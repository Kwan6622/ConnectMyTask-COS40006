// Fraud/risk flag workflow tests — exercises the existing rule in
// src/modules/tasks/riskEvaluator.js through the real Express routes.
// Run: node --test test_folder/fraud.flow.test.js
const assert = require('node:assert/strict');
const { test, before, after, describe } = require('node:test');
const { startPlatform } = require('./support/platformHarness');

let p;
before(async () => { p = await startPlatform(); });
after(async () => { await p.close(); });

const pair = async () => ({ requester: await p.signup('CLIENT'), provider: await p.signup('PROVIDER') });
const post = (requester, overrides) => p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload(overrides) });
const edit = (requester, id, body) => p.api('PATCH', `/api/tasks/${id}`, { token: requester.token, body });
const activity = (taskId, action) => p.store.activities.filter((a) => a.taskId === taskId && a.action === action);

describe('F1 Flagging on task creation', () => {
  test('F1.1 a budget under half the category minimum is flagged HIGH with the generic reason', async () => {
    const { requester } = await pair();
    const res = await post(requester, { category: 'HOME_REPAIR', budget: 100000 });
    assert.equal(res.status, 201);
    const row = p.dbTask(res.body.id);
    assert.equal(row.isSuspicious, true);
    assert.equal(row.riskLevel, 'HIGH');
    assert.equal(row.suspiciousReason, 'Budget is unusually low for this type of job');
  });

  test('F1.2 a budget just under the minimum is flagged MEDIUM', async () => {
    const { requester } = await pair();
    const res = await post(requester, { category: 'HOME_REPAIR', budget: 349000 });
    assert.equal(p.dbTask(res.body.id).riskLevel, 'MEDIUM');
  });

  test('F1.3 a realistic budget is not flagged', async () => {
    const { requester } = await pair();
    const res = await post(requester, { category: 'HOME_REPAIR', budget: 350000 });
    const row = p.dbTask(res.body.id);
    assert.equal(row.isSuspicious, false);
    assert.equal(row.riskLevel, null);
    assert.equal(row.suspiciousReason, null);
  });

  test('F1.4 keywords raise the minimum, so the same budget becomes suspicious with a specific reason', async () => {
    const { requester } = await pair();
    const base = { category: 'CLEANING', budget: 300000 };
    const normal = await post(requester, { ...base, title: 'Clean my room', description: 'Weekly tidy up of one bedroom.' });
    const deep = await post(requester, { ...base, title: 'Deep cleaning', description: 'Deep clean of the full apartment.' });
    assert.equal(p.dbTask(normal.body.id).isSuspicious, false);
    const row = p.dbTask(deep.body.id);
    assert.equal(row.isSuspicious, true);
    assert.equal(row.riskLevel, 'MEDIUM');
    assert.equal(row.suspiciousReason, 'Task scope suggests a more intensive service than a standard cleaning job. Budget looks unusually low for this task.');
  });

  test('F1.5 the TASK_CREATED audit entry records the risk result', async () => {
    const { requester } = await pair();
    const res = await post(requester, { budget: 20000 });
    const [log] = activity(res.body.id, 'TASK_CREATED');
    assert.equal(log.metadata.isSuspicious, true);
    assert.equal(log.metadata.riskLevel, 'HIGH');
  });
});

describe('F2 Who can see the flag', () => {
  test('F2.1 the requester never sees risk fields, on create, detail or list', async () => {
    const { requester } = await pair();
    const created = await post(requester, { budget: 20000 });
    assert.equal(created.body.isSuspicious, undefined);
    const detail = await p.api('GET', `/api/tasks/${created.body.id}`, { token: requester.token });
    assert.equal(detail.body.riskLevel, undefined);
    assert.equal(detail.body.suspiciousReason, undefined);
    const list = await p.api('GET', '/api/tasks', { token: requester.token });
    const mine = list.body.find((t) => t.id === created.body.id);
    assert.ok(mine);
    assert.equal(mine.isSuspicious, undefined);
  });

  test('F2.2 a visitor without a token does not see risk fields', async () => {
    const { requester } = await pair();
    const created = await post(requester, { budget: 20000 });
    const detail = await p.api('GET', `/api/tasks/${created.body.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.isSuspicious, undefined);
    assert.equal(detail.body.riskLevel, undefined);
  });

  test('F2.3 providers see the flag, level and reason on detail and in the browse list', async () => {
    const { requester, provider } = await pair();
    const created = await post(requester, { budget: 20000 });
    const detail = await p.api('GET', `/api/tasks/${created.body.id}`, { token: provider.token });
    assert.equal(detail.body.isSuspicious, true);
    assert.equal(detail.body.riskLevel, 'HIGH');
    assert.match(detail.body.suspiciousReason, /unusually low/);
    const list = await p.api('GET', '/api/tasks', { token: provider.token });
    assert.equal(list.body.find((t) => t.id === created.body.id)?.isSuspicious, true);
  });
});

describe('F3 Re-evaluation when the requester edits the task', () => {
  test('F3.1 raising the budget clears the flag; lowering it flags again', async () => {
    const { requester } = await pair();
    const created = await post(requester, { category: 'MOVING', budget: 100000 });
    assert.equal(p.dbTask(created.body.id).isSuspicious, true);

    assert.equal((await edit(requester, created.body.id, { budget: 900000 })).status, 200);
    let row = p.dbTask(created.body.id);
    assert.equal(row.isSuspicious, false);
    assert.equal(row.riskLevel, null);
    assert.equal(row.suspiciousReason, null);

    await edit(requester, created.body.id, { budget: 500000 });
    row = p.dbTask(created.body.id);
    assert.equal(row.isSuspicious, true);
    assert.equal(row.riskLevel, 'MEDIUM');
    const logs = activity(created.body.id, 'TASK_UPDATED');
    assert.deepEqual(logs.map((l) => l.metadata.isSuspicious), [false, true]);
  });

  test('F3.2 editing only the title re-checks keywords against the stored budget', async () => {
    const { requester } = await pair();
    const created = await post(requester, { category: 'DELIVERY', budget: 110000, title: 'Deliver a parcel', description: 'Small parcel across town.' });
    assert.equal(p.dbTask(created.body.id).isSuspicious, false);
    await edit(requester, created.body.id, { title: 'Deliver a parcel ASAP' });
    const row = p.dbTask(created.body.id);
    assert.equal(row.isSuspicious, true);
    assert.match(row.suspiciousReason, /^Urgent tasks usually require a higher budget/);
  });

  test('F3.3 changing the category re-checks against the new category minimum', async () => {
    const { requester } = await pair();
    const created = await post(requester, { category: 'DELIVERY', budget: 150000, title: 'Help', description: 'Help with a small job.' });
    assert.equal(p.dbTask(created.body.id).isSuspicious, false);
    await edit(requester, created.body.id, { category: 'MOVING' });
    assert.equal(p.dbTask(created.body.id).riskLevel, 'HIGH');
  });
});

describe('F4 What the flag does not do (current behaviour)', () => {
  test('F4.1 a flagged task stays OPEN and providers can still bid on it', async () => {
    const { requester, provider } = await pair();
    const created = await post(requester, { budget: 20000 });
    assert.equal(p.dbTask(created.body.id).status, 'OPEN');
    const bid = await p.api('POST', `/api/tasks/${created.body.id}/bids`, {
      token: provider.token, body: { amount: 20000, message: 'Can do it' },
    });
    assert.equal(bid.status, 201);
  });

  test('F4.2 editing the site address re-verifies it with the geocoder', {
    todo: 'GAP: updateTask accepts any siteAddress/siteLatitude/siteLongitude without calling verifyAddress, so a verified task address can be replaced with an unverified one',
  }, async () => {
    const { requester } = await pair();
    const created = await post(requester, {});
    const res = await edit(requester, created.body.id, { siteAddress: 'Somewhere else', siteLatitude: 0, siteLongitude: 0 });
    assert.equal(res.status, 400);
  });
});
