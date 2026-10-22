function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error(err);

  let status = err.statusCode || err.status || 500;
  let message = err.message || 'Internal server error';

  // Basic Zod-style validation error handling
  if (err.name === 'ZodError') {
    const issues = err.issues || err.errors || [];
    const first = issues[0];
    const pathStr =
      first && Array.isArray(first.path) && first.path.length ? `${first.path.join('.')}: ` : '';
    const message = first ? `${pathStr}${first.message}` : 'Invalid request';
    return res.status(400).json({
      error: 'ValidationError',
      message,
      details: issues,
    });
  }

  const msg = String(err.message || '').toLowerCase();
  const code = err.code || '';
  const databaseUnavailable =
    ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(code) ||
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code) ||
    msg.includes("can't reach database server") ||
    msg.includes('connection refused') ||
    msg.includes('connection reset') ||
    msg.includes('server has closed the connection') ||
    msg.includes('timed out fetching a new connection') ||
    msg.includes('database is temporarily unavailable');

  if (databaseUnavailable || err.message === 'Chat context database request timed out') {
    status = 503;
    message = 'The database is temporarily unavailable. Please try again shortly.';
  } else if (err.name && err.name.includes('Prisma')) {
    status = 500;
    message = 'Something went wrong. Please try again.';
  }

  return res.status(status).json({
    error: err.name || 'Error',
    message,
  });
}

module.exports = { errorHandler };

