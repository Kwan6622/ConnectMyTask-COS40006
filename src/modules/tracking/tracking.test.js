const test = require('node:test');
const assert = require('node:assert/strict');
let task;
let verifications = [];
let logs = [];
let activities = [];
let notifications = [];
let queue = Promise.resolve();
const copy = value => structuredClone(value);
const fake = {
  $queryRaw: async () => [],
  $transaction: action => {
    const run = queue.then(() => action(fake));
    queue = run.catch(() => {});
    return run;
  },
  task: { findUnique: async () => copy(task) },
  taskLocationVerification: {
    findUnique: async ({ where }) => copy(verifications.find(v => v.requestId === where.requestId) || null),
    findFirst: async ({ where }) => copy([...verifications].reverse().find(v => v.taskId === where.taskId && v.providerId === where.providerId) || null),
    create: async ({ data }) => {
      const row = { id: verifications.length + 1, ...data };
      verifications.push(row);
      return copy(row);
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      verifications.forEach(row => {
        if (row.taskId === where.taskId && row.revokedAt == null) { Object.assign(row, data); count++; }
      });
      return { count };
    },
  },
  trackingLog: {
    create: async ({ data }) => { const row = { id: logs.length + 1, ...data }; logs.push(row); return copy(row); },
    findMany: async ({ take }) => copy(logs.slice(-take).reverse()),
  },
  taskActivityLog: { create: async ({ data }) => { activities.push(data); return data; } },
  notification: { create: async ({ data }) => { notifications.push(data); return data; } },
};
const dbPath = require.resolve('../../database/prisma');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fake } };
const service = require('./service');
const repository = require('./repository');
const { trackingUpdateSchema, verificationSchema } = require('./validation');
const provider = { id: 2, role: 'PROVIDER' };
const requester = { id: 1, role: 'REQUESTER' };
const point = (overrides = {}) => ({
  requestId: `gps_${Date.now()}_abcdefghij`,
  lat: 10.775,
  lng: 106.700,
  accuracy: 15,
  timestamp: new Date().toISOString(),
  ...overrides,
});
function reset() {
  task = {
    id: 1,
    title: 'GPS task',
    createdById: 1,
    assignedProviderId: 2,
    status: 'ASSIGNED',
    escrowStatus: 'HELD',
    isDeleted: false,
    siteAddress: 'Trusted task address',
    siteLatitude: 10.775,
    siteLongitude: 106.700,
    siteVersion: 1,
  };
  verifications = []; logs = []; activities = []; notifications = [];
}

test('inside 1 km verifies and enables fresh participant tracking', async () => {
  reset();
  const result = await service.verifyTaskLocation(1, point(), provider);
  assert.equal(result.isValid, true);
  assert.ok(result.distanceMeters < 1000);
  assert.equal(logs.length, 1);
  await service.recordLocationUpdate({ taskId: 1, ...point(), requestId: undefined }, provider);
  assert.equal(logs.length, 2);
  assert.equal((await service.getVerificationStatus(1, requester)).isValid, true);
});

test('outside radius, inaccurate, stale, unfunded and wrong provider are rejected', async () => {
  reset();
  await assert.rejects(service.verifyTaskLocation(1, point({ lat: 10.80 }), provider), { statusCode: 409 });
  await assert.rejects(service.verifyTaskLocation(1, point({ accuracy: 150 }), provider), { statusCode: 409 });
  await assert.rejects(service.verifyTaskLocation(1, point({ timestamp: new Date(Date.now() - 180000).toISOString() }), provider), { statusCode: 409 });
  await assert.rejects(service.verifyTaskLocation(1, point(), { id: 3, role: 'PROVIDER' }), { statusCode: 403 });
  task.escrowStatus = 'PENDING_DEPOSIT';
  await assert.rejects(service.verifyTaskLocation(1, point(), provider), { statusCode: 409 });
  assert.equal(verifications.length, 0);
});

test('request replay, expiry, revocation and site-version change fail closed', async () => {
  reset();
  const payload = point();
  await service.verifyTaskLocation(1, payload, provider);
  await assert.rejects(service.verifyTaskLocation(1, payload, provider), { statusCode: 409 });
  verifications[0].expiresAt = new Date(Date.now() - 1);
  await assert.rejects(service.requireValidVerification(task, provider.id), { statusCode: 409 });
  verifications[0].expiresAt = new Date(Date.now() + 60000);
  task.siteVersion = 2;
  await assert.rejects(service.requireValidVerification(task, provider.id), { statusCode: 409 });
  task.siteVersion = 1;
  await service.revokeTaskVerification(1, 'TASK_CANCELLED');
  await assert.rejects(service.requireValidVerification(task, provider.id), { statusCode: 409 });
});

test('tracking reads are participant/admin only and validation rejects invalid evidence', async () => {
  reset();
  await service.verifyTaskLocation(1, point(), provider);
  await assert.rejects(repository.readLocations(1, { id: 3, role: 'PROVIDER' }, 100), { statusCode: 403 });
  await assert.rejects(service.getVerificationStatus(1, { id: 3, role: 'PROVIDER' }), { statusCode: 403 });
  for (const user of [provider, requester, { id: 4, role: 'ADMIN' }]) {
    assert.equal((await repository.readLocations(1, user, 100)).length, 1);
  }
  const { requestId: _requestId, ...trackingPoint } = point();
  assert.equal(trackingUpdateSchema.safeParse({ taskId: 1, ...trackingPoint }).success, true);
  assert.equal(verificationSchema.safeParse(point({ lat: 91 })).success, false);
  assert.equal(verificationSchema.safeParse(point({ requestId: 'short' })).success, false);
  assert.equal(verificationSchema.safeParse({ ...point(), verified: true }).success, false);
});
