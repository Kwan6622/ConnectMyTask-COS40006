const test = require('node:test');
const assert = require('node:assert/strict');
let task;
let verifications = [];
let activities = [];
let notifications = [];
let queue = Promise.resolve();
let nextTaskId = 0;
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
  trackingLog: { create: async () => { throw new Error('Tracking history must not be written to the database'); } },
  taskActivityLog: { create: async ({ data }) => { activities.push(data); return data; } },
  notification: { create: async ({ data }) => { notifications.push(data); return data; } },
};
const dbPath = require.resolve('../../database/prisma');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fake } };
const service = require('./service');
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
    id: ++nextTaskId,
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
  verifications = []; activities = []; notifications = [];
}

test('within 1 km verifies task location and enables participant tracking', async () => {
  reset();
  const result = await service.verifyTaskLocation(task.id, point(), provider);
  assert.equal(result.isValid, true);
  assert.ok(result.distanceMeters <= 1000);
  assert.equal((await service.getLatestLocation(task.id, requester)).lat, 10.775);
  await service.recordLocationUpdate({ taskId: task.id, ...point(), requestId: undefined }, provider);
  const latest = await service.getLatestLocation(task.id, requester);
  assert.equal(latest.lng, 106.7);
  assert.deepEqual(await service.getLocationHistory(task.id, requester), []);
  assert.equal((await service.getVerificationStatus(task.id, requester)).isValid, true);
});

test('location verification allows 999 m and rejects 1001 m from task site', async () => {
  reset();
  const offsetForMeters = meters => (meters / 6371000) * (180 / Math.PI);
  const nearPoint = point({ lat: task.siteLatitude + offsetForMeters(999) });
  const result = await service.verifyTaskLocation(task.id, nearPoint, provider);
  assert.equal(result.isValid, true);
  assert.ok(result.distanceMeters <= 1000);

  reset();
  const farPoint = point({ lat: task.siteLatitude + offsetForMeters(1001) });
  await assert.rejects(service.verifyTaskLocation(task.id, farPoint, provider), {
    statusCode: 409,
    message: 'Provider is outside the 1 km location verification radius',
  });
});

test('outside radius, inaccurate, stale and wrong provider are rejected', async () => {
  reset();
  await assert.rejects(service.verifyTaskLocation(task.id, point({ lat: 10.80 }), provider), { statusCode: 409 });
  await assert.rejects(service.verifyTaskLocation(task.id, point({ accuracy: 150 }), provider), { statusCode: 409 });
  await assert.rejects(service.verifyTaskLocation(task.id, point({ timestamp: new Date(Date.now() - 180000).toISOString() }), provider), { statusCode: 409 });
  await assert.rejects(service.verifyTaskLocation(task.id, point(), { id: 3, role: 'PROVIDER' }), { statusCode: 403 });
  assert.equal(verifications.length, 0);
});

test('tracking and verification both require funded escrow', async () => {
  reset();
  task.escrowStatus = 'PENDING_DEPOSIT';
  await assert.rejects(service.verifyTaskLocation(task.id, point(), provider), {
    statusCode: 409,
    code: 'ESCROW_FUNDING_REQUIRED',
  });
  await assert.rejects(service.recordLocationUpdate(
    { taskId: task.id, ...point(), requestId: undefined },
    provider
  ), {
    statusCode: 409,
    code: 'ESCROW_FUNDING_REQUIRED',
  });
  assert.equal((await service.getVerificationStatus(task.id, requester)).isValid, false);
  assert.equal((await service.getVerificationStatus(task.id, requester)).reason, 'ESCROW_NOT_FUNDED');
  await assert.rejects(service.getLatestLocation(task.id, requester), {
    statusCode: 409,
    code: 'ESCROW_FUNDING_REQUIRED',
  });
});

test('provider can share journey outside verification radius before verifying location', async () => {
  reset();
  const journeyPoint = point({ lat: 10.80 });
  await service.recordLocationUpdate({ taskId: task.id, ...journeyPoint, requestId: undefined }, provider);
  assert.ok(await service.getLatestLocation(task.id, requester));
  await assert.rejects(service.verifyTaskLocation(task.id, journeyPoint, provider), {
    statusCode: 409,
    message: 'Provider is outside the 1 km location verification radius',
  });
  assert.equal(verifications.length, 0);
});

test('request replay, expiry, revocation and site-version change fail closed', async () => {
  reset();
  const payload = point();
  await service.verifyTaskLocation(task.id, payload, provider);
  await assert.rejects(service.verifyTaskLocation(task.id, payload, provider), { statusCode: 409 });
  verifications[0].expiresAt = new Date(Date.now() - 1);
  await assert.rejects(service.requireValidVerification(task, provider.id), { statusCode: 409 });
  verifications[0].expiresAt = new Date(Date.now() + 60000);
  task.siteVersion = 2;
  await assert.rejects(service.requireValidVerification(task, provider.id), { statusCode: 409 });
  task.siteVersion = 1;
  task.escrowStatus = 'PENDING_DEPOSIT';
  await assert.rejects(service.requireValidVerification(task, provider.id), { statusCode: 409 });
  const status = await service.getVerificationStatus(task.id, requester);
  assert.equal(status.isValid, false);
  assert.equal(status.reason, 'ESCROW_NOT_FUNDED');
  task.escrowStatus = 'HELD';
  await service.revokeTaskVerification(task.id, 'TASK_CANCELLED');
  await assert.rejects(service.requireValidVerification(task, provider.id), { statusCode: 409 });
});

test('tracking reads are participant/admin only and validation rejects invalid evidence', async () => {
  reset();
  await service.verifyTaskLocation(task.id, point(), provider);
  await assert.rejects(service.getLatestLocation(task.id, { id: 3, role: 'PROVIDER' }), { statusCode: 403 });
  await assert.rejects(service.getLocationHistory(task.id, { id: 3, role: 'PROVIDER' }), { statusCode: 403 });
  await assert.rejects(service.getVerificationStatus(task.id, { id: 3, role: 'PROVIDER' }), { statusCode: 403 });
  for (const user of [provider, requester, { id: 4, role: 'ADMIN' }]) {
    assert.ok(await service.getLatestLocation(task.id, user));
    assert.deepEqual(await service.getLocationHistory(task.id, user), []);
  }
  task.status = 'COMPLETED';
  assert.equal(await service.getLatestLocation(task.id, requester), null);
  const { requestId: _requestId, ...trackingPoint } = point();
  assert.equal(trackingUpdateSchema.safeParse({ taskId: 1, ...trackingPoint }).success, true);
  assert.equal(verificationSchema.safeParse(point({ lat: 91 })).success, false);
  assert.equal(verificationSchema.safeParse(point({ requestId: 'short' })).success, false);
  assert.equal(verificationSchema.safeParse({ ...point(), verified: true }).success, false);
});

test('tracking and requester address are available to participants only after escrow is funded', async () => {
  reset();
  task.escrowStatus = 'PENDING_DEPOSIT';
  for (const user of [requester, provider]) {
    await assert.rejects(service.getTaskSiteLocation(task.id, user), {
      statusCode: 409,
      code: 'ESCROW_FUNDING_REQUIRED',
    });
    await assert.rejects(service.getLatestLocation(task.id, user), {
      statusCode: 409,
      code: 'ESCROW_FUNDING_REQUIRED',
    });
  }
  await assert.rejects(service.getLocationHistory(task.id, requester), {
    statusCode: 409,
    code: 'ESCROW_FUNDING_REQUIRED',
  });

  task.escrowStatus = 'HELD';
  for (const user of [requester, provider, { id: 4, role: 'ADMIN' }]) {
    assert.deepEqual(await service.getTaskSiteLocation(task.id, user), {
      siteAddress: task.siteAddress,
      siteLatitude: task.siteLatitude,
      siteLongitude: task.siteLongitude,
      available: true,
    });
  }
  task.siteLatitude = null;
  task.siteLongitude = null;
  assert.deepEqual(await service.getTaskSiteLocation(task.id, requester), {
    siteAddress: task.siteAddress,
    siteLatitude: null,
    siteLongitude: null,
    available: false,
  });
  await assert.rejects(service.getTaskSiteLocation(task.id, { id: 3, role: 'PROVIDER' }), {
    statusCode: 403,
  });
});
