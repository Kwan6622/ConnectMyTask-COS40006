const test = require('node:test');
const assert = require('node:assert/strict');

let savedData;
const repository = {
  getUserById: async id => ({ id, role: 'REQUESTER' }),
  updateProfile: async (id, data) => { savedData = data; return { id, ...data }; },
  getPublicUserById: async id => ({ id, name: 'Public user', role: 'REQUESTER' }),
  getLatestProviderRatingsSummary: async () => null,
  toSafePrivateUser: user => user,
};
const repositoryPath = require.resolve('./repository');
require.cache[repositoryPath] = { id: repositoryPath, filename: repositoryPath, loaded: true, exports: repository };
delete require.cache[require.resolve('./service')];
const service = require('./service');

test('profile update persists only intended editable fields', async () => {
  await service.updateProfile(4, {
    name: 'Updated name', phone: '123', bio: 'Bio', email: 'ignored@example.test', role: 'ADMIN', status: 'SUSPENDED',
  });
  assert.deepEqual(savedData, { name: 'Updated name', phone: '123', bio: 'Bio' });
});

test('public profile uses privacy-safe repository projection', async () => {
  const user = await service.getUserById(4);
  assert.deepEqual(user, { id: 4, name: 'Public user', role: 'REQUESTER', providerRatingSummary: null });
});
