const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { signToken } = require('../../shared/middlewares/auth');

const tickets = [];
const messages = [];
const activities = [];
let nextId = 1;
const fake = {
  supportTicket: {
    findMany: async ({ where, skip, take }) => { assert.equal(Number.isInteger(skip), true); assert.equal(Number.isInteger(take), true); return tickets.filter((ticket) => (!where.requesterId || ticket.requesterId === where.requesterId)); },
    count: async ({ where }) => tickets.filter((ticket) => (!where.requesterId || ticket.requesterId === where.requesterId)).length,
    findFirst: async ({ where }) => { const ticket = tickets.find((item) => item.id === where.id && (!where.requesterId || item.requesterId === where.requesterId)); return ticket ? { ...ticket } : null; },
    findUnique: async ({ where }) => { const ticket = tickets.find((item) => item.id === where.id); return ticket ? { ...ticket } : null; },
    create: async ({ data }) => { const ticket = { id: nextId++, status: 'OPEN', priority: 'NORMAL', createdAt: new Date(), updatedAt: new Date(), requester: { id: data.requesterId, name: 'Requester' }, ...data }; tickets.push(ticket); return ticket; },
    updateMany: async ({ where, data }) => { const ticket = tickets.find((item) => item.id === where.id); if (!ticket || (where.status && ticket.status === where.status.not) || (where.updatedAt && ticket.updatedAt !== where.updatedAt)) return { count: 0 }; Object.assign(ticket, data, { updatedAt: new Date() }); return { count: 1 }; },
  },
  supportMessage: {
    create: async ({ data }) => { const message = { id: messages.length + 1, ...data, createdAt: new Date(), sender: { id: data.senderId, name: 'Sender' } }; messages.push(message); return message; },
    findMany: async ({ where, skip, take }) => { assert.equal(Number.isInteger(skip), true); assert.equal(Number.isInteger(take), true); return messages.filter((message) => message.ticketId === where.ticketId); },
    count: async ({ where }) => messages.filter((message) => message.ticketId === where.ticketId).length,
  },
  supportActivity: {
    create: async ({ data }) => { const item = { id: activities.length + 1, ...data, createdAt: new Date(), actor: { name: 'Actor' } }; activities.push(item); return item; },
    findMany: async ({ where, skip, take }) => { assert.equal(Number.isInteger(skip), true); assert.equal(Number.isInteger(take), true); return activities.filter((item) => item.ticketId === where.ticketId); },
    count: async ({ where }) => activities.filter((item) => item.ticketId === where.ticketId).length,
  },
  user: { findMany: async () => [{ id: 3 }] },
  notification: { create: async () => ({ id: 1 }) },
  task: { findFirst: async ({ where }) => where.id === 7 ? { createdById: 1, assignedProviderId: null } : null },
  bid: { findFirst: async () => null },
  paymentTransaction: { findFirst: async () => null },
  $transaction: async (value) => Array.isArray(value) ? Promise.all(value) : value(fake),
};
const prismaPath = require.resolve('../../database/prisma');
const previous = require.cache[prismaPath];
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: { prisma: fake } };
const router = require('./routes');
if (previous) require.cache[prismaPath] = previous; else delete require.cache[prismaPath];
const app = express();
app.use(express.json());
app.use('/api/support', router);
app.use((err, req, res, next) => res.status(err.statusCode || 400).json({ message: err.message }));

test('support creation, ownership, replies and admin status use only mocked data', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/support/tickets`;
  const request = async (token, path = '', method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const owner = signToken({ id: 1, email: 'owner@example.test', role: 'REQUESTER' });
  const stranger = signToken({ id: 2, email: 'stranger@example.test', role: 'PROVIDER' });
  const admin = signToken({ id: 3, email: 'admin@example.test', role: 'ADMIN' });
  try {
    const created = await request(owner, '', 'POST', { category: 'TASK', subject: 'Need help', description: 'Please review this task', taskId: 7 });
    assert.equal(created.status, 201);
    const id = created.data.id;
    assert.equal((await request(admin)).data.total, 1);
    assert.equal((await request(stranger)).data.total, 0);
    assert.equal((await request(stranger, '', 'POST', { category: 'PAYMENT', subject: 'Payment issue', description: 'Please review payment', paymentId: 99 })).status, 404);
    assert.equal((await request(owner, '', 'POST', { category: 'OTHER', subject: 'Bad link', description: 'Please review evidence', evidenceUrls: ['https://res.cloudinary.com.evil.test/file'] })).status, 400);
    assert.equal((await request(stranger, `/${id}`)).status, 404);
    assert.equal((await request(stranger, `/${id}/messages`)).status, 404);
    assert.equal((await request(stranger, `/${id}/activity`)).status, 404);
    assert.equal((await request(stranger, `/${id}/messages`, 'POST', { body: 'intrusion' })).status, 404);
    assert.equal((await request(owner, `/${id}`, 'PATCH', { status: 'CLOSED' })).status, 403);
    assert.equal((await request(owner, `/${id}/messages`, 'POST', { body: 'More detail' })).status, 201);
    assert.equal((await request(admin, `/${id}/messages`, 'POST', { body: 'We are reviewing it' })).status, 201);
    assert.equal((await request(admin, `/${id}`, 'PATCH', { status: 'CLOSED', priority: 'HIGH' })).status, 200);
    assert.equal((await request(owner, `/${id}/messages`, 'POST', { body: 'Too late' })).status, 409);
    assert.equal((await request(owner, `/${id}/messages`)).data.total, 2);
    assert.equal((await request(owner, `/${id}/activity`)).data.total, 5);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
