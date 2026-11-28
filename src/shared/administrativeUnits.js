// Cities and wards (two-level system in force since 1 July 2025: no districts).
// Data: administrativeUnits.json, refreshed by database/scripts/fetch-administrative-units.js.
// Ids are official codes and match the CITIES / LOCATIONS tables on every DB branch.
const data = require('./administrativeUnits.json');

/** Lower-case, no diacritics, single spaces: "Bến Thành" -> "ben thanh". */
function toSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CITIES = data.cities.map(({ wards, ...city }) => city);
const WARDS = data.cities.flatMap((city) => city.wards.map((ward) => ({ ...ward, cityId: city.id })));
const WARD_BY_ID = new Map(WARDS.map((ward) => [ward.id, ward]));
const CITY_BY_ID = new Map(CITIES.map((city) => [city.id, city]));

function getCity(cityId) {
  return CITY_BY_ID.get(Number(cityId)) || null;
}

function getWard(wardId) {
  return WARD_BY_ID.get(Number(wardId)) || null;
}

function listWards(cityId) {
  return WARDS.filter((ward) => ward.cityId === Number(cityId));
}

/** "Ben Thanh, Ho Chi Minh City": the public, non-identifying location text. */
function formatWardLocation(ward) {
  const city = ward && getCity(ward.cityId);
  return ward && city ? `${ward.name}, ${city.name}` : null;
}

/**
 * Resolve a ward id sent by a client. Throws a 400 the API can show as-is,
 * so a free-typed ward that was never picked from the list is rejected.
 */
function resolveWard(wardId) {
  const ward = getWard(wardId);
  if (!ward) {
    throw Object.assign(new Error('Please choose a city, then pick your ward from the suggestions.'), { statusCode: 400 });
  }
  return { ...ward, city: getCity(ward.cityId), location: formatWardLocation(ward) };
}

module.exports = {
  CITIES,
  WARDS,
  getCity,
  getWard,
  listWards,
  resolveWard,
  formatWardLocation,
  toSearchText,
  source: { url: data.source, effectiveFrom: data.effectiveFrom, fetchedAt: data.fetchedAt },
};
