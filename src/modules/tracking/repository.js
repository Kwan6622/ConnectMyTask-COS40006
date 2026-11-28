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
// Private home address of the task's requester (approximate-location tasks only).
const getRequesterHomeAddress = taskId =>
  prisma.task.findUnique({
    where: { id: taskId },
    select: { createdBy: { select: { streetAddress: true, locationId: true } } },
  }).then(row => row?.createdBy || null);
const revokeTaskVerifications = (taskId, reason, revokedAt = new Date()) =>
  prisma.taskLocationVerification.updateMany({
    where: { taskId, revokedAt: null },
    data: { revokedAt, revokeReason: reason },
  });

module.exports = {
  getTaskById,
  getRequesterHomeAddress,
  getVerificationByRequestId,
  getLatestVerification,
  createVerification,
  revokeTaskVerifications,
};
