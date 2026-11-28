const jwt = require('jsonwebtoken');
const { env } = require('../../config/env');
const { prisma } = require('../../database/prisma');
const warnings = require('../../modules/users/warnings');

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing token' });
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    let user = await prisma.user.findUnique({
      where: { id: Number(payload.id) },
      select: { id: true, email: true, role: true, status: true, tokenVersion: true, warningCount: true, lockedUntil: true },
    });
    if (!user || user.status === 'SUSPENDED' || Number(payload.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Session is no longer active' });
    }
    if (user.status === 'LOCKED') {
      // Lazy auto-reactivation: an expired lock is lifted on the next request.
      user = await warnings.releaseLockIfExpired(user);
      if (warnings.isLockActive(user)) {
        const locked = await warnings.lockedError(user);
        return res.status(403).json({
          error: 'Forbidden', code: locked.code, message: locked.message,
          lockedUntil: user.lockedUntil, warningCount: user.warningCount, reasons: locked.reasons,
        });
      }
    }
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
  }
}

async function authenticateIfPresent(req, res, next) {
  if (!req.headers.authorization) return next();
  return authenticate(req, res, next);
}

function requireRoles(...allowedRoles) {
  const normalizedAllowedRoles = allowedRoles.map((role) => String(role).toUpperCase());
  return (req, res, next) => {
    const role = String(req.user?.role || '').toUpperCase();
    if (!role) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Missing user role' });
    }
    if (!normalizedAllowedRoles.includes(role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Only ${normalizedAllowedRoles.join(' or ')} can access this resource`,
      });
    }
    return next();
  };
}

function signToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    tokenVersion: Number(user.tokenVersion || 0),
  };

  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: '1h',
  });

  return token;
}

module.exports = {
  authenticate,
  authenticateIfPresent,
  requireRoles,
  signToken,
};
