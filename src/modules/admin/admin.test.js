const test = require('node:test');
const assert = require('node:assert/strict');

const state = { updated: null, deleted: null, released: null };
const repository = {
  getAdminStats: async () => ({ totalUsers: 2 }),
  listUsers: async () => [],
  getUserForAdmin: async id => ({ id, role: id === 1 ? 'ADMIN' : 'PROVIDER', status: 'ACTIVE' }),
  updateUserStatus: async (id, status) => { state.updated = { id, status }; return { id, status }; },
  listAdminTasks: async () => [{
    id: 8, title: 'Task', status: 'ASSIGNED', escrowStatus: 'HELD', assignedProviderId: 2,
    siteVersion: 1, siteAddress: 'private', siteLatitude: 1, siteLongitude: 2,
    locationVerifications: [{ providerId: 2, siteVersion: 1, expiresAt: new Date('2099-01-01T00:00:00.000Z'), revokedAt: null }],
  }],
  getTaskForAdmin: async id => ({ id, status: 'ASSIGNED', escrowStatus: id === 10 ? 'HELD' : 'PENDING_DEPOSIT' }),
  softDeleteTask: async id => { state.deleted = id; return { id, isDeleted: true }; },
  markTaskReviewed: async id => ({ id }),
  listCertificates: async () => [],
  verifyCertificate: async id => ({ id }),
  listPayments: async () => [],
  getPaymentById: async id => ({ id, taskId: 8 }),
};
const payments = {
  releaseEscrowForTask: async taskId => { state.released = taskId; return { taskId }; },
};

const repositoryPath = require.resolve('./repository');
const paymentPath = require.resolve('../payments/service');
require.cache[repositoryPath] = { id: repositoryPath, filename: repositoryPath, loaded: true, exports: repository };
require.cache[paymentPath] = { id: paymentPath, filename: paymentPath, loaded: true, exports: payments };
delete require.cache[require.resolve('./service')];
const service = require('./service');

const admin = { id: 1, role: 'ADMIN' };

test('admin service rejects non-admin callers', async () => {
  await assert.rejects(() => service.getStats({ id: 2, role: 'PROVIDER' }), error => error.statusCode === 403);
});

test('admin task output reports GPS status without private site coordinates', async () => {
  const [task] = await service.getTasks(admin);
  assert.equal(task.gpsVerificationStatus, 'VERIFIED');
  assert.equal(task.siteAddress, undefined);
  assert.equal(task.siteLatitude, undefined);
  assert.equal(task.siteLongitude, undefined);
});

test('suspension protects admins and invalidates target sessions through repository update', async () => {
  await assert.rejects(() => service.updateUserStatus(1, 'SUSPENDED', admin), error => error.statusCode === 409);
  const result = await service.updateUserStatus(2, 'SUSPENDED', admin);
  assert.equal(result.status, 'SUSPENDED');
  assert.deepEqual(state.updated, { id: 2, status: 'SUSPENDED' });
});

test('task deletion cannot bypass held escrow', async () => {
  await assert.rejects(() => service.deleteTask(10, admin), error => error.statusCode === 409);
  await service.deleteTask(11, admin);
  assert.equal(state.deleted, 11);
});

test('manual release delegates to idempotent payment settlement service', async () => {
  await service.releasePayment(3, admin);
  assert.equal(state.released, 8);
});
