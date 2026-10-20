const test = require('node:test');
const assert = require('node:assert/strict');

let storedUser = { id: 7, email: 'user@example.test', role: 'PROVIDER', status: 'ACTIVE', tokenVersion: 0 };
const prismaPath = require.resolve('../../database/prisma');
require.cache[prismaPath] = {
  id: prismaPath,
  filename: prismaPath,
  loaded: true,
  exports: { prisma: { user: { findUnique: async () => storedUser } } },
};
delete require.cache[require.resolve('./auth')];
const { authenticate, signToken } = require('./auth');

async function runAuth(token) {
  const result = { status: null, body: null, next: false, user: null };
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  await authenticate(req, res, () => { result.next = true; result.user = req.user; });
  return result;
}

test('active token authenticates and suspension or token-version change invalidates it', async () => {
  const token = signToken(storedUser);
  assert.equal((await runAuth(token)).next, true);

  storedUser = { ...storedUser, status: 'SUSPENDED' };
  assert.equal((await runAuth(token)).status, 401);

  storedUser = { ...storedUser, status: 'ACTIVE', tokenVersion: 1 };
  assert.equal((await runAuth(token)).status, 401);
});
