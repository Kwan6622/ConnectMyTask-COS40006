const jwt = require('jsonwebtoken');
const { env } = require('../../config/env');
const { prisma } = require('../../database/prisma');

function getCookieValue(header, name) {
  const cookie = String(header || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : null;
}

async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');
  const cookieToken = getCookieValue(req.headers.cookie, 'cmt_access_token');
  const sessionToken = token || cookieToken;

  if (!sessionToken) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing token' });
  }

  try {
    if (!token && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const allowedOrigins = String(env.FRONTEND_URL || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
      if (
        req.headers['x-cmt-request'] !== 'web'
        || !allowedOrigins.includes(req.headers.origin)
      ) {
        return res.status(403).json({ error: 'Forbidden', message: 'Invalid browser request origin' });
      }
    }

    const payload = jwt.verify(sessionToken, env.JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: Number(payload.id) },
      select: { id: true, email: true, role: true, status: true, tokenVersion: true },
    });
    if (!user || user.status === 'SUSPENDED' || Number(payload.tokenVersion || 0) !== Number(user.tokenVersion || 0)) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Session is no longer active' });
    }
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
  }
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
  requireRoles,
  signToken,
};
