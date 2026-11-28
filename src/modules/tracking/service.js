const trackingRepository = require('./repository');
const notificationRepository = require('../notifications/repository');
const taskRepository = require('../tasks/repository');
const { withTaskLock } = require('../../database/taskTransaction');
const { getWard, formatWardLocation } = require('../../shared/administrativeUnits');

// Provider must be within this distance of the verified task address to start work.
const VERIFICATION_RADIUS_METERS = 100;
// Live journey sharing and arrival check both accept GPS fixes up to 100 m accuracy
// (MERGE decision; main uses 20 m for the arrival check).
const MAX_LOCATION_UPDATE_ACCURACY_METERS = 100;
const MAX_VERIFICATION_ACCURACY_METERS = 100;
const MAX_LOCATION_AGE_MS = 2 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 15 * 1000;
const VERIFICATION_TTL_MS = 60 * 60 * 1000;
const DISTANCE_COMPARISON_TOLERANCE_METERS = 1e-6;
const OSRM_ROUTING_BASE_URL = 'https://router.project-osrm.org';
const ROUTE_CACHE_TTL_MS = 30 * 1000;
const ROUTE_CACHE_MAX_AGE_MS = 2 * 60 * 1000;
const ROUTE_REFRESH_DISTANCE_METERS = 200;
const ROUTE_OFF_PATH_THRESHOLD_METERS = 40;
const ROUTE_REQUEST_TIMEOUT_MS = 10 * 1000;
const ACTIVE_TASK_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION'];
const liveLocations = new Map();
const routeCache = new Map();
const routeRequests = new Map();
let liveLocationSequence = 0;

function validateTaskId(taskId) {
  if (!/^[1-9]\d*$/.test(String(taskId)) || !Number.isSafeInteger(Number(taskId))) {
    throw Object.assign(new Error('Invalid task ID'), { statusCode: 400 });
  }
  return Number(taskId);
}

function assertTaskParticipant(task, user, action) {
  if (!task || task.isDeleted) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
  const role = String(user?.role || '').toUpperCase();
  if (role !== 'ADMIN' && task.createdById !== user?.id && task.assignedProviderId !== user?.id) {
    throw Object.assign(new Error(`Only task participants can ${action}`), { statusCode: 403 });
  }
}

function assertEscrowFunded(task) {
  if (task.escrowStatus !== 'HELD') {
    throw Object.assign(new Error('Requester must fund escrow before tracking is available'), {
      statusCode: 409,
      code: 'ESCROW_FUNDING_REQUIRED',
    });
  }
}

function saveLiveLocation(taskId, providerId, payload, timestamp, source = 'GPS') {
  const now = Date.now();
  for (const [cachedTaskId, location] of liveLocations) {
    if (now - location.receivedAt > MAX_LOCATION_AGE_MS) liveLocations.delete(cachedTaskId);
  }
  liveLocationSequence += 1;
  const liveLocation = {
    id: `live-${taskId}-${liveLocationSequence}`,
    taskId,
    providerId,
    lat: payload.lat,
    lng: payload.lng,
    accuracy: payload.accuracy,
    source,
    timestamp: timestamp.toISOString(),
    receivedAt: now,
  };
  liveLocations.set(taskId, liveLocation);
  const { receivedAt: _receivedAt, ...response } = liveLocation;
  return response;
}

function parseLocationTimestamp(value, now = Date.now()) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw Object.assign(new Error('Invalid location timestamp'), { statusCode: 400 });
  }
  const age = now - timestamp.getTime();
  if (age > MAX_LOCATION_AGE_MS) throw Object.assign(new Error('GPS location is stale'), { statusCode: 409 });
  if (age < -MAX_FUTURE_SKEW_MS) throw Object.assign(new Error('GPS timestamp is in the future'), { statusCode: 409 });
  return timestamp;
}

function assertAccuracy(accuracy, maximum) {
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > maximum) {
    throw Object.assign(new Error(`GPS accuracy must be within ${maximum} metres`), { statusCode: 409 });
  }
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const radians = value => value * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceFromPointToRouteMeters(point, routeCoordinates) {
  if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) return Infinity;
  const metersPerLatitudeDegree = 111320;
  const metersPerLongitudeDegree = metersPerLatitudeDegree
    * Math.max(0.01, Math.cos(point.latitude * Math.PI / 180));
  const project = coordinate => ({
    x: (coordinate.longitude - point.longitude) * metersPerLongitudeDegree,
    y: (coordinate.latitude - point.latitude) * metersPerLatitudeDegree,
  });
  let minimumDistanceSquared = Infinity;

  for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
    const start = project(routeCoordinates[index]);
    const end = project(routeCoordinates[index + 1]);
    const segmentX = end.x - start.x;
    const segmentY = end.y - start.y;
    const segmentLengthSquared = segmentX ** 2 + segmentY ** 2;
    const fraction = segmentLengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, -(start.x * segmentX + start.y * segmentY) / segmentLengthSquared));
    const distanceX = start.x + fraction * segmentX;
    const distanceY = start.y + fraction * segmentY;
    minimumDistanceSquared = Math.min(
      minimumDistanceSquared,
      distanceX ** 2 + distanceY ** 2
    );
  }

  return Math.sqrt(minimumDistanceSquared);
}

function assertProviderTask(task, user) {
  if (!task || task.isDeleted) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
  if (String(user?.role || '').toUpperCase() !== 'PROVIDER' || task.assignedProviderId !== user.id) {
    throw Object.assign(new Error('Only the assigned provider can verify this task'), { statusCode: 403 });
  }
  if (!ACTIVE_TASK_STATUSES.includes(task.status)) {
    throw Object.assign(new Error('Location verification requires an active task'), { statusCode: 409 });
  }
  if (!task.siteAddress || !Number.isFinite(task.siteLatitude) || !Number.isFinite(task.siteLongitude)) {
    throw Object.assign(new Error('Task has no trusted site coordinates'), { statusCode: 409 });
  }
}

async function requireValidVerification(task, providerId, now = new Date()) {
  const verification = await trackingRepository.getLatestVerification(task.id, providerId);
  if (!verification
    || verification.revokedAt
    || verification.expiresAt <= now
    || verification.siteVersion !== Number(task.siteVersion || 1)
    || task.escrowStatus !== 'HELD'
    || task.assignedProviderId !== providerId
    || !ACTIVE_TASK_STATUSES.includes(task.status)) {
    throw Object.assign(new Error('Valid task location verification is required'), {
      statusCode: 409,
      code: 'LOCATION_VERIFICATION_REQUIRED',
    });
  }
  return verification;
}

async function verifyTaskLocation(taskId, payload, user) {
  return withTaskLock(taskId, async () => {
    const task = await trackingRepository.getTaskById(taskId);
    assertProviderTask(task, user);
    if (task.escrowStatus !== 'HELD') {
      throw Object.assign(new Error('Requester must fund escrow before location verification'), {
        statusCode: 409,
        code: 'ESCROW_FUNDING_REQUIRED',
      });
    }
    if (await trackingRepository.getVerificationByRequestId(payload.requestId)) {
      throw Object.assign(new Error('Location verification request was already used'), { statusCode: 409 });
    }
    const locationTimestamp = parseLocationTimestamp(payload.timestamp);
    assertAccuracy(payload.accuracy, MAX_VERIFICATION_ACCURACY_METERS);
    const measuredDistance = distanceMeters(payload.lat, payload.lng, task.siteLatitude, task.siteLongitude);
    if (measuredDistance - VERIFICATION_RADIUS_METERS > DISTANCE_COMPARISON_TOLERANCE_METERS) {
      // No distance in the message on purpose (MERGE decision); the details carry it.
      throw Object.assign(new Error("You are not at the job site yet. Move closer to the task address and try again."), {
        statusCode: 409,
        details: { distanceMeters: Math.round(measuredDistance), allowedMeters: VERIFICATION_RADIUS_METERS },
      });
    }
    const now = new Date();
    await trackingRepository.revokeTaskVerifications(taskId, 'REPLACED_BY_NEW_VERIFICATION', now);
    const verification = await trackingRepository.createVerification({
      requestId: payload.requestId,
      taskId,
      providerId: user.id,
      siteVersion: Number(task.siteVersion || 1),
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy,
      distanceMeters: measuredDistance,
      locationTimestamp,
      verifiedAt: now,
      expiresAt: new Date(now.getTime() + VERIFICATION_TTL_MS),
    });
    saveLiveLocation(taskId, user.id, payload, locationTimestamp);
    await taskRepository.createTaskActivity({
      taskId,
      actorId: user.id,
      action: 'LOCATION_VERIFIED',
      message: 'Assigned provider verified their location at the task site.',
      metadata: { distanceMeters: Math.round(measuredDistance), expiresAt: verification.expiresAt },
    });
    await notificationRepository.createNotification({
      recipientId: task.createdById,
      senderId: user.id,
      taskId,
      message: `Provider verified their location for "${task.title}".`,
    });
    return {
      isValid: true,
      distanceMeters: Math.round(measuredDistance),
      verifiedAt: verification.verifiedAt,
      expiresAt: verification.expiresAt,
    };
  });
}

async function recordLocationUpdate(payload, user) {
  if (!user?.id) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  if (payload.providerId != null && payload.providerId !== user.id) {
    throw Object.assign(new Error('Provider identity mismatch'), { statusCode: 403 });
  }
  const source = payload.source || 'GPS';
  if (source === 'DEMO' && process.env.NODE_ENV === 'production') {
    throw Object.assign(new Error('Simulated GPS updates are disabled in production'), { statusCode: 403 });
  }
  return withTaskLock(payload.taskId, async () => {
    const task = await trackingRepository.getTaskById(payload.taskId);
    assertProviderTask(task, user);
    assertEscrowFunded(task);
    const timestamp = parseLocationTimestamp(payload.timestamp);
    assertAccuracy(payload.accuracy, MAX_LOCATION_UPDATE_ACCURACY_METERS);
    return saveLiveLocation(payload.taskId, user.id, payload, timestamp, source);
  });
}

async function getLatestLocation(taskId, user) {
  const id = validateTaskId(taskId);
  const task = await trackingRepository.getTaskById(id);
  assertTaskParticipant(task, user, 'read tracking');
  assertEscrowFunded(task);
  const location = liveLocations.get(id);
  if (!location
    || !ACTIVE_TASK_STATUSES.includes(task.status)
    || location.providerId !== task.assignedProviderId
    || Date.now() - location.receivedAt > MAX_LOCATION_AGE_MS) {
    liveLocations.delete(id);
    return null;
  }
  return {
    id: location.id,
    taskId: location.taskId,
    providerId: location.providerId,
    lat: location.lat,
    lng: location.lng,
    accuracy: location.accuracy,
    source: location.source,
    timestamp: location.timestamp,
  };
}

async function getDrivingRoute(taskId, user) {
  const id = validateTaskId(taskId);
  const task = await trackingRepository.getTaskById(id);
  assertTaskParticipant(task, user, 'view tracking');
  assertEscrowFunded(task);

  const hasTaskCoordinates = Number.isFinite(task.siteLatitude)
    && Number.isFinite(task.siteLongitude)
    && task.siteLatitude >= -90 && task.siteLatitude <= 90
    && task.siteLongitude >= -180 && task.siteLongitude <= 180;
  if (!hasTaskCoordinates) {
    throw Object.assign(new Error('Task has no saved requester map pin'), { statusCode: 409 });
  }

  const providerLocation = await getLatestLocation(id, user);
  if (!providerLocation) return null;
  const origin = { latitude: providerLocation.lat, longitude: providerLocation.lng };
  const destination = { latitude: task.siteLatitude, longitude: task.siteLongitude };
  const now = Date.now();

  for (const [cachedTaskId, cachedRoute] of routeCache) {
    if (now - cachedRoute.cachedAt > ROUTE_CACHE_MAX_AGE_MS) routeCache.delete(cachedTaskId);
  }

  const cached = routeCache.get(id);
  if (cached
    && cached.destination.latitude === destination.latitude
    && cached.destination.longitude === destination.longitude
    && now - cached.cachedAt < ROUTE_CACHE_TTL_MS
    && distanceMeters(origin.latitude, origin.longitude, cached.origin.latitude, cached.origin.longitude)
      < ROUTE_REFRESH_DISTANCE_METERS
    && distanceFromPointToRouteMeters(origin, cached.route.coordinates)
      <= Math.max(ROUTE_OFF_PATH_THRESHOLD_METERS, providerLocation.accuracy || 0)) {
    return cached.route;
  }

  const pendingRequest = routeRequests.get(id);
  if (pendingRequest
    && pendingRequest.destination.latitude === destination.latitude
    && pendingRequest.destination.longitude === destination.longitude
    && distanceMeters(origin.latitude, origin.longitude, pendingRequest.origin.latitude, pendingRequest.origin.longitude) < 1) {
    return pendingRequest.promise;
  }

  const routeUrl = new URL(
    `${OSRM_ROUTING_BASE_URL}/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`
  );
  routeUrl.searchParams.set('overview', 'full');
  routeUrl.searchParams.set('geometries', 'geojson');

  const routePromise = (async () => {
    let response;
    let result;
    try {
      response = await fetch(routeUrl, { signal: AbortSignal.timeout(ROUTE_REQUEST_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`OSRM returned ${response.status}`);
      result = await response.json();
    } catch (error) {
      throw Object.assign(new Error('Unable to retrieve a road route from OSRM'), {
        statusCode: 502,
        cause: error,
      });
    }

    const route = result?.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    const validCoordinates = Array.isArray(coordinates)
      && coordinates.length >= 2
      && coordinates.every(coordinate => Array.isArray(coordinate)
        && coordinate.length >= 2
        && Number.isFinite(coordinate[0])
        && Number.isFinite(coordinate[1])
        && Math.abs(coordinate[0]) <= 180
        && Math.abs(coordinate[1]) <= 90);
    if (result?.code !== 'Ok'
      || !validCoordinates
      || !Number.isFinite(route.distance)
      || !Number.isFinite(route.duration)) {
      throw Object.assign(new Error('OSRM did not return a usable driving route'), { statusCode: 502 });
    }

    const roadRoute = {
      coordinates: coordinates.map(([longitude, latitude]) => ({ latitude, longitude })),
      distanceKm: route.distance / 1000,
      durationMinutes: route.duration / 60,
    };
    routeCache.set(id, { origin, destination, route: roadRoute, cachedAt: Date.now() });
    return roadRoute;
  })();
  routeRequests.set(id, { origin, destination, promise: routePromise });

  try {
    return await routePromise;
  } finally {
    if (routeRequests.get(id)?.promise === routePromise) routeRequests.delete(id);
  }
}

async function getLocationHistory(taskId, user) {
  const id = validateTaskId(taskId);
  const task = await trackingRepository.getTaskById(id);
  assertTaskParticipant(task, user, 'read tracking');
  assertEscrowFunded(task);
  return [];
}

async function getVerificationStatus(taskId, user) {
  const task = await trackingRepository.getTaskById(taskId);
  if (!task || task.isDeleted) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
  const role = String(user?.role || '').toUpperCase();
  if (role !== 'ADMIN' && task.createdById !== user?.id && task.assignedProviderId !== user?.id) {
    throw Object.assign(new Error('Only task participants can view verification'), { statusCode: 403 });
  }
  const verification = task.assignedProviderId
    ? await trackingRepository.getLatestVerification(taskId, task.assignedProviderId)
    : null;
  const isValid = Boolean(verification
    && !verification.revokedAt
    && verification.expiresAt > new Date()
    && verification.siteVersion === Number(task.siteVersion || 1)
    && task.escrowStatus === 'HELD'
    && ACTIVE_TASK_STATUSES.includes(task.status));
  let reason = null;
  if (!isValid) {
    if (task.escrowStatus !== 'HELD') reason = 'ESCROW_NOT_FUNDED';
    else if (verification?.revokedAt) reason = verification.revokeReason;
    else reason = verification ? 'EXPIRED_OR_TASK_STATE_CHANGED' : 'NOT_VERIFIED';
  }
  return {
    isValid,
    verifiedAt: verification?.verifiedAt || null,
    expiresAt: verification?.expiresAt || null,
    distanceMeters: verification ? Math.round(verification.distanceMeters) : null,
    reason,
  };
}

async function getTaskSiteLocation(taskId, user) {
  const task = await trackingRepository.getTaskById(taskId);
  if (!task || task.isDeleted) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
  assertTaskParticipant(task, user, 'view the task location');
  assertEscrowFunded(task);
  const hasCoordinates = Number.isFinite(task.siteLatitude)
    && Number.isFinite(task.siteLongitude)
    && task.siteLatitude >= -90 && task.siteLatitude <= 90
    && task.siteLongitude >= -180 && task.siteLongitude <= 180;
  // Once the task is assigned and funded, participants get the private address
  // details (unit / floor, or the exact address when the site is a nearby spot).
  // Older nearby-address tasks without details fall back to the profile home address.
  let requesterAddress = null;
  if (task.isApproximateLocation && !task.addressDetail) {
    const home = await trackingRepository.getRequesterHomeAddress(task.id);
    const wardText = formatWardLocation(getWard(home?.locationId));
    requesterAddress = home?.streetAddress
      ? [home.streetAddress, wardText].filter(Boolean).join(', ')
      : null;
  }
  return {
    siteAddress: task.siteAddress || null,
    siteLatitude: hasCoordinates ? task.siteLatitude : null,
    siteLongitude: hasCoordinates ? task.siteLongitude : null,
    available: hasCoordinates,
    isApproximateLocation: Boolean(task.isApproximateLocation),
    addressDetail: task.addressDetail || null,
    requesterAddress,
  };
}

const revokeTaskVerification = (taskId, reason) =>
  trackingRepository.revokeTaskVerifications(taskId, reason);

module.exports = {
  recordLocationUpdate,
  getLatestLocation,
  getDrivingRoute,
  getLocationHistory,
  verifyTaskLocation,
  getVerificationStatus,
  getTaskSiteLocation,
  requireValidVerification,
  revokeTaskVerification,
  distanceMeters,
  constants: {
    VERIFICATION_RADIUS_METERS,
    MAX_LOCATION_UPDATE_ACCURACY_METERS,
    MAX_VERIFICATION_ACCURACY_METERS,
    MAX_LOCATION_AGE_MS,
    MAX_FUTURE_SKEW_MS,
    VERIFICATION_TTL_MS,
  },
};
