const { listWards, resolveWard } = require('../../shared/administrativeUnits');

const GEOCODING_URL = 'https://api.distancematrix.ai/maps/api/geocode/json';
const WARD_PREFIXES = /^(quan|huyen|district|urban district|thanh pho|tp|phuong|ward|p|xa|commune|dac khu)\s+/i;
// Addresses this close together are treated as the same place (ward-border tolerance).
const SAME_PLACE_METERS = 300;

// Streets whose names are numbers can be written either way ("3 Thang 2" / "Ba Thang Hai").
const STREET_ALIASES = [
  [/\bba thang hai\b/g, '3 thang 2'],
  [/\bcach mang thang tam\b/g, 'cach mang thang 8'],
  [/\bba muoi thang tu\b/g, '30 thang 4'],
  [/\bhai muoi ba thang chin\b/g, '23 thang 9'],
];
const STREET_TYPE_PREFIX = /^(duong|d|pho|hem|ngo)\s+/;

/** Name as the geocoder knows it: "Thanh An (Can Gio)" -> "Thanh An". */
function placeName(ward) {
  return ward.name.replace(/\s*\(.*\)$/, '');
}

/** Normalised ward names of one city, used to tell "wrong ward" from "unknown place". */
function knownWards(cityId) {
  return new Set(listWards(cityId).map((ward) => normalizeText(placeName(ward))));
}

function geocodingError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

/** Same text without Vietnamese accents, keeping case and punctuation. */
function toEnglishAddress(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[đĐ]/g, 'd')
    .replace(WARD_PREFIXES, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeStreet(value) {
  let text = normalizeText(value).replace(STREET_TYPE_PREFIX, '');
  STREET_ALIASES.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });
  return text;
}

function assertConfigured() {
  if (!process.env.GEOCODING_API_KEY) {
    throw geocodingError('Address verification is temporarily unavailable.', 503);
  }
}

function parseStreetInput(value) {
  const match = String(value).trim().match(/^([A-Za-z]?\d+[A-Za-z]?(?:\s*[-/]\s*[A-Za-z]?\d+[A-Za-z]?)*)\s+(.+)$/);
  return match
    ? { houseNumber: match[1].replace(/\s+/g, ''), roadName: match[2].trim() }
    : { houseNumber: '', roadName: String(value).trim() };
}

function getAddressComponents(result) {
  return Array.isArray(result?.address_components) ? result.address_components : [];
}

function getComponentValues(result, fields) {
  return getAddressComponents(result)
    .filter((component) => component.types?.some((type) => fields.includes(type)))
    .map((component) => component.long_name || component.short_name || '');
}

/** "10 Nguyễn Huệ, Sài Gòn, Hồ Chí Minh 70000, Vietnam" -> ["10 nguyen hue", "sai gon", ...] */
function getAddressSegments(result) {
  return String(result?.formatted_address || '').split(',').map((part) => part.trim()).filter(Boolean);
}

function isCitySegment(segment) {
  return /^(ho chi minh|ha noi|hanoi)( \d+)?$/.test(normalizeText(segment));
}

/**
 * The ward the geocoder placed the result in. The provider glues the ward onto
 * route/locality components ("dien bien phu gia dinh"), so the reliable source
 * is the formatted address: the last segment before the city.
 */
function getResultWard(result) {
  const segments = getAddressSegments(result);
  const cityIndex = segments.findIndex(isCitySegment);
  if (cityIndex > 1) return normalizeText(segments[cityIndex - 1]);

  const suburb = getComponentValues(result, ['suburb', 'sublocality', 'administrative_area_level_3'])[0];
  if (suburb) return normalizeText(suburb);
  const locality = normalizeText(getComponentValues(result, ['locality'])[0]).replace(/\s*(ho chi minh|ha noi|hanoi)$/, '');
  return locality || '';
}

function isWardMatch(result, ward) {
  const resultWard = getResultWard(result);
  return Boolean(resultWard) && resultWard === normalizeText(ward);
}

/** The street part of the first formatted segment, e.g. "10 Nguyễn Huệ" -> "nguyen hue". */
function getFormattedStreet(result) {
  const first = getAddressSegments(result)[0] || '';
  return normalizeStreet(parseStreetInput(first).roadName);
}

/**
 * Alley results name the alley as the road: "47/24 Hẻm 47 Bùi Đình Túy" has the
 * route "hẻm 47 bùi đình túy". Strip "hem <alley number>" so it compares with
 * the main street the user typed.
 */
function stripAlleyPrefix(value, houseNumber) {
  const text = normalizeText(value);
  const alleyParts = String(houseNumber || '').split('/').slice(0, -1).map(normalizeText).filter(Boolean);
  if (!alleyParts.length) return text;
  for (let count = alleyParts.length; count > 0; count -= 1) {
    const prefix = `hem ${alleyParts.slice(0, count).join(' ')} `;
    if (text.startsWith(prefix)) return text.slice(prefix.length);
  }
  return text;
}

function isStreetMatch(result, roadName, houseNumber = '') {
  const expected = normalizeStreet(roadName);
  if (!expected) return false;
  const firstSegmentRoad = parseStreetInput(getAddressSegments(result)[0] || '').roadName;
  const candidates = [
    getFormattedStreet(result),
    ...getComponentValues(result, ['route']).map(normalizeStreet),
    normalizeStreet(stripAlleyPrefix(firstSegmentRoad, houseNumber)),
    ...getComponentValues(result, ['route']).map((route) => normalizeStreet(stripAlleyPrefix(route, houseNumber))),
  ].filter(Boolean);
  // Routes may carry a ward suffix ("phan xich long cau kieu"), so the
  // candidate must start with the requested street name.
  return candidates.some((candidate) => candidate === expected || candidate.startsWith(`${expected} `));
}

// Keep "/" and "-" so an alley number ("/50", "12/3") never equals a main-street number ("50").
function normalizeHouseNumber(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function isHouseNumberMatch(result, houseNumber) {
  const expected = normalizeHouseNumber(houseNumber);
  if (!expected) return false;
  const first = getAddressSegments(result)[0] || '';
  if (normalizeHouseNumber(parseStreetInput(first).houseNumber) === expected) return true;
  return getComponentValues(result, ['street_number'])
    .some((candidate) => normalizeHouseNumber(candidate) === expected);
}

function isAddressMatch(result, { houseNumber, roadName }) {
  return isStreetMatch(result, roadName, houseNumber) && isHouseNumberMatch(result, houseNumber);
}

/**
 * The provider resolves "47/24 Bui Dinh Tuy" poorly (empty result, or a deeper
 * sub-alley such as 47/24/30C) but resolves the Vietnamese alley form
 * "24 Hem 47 Bui Dinh Tuy" to the exact house. Returns null for main-street numbers.
 */
function toAlleyQuery({ houseNumber, roadName }) {
  const parts = String(houseNumber || '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return `${parts.at(-1)} Hem ${parts.slice(0, -1).join('/')} ${roadName}`;
}

/** Geocode the typed address and, for alley numbers, the alley form; return all results. */
async function geocodeAddress(parsed, typedStreet, suffix) {
  const results = await geocode(`${typedStreet}, ${suffix}`);
  if (results.some((result) => isAddressMatch(result, parsed))) return results;
  const alleyQuery = toAlleyQuery(parsed);
  return alleyQuery ? [...results, ...(await geocode(`${alleyQuery}, ${suffix}`))] : results;
}

function getCoordinates(result) {
  const latitude = Number(result?.geometry?.location?.lat);
  const longitude = Number(result?.geometry?.location?.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function distanceMeters(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLng = (b.longitude - a.longitude) * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function toDisplayWard(normalizedWard, cityId) {
  const match = listWards(cityId).find((ward) => normalizeText(placeName(ward)) === normalizedWard);
  return match ? match.name : normalizedWard.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function geocode(query) {
  const url = new URL(process.env.GEOCODING_API_URL || GEOCODING_URL);
  url.searchParams.set('address', query);
  url.searchParams.set('key', process.env.GEOCODING_API_KEY);

  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw geocodingError('Address verification is temporarily unavailable.', 503);
  }
  if (response.status === 429 || response.status === 503) {
    throw geocodingError('Address verification is temporarily unavailable. Please try again shortly.', 503);
  }
  if (!response.ok) {
    throw geocodingError('Address verification is temporarily unavailable.', 503);
  }

  const payload = await response.json();
  if (payload.status === 'REQUEST_DENIED' || payload.status === 'OVER_QUERY_LIMIT') {
    throw geocodingError('Address verification is temporarily unavailable.', 503);
  }
  return Array.isArray(payload.result) ? payload.result : [];
}

function toVerifiedAddress(result, { wardId, ward, streetName }) {
  const coordinates = getCoordinates(result);
  if (!coordinates) {
    throw geocodingError('The address was found, but its coordinates are unavailable.', 503);
  }
  return {
    // The app is in English: store the provider's address without accents
    // ("Hẻm 47 Bùi Đình Túy" -> "Hem 47 Bui Dinh Tuy").
    address: toEnglishAddress(result.formatted_address),
    placeId: result.place_id || null,
    ...coordinates,
    wardId,
    ward,
    streetName,
  };
}

/**
 * Verify "<house number> <street>" really lies in the chosen ward (wardId = official code).
 *
 * The provider echoes whatever ward is in the query and invents a point for it
 * (kilometres away from the real house), so the ward must not be trusted from a
 * ward-hinted query. We first geocode without the ward and compare the ward the
 * provider finds. The ward-hinted query is only used when the unhinted answer is
 * no evidence against the user: it found nothing usable, it resolved to a
 * same-named street outside the supported wards, or both answers are the same place.
 */
async function verifyAddress({ wardId, streetName }) {
  const ward = resolveWard(wardId);
  const normalizedStreet = String(streetName || '').trim().replace(/\s+/g, ' ');
  if (normalizedStreet.length < 3) {
    throw geocodingError('Please enter at least 3 characters for the street name.');
  }

  const parsed = parseStreetInput(normalizedStreet);
  if (!parsed.houseNumber) {
    throw geocodingError('Please include the house number, e.g. "10 Nguyen Hue".');
  }

  assertConfigured();
  const known = knownWards(ward.cityId);
  const citySuffix = `${ward.city.geocodeName}, Vietnam`;
  const context = { wardId: ward.id, ward: ward.name, streetName: normalizedStreet };

  const unhinted = (await geocodeAddress(parsed, normalizedStreet, citySuffix))
    .find((result) => isAddressMatch(result, parsed));
  if (unhinted && isWardMatch(unhinted, placeName(ward))) {
    return toVerifiedAddress(unhinted, context);
  }

  const hintedResults = (await geocodeAddress(parsed, normalizedStreet, `${placeName(ward)}, ${citySuffix}`))
    .filter((result) => isAddressMatch(result, parsed));
  const hinted = hintedResults.find((result) => isWardMatch(result, placeName(ward)));
  const hintedOtherWard = hintedResults.map(getResultWard).find((name) => known.has(name));

  if (unhinted) {
    const actualWard = getResultWard(unhinted);
    const unhintedPoint = getCoordinates(unhinted);
    const hintedPoint = getCoordinates(hinted);
    const samePlace = unhintedPoint && hintedPoint
      && distanceMeters(unhintedPoint, hintedPoint) <= SAME_PLACE_METERS;
    if (hinted && (samePlace || !known.has(actualWard))) {
      return toVerifiedAddress(hinted, context);
    }
    if (known.has(actualWard)) {
      throw geocodingError(
        `"${normalizedStreet}" belongs to ${toDisplayWard(actualWard, ward.cityId)}, not ${ward.name}. Please check the ward.`
      );
    }
  }

  if (hinted) return toVerifiedAddress(hinted, context);
  if (hintedOtherWard) {
    throw geocodingError(
      `"${normalizedStreet}" belongs to ${toDisplayWard(hintedOtherWard, ward.cityId)}, not ${ward.name}. Please check the ward.`
    );
  }
  // The client uses this code to offer the "nearby address" option.
  throw Object.assign(geocodingError(
    `"${normalizedStreet}" could not be found in ${ward.name}. Please check the house number and street name.`
  ), { code: 'ADDRESS_NOT_FOUND' });
}

module.exports = {
  normalizeText,
  normalizeStreet,
  parseStreetInput,
  getResultWard,
  isWardMatch,
  isStreetMatch,
  isHouseNumberMatch,
  toAlleyQuery,
  toEnglishAddress,
  verifyAddress,
};
