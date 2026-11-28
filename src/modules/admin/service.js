const adminRepository = require('./repository');
const warnings = require('../users/warnings');
const notificationRepository = require('../notifications/repository');
const paymentService = require('../payments/service');
const { LEGACY_PLATFORM_FEE_CONFIG, normalizePlatformFeeConfig } = require('../payments/platformFee');

const ADMIN_TASK_TRANSITIONS = Object.freeze({
  PENDING: ['OPEN', 'CANCELLED'],
  OPEN: ['CANCELLED'],
  BIDDING: ['CANCELLED'],
  ASSIGNED: ['CANCELLED'],
});

function assertAdmin(currentUser) {
  if (String(currentUser?.role || '').toUpperCase() !== 'ADMIN') {
    const err = new Error('Only admin can access this resource');
    err.statusCode = 403;
    throw err;
  }
}

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error(`Invalid ${label}`);
    err.statusCode = 400;
    throw err;
  }
  return id;
}

async function getStats(currentUser) {
  assertAdmin(currentUser);
  return adminRepository.getAdminStats();
}

async function getUsers(currentUser) {
  assertAdmin(currentUser);
  // Expired locks are lifted first so the list never shows a lock that is over.
  await warnings.releaseExpiredLocks();
  return adminRepository.listUsers();
}

async function getUserWarnings(userIdRaw, currentUser) {
  assertAdmin(currentUser);
  const userId = parseId(userIdRaw, 'user id');
  const user = await adminRepository.getUserForAdmin(userId);
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  return { user, limit: warnings.WARNING_LIMIT, lockDays: warnings.LOCK_DAYS, warnings: await warnings.listWarnings(userId) };
}

/** +1 or -1 warning with a reason; 3 warnings lock the account for 3 days. */
async function changeUserWarnings(userIdRaw, body, currentUser) {
  assertAdmin(currentUser);
  const userId = parseId(userIdRaw, 'user id');
  const change = Number(body?.change);
  const result = await warnings.changeWarnings(userId, { change, reason: body?.reason, createdById: currentUser.id });
  return result.user;
}

async function updateUserStatus(userIdRaw, statusRaw, currentUser) {
  assertAdmin(currentUser);
  const userId = parseId(userIdRaw, 'user id');
  const status = String(statusRaw || '').toUpperCase();
  if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
    throw Object.assign(new Error('Status must be ACTIVE or SUSPENDED'), { statusCode: 400 });
  }
  const user = await adminRepository.getUserForAdmin(userId);
  if (!user) throw Object.assign(new Error('User not found'), { statusCode: 404 });
  if (user.id === currentUser.id || String(user.role).toUpperCase() === 'ADMIN') {
    throw Object.assign(new Error('Admin accounts cannot be suspended from this dashboard'), { statusCode: 409 });
  }
  if (user.status === 'LOCKED' && status === 'ACTIVE') {
    // Reactivating a warning lock also resets the warnings.
    return warnings.reactivate(user, currentUser.id);
  }
  if (user.status === status) return user;
  return adminRepository.updateUserStatus(userId, status);
}

function withGpsStatus(task, now = new Date()) {
  const latest = task.locationVerifications?.[0] || null;
  const isValid = Boolean(latest
    && !latest.revokedAt
    && latest.expiresAt > now
    && latest.siteVersion === Number(task.siteVersion || 1)
    && latest.providerId === task.assignedProviderId
    && task.escrowStatus === 'HELD'
    && ['ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION'].includes(task.status));
  const { locationVerifications: _locationVerifications, addressDetail: _addressDetail, siteAddress: _siteAddress, siteLatitude: _siteLatitude, siteLongitude: _siteLongitude, ...safeTask } = task;
  return {
    ...safeTask,
    gpsVerificationStatus: !task.assignedProviderId ? 'NOT_REQUIRED' : isValid ? 'VERIFIED' : latest?.revokedAt ? 'REVOKED' : latest ? 'EXPIRED_OR_INVALID' : 'NOT_VERIFIED',
    gpsVerificationExpiresAt: isValid ? latest.expiresAt : null,
  };
}

async function getTasks(currentUser) {
  assertAdmin(currentUser);
  return (await adminRepository.listAdminTasks()).map((task) => withGpsStatus(task));
}

async function getSuspiciousTasks(currentUser) {
  assertAdmin(currentUser);
  return (await adminRepository.listAdminTasks({ suspiciousOnly: true })).map((task) => withGpsStatus(task));
}

/**
 * Soft delete: the task is hidden everywhere and cancelled, pending bids close,
 * and the requester and every bidder are told why. Needs a reason (5-500 chars).
 */
async function deleteTask(taskIdRaw, currentUser, reasonRaw) {
  assertAdmin(currentUser);
  const taskId = parseId(taskIdRaw, 'task id');
  const reason = String(reasonRaw || '').trim();
  if (reason.length < 5 || reason.length > 500) {
    throw Object.assign(new Error('Give a reason between 5 and 500 characters; it is sent to the requester and bidders'), { statusCode: 400 });
  }
  const task = await adminRepository.getTaskForAdmin(taskId);
  if (!task || task.isDeleted) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
  if (['HELD', 'FROZEN'].includes(task.escrowStatus) || task.status === 'DISPUTED') {
    throw Object.assign(new Error('Resolve active escrow or dispute before deleting this task'), { statusCode: 409 });
  }
  const { task: removed, bidderIds } = await adminRepository.softDeleteTask(taskId, currentUser.id, reason);

  const notify = async (recipientId, message) => {
    try {
      await notificationRepository.createNotification({ recipientId, senderId: currentUser.id, taskId, message });
    } catch {
      // A failed notification must not undo the removal.
    }
  };
  await notify(removed.createdById, `An admin removed your task "${removed.title}". Reason: ${reason}`);
  for (const providerId of bidderIds) {
    if (providerId === removed.assignedProviderId) continue;
    await notify(providerId, `Task "${removed.title}" was removed by an admin, so your bid was closed. Reason: ${reason}`);
  }
  if (removed.assignedProviderId) {
    await notify(removed.assignedProviderId, `Task "${removed.title}" you were assigned to was removed by an admin. Reason: ${reason}`);
  }
  return { ...removed, closedBids: bidderIds.length };
}

async function reviewTask(taskIdRaw, currentUser) {
  assertAdmin(currentUser);
  const taskId = parseId(taskIdRaw, 'task id');
  return adminRepository.markTaskReviewed(taskId, currentUser.id);
}

async function updateTaskStatus(taskIdRaw, payload, currentUser) {
  assertAdmin(currentUser);
  const taskId = parseId(taskIdRaw, 'task id');
  const status = String(payload?.status || '').toUpperCase();
  const reason = String(payload?.reason || '').trim();
  if (reason.length < 5 || reason.length > 500) {
    throw Object.assign(new Error('A reason between 5 and 500 characters is required'), { statusCode: 400 });
  }
  const task = await adminRepository.getTaskForAdmin(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
  if (task.status === status) return task;
  if (!(ADMIN_TASK_TRANSITIONS[task.status] || []).includes(status)) {
    throw Object.assign(new Error(`Admin cannot change task from ${task.status} to ${status}`), { statusCode: 409 });
  }
  const hasActiveFinancialOrDisputeState = ['HELD', 'FROZEN', 'RELEASED', 'REFUNDED'].includes(task.escrowStatus)
    || ['ESCROW_HELD', 'FROZEN', 'RELEASED', 'REFUNDED'].includes(task.paymentStatus)
    || Number(task._count?.disputes || 0) > 0;
  if (hasActiveFinancialOrDisputeState) {
    throw Object.assign(new Error('Resolve active escrow, payment, or dispute before changing task status'), { statusCode: 409 });
  }
  return adminRepository.updateTaskStatusByAdmin(taskId, task.status, status, currentUser.id, reason);
}

async function getPlatformFeeSettings(currentUser) {
  assertAdmin(currentUser);
  try {
    const result = await adminRepository.getPlatformFeeSettings();
    return {
      config: normalizePlatformFeeConfig(result.config || LEGACY_PLATFORM_FEE_CONFIG),
      audits: result.audits || [],
      policy: { chargedTo: 'PROVIDER_PAYOUT', requesterChargeBasis: 'ACCEPTED_BID' },
    };
  } catch (error) {
    if (error?.code !== 'P2021' && error?.code !== 'P2022') throw error;
    return {
      config: normalizePlatformFeeConfig(LEGACY_PLATFORM_FEE_CONFIG),
      audits: [],
      policy: { chargedTo: 'PROVIDER_PAYOUT', requesterChargeBasis: 'ACCEPTED_BID' },
      migrationRequired: true,
    };
  }
}

async function updatePlatformFeeSettings(payload, currentUser) {
  assertAdmin(currentUser);
  const reason = String(payload?.reason || '').trim();
  const feeType = String(payload?.feeType || '').toUpperCase();
  const isActive = payload?.isActive;
  if (reason.length < 5 || reason.length > 500) {
    throw Object.assign(new Error('A reason between 5 and 500 characters is required'), { statusCode: 400 });
  }
  if (!['PERCENTAGE', 'FIXED'].includes(feeType) || typeof isActive !== 'boolean') {
    throw Object.assign(new Error('feeType and isActive are required'), { statusCode: 400 });
  }
  const next = { feeType, isActive, percentageRate: null, fixedAmount: null };
  if (feeType === 'PERCENTAGE') {
    const rate = Number(payload?.percentageRate);
    if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
      throw Object.assign(new Error('percentageRate must be between 0 and 1'), { statusCode: 400 });
    }
    next.percentageRate = rate;
  } else {
    const amount = Number(payload?.fixedAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw Object.assign(new Error('fixedAmount must be zero or greater'), { statusCode: 400 });
    }
    next.fixedAmount = amount;
  }
  try {
    const config = await adminRepository.updatePlatformFeeSettings(next, currentUser.id, reason);
    return {
      config: normalizePlatformFeeConfig(config),
      policy: { chargedTo: 'PROVIDER_PAYOUT', requesterChargeBasis: 'ACCEPTED_BID' },
    };
  } catch (error) {
    if (error?.code === 'P2021' || error?.code === 'P2022') {
      throw Object.assign(new Error('Platform fee settings migration is required before updates can be saved'), { statusCode: 503 });
    }
    throw error;
  }
}

async function getCertificates(currentUser) {
  assertAdmin(currentUser);
  return adminRepository.listCertificates();
}

async function verifyCertificate(certificateIdRaw, currentUser) {
  assertAdmin(currentUser);
  const certificateId = parseId(certificateIdRaw, 'certificate id');
  return adminRepository.verifyCertificate(certificateId, currentUser.id, 'VERIFIED');
}

async function rejectCertificate(certificateIdRaw, currentUser) {
  assertAdmin(currentUser);
  const certificateId = parseId(certificateIdRaw, 'certificate id');
  return adminRepository.verifyCertificate(certificateId, currentUser.id, 'REJECTED');
}

async function getPayments(currentUser) {
  assertAdmin(currentUser);
  return adminRepository.listPayments();
}

async function getEscrowPayments(currentUser) {
  assertAdmin(currentUser);
  return adminRepository.listPayments({ heldOnly: true });
}

async function releasePayment(paymentIdRaw, currentUser) {
  assertAdmin(currentUser);
  const paymentId = parseId(paymentIdRaw, 'payment id');
  const payment = await adminRepository.getPaymentById(paymentId);
  if (!payment) {
    const err = new Error('Payment not found');
    err.statusCode = 404;
    throw err;
  }
  if (!payment.taskId) {
    const err = new Error('Payment missing task reference');
    err.statusCode = 400;
    throw err;
  }

  const released = await paymentService.releaseEscrowForTask(payment.taskId, currentUser, {
    reason: 'Admin manual release',
  });
  return released;
}

module.exports = {
  getStats,
  getUsers,
  updateUserStatus,
  getUserWarnings,
  changeUserWarnings,
  getTasks,
  getSuspiciousTasks,
  deleteTask,
  reviewTask,
  updateTaskStatus,
  getPlatformFeeSettings,
  updatePlatformFeeSettings,
  getCertificates,
  verifyCertificate,
  rejectCertificate,
  getPayments,
  getEscrowPayments,
  releasePayment,
};
