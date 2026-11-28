// Distance-based ranking for provider task suggestions. No model is needed:
// every task has an exact site point and every ward has a centre, so "nearby"
// is the straight-line distance between the provider and the task.
const { getWard } = require('../../shared/administrativeUnits');

const EARTH_RADIUS_KM = 6371;
/** Score at 0 km; it halves roughly every 2.8 km (e^(-d/4)). */
const MAX_LOCATION_SCORE = 60;
const DECAY_KM = 4;

function isPoint(point) {
  return Boolean(point) && Number.isFinite(point.latitude) && Number.isFinite(point.longitude);
}

/** Great-circle distance in kilometres. */
function distanceKm(a, b) {
  if (!isPoint(a) || !isPoint(b)) return null;
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLng = (b.longitude - a.longitude) * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function wardCentre(wardId) {
  const ward = getWard(wardId);
  return ward && Number.isFinite(ward.lat) ? { latitude: ward.lat, longitude: ward.lng } : null;
}

/** Provider's home point, or the centre of their ward when the house is not on the map. */
function providerPoint(home) {
  const exact = { latitude: home?.homeLatitude, longitude: home?.homeLongitude };
  return isPoint(exact) ? exact : wardCentre(home?.locationId);
}

/** Task's verified site point, or the centre of its ward for older tasks. */
function taskPoint(task) {
  const exact = { latitude: Number(task?.siteLatitude), longitude: Number(task?.siteLongitude) };
  return task?.siteLatitude != null && isPoint(exact) ? exact : wardCentre(task?.locationId);
}

/** 60 at the door, ~36 at 2 km, ~22 at 4 km, ~8 at 8 km, ~1 at 15 km. */
function locationScore(km) {
  if (km == null) return 0;
  return Math.round(MAX_LOCATION_SCORE * Math.exp(-km / DECAY_KM));
}

/**
 * Distance shown to the provider, rounded to 0.5 km (never below 0.5) so the
 * exact task site cannot be worked out from it before the provider is hired.
 */
function displayDistanceKm(km) {
  if (km == null) return null;
  return Math.max(0.5, Math.round(km * 2) / 2);
}

module.exports = {
  distanceKm,
  wardCentre,
  providerPoint,
  taskPoint,
  locationScore,
  displayDistanceKm,
  MAX_LOCATION_SCORE,
};
