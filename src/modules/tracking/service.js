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
  if (task.escrowStatus !== 'HELD' || !ACTIVE_TASK_STATUSES.includes(task.status)) {
    throw Object.assign(new Error('Location verification requires an active task with funded escrow'), { statusCode: 409 });
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
    || task.assignedProviderId !== providerId
    || task.escrowStatus !== 'HELD'
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
    if (await trackingRepository.getVerificationByRequestId(payload.requestId)) {
      throw Object.assign(new Error('Location verification request was already used'), { statusCode: 409 });
    }
    const locationTimestamp = parseLocationTimestamp(payload.timestamp);
    assertAccuracy(payload.accuracy);
    const measuredDistance = distanceMeters(payload.lat, payload.lng, task.siteLatitude, task.siteLongitude);
    if (measuredDistance > VERIFICATION_RADIUS_METERS) {
      throw Object.assign(new Error('Provider is outside the 1 km task verification area'), {
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
    await trackingRepository.createTrackingLog({
      taskId,
      providerId: user.id,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy,
      timestamp: locationTimestamp,
    });
    await taskRepository.createTaskActivity({
      taskId,
      actorId: user.id,
      action: 'LOCATION_VERIFIED',
      message: 'Assigned provider verified presence at the task site.',
      metadata: { distanceMeters: Math.round(measuredDistance), expiresAt: verification.expiresAt },
    });
    await notificationRepository.createNotification({
      recipientId: task.createdById,
      senderId: user.id,
      taskId,
      message: `Provider verified arrival for "${task.title}".`,
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
    await requireValidVerification(task, user.id);
    const timestamp = parseLocationTimestamp(payload.timestamp);
    assertAccuracy(payload.accuracy);
    return trackingRepository.createTrackingLog({
      taskId: payload.taskId,
      providerId: user.id,
      lat: payload.lat,
      lng: payload.lng,
      accuracy: payload.accuracy,
      timestamp,
    });
  });
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
  return {
    isValid,
    verifiedAt: verification?.verifiedAt || null,
    expiresAt: verification?.expiresAt || null,
    distanceMeters: verification ? Math.round(verification.distanceMeters) : null,
    reason: isValid ? null : verification?.revokedAt
      ? verification.revokeReason
      : verification ? 'EXPIRED_OR_TASK_STATE_CHANGED' : 'NOT_VERIFIED',
  };
}

const revokeTaskVerification = (taskId, reason) =>
  trackingRepository.revokeTaskVerifications(taskId, reason);

module.exports = {
  recordLocationUpdate,
  verifyTaskLocation,
  getVerificationStatus,
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
