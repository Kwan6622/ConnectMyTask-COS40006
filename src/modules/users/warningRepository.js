const { prisma } = require('../../database/prisma');

const accountSelect = { id: true, name: true, role: true, status: true, warningCount: true, lockedUntil: true };

function getAccount(userId) {
  return prisma.user.findUnique({ where: { id: userId }, select: accountSelect });
}

/** Saves the new count/status and the history row together. */
async function applyWarningChange(userId, { warningCount, status, lockedUntil }, record) {
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { warningCount, status, lockedUntil }, select: accountSelect }),
    prisma.userWarning.create({ data: { userId, ...record } }),
  ]);
  return user;
}

function listWarnings(userId, take = 50) {
  return prisma.userWarning.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
    select: {
      id: true, change: true, countAfter: true, reason: true, taskId: true, createdAt: true,
      createdBy: { select: { id: true, name: true } },
    },
  });
}

/** Locked accounts whose lock time is over. */
function listExpiredLocks(now) {
  return prisma.user.findMany({ where: { status: 'LOCKED', lockedUntil: { lte: now } }, select: accountSelect });
}

module.exports = { getAccount, applyWarningChange, listWarnings, listExpiredLocks };
