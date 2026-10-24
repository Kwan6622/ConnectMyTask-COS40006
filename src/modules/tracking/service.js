const trackingRepository = require('./repository');
const notificationRepository = require('../notifications/repository');
const taskRepository = require('../tasks/repository');
const { withTaskLock } = require('../../database/taskTransaction');

const VERIFICATION_RADIUS_METERS = 1000;
const MAX_GPS_ACCURACY_METERS = 100;
const MAX_LOCATION_AGE_MS = 2 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 15 * 1000;
const VERIFICATION_TTL_MS = 60 * 60 * 1000;
const ACTIVE_TASK_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION'];
const liveLocations = new Map();
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

function saveLiveLocation(taskId, providerId, payload, timestamp) {
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

function assertAccuracy(accuracy) {
  if (!Number.isFinite(accuracy) || accuracy <= 0 || accuracy > MAX_GPS_ACCURACY_METERS) {
    throw Object.assign(new Error(`GPS accuracy must be within ${MAX_GPS_ACCURACY_METERS} metres`), { statusCode: 409 });
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
    assertAccuracy(payload.accuracy);
    const measuredDistance = distanceMeters(payload.lat, payload.lng, task.siteLatitude, task.siteLongitude);
    if (measuredDistance > VERIFICATION_RADIUS_METERS) {
      throw Object.assign(new Error('Provider is outside the 1 km location verification radius'), {
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
  return withTaskLock(payload.taskId, async () => {
    const task = await trackingRepository.getTaskById(payload.taskId);
    assertProviderTask(task, user);
    assertEscrowFunded(task);
    const timestamp = parseLocationTimestamp(payload.timestamp);
    assertAccuracy(payload.accuracy);
    return saveLiveLocation(payload.taskId, user.id, payload, timestamp);
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
    timestamp: location.timestamp,
  };
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
  return {
    siteAddress: task.siteAddress || null,
    siteLatitude: hasCoordinates ? task.siteLatitude : null,
    siteLongitude: hasCoordinates ? task.siteLongitude : null,
    available: hasCoordinates,
  };
}

const revokeTaskVerification = (taskId, reason) =>
  trackingRepository.revokeTaskVerifications(taskId, reason);

module.exports = {
  recordLocationUpdate,
  getLatestLocation,
  getLocationHistory,
  verifyTaskLocation,
  getVerificationStatus,
  getTaskSiteLocation,
  requireValidVerification,
  revokeTaskVerification,
  distanceMeters,
  constants: {
    VERIFICATION_RADIUS_METERS,
    MAX_GPS_ACCURACY_METERS,
    MAX_LOCATION_AGE_MS,
    MAX_FUTURE_SKEW_MS,
    VERIFICATION_TTL_MS,
  },
};
