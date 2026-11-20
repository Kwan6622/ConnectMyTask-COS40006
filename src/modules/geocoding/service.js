const GEOCODING_URL = 'https://api.distancematrix.ai/maps/api/geocode/json';
const DISTRICT_PREFIXES = /^(quan|huyen|district|urban district|thanh pho|tp|phuong|ward)\s+/i;
const ADMINISTRATIVE_FIELDS = [
  'district',
  'city_district',
  'county',
  'municipality',
  'suburb',
  'locality',
];

function geocodingError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[đĐ]/g, 'd')
    .replace(DISTRICT_PREFIXES, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function assertConfigured() {
  if (!process.env.GEOCODING_API_KEY) {
    throw geocodingError('Address verification is temporarily unavailable.', 503);
  }
}

function parseStreetInput(value) {
  const match = String(value).trim().match(/^([A-Za-z]?\d+[A-Za-z]?(?:\s*[-/]\s*[A-Za-z]?\d+[A-Za-z]?)?)\s+(.+)$/);
  return match
    ? { houseNumber: match[1], roadName: match[2].trim() }
    : { houseNumber: '', roadName: String(value).trim() };
}

function getAddressComponents(result) {
  return Array.isArray(result?.address_components) ? result.address_components : [];
}

function getComponentValues(result, fields) {
  return getAddressComponents(result)
    .filter((component) => component.types?.some((type) => fields.includes(type)))
    .flatMap((component) => [component.long_name, component.short_name])
    .map(normalizeText)
    .filter(Boolean);
}

function getAdministrativeValues(result) {
  return getComponentValues(result, ADMINISTRATIVE_FIELDS);
}

function isDistrictMatch(result, district) {
  const expected = normalizeText(district);
  const administrativeMatch = getAdministrativeValues(result).some((candidate) => (
    candidate === expected || candidate.includes(expected) || expected.includes(candidate)
  ));
  if (administrativeMatch) return true;

  // Some geocoding results encode a ward in the route name when a street
  // crosses ward boundaries (for example, "phan xich long cau kieu").
  const routeValues = getComponentValues(result, ['route']);
  const formattedAddress = normalizeText(result?.formatted_address);
  return routeValues.some((candidate) => candidate.includes(expected))
    || formattedAddress.includes(expected);
}

function isStreetMatch(result, roadName) {
  const expected = normalizeText(roadName);
  const route = getComponentValues(result, ['route']);
  return route.some((candidate) => (
    candidate === expected || candidate.includes(expected) || expected.includes(candidate)
  ));
}

function isHouseNumberMatch(result, houseNumber) {
  if (!houseNumber) return true;
  return getComponentValues(result, ['street_number'])
    .some((candidate) => candidate === normalizeText(houseNumber));
}

async function verifyAddress({ district, streetName }) {
  const normalizedDistrict = String(district || '').trim();
  const normalizedStreet = String(streetName || '').trim();
  if (normalizedDistrict.length < 2) {
    throw geocodingError('Please select a ward in Ho Chi Minh City.');
  }
  if (normalizedStreet.length < 3) {
    throw geocodingError('Please enter at least 3 characters for the street name.');
  }

  assertConfigured();
  const { houseNumber, roadName } = parseStreetInput(normalizedStreet);
  const query = `${normalizedStreet}, ${normalizedDistrict}, Ho Chi Minh, Vietnam`;
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

  const results = Array.isArray(payload.result) ? payload.result : [];
  const matchingResult = results.find((result) => (
    isStreetMatch(result, roadName)
      && isHouseNumberMatch(result, houseNumber)
      && isDistrictMatch(result, normalizedDistrict)
  ));

  if (!matchingResult) {
    const streetResult = results.find((result) => isStreetMatch(result, roadName));
    if (!streetResult) {
      throw geocodingError(`Street "${normalizedStreet}" could not be found in ${normalizedDistrict}.`);
    }
    if (houseNumber && !isHouseNumberMatch(streetResult, houseNumber)) {
      throw geocodingError(`House number "${houseNumber}" could not be located on ${roadName}.`);
    }
    throw geocodingError(`Street "${normalizedStreet}" does not belong to ${normalizedDistrict}. Please check again.`);
  }

  const location = matchingResult.geometry?.location;
  const latitude = Number(location?.lat);
  const longitude = Number(location?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw geocodingError('The address was found, but its coordinates are unavailable.', 503);
  }

  return {
    address: matchingResult.formatted_address || query,
    placeId: matchingResult.place_id || null,
    latitude,
    longitude,
    district: normalizedDistrict,
    streetName: normalizedStreet,
  };
}

module.exports = { normalizeText, verifyAddress };
