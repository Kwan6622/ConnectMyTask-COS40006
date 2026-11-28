// Account warnings. Three warnings lock the account for three days
// (status LOCKED until lockedUntil). The lock ends on its own when the time is
// up (checked whenever the user signs in or calls the API) or when an admin
// reactivates the account; either way the count starts again from zero.
const warningRepository = require('./warningRepository');
const notificationRepository = require('../notifications/repository');

const WARNING_LIMIT = 3;
const LOCK_DAYS = 3;
const LOCK_MS = LOCK_DAYS * 24 * 60 * 60 * 1000;

function warningError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function isLockActive(user, now = new Date()) {
  return user?.status === 'LOCKED' && Boolean(user.lockedUntil) && new Date(user.lockedUntil) > now;
}

async function notify(userId, message, taskId = null) {
  try {
    await notificationRepository.createNotification({ recipientId: userId, senderId: null, taskId, message });
  } catch {
    // A failed notification must not undo the warning itself.
  }
}

/**
 * Add (+1) or remove (-1) a warning. Reaching 3 locks the account for 3 days;
 * dropping below 3 while locked lifts the lock.
 */
async function changeWarnings(userId, { change, reason, taskId = null, createdById = null, now = new Date() }) {
  if (![1, -1].includes(change)) throw warningError('change must be 1 or -1');
  const text = String(reason || '').trim();
  if (text.length < 3) throw warningError('Give a reason for the warning (at least 3 characters)');

  const user = await warningRepository.getAccount(userId);
  if (!user) throw warningError('User not found', 404);
  if (String(user.role).toUpperCase() === 'ADMIN') throw warningError('Admin accounts cannot receive warnings', 409);
  if (change < 0 && user.warningCount <= 0) throw warningError('This user has no warnings to remove', 409);

  const warningCount = Math.max(0, user.warningCount + change);
  let { status, lockedUntil } = user;
  let lockedNow = false;
  if (change > 0 && warningCount >= WARNING_LIMIT && !isLockActive(user, now) && status !== 'SUSPENDED') {
    status = 'LOCKED';
    lockedUntil = new Date(now.getTime() + LOCK_MS);
    lockedNow = true;
  } else if (change < 0 && warningCount < WARNING_LIMIT && status === 'LOCKED') {
    status = 'ACTIVE';
    lockedUntil = null;
  }

  const updated = await warningRepository.applyWarningChange(
    userId,
    { warningCount, status, lockedUntil },
    { change, countAfter: warningCount, reason: text, taskId, createdById, createdAt: now }
  );

  if (change > 0) {
    await notify(userId, lockedNow
      ? `You received warning ${warningCount}/${WARNING_LIMIT}: ${text} Your account is locked until ${lockedUntil.toISOString()}.`
      : `You received warning ${warningCount}/${WARNING_LIMIT}: ${text}`, taskId);
  } else {
    await notify(userId, `A warning was removed from your account (now ${warningCount}/${WARNING_LIMIT}).`);
  }
  return { user: updated, lockedNow };
}

/** Ends a lock whose time is over: account ACTIVE again, warnings back to 0. */
async function releaseLockIfExpired(user, now = new Date()) {
  if (user?.status !== 'LOCKED' || isLockActive(user, now)) return user;
  const updated = await warningRepository.applyWarningChange(
    user.id,
    { warningCount: 0, status: 'ACTIVE', lockedUntil: null },
    { change: -Number(user.warningCount || 0), countAfter: 0, reason: 'Lock period ended; warnings reset.', createdAt: now }
  );
  await notify(user.id, 'Your account lock has ended and your warnings were reset. Welcome back.');
  return { ...user, ...updated };
}

/** Admin reactivation of a locked account: ACTIVE now, warnings back to 0. */
async function reactivate(user, adminId, now = new Date()) {
  const updated = await warningRepository.applyWarningChange(
    user.id,
    { warningCount: 0, status: 'ACTIVE', lockedUntil: null },
    { change: -Number(user.warningCount || 0), countAfter: 0, reason: 'Account reactivated by an admin; warnings reset.', createdById: adminId, createdAt: now }
  );
  await notify(user.id, 'An admin reactivated your account. Your warnings were reset.');
  return updated;
}

/** Sweep used by admin lists so expired locks never look active. */
async function releaseExpiredLocks(now = new Date()) {
  const expired = await warningRepository.listExpiredLocks(now);
  for (const user of expired) await releaseLockIfExpired(user, now);
  return expired.length;
}

/** 403 for a locked account, with the time and the reasons for the lock page. */
async function lockedError(user) {
  let reasons = [];
  try {
    reasons = (await warningRepository.listWarnings(user.id, 10))
      .filter((item) => item.change > 0).slice(0, WARNING_LIMIT).map((item) => item.reason);
  } catch {
    // The page still shows the time without reasons.
  }
  return Object.assign(new Error(`Your account is locked until ${new Date(user.lockedUntil).toISOString()} after ${WARNING_LIMIT} warnings.`), {
    statusCode: 403,
    code: 'ACCOUNT_LOCKED',
    lockedUntil: user.lockedUntil,
    warningCount: user.warningCount,
    reasons,
  });
}

module.exports = {
  WARNING_LIMIT,
  LOCK_DAYS,
  isLockActive,
  changeWarnings,
  releaseLockIfExpired,
  releaseExpiredLocks,
  reactivate,
  lockedError,
  listWarnings: (userId) => warningRepository.listWarnings(userId),
};
