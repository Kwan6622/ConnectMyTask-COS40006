const { prisma } = require('../../database/taskTransaction');

const getTaskById = taskId => prisma.task.findUnique({ where: { id: taskId } });
const getVerificationByRequestId = requestId =>
  prisma.taskLocationVerification.findUnique({ where: { requestId } });
const getLatestVerification = (taskId, providerId) =>
  prisma.taskLocationVerification.findFirst({
    where: { taskId, providerId },
    orderBy: [{ verifiedAt: 'desc' }, { id: 'desc' }],
  });
const createVerification = data => prisma.taskLocationVerification.create({ data });
const revokeTaskVerifications = (taskId, reason, revokedAt = new Date()) =>
  prisma.taskLocationVerification.updateMany({
    where: { taskId, revokedAt: null },
    data: { revokedAt, revokeReason: reason },
  });
const createTrackingLog = data => prisma.trackingLog.create({ data });

async function readLocations(taskId, user, limit) {
  if (!user?.id) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
  if (!/^[1-9]\d*$/.test(String(taskId)) || !Number.isSafeInteger(Number(taskId))) {
    throw Object.assign(new Error('Invalid task ID'), { statusCode: 400 });
  }
  const id = Number(taskId);
  const task = await getTaskById(id);
  if (!task || task.isDeleted) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
  const role = String(user.role || '').toUpperCase();
  if (role !== 'ADMIN' && task.createdById !== user.id && task.assignedProviderId !== user.id) {
    throw Object.assign(new Error('Only task participants can read tracking'), { statusCode: 403 });
  }
  return prisma.trackingLog.findMany({
    where: { taskId: id },
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: Math.min(Math.max(Number(limit) || 1, 1), 100),
  });
}

module.exports = {
  getTaskById,
  getVerificationByRequestId,
  getLatestVerification,
  createVerification,
  revokeTaskVerifications,
  createTrackingLog,
  readLocations,
};
