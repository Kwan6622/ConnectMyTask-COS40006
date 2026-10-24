const adminRepository = require('./repository');
const paymentService = require('../payments/service');

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
  return adminRepository.listUsers();
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
  const { locationVerifications: _locationVerifications, siteAddress: _siteAddress, siteLatitude: _siteLatitude, siteLongitude: _siteLongitude, ...safeTask } = task;
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

async function deleteTask(taskIdRaw, currentUser) {
  assertAdmin(currentUser);
  const taskId = parseId(taskIdRaw, 'task id');
  const task = await adminRepository.getTaskForAdmin(taskId);
  if (!task) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
  if (['HELD', 'FROZEN'].includes(task.escrowStatus) || task.status === 'DISPUTED') {
    throw Object.assign(new Error('Resolve active escrow or dispute before deleting this task'), { statusCode: 409 });
  }
  return adminRepository.softDeleteTask(taskId, currentUser.id);
}

async function reviewTask(taskIdRaw, currentUser) {
  assertAdmin(currentUser);
  const taskId = parseId(taskIdRaw, 'task id');
  return adminRepository.markTaskReviewed(taskId, currentUser.id);
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
  return adminRepository.listPayments({ lifecycleStatus: 'ESCROW_HELD' });
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
  getTasks,
  getSuspiciousTasks,
  deleteTask,
  reviewTask,
  getCertificates,
  verifyCertificate,
  rejectCertificate,
  getPayments,
  getEscrowPayments,
  releasePayment,
};
