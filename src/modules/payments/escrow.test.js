const test = require('node:test');
const assert = require('node:assert/strict');
// Entire database and Stripe transport are in memory: never loads .env or contacts services.
function mock(path, exports) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
let state, session, creates, failRelease, failRefund, event;
let expires;
let queue = Promise.resolve();
const copy = value => structuredClone(value);
const matches = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
const db = {
  $queryRaw: async () => [],
  $transaction: action => {
    const run = queue.then(async () => {
      const before = copy(state);
      try { return await action(db); } catch (error) { state = before; throw error; }
    });
    queue = run.catch(() => {});
    return run;
  },
  task: {
    findUnique: async () => copy(state.task),
    findFirst: async () => copy(state.task),
    update: async ({ data }) => Object.assign(state.task, data),
  },
  paymentTransaction: {
    findFirst: async ({ where }) => copy(state.payments.find(p => matches(p, where)) || null),
    findMany: async ({ where }) => copy(state.payments.filter(p => matches(p, where))),
    create: async ({ data }) => {
      if (failRelease && data.type === 'ESCROW_RELEASE') throw new Error('Simulated release failure');
      const row = { id: state.payments.length + 1, ...data };
      state.payments.push(row); return copy(row);
    },
    update: async ({ where, data }) => Object.assign(state.payments.find(p => p.id === where.id), data),
  },
  taskActivityLog: { create: async ({ data }) => { state.logs.push(data); return data; } },
  taskSubtask: {
    findFirst: async () => ({ id: 1, taskId: 1, title: 'Work', status: state.subtaskStatus || 'PENDING' }),
    findMany: async () => [{ id: 1, status: state.subtaskStatus || 'PENDING' }],
    updateMany: async ({ data }) => { state.subtaskStatus = data.status; return { count: 1 }; },
  },
  taskProgressUpdate: {
    create: async ({ data }) => { state.progress = data; return data; },
    count: async () => state.progress ? 1 : 0,
  },
  taskLocationVerification: {
    findFirst: async ({ where }) => copy([...state.verifications].reverse().find(v => matches(v, where)) || null),
    findUnique: async ({ where }) => copy(state.verifications.find(v => v.requestId === where.requestId) || null),
    create: async ({ data }) => { const row = { id: state.verifications.length + 1, ...data }; state.verifications.push(row); return copy(row); },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const row of state.verifications) {
        if (row.taskId === where.taskId && row.revokedAt == null) { Object.assign(row, data); count++; }
      }
      return { count };
    },
  },
  dispute: {
    findUnique: async () => ({ id: 1, taskId: 1, status: 'OPEN' }),
    update: async ({ data }) => ({ id: 1, taskId: 1, ...data }),
  },
  notification: { create: async ({ data }) => data },
};
mock('../../database/prisma', { prisma: db });
mock('../../config/env', { env: { STRIPE_SECRET_KEY: 'mock-only', STRIPE_WEBHOOK_SECRET: 'mock-only', STRIPE_CURRENCY: 'vnd' } });
mock('stripe', class {
  checkout = { sessions: {
    create: async (data, options) => {
      assert.ok(options.idempotencyKey); creates++;
      session = { id: 'session-mock', url: 'https://example.invalid/checkout', status: 'open', payment_status: 'unpaid', amount_total: data.line_items[0].price_data.unit_amount, currency: 'vnd', metadata: data.metadata, payment_intent: 'intent-mock' };
      return copy(session);
    },
    retrieve: async () => copy(session),
    expire: async () => { expires++; session.status = 'expired'; return copy(session); },
  } };
  refunds = { create: async (_data, options) => {
    assert.ok(options.idempotencyKey);
    if (failRefund) throw new Error('Simulated refund failure');
    return { id: 'refund-mock', status: 'succeeded' };
  } };
  webhooks = { constructEvent: (body, signature) => {
    assert.ok(Buffer.isBuffer(body)); assert.equal(signature, 'mock'); return event;
  } };
});
const payments = require('./service');
const tasks = require('../tasks/service');
const requester = { id: 1, role: 'REQUESTER' };
const provider = { id: 2, role: 'PROVIDER' };
function reset() {
  state = { task: { id: 1, createdById: 1, assignedProviderId: 2, status: 'ASSIGNED', escrowStatus: 'PENDING_DEPOSIT', budget: 150000, escrowAmount: 100000, bids: [{ id: 1, providerId: 2, price: 100000, status: 'ACCEPTED' }], title: 'Test task', isDeleted: false, siteVersion: 1, siteAddress: 'Test', siteLatitude: 1, siteLongitude: 103 }, payments: [], logs: [], verifications: [] };
  creates = 0; expires = 0; failRelease = false; failRefund = false;
}
const deposit = () => payments.createCheckoutPayment({ taskId: 1, flow: 'ESCROW_DEPOSIT' }, requester);
async function fund() {
  await deposit(); session.status = 'complete'; session.payment_status = 'paid';
  return payments.confirmStripeSession(session.id, requester);
}
function verify() {
  state.verifications.push({ id: state.verifications.length + 1, requestId: `test-${Date.now()}`, taskId: 1, providerId: 2, siteVersion: 1, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000), revokedAt: null });
}
test('unfunded work, unauthorized provider and generic payment bypass rejected', async () => {
  reset();
  await assert.rejects(tasks.updateTaskStatus(1, 'IN_PROGRESS', provider));
  await assert.rejects(tasks.updateTaskSubtaskStatus(1, 1, { status: 'DONE' }, provider), { statusCode: 409 });
  await assert.rejects(tasks.createTaskProgressUpdate(1, { progressPercent: 50 }, provider));
  await assert.rejects(tasks.updateTaskStatus(1, 'PAID', requester), { statusCode: 409 });
  await assert.rejects(tasks.updateTask(1, { escrowStatus: 'HELD' }, requester));
  await fund();
  await assert.rejects(tasks.updateTaskStatus(1, 'IN_PROGRESS', provider), { statusCode: 409 });
  verify();
  await assert.rejects(tasks.updateTaskStatus(1, 'IN_PROGRESS', { id: 3, role: 'PROVIDER' }), { statusCode: 403 });
  await assert.rejects(tasks.updateTaskSubtaskStatus(1, 1, { status: 'DONE' }, { id: 3, role: 'PROVIDER' }), { statusCode: 403 });
  await assert.rejects(tasks.createTaskProgressUpdate(1, { progressPercent: 50 }, { id: 3, role: 'PROVIDER' }), { statusCode: 403 });
  await tasks.updateTaskStatus(1, 'IN_PROGRESS', provider);
  await tasks.updateTaskStatus(1, 'IN_PROGRESS', provider);
  await assert.rejects(tasks.updateTaskStatus(1, 'ASSIGNED', provider), { statusCode: 409 });
  assert.equal(state.logs.filter(l => l.action === 'STATUS_CHANGED').length, 1);
});
test('concurrent deposits and confirmations have one funding effect; pending/failed cannot fund', async () => {
  reset();
  await Promise.all([deposit(), deposit()]);
  assert.equal(creates, 1); assert.equal(state.payments.length, 1);
  assert.equal((await payments.confirmStripeSession(session.id, requester)).status, 'PENDING');
  event = { type: 'checkout.session.completed', data: { object: session } };
  await payments.handleWebhook('mock', Buffer.from('mock'));
  assert.notEqual(state.task.escrowStatus, 'HELD');
  await assert.rejects(payments.confirmStripeSession(session.id, provider), { statusCode: 403 });
  session.status = 'expired';
  event = { type: 'checkout.session.expired', data: { object: session } };
  await payments.handleWebhook('mock', Buffer.from('mock'));
  assert.equal(state.payments[0].status, 'FAILED');
  await deposit(); assert.equal(creates, 2);
  // Unique session IDs in real Stripe; separate the failed mock record.
  state.payments[0].checkoutSessionId = 'expired-mock';
  session.status = 'complete'; session.payment_status = 'paid';
  await Promise.all([payments.confirmStripeSession(session.id, requester), payments.confirmStripeSession(session.id, requester)]);
  event = { type: 'checkout.session.completed', data: { object: session } };
  await payments.handleWebhook('mock', Buffer.from('mock'));
  assert.equal(state.task.escrowStatus, 'HELD');
  assert.equal(state.logs.filter(l => l.action === 'ESCROW_DEPOSIT_CONFIRMED').length, 1);
  await assert.rejects(deposit(), { statusCode: 409 });
});
test('deposit uses accepted bid, keeps VND zero-decimal, and replaces mismatched open checkout', async () => {
  reset();
  state.task.budget = 650000;
  state.task.escrowAmount = 600000;
  state.task.bids[0].price = 600000;
  const first = await deposit();
  assert.equal(session.amount_total, 600000);
  assert.equal(session.currency, 'vnd');
  assert.equal(state.payments[0].amount, 600000);
  assert.equal(state.payments[0].platformFeeAmount, 120000);
  assert.equal(state.payments[0].providerPayoutAmount, 480000);
  assert.equal((await deposit()).sessionId, first.sessionId);
  assert.equal(creates, 1);

  state.task.bids[0].price = 590000;
  await deposit();
  assert.equal(expires, 1);
  assert.equal(creates, 2);
  assert.equal(session.amount_total, 590000);
  assert.equal(state.payments[0].status, 'CANCELED');
  assert.equal(state.task.escrowAmount, 590000);
});
test('requester transaction history is owner-scoped and omits Stripe internal identifiers', async () => {
  reset();
  await deposit();
  state.payments[0].metadata = { cardBrand: 'visa', cardLast4: '4242' };
  const history = await payments.listMyPayments(requester);
  assert.equal(history.length, 1);
  assert.equal(history[0].reference, 'CMT-00000001');
  assert.equal(history[0].agreedPrice, 100000);
  assert.deepEqual(history[0].card, { brand: 'visa', last4: '4242' });
  assert.equal(Object.hasOwn(history[0], 'checkoutSessionId'), false);
  assert.equal(Object.hasOwn(history[0], 'providerTransactionId'), false);
  await assert.rejects(payments.listMyPayments(provider), { statusCode: 403 });
});
test('Stripe binding and late payment checks fail closed', async () => {
  reset(); await deposit(); session.payment_status = 'paid'; session.status = 'complete';
  session.amount_total = 1;
  await assert.rejects(payments.confirmStripeSession(session.id, requester), { statusCode: 409 });
  session.amount_total = 100000;
  session.currency = 'usd';
  await assert.rejects(payments.confirmStripeSession(session.id, requester), { statusCode: 409 });
  session.currency = 'vnd';
  for (const status of ['CANCELLED', 'DISPUTED']) {
    state.task.status = status;
    await assert.rejects(payments.confirmStripeSession(session.id, requester), { statusCode: 409 });
    assert.notEqual(state.task.escrowStatus, 'HELD');
  }
});
test('completion release failure rolls back; retry and concurrent retry settle once', async () => {
  reset(); await fund(); state.task.status = 'PENDING_CONFIRMATION'; failRelease = true;
  await assert.rejects(tasks.confirmTaskCompletion(1, requester), /Simulated release failure/);
  assert.equal(state.task.status, 'PENDING_CONFIRMATION');
  assert.equal(state.logs.filter(l => l.action === 'COMPLETION_CONFIRMED').length, 0);
  failRelease = false;
  await Promise.all([tasks.confirmTaskCompletion(1, requester), tasks.confirmTaskCompletion(1, requester)]);
  assert.equal(state.task.status, 'PAID');
  assert.equal(state.payments.filter(p => p.type === 'ESCROW_RELEASE').length, 1);
});
test('refund failure preserves held funds; retry/replayed funding cannot revive refund', async () => {
  reset(); await fund(); failRefund = true;
  await assert.rejects(payments.refundEscrowForTask(1, requester), { statusCode: 502 });
  assert.equal(state.task.escrowStatus, 'HELD');
  failRefund = false;
  await payments.refundEscrowForTask(1, requester);
  await payments.refundEscrowForTask(1, requester);
  await payments.confirmStripeSession(session.id, requester);
  assert.equal(state.task.escrowStatus, 'REFUNDED');
  assert.equal(state.payments.filter(p => p.type === 'ESCROW_REFUND').length, 1);
});

test('funded subtask and progress updates work; first work prevents direct cancellation', async () => {
  reset(); await fund(); verify();
  await tasks.updateTaskSubtaskStatus(1, 1, { status: 'DONE' }, provider);
  assert.equal(state.task.status, 'IN_PROGRESS');
  await tasks.createTaskProgressUpdate(1, { progressPercent: 100, markAsCompleted: true }, provider);
  assert.equal(state.task.status, 'PENDING_CONFIRMATION');
  await assert.rejects(tasks.cancelTask(1, 'test', requester));
});

test('expired or revoked verification blocks every provider work mutation', async () => {
  reset(); await fund(); verify();
  state.verifications[0].expiresAt = new Date(Date.now() - 1);
  await assert.rejects(tasks.updateTaskStatus(1, 'IN_PROGRESS', provider), { statusCode: 409 });
  await assert.rejects(tasks.updateTaskSubtaskStatus(1, 1, { status: 'DONE' }, provider), { statusCode: 409 });
  await assert.rejects(tasks.createTaskProgressUpdate(1, { progressPercent: 50, note: 'test' }, provider), { statusCode: 409 });

  state.verifications[0].expiresAt = new Date(Date.now() + 60000);
  state.verifications[0].revokedAt = new Date();
  await assert.rejects(tasks.updateTaskStatus(1, 'IN_PROGRESS', provider), { statusCode: 409 });
  await assert.rejects(tasks.updateTaskSubtaskStatus(1, 1, { status: 'DONE' }, provider), { statusCode: 409 });
  await assert.rejects(tasks.createTaskProgressUpdate(1, { progressPercent: 50, note: 'test' }, provider), { statusCode: 409 });
});

test('historical COMPLETED/HELD settlement remains retryable', async () => {
  reset(); await fund(); state.task.status = 'COMPLETED';
  await tasks.confirmTaskCompletion(1, requester);
  assert.equal(state.task.status, 'PAID');
});

test('closing unfunded dispute cannot invent held funds', async () => {
  reset(); state.task.status = 'DISPUTED'; state.task.escrowStatus = 'FROZEN'; state.task.paymentStatus = 'FROZEN';
  await tasks.reviewDisputeByAdmin(1, 1, { status: 'CLOSED' }, { id: 3, role: 'ADMIN' });
  assert.equal(state.task.escrowStatus, 'PENDING_DEPOSIT');
  await assert.rejects(tasks.updateTaskStatus(1, 'IN_PROGRESS', provider));
});

test('public task response exposes district but not trusted site coordinates', async () => {
  reset();
  state.task.district = 'District 1';
  state.task.location = 'District 1';
  const publicTask = await tasks.getPublicTaskById(1);
  assert.equal(publicTask.location, 'District 1');
  assert.equal(publicTask.siteAddress, undefined);
  assert.equal(publicTask.siteLatitude, undefined);
  assert.equal(publicTask.siteLongitude, undefined);
});
