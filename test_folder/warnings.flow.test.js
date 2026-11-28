// Account warnings (3 = locked for 3 days) and EXPIRED tasks.
// Runs the real Express app against the in-memory store (support/platformHarness.js).
// Run: node --test test_folder/warnings.flow.test.js
const assert = require('node:assert/strict');
const { test, before, after, describe } = require('node:test');
const { startPlatform } = require('./support/platformHarness');

let p;
before(async () => { p = await startPlatform(); });
after(async () => { await p.close(); });

const PASSWORD = 'WorkflowPass123!';
const DAY = 24 * 60 * 60 * 1000;
const login = (user) => p.api('POST', '/api/auth/login', { body: { email: user.email, password: PASSWORD } });
const warn = (admin, user, change, reason = 'Repeated no-shows reported by providers') =>
  p.api('POST', `/api/admin/users/${user.id}/warnings`, { token: admin.token, body: { change, reason } });
const user = (id) => p.store.users.find((u) => u.id === id);
const notes = (id) => p.store.notifications.filter((n) => n.recipientId === id).map((n) => n.message);

describe('W Account warnings', () => {
  test('W1 an admin adds a warning with a reason; the user sees count and reason on the profile', async () => {
    const admin = p.createAdmin();
    const requester = await p.signup('CLIENT');
    const res = await warn(admin, requester, 1);
    assert.equal(res.status, 200);
    assert.equal(res.body.warningCount, 1);
    const me = await p.api('GET', '/api/users/me', { token: requester.token });
    assert.equal(me.body.warningCount, 1);
    assert.equal(me.body.warningLimit, 3);
    assert.equal(me.body.warnings[0].reason, 'Repeated no-shows reported by providers');
    assert.ok(notes(requester.id).some((m) => /warning 1\/3/.test(m)));
    const history = await p.api('GET', `/api/admin/users/${requester.id}/warnings`, { token: admin.token });
    assert.equal(history.status, 200);
    assert.equal(history.body.warnings.length, 1);
  });

  test('W2 only admins can change warnings, admins cannot be warned, and a reason is required', async () => {
    const admin = p.createAdmin();
    const requester = await p.signup('CLIENT');
    const provider = await p.signup('PROVIDER');
    assert.equal((await warn(provider, requester, 1)).status, 403);
    assert.equal((await warn(admin, p.createAdmin(), 1)).status, 409);
    assert.equal((await warn(admin, requester, 1, '')).status, 400);
    assert.equal((await warn(admin, requester, -1)).status, 409, 'cannot go below zero');
    assert.equal((await warn(admin, requester, 2)).status, 400, 'one step at a time');
  });

  test('W3 the third warning locks the account for 3 days: sign-in and API calls show the lock time', async () => {
    const admin = p.createAdmin();
    const requester = await p.signup('CLIENT');
    await warn(admin, requester, 1);
    await warn(admin, requester, 1);
    const third = await warn(admin, requester, 1);
    assert.equal(third.body.status, 'LOCKED');
    const until = new Date(third.body.lockedUntil).getTime();
    assert.ok(Math.abs(until - (Date.now() + 3 * DAY)) < 60 * 1000, 'locked for 3 days');

    const signIn = await login(requester);
    assert.equal(signIn.status, 403);
    assert.equal(signIn.body.code, 'ACCOUNT_LOCKED');
    assert.equal(new Date(signIn.body.lockedUntil).getTime(), until);
    assert.equal(signIn.body.warningCount, 3);
    assert.equal(signIn.body.reasons.length, 3, 'the lock page can list why');
    assert.equal(signIn.body.accessToken, undefined, 'no session is issued');

    const api = await p.api('GET', '/api/users/me', { token: requester.token });
    assert.equal(api.status, 403, 'an existing session is blocked too');
    assert.equal(api.body.code, 'ACCOUNT_LOCKED');
  });

  test('W4 the lock ends by itself when the time is up and the warnings reset', async () => {
    const admin = p.createAdmin();
    const requester = await p.signup('CLIENT');
    for (let i = 0; i < 3; i += 1) await warn(admin, requester, 1);
    user(requester.id).lockedUntil = new Date(Date.now() - 1000);
    const signIn = await login(requester);
    assert.equal(signIn.status, 200);
    assert.equal(user(requester.id).status, 'ACTIVE');
    assert.equal(user(requester.id).warningCount, 0);
    assert.ok(notes(requester.id).some((m) => /lock has ended/.test(m)));
  });

  test('W5 an admin can reactivate a locked account early, and lowering below 3 also lifts the lock', async () => {
    const admin = p.createAdmin();
    const a = await p.signup('CLIENT');
    for (let i = 0; i < 3; i += 1) await warn(admin, a, 1);
    const reactivated = await p.api('PATCH', `/api/admin/users/${a.id}/status`, { token: admin.token, body: { status: 'ACTIVE' } });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body.status, 'ACTIVE');
    assert.equal(reactivated.body.warningCount, 0);
    assert.equal((await login(a)).status, 200);

    const b = await p.signup('PROVIDER');
    for (let i = 0; i < 3; i += 1) await warn(admin, b, 1);
    const lowered = await warn(admin, b, -1, 'Warning issued by mistake');
    assert.equal(lowered.body.status, 'ACTIVE');
    assert.equal(lowered.body.warningCount, 2);
    assert.equal((await login(b)).status, 200);

    const list = await p.api('GET', '/api/admin/users', { token: admin.token });
    assert.ok(list.body.find((u) => u.id === b.id).warningCount === 2, 'admin list shows the count');
  });
});

describe('E Expired tasks', () => {
  // dbTask() returns a copy; change the stored row itself.
  const row = (id) => p.store.tasks.find((t) => t.id === id);
  const pastDue = (task, hoursAgo = 1) => { row(task.id).dueDate = new Date(Date.now() - hoursAgo * 3600 * 1000); };
  const browseIds = async (token) => (await p.api('GET', '/api/tasks', { token })).body.map((t) => t.id);

  test('E1 an open task past its deadline with no bids becomes EXPIRED, private to its requester, with a repost hint', async () => {
    const { requester, provider } = { requester: await p.signup('CLIENT'), provider: await p.signup('PROVIDER') };
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    pastDue(task);
    assert.ok(!(await browseIds(provider.token)).includes(task.id), 'gone from browse');
    assert.equal(p.dbTask(task.id).status, 'EXPIRED');
    assert.equal((await p.api('GET', `/api/tasks/${task.id}`, { token: provider.token })).status, 404, 'others cannot open it');
    assert.equal((await p.api('GET', `/api/tasks/${task.id}`)).status, 404);
    assert.equal((await p.api('GET', `/api/tasks/${task.id}`, { token: requester.token })).status, 200, 'the requester can');
    const mine = await p.api('GET', '/api/tasks/requester/me', { token: requester.token });
    assert.equal(mine.body.find((t) => t.id === task.id).status, 'EXPIRED');
    assert.ok(notes(requester.id).some((m) => /expired with no bids.*edit and repost/i.test(m)));
    assert.equal(user(requester.id).warningCount || 0, 0, 'no bids, no warning');
    const suggested = await p.api('GET', '/api/tasks/suggested/me', { token: provider.token });
    assert.ok(!suggested.body.some((t) => t.id === task.id), 'not suggested either');
  });

  test('E2 bids received but nobody assigned before the deadline: EXPIRED and +1 warning for the requester', async () => {
    const requester = await p.signup('CLIENT');
    const provider = await p.signup('PROVIDER');
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    assert.equal((await p.api('POST', `/api/tasks/${task.id}/bids`, { token: provider.token, body: { amount: 600000 } })).status, 201);
    pastDue(task); // deadline passed while the 24 h bidding window was still open
    await browseIds(provider.token);
    assert.equal(p.dbTask(task.id).status, 'EXPIRED');
    assert.equal(user(requester.id).warningCount, 1);
    assert.match(p.store.warnings.find((w) => w.userId === requester.id).reason, /received 1 bid\(s\) but no provider was assigned/);
    assert.ok(p.store.bids.filter((b) => b.taskId === task.id).every((b) => b.status === 'REJECTED'), 'bids closed');
    assert.ok(notes(provider.id).some((m) => /expired before the requester assigned anyone/.test(m)));
  });

  test('E3 a task whose bidding window closed before the deadline is left to auto-assign: not expired, no warning', async () => {
    const requester = await p.signup('CLIENT');
    const provider = await p.signup('PROVIDER');
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    await p.api('POST', `/api/tasks/${task.id}/bids`, { token: provider.token, body: { amount: 600000 } });
    row(task.id).biddingEndsAt = new Date(Date.now() - 2 * 3600 * 1000);
    pastDue(task, 1);
    await browseIds(provider.token);
    assert.notEqual(p.dbTask(task.id).status, 'EXPIRED');
    assert.equal(user(requester.id).warningCount || 0, 0);
  });

  test('E4 the requester gets repost tips, edits the task and reposts it with a new deadline', async () => {
    const requester = await p.signup('CLIENT');
    const provider = await p.signup('PROVIDER');
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ budget: 100000, title: 'Repair', imageUrls: [] }) })).body;
    pastDue(task);
    await browseIds(provider.token);

    const tips = await p.api('GET', `/api/tasks/${task.id}/repost-suggestions`, { token: requester.token });
    assert.equal(tips.status, 200);
    const fields = tips.body.suggestions.map((s) => s.field);
    for (const field of ['budget', 'dueDate', 'title', 'imageUrls']) assert.ok(fields.includes(field), `tip for ${field}`);
    const newDue = tips.body.suggestions.find((s) => s.field === 'dueDate').suggestedValue;
    assert.ok(new Date(newDue) > new Date());
    assert.equal((await p.api('GET', `/api/tasks/${task.id}/repost-suggestions`, { token: provider.token })).status, 403);

    const repost = (body, token = requester.token) => p.api('PATCH', `/api/tasks/${task.id}/repost`, { token, body });
    assert.equal((await repost({ dueDate: '2020-01-01T00:00:00.000Z' })).status, 400, 'deadline must be in the future');
    assert.equal((await repost({ dueDate: newDue }, provider.token)).status, 403);
    const done = await repost({ title: 'Repair loose kitchen cabinet door', budget: 650000, dueDate: newDue });
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'OPEN');
    assert.equal(done.body.title, 'Repair loose kitchen cabinet door');
    assert.ok((await browseIds(provider.token)).includes(task.id), 'back in browse');
    assert.equal((await repost({ dueDate: newDue })).status, 409, 'only expired tasks can be reposted');
  });

  test('E5 the requester can delete an expired task permanently; nobody else can, and only expired ones', async () => {
    const requester = await p.signup('CLIENT');
    const other = await p.signup('CLIENT');
    const open = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    assert.equal((await p.api('DELETE', `/api/tasks/${open.id}/permanent`, { token: requester.token })).status, 409);

    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    pastDue(task);
    await browseIds(requester.token);
    assert.equal((await p.api('DELETE', `/api/tasks/${task.id}/permanent`, { token: other.token })).status, 403);
    const del = await p.api('DELETE', `/api/tasks/${task.id}/permanent`, { token: requester.token });
    assert.equal(del.status, 200);
    assert.equal(p.dbTask(task.id), null, 'row removed from the database');
    assert.equal(p.store.subtasks.filter((s) => s.taskId === task.id).length, 0);
  });

  test('E6 providers cannot bid once the deadline has passed', async () => {
    const requester = await p.signup('CLIENT');
    const provider = await p.signup('PROVIDER');
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    pastDue(task);
    const bid = await p.api('POST', `/api/tasks/${task.id}/bids`, { token: provider.token, body: { amount: 600000 } });
    assert.equal(bid.status, 400);
  });
});
