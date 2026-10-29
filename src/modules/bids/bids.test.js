const test = require('node:test');
const assert = require('node:assert/strict');

const repository = {
  getTaskById: async () => ({ id: 4, createdById: 10, category: 'HOME_REPAIR', status: 'OPEN', _count: { bids: 3 } }),
  listBidsForTask: async () => [
    { id: 1, taskId: 4, providerId: 21, price: 700, createdAt: '2026-01-01T00:00:00Z', provider: { name: 'A', skills: 'Cleaning', providerProfile: { specialties: [] }, ratingsReceived: [{ rating: 5 }], _count: { tasksAssigned: 9 } } },
    { id: 2, taskId: 4, providerId: 22, price: 500, createdAt: '2026-01-03T00:00:00Z', provider: { name: 'B', skills: 'Home Repair', providerProfile: { specialties: [] }, ratingsReceived: [{ rating: 4 }, { rating: 4 }], _count: { tasksAssigned: 2 } } },
    { id: 3, taskId: 4, providerId: 23, price: 600, createdAt: '2026-01-02T00:00:00Z', provider: { name: 'C', skills: '', providerProfile: { specialties: [] }, ratingsReceived: [], _count: { tasksAssigned: 5 } } },
  ],
};
const notifications = { createNotification: async () => ({}) };
const repositoryPath = require.resolve('./repository');
const notificationPath = require.resolve('../notifications/repository');
require.cache[repositoryPath] = { id: repositoryPath, filename: repositoryPath, loaded: true, exports: repository };
require.cache[notificationPath] = { id: notificationPath, filename: notificationPath, loaded: true, exports: notifications };
delete require.cache[require.resolve('./service')];
const service = require('./service');

test('bid list is requester/admin only', async () => {
  await assert.rejects(() => service.listBidsForTask(4, { id: 21, role: 'PROVIDER' }), error => error.statusCode === 403);
  assert.equal((await service.listBidsForTask(4, { id: 10, role: 'REQUESTER' })).length, 3);
  assert.equal((await service.listBidsForTask(4, { id: 1, role: 'ADMIN' })).length, 3);
});

test('bid sorting uses actual price, ratings, completed tasks and category match', async () => {
  const requester = { id: 10, role: 'REQUESTER' };
  assert.deepEqual((await service.listBidsForTask(4, requester, 'PRICE_ASC')).map(item => item.id), [2, 3, 1]);
  assert.deepEqual((await service.listBidsForTask(4, requester, 'RATING')).map(item => item.id), [1, 2, 3]);
  assert.deepEqual((await service.listBidsForTask(4, requester, 'EXPERIENCE')).map(item => item.id), [1, 3, 2]);
  const expertise = await service.listBidsForTask(4, requester, 'EXPERTISE');
  assert.equal(expertise[0].id, 2);
  assert.equal(expertise[0].provider.expertiseMatch, true);
});

test('unsupported bid sort is rejected', async () => {
  await assert.rejects(() => service.listBidsForTask(4, { id: 10, role: 'REQUESTER' }, 'MADE_UP_SCORE'), error => error.statusCode === 400);
});
