// Requester (CLIENT) workflow tests — Project B plan FR-B1..FR-B7 from the requester side.
// Runs the real Express app against an in-memory store (see support/platformHarness.js).
// Run: node --test test_folder/requester.flow.test.js
const assert = require('node:assert/strict');
const { test, before, after, describe } = require('node:test');
const { startPlatform } = require('./support/platformHarness');

let p;
before(async () => { p = await startPlatform(); });
after(async () => { await p.close(); });

const pair = async () => ({ requester: await p.signup('CLIENT'), provider: await p.signup('PROVIDER') });

describe('R1 Account and profile', () => {
  test('R1.1 CLIENT signup maps to REQUESTER and /auth/me returns the session user', async () => {
    const requester = await p.signup('CLIENT');
    assert.equal(requester.role, 'REQUESTER');
    assert.equal(requester.passwordHash, undefined, 'password hash must never be returned');
    const me = await p.api('GET', '/api/auth/me', { token: requester.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, requester.id);
  });

  test('R1.2 signup requires a ward/location and rejects duplicate emails', async () => {
    const missing = await p.api('POST', '/api/auth/signup', {
      body: { fullName: 'No Location', email: 'noloc@example.test', password: 'Secret123!', role: 'CLIENT', wardId: 999999 },
    });
    assert.equal(missing.status, 400);
    const requester = await p.signup('CLIENT');
    const dup = await p.api('POST', '/api/auth/signup', {
      body: { fullName: 'Duplicate', email: requester.email, password: 'Secret123!', role: 'CLIENT', wardId: p.BEN_THANH },
    });
    assert.equal(dup.status, 400);
  });

  test('R1.3 login succeeds with the right password and fails with a wrong one', async () => {
    const requester = await p.signup('CLIENT');
    const ok = await p.api('POST', '/api/auth/login', { body: { email: requester.email, password: 'WorkflowPass123!' } });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.accessToken);
    const bad = await p.api('POST', '/api/auth/login', { body: { email: requester.email, password: 'WrongPass123!' } });
    assert.equal(bad.status, 401);
  });

  test('R1.4 requests without a token are rejected (401)', async () => {
    const res = await p.api('POST', '/api/tasks', { body: p.taskPayload() });
    assert.equal(res.status, 401);
  });

  test('R1.5 FR-B7 profile update saves phone/location and rejects protected fields', async () => {
    const requester = await p.signup('CLIENT');
    const ok = await p.api('PATCH', '/api/users/me', { token: requester.token, body: { phone: '0901234567', wardId: p.ward('Tan Dinh'), streetAddress: '12/5 Tran Quang Khai', bio: 'Busy parent' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.phone, '0901234567');
    assert.equal(ok.body.user.location, 'Tan Dinh, Ho Chi Minh City');
    assert.equal(ok.body.user.locationId, p.ward('Tan Dinh'));
    assert.equal(ok.body.user.cityId, 79);
    assert.equal(ok.body.user.streetAddress, '12/5 Tran Quang Khai');
    const typed = await p.api('PATCH', '/api/users/me', { token: requester.token, body: { wardId: 123 } });
    assert.equal(typed.status, 400, 'a ward that is not on the list cannot be saved');
    const me = await p.api('GET', '/api/users/me', { token: requester.token });
    assert.equal(me.status, 200);
    assert.equal(JSON.stringify(me.body).includes('passwordHash'), false, 'private profile never exposes the password hash');
    const escalate = await p.api('PATCH', '/api/users/me', { token: requester.token, body: { role: 'ADMIN' } });
    assert.equal(escalate.status, 400, 'role must not be editable through the profile endpoint');
    assert.equal(p.store.users.find((u) => u.id === requester.id).role, 'REQUESTER');
  });
});

describe('R2 Post and manage a task', () => {
  test('R2.1 FR-B6 only requesters can post tasks', async () => {
    const { provider } = await pair();
    const res = await p.api('POST', '/api/tasks', { token: provider.token, body: p.taskPayload() });
    assert.equal(res.status, 403);
  });

  test('R2.2 invalid task input is rejected (negative budget, past due date, >3 images)', async () => {
    const requester = await p.signup('CLIENT');
    assert.equal((await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ budget: -5 }) })).status, 400);
    assert.equal((await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ dueDate: '2020-01-01T00:00:00.000Z' }) })).status, 400);
    const images = Array.from({ length: 4 }, (_, i) => `https://res.cloudinary.com/demo/${i}.jpg`);
    assert.equal((await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ imageUrls: images }) })).status, 400);
  });

  test('R2.3 a valid task is OPEN, geocoded, gets 4 subtasks and hides the precise address in responses', async () => {
    const requester = await p.signup('CLIENT');
    const res = await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'OPEN');
    assert.equal(res.body.createdById, requester.id);
    assert.equal(res.body.location, 'Ben Thanh, Ho Chi Minh City');
    assert.equal(res.body.isApproximateLocation, false);
    assert.equal(res.body.siteAddress, undefined, 'FR-B3 precise address must not be in the public task');
    assert.equal(res.body.siteLatitude, undefined);
    const stored = p.dbTask(res.body.id);
    assert.ok(Number.isFinite(stored.siteLatitude) && Number.isFinite(stored.siteLongitude), 'server stores trusted geocoded coordinates');
    assert.equal(p.store.subtasks.filter((s) => s.taskId === res.body.id).length, 4);
  });

  test('R2.4 Fraud/risk flags are computed but hidden from the requester', async () => {
    const requester = await p.signup('CLIENT');
    const res = await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ budget: 20000 }) });
    assert.equal(res.status, 201);
    assert.equal(p.dbTask(res.body.id).isSuspicious, true, 'unrealistically low budget should be flagged');
    assert.equal(res.body.isSuspicious, undefined);
    assert.equal(res.body.riskLevel, undefined);
  });

  test('R2.5 the requester can edit an OPEN task but not after a provider is assigned', async () => {
    const { requester, provider } = await pair();
    const { task, bid } = await p.advanceTask('BID', { requester, provider });
    const edit = await p.api('PATCH', `/api/tasks/${task.id}`, { token: requester.token, body: { title: 'Fix sink and tap' } });
    assert.equal(edit.status, 200);
    await p.api('PATCH', `/api/tasks/${task.id}/assign-provider`, { token: requester.token, body: { bidId: bid.id } });
    const late = await p.api('PATCH', `/api/tasks/${task.id}`, { token: requester.token, body: { budget: 1 } });
    assert.equal(late.status, 409);
  });

  test('R2.6 another requester cannot edit someone else\'s task', async () => {
    const owner = await p.signup('CLIENT');
    const other = await p.signup('CLIENT');
    const task = (await p.api('POST', '/api/tasks', { token: owner.token, body: p.taskPayload() })).body;
    const res = await p.api('PATCH', `/api/tasks/${task.id}`, { token: other.token, body: { title: 'Hijacked' } });
    assert.equal(res.status, 403);
  });

  test('R2.7 the task appears in /tasks/requester/me', async () => {
    const requester = await p.signup('CLIENT');
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    const mine = await p.api('GET', '/api/tasks/requester/me', { token: requester.token });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.some((t) => t.id === task.id));
  });
});

describe('R3 Review bids and assign a provider', () => {
  test('R3.1 only the task owner can view bids; sort options work', async () => {
    const requester = await p.signup('CLIENT');
    const cheap = await p.signup('PROVIDER');
    const pricey = await p.signup('PROVIDER');
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    await p.api('POST', `/api/tasks/${task.id}/bids`, { token: pricey.token, body: { amount: 700000 } });
    await p.api('POST', `/api/tasks/${task.id}/bids`, { token: cheap.token, body: { amount: 550000 } });
    const sorted = await p.api('GET', `/api/tasks/${task.id}/bids?sort=PRICE_ASC`, { token: requester.token });
    assert.equal(sorted.status, 200);
    assert.deepEqual(sorted.body.map((b) => b.providerId), [cheap.id, pricey.id]);
    assert.equal((await p.api('GET', `/api/tasks/${task.id}/bids`, { token: cheap.token })).status, 403);
    assert.equal((await p.api('GET', `/api/tasks/${task.id}/bids?sort=MADE_UP`, { token: requester.token })).status, 400);
  });

  test('R3.2 assigning a bid sets ASSIGNED + PENDING_DEPOSIT and rejects the other bids', async () => {
    const requester = await p.signup('CLIENT');
    const winner = await p.signup('PROVIDER');
    const loser = await p.signup('PROVIDER');
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    const win = (await p.api('POST', `/api/tasks/${task.id}/bids`, { token: winner.token, body: { amount: 600000 } })).body;
    const lose = (await p.api('POST', `/api/tasks/${task.id}/bids`, { token: loser.token, body: { amount: 620000 } })).body;
    const res = await p.api('PATCH', `/api/tasks/${task.id}/assign-provider`, { token: requester.token, body: { bidId: win.id } });
    assert.equal(res.status, 200);
    const stored = p.dbTask(task.id);
    assert.equal(stored.status, 'ASSIGNED');
    assert.equal(stored.assignedProviderId, winner.id);
    assert.equal(stored.escrowStatus, 'PENDING_DEPOSIT');
    assert.equal(p.store.bids.find((b) => b.id === lose.id).status, 'REJECTED');
    const again = await p.api('PATCH', `/api/tasks/${task.id}/assign-provider`, { token: requester.token, body: { bidId: lose.id } });
    assert.equal(again.status, 400, 'a task cannot be assigned twice');
  });

  test('R3.3 a different requester cannot assign a provider to the task', async () => {
    const { requester, provider } = await pair();
    const intruder = await p.signup('CLIENT');
    const { task, bid } = await p.advanceTask('BID', { requester, provider });
    const res = await p.api('PATCH', `/api/tasks/${task.id}/assign-provider`, { token: intruder.token, body: { bidId: bid.id } });
    assert.equal(res.status, 403);
  });
});

describe('R4 FR-B1 Fund escrow before work', () => {
  test('R4.1 escrow cannot be created before assignment or by the provider', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('BID', { requester, provider });
    const early = await p.api('POST', '/api/payments/create', { token: requester.token, body: { taskId: task.id, flow: 'ESCROW_DEPOSIT' } });
    assert.equal(early.status, 400);
    const byProvider = await p.api('POST', '/api/payments/create', { token: provider.token, body: { taskId: task.id, flow: 'ESCROW_DEPOSIT' } });
    assert.equal(byProvider.status, 403);
  });

  test('R4.2 direct payment without escrow is refused', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('ASSIGNED', { requester, provider });
    const res = await p.api('POST', '/api/payments/create', { token: requester.token, body: { taskId: task.id, flow: 'DIRECT_PAYMENT' } });
    assert.equal(res.status, 409);
  });

  test('R4.3 checkout charges the accepted bid price, not the budget, and stays pending until paid', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('ASSIGNED', { requester, provider, bidAmount: 580000 });
    const checkout = await p.api('POST', '/api/payments/create', { token: requester.token, body: { taskId: task.id, flow: 'ESCROW_DEPOSIT' } });
    assert.equal(checkout.status, 201);
    assert.ok(checkout.body.paymentUrl);
    assert.equal(p.store.stripeSessions.get(checkout.body.sessionId).amount_total, 580000);
    const unpaid = await p.api('POST', '/api/payments/confirm-session', { token: requester.token, body: { sessionId: checkout.body.sessionId } });
    assert.equal(unpaid.status, 200);
    assert.equal(unpaid.body.status, 'PENDING');
    assert.equal(p.dbTask(task.id).escrowStatus, 'PENDING_DEPOSIT');
  });

  test('R4.4 paying the checkout moves escrow to HELD; a second deposit is refused', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('FUNDED', { requester, provider });
    const stored = p.dbTask(task.id);
    assert.equal(stored.escrowStatus, 'HELD');
    assert.equal(stored.paymentStatus, 'ESCROW_HELD');
    const again = await p.api('POST', '/api/payments/create', { token: requester.token, body: { taskId: task.id, flow: 'ESCROW_DEPOSIT' } });
    assert.equal(again.status, 409);
  });

  test('R4.5 another user cannot confirm the requester\'s checkout session', async () => {
    const { requester, provider } = await pair();
    const intruder = await p.signup('CLIENT');
    const { task } = await p.advanceTask('ASSIGNED', { requester, provider });
    const checkout = (await p.api('POST', '/api/payments/create', { token: requester.token, body: { taskId: task.id, flow: 'ESCROW_DEPOSIT' } })).body;
    p.payCheckout(checkout.sessionId);
    const res = await p.api('POST', '/api/payments/confirm-session', { token: intruder.token, body: { sessionId: checkout.sessionId } });
    assert.equal(res.status, 403);
    assert.equal(p.dbTask(task.id).escrowStatus, 'PENDING_DEPOSIT');
  });
});

describe('R5 Track the provider (IoT)', () => {
  test('R5.1 site location and live tracking are locked until escrow is HELD', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('ASSIGNED', { requester, provider });
    const site = await p.api('GET', `/api/tracking/tasks/${task.id}/site-location`, { token: requester.token });
    assert.equal(site.status, 409);
    assert.equal((await p.api('GET', `/api/tracking/tasks/${task.id}/latest`, { token: requester.token })).status, 409);
  });

  test('R5.2 after funding the requester sees verification status and the provider\'s live location', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('FUNDED', { requester, provider });
    const before = await p.api('GET', `/api/tracking/tasks/${task.id}/verification`, { token: requester.token });
    assert.equal(before.body.isValid, false);
    assert.equal(before.body.reason, 'NOT_VERIFIED');
    await p.api('POST', `/api/tracking/tasks/${task.id}/verify`, { token: provider.token, body: p.gpsFix(p.dbTask(task.id)) });
    const afterVerify = await p.api('GET', `/api/tracking/tasks/${task.id}/verification`, { token: requester.token });
    assert.equal(afterVerify.body.isValid, true);
    const latest = await p.api('GET', `/api/tracking/tasks/${task.id}/latest`, { token: requester.token });
    assert.equal(latest.status, 200);
    assert.equal(latest.body.providerId, provider.id);
  });

  test('R5.3 an unrelated requester cannot read tracking data', async () => {
    const { requester, provider } = await pair();
    const outsider = await p.signup('CLIENT');
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    assert.equal((await p.api('GET', `/api/tracking/tasks/${task.id}/latest`, { token: outsider.token })).status, 403);
    assert.equal((await p.api('GET', `/api/tasks/${task.id}/progress`, { token: outsider.token })).status, 403);
  });
});

describe('R6 Confirm completion and release payment', () => {
  test('R6.1 completion cannot be confirmed before the provider marks the task complete', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    const res = await p.api('POST', `/api/tasks/${task.id}/confirm-completion`, { token: requester.token });
    assert.equal(res.status, 400);
    assert.equal(p.dbTask(task.id).escrowStatus, 'HELD');
  });

  test('R6.2 confirming completion releases escrow: task PAID, payout + platform fee = agreed price', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('PENDING_CONFIRMATION', { requester, provider, bidAmount: 600000 });
    const res = await p.api('POST', `/api/tasks/${task.id}/confirm-completion`, { token: requester.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.task.status, 'PAID');
    assert.equal(res.body.task.escrowStatus, 'RELEASED');
    const release = p.store.payments.find((x) => x.taskId === task.id && x.type === 'ESCROW_RELEASE');
    assert.ok(release, 'an ESCROW_RELEASE transaction is recorded');
    const deposit = p.store.payments.find((x) => x.taskId === task.id && x.type === 'ESCROW_DEPOSIT');
    assert.equal(deposit.lifecycleStatus, 'RELEASED', 'the deposit is no longer counted as held money');
    assert.equal(deposit.escrowStatus, 'RELEASED');
    assert.equal(release.providerPayoutAmount + release.platformFeeAmount, 600000);
    const again = await p.api('POST', `/api/tasks/${task.id}/confirm-completion`, { token: requester.token });
    assert.equal(again.status, 200, 'confirmation is idempotent');
    assert.equal(p.store.payments.filter((x) => x.taskId === task.id && x.type === 'ESCROW_RELEASE').length, 1, 'no double payout');
  });

  test('R6.3 only the task owner can confirm completion', async () => {
    const { requester, provider } = await pair();
    const other = await p.signup('CLIENT');
    const { task } = await p.advanceTask('PENDING_CONFIRMATION', { requester, provider });
    assert.equal((await p.api('POST', `/api/tasks/${task.id}/confirm-completion`, { token: other.token })).status, 403);
    assert.equal((await p.api('POST', `/api/tasks/${task.id}/confirm-completion`, { token: provider.token })).status, 403);
  });

  test('R6.4 payment history lists the deposit and release for the requester', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('PAID', { requester, provider });
    const mine = await p.api('GET', '/api/payments/me', { token: requester.token });
    assert.equal(mine.status, 200);
    const types = mine.body.filter((x) => x.taskId === task.id).map((x) => x.type).sort();
    assert.deepEqual(types, ['ESCROW_DEPOSIT', 'ESCROW_RELEASE']);
  });
});

describe('R7 Cancel, dispute and support', () => {
  test('R7.1 an OPEN task can be cancelled directly', async () => {
    const requester = await p.signup('CLIENT');
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    const res = await p.api('POST', `/api/tasks/${task.id}/cancel`, { token: requester.token, body: { reason: 'No longer needed' } });
    assert.equal(res.status, 200);
    assert.equal(p.dbTask(task.id).status, 'CANCELLED');
  });

  test('R7.2 cancelling a funded task before work starts refunds escrow', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('FUNDED', { requester, provider });
    const res = await p.api('POST', `/api/tasks/${task.id}/cancel`, { token: requester.token, body: { reason: 'Plans changed' } });
    assert.equal(res.status, 200);
    const stored = p.dbTask(task.id);
    assert.equal(stored.status, 'CANCELLED');
    assert.equal(stored.escrowStatus, 'REFUNDED');
    assert.ok(p.store.payments.some((x) => x.taskId === task.id && x.type === 'ESCROW_REFUND'));
  });

  test('R7.3 once work has started the requester must open a dispute instead of cancelling', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    await p.api('POST', `/api/tasks/${task.id}/progress`, { token: provider.token, body: { progressPercent: 30, note: 'Started' } });
    const res = await p.api('POST', `/api/tasks/${task.id}/cancel`, { token: requester.token, body: { reason: 'Too slow' } });
    assert.equal(res.status, 400);
  });

  test('R7.4 opening a dispute freezes the task and escrow, and admin can refund', async () => {
    const { requester, provider } = await pair();
    const admin = p.createAdmin();
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    await p.api('POST', `/api/tasks/${task.id}/progress`, { token: provider.token, body: { progressPercent: 40, note: 'Halfway' } });
    const dispute = await p.api('POST', `/api/tasks/${task.id}/disputes`, {
      token: requester.token, body: { reason: 'QUALITY_ISSUE', description: 'The leak is still there.' },
    });
    assert.equal(dispute.status, 201);
    let stored = p.dbTask(task.id);
    assert.equal(stored.status, 'DISPUTED');
    assert.equal(stored.escrowStatus, 'FROZEN');
    const dup = await p.api('POST', `/api/tasks/${task.id}/disputes`, { token: requester.token, body: { reason: 'OTHER', description: 'Again' } });
    assert.equal(dup.status, 409, 'only one active dispute per task');
    const review = await p.api('PATCH', `/api/tasks/${task.id}/disputes/${dispute.body.dispute.id}/review`, {
      token: admin.token, body: { status: 'RESOLVED', resolution: 'Refund requester', action: 'REFUND_ESCROW' },
    });
    assert.equal(review.status, 200);
    stored = p.dbTask(task.id);
    assert.equal(stored.status, 'CANCELLED');
    assert.equal(stored.escrowStatus, 'REFUNDED');
  });

  test('R7.5 requesters cannot review disputes (admin only)', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    const d = (await p.api('POST', `/api/tasks/${task.id}/disputes`, { token: requester.token, body: { reason: 'OTHER', description: 'Issue' } })).body;
    const res = await p.api('PATCH', `/api/tasks/${task.id}/disputes/${d.dispute.id}/review`, {
      token: requester.token, body: { status: 'RESOLVED', action: 'REFUND_ESCROW' },
    });
    assert.equal(res.status, 403);
  });

  test('R7.6 support ticket can be raised for an own task but not for a stranger\'s task', async () => {
    const requester = await p.signup('CLIENT');
    const stranger = await p.signup('CLIENT');
    const mine = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    const theirs = (await p.api('POST', '/api/tasks', { token: stranger.token, body: p.taskPayload() })).body;
    const ok = await p.api('POST', '/api/support/tickets', {
      token: requester.token, body: { category: 'TASK', subject: 'Provider late', description: 'Provider has not arrived yet.', taskId: mine.id },
    });
    assert.equal(ok.status, 201);
    const no = await p.api('POST', '/api/support/tickets', {
      token: requester.token, body: { category: 'TASK', subject: 'Not mine', description: 'Trying another task.', taskId: theirs.id },
    });
    assert.equal(no.status, 404);
  });
});

describe('R8 Notifications and ratings', () => {
  test('R8.1 requester is notified about bids, location verification and completion', async () => {
    const { requester, provider } = await pair();
    await p.advanceTask('PENDING_CONFIRMATION', { requester, provider });
    const res = await p.api('GET', '/api/notifications/me', { token: requester.token });
    assert.equal(res.status, 200);
    const text = res.body.map((n) => n.message).join('\n');
    assert.match(text, /wants to contact you/);
    assert.match(text, /verified their location/);
    assert.match(text, /marked .* as completed/);
  });

  test('R8.2 a requester cannot rate before the task is completed', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    const res = await p.api('POST', '/api/ratings', { token: requester.token, body: { taskId: task.id, rating: 5 } });
    assert.equal(res.status, 400);
  });

  test('R8.3 FR-B4 requester rates the provider after confirming completion (task is PAID)', {
    todo: 'GAP: ratings/service.js only accepts status COMPLETED, but confirm-completion moves the task straight to PAID',
  }, async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('PAID', { requester, provider });
    const res = await p.api('POST', '/api/ratings', { token: requester.token, body: { taskId: task.id, rating: 5, comment: 'Great job' } });
    assert.equal(res.status, 201);
  });
});

describe('R9 City and ward location (two-level units since 1 July 2025)', () => {
  test('R9.1 the public ward lists cover Ho Chi Minh City and Ha Noi, keyed by official code', async () => {
    const cities = await p.api('GET', '/api/locations/cities');
    assert.equal(cities.status, 200);
    assert.deepEqual(cities.body.cities.map((c) => c.id).sort((a, b) => a - b), [1, 79]);
    const hcm = await p.api('GET', '/api/locations/cities/79/wards');
    const hn = await p.api('GET', '/api/locations/cities/1/wards');
    assert.equal(hcm.body.wards.length, 168);
    assert.equal(hn.body.wards.length, 126);
    assert.ok(hcm.body.wards.some((w) => w.id === p.BEN_THANH && w.name === 'Ben Thanh'));
    assert.equal((await p.api('GET', '/api/locations/cities/48/wards')).status, 404);
  });

  test('R9.2 a task in Ha Noi shows its ward and city', async () => {
    const requester = await p.signup('CLIENT', { wardId: p.ward('Hoan Kiem', 1) });
    assert.equal(requester.location, 'Hoan Kiem, Hanoi');
    assert.equal(requester.cityId, 1);
    const res = await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ wardId: p.ward('Hoan Kiem', 1) }) });
    assert.equal(res.status, 201);
    assert.equal(res.body.location, 'Hoan Kiem, Hanoi');
    assert.equal(res.body.cityId, 1);
  });

  test('R9.3 an address the geocoder cannot find returns ADDRESS_NOT_FOUND so the app can offer a nearby address', async () => {
    const requester = await p.signup('CLIENT');
    const res = await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ streetName: '99 Unfindable Alley' }) });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'ADDRESS_NOT_FOUND');
  });

  test('R9.4 posting at a nearby address requires the exact address (details or profile home address)', async () => {
    const requester = await p.signup('CLIENT');
    const res = await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ isApproximateLocation: true }) });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'EXACT_ADDRESS_REQUIRED');
  });

  test('R9.5 the real home address is tagged, hidden from the public and shown to the provider once funded', async () => {
    const { requester, provider } = await pair();
    await p.api('PATCH', '/api/users/me', { token: requester.token, body: { wardId: p.BEN_THANH, streetAddress: '47/24/3 Le Thanh Ton' } });
    const open = await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ isApproximateLocation: true }) });
    assert.equal(open.status, 201);
    assert.equal(open.body.isApproximateLocation, true);
    const browse = await p.api('GET', '/api/tasks');
    assert.equal(browse.body.find((t) => t.id === open.body.id).isApproximateLocation, true, 'the tag is public');
    const detail = await p.api('GET', `/api/tasks/${open.body.id}`);
    assert.doesNotMatch(JSON.stringify([browse.body, detail.body, open.body]), /Le Thanh Ton/, 'the home address never appears in task data');

    const { task: assigned } = await p.advanceTask('ASSIGNED', { requester, provider, payload: { isApproximateLocation: true } });
    assert.equal((await p.api('GET', `/api/tracking/tasks/${assigned.id}/site-location`, { token: provider.token })).status, 409);

    const { task: funded } = await p.advanceTask('FUNDED', { requester, provider, payload: { isApproximateLocation: true } });
    const site = await p.api('GET', `/api/tracking/tasks/${funded.id}/site-location`, { token: provider.token });
    assert.equal(site.status, 200, JSON.stringify(site.body));
    assert.equal(site.body.isApproximateLocation, true);
    assert.equal(site.body.requesterAddress, '47/24/3 Le Thanh Ton, Ben Thanh, Ho Chi Minh City');
    assert.match(site.body.siteAddress, /Nguyen Hue/, 'GPS check still uses the findable nearby address');
  });
});

describe('R10 Address details on a task (private, max 100 characters)', () => {
  test('R10.1 a nearby address plus exact address details posts without a profile home address; only the funded provider sees the details', async () => {
    const { requester, provider } = await pair();
    const details = 'Hem 47/24, nha mau xanh, tang 3 (house is 80 m down the alley)';
    const payload = { isApproximateLocation: true, addressDetail: details };
    const open = await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload(payload) });
    assert.equal(open.status, 201);
    assert.equal(open.body.isApproximateLocation, true);
    assert.equal(open.body.addressDetail, undefined, 'never in task responses');
    const detail = await p.api('GET', `/api/tasks/${open.body.id}`, { token: provider.token });
    assert.doesNotMatch(JSON.stringify(detail.body), /nha mau xanh/);

    const { task: assigned } = await p.advanceTask('ASSIGNED', { requester, provider, payload });
    assert.equal((await p.api('GET', `/api/tracking/tasks/${assigned.id}/site-location`, { token: provider.token })).status, 409, 'not before funding');
    const { task: funded } = await p.advanceTask('FUNDED', { requester, provider, payload });
    const site = await p.api('GET', `/api/tracking/tasks/${funded.id}/site-location`, { token: provider.token });
    assert.equal(site.status, 200);
    assert.equal(site.body.addressDetail, details);
    assert.equal(site.body.requesterAddress, null, 'the details replace the profile fallback');
  });

  test('R10.2 address details are optional and limited to 100 characters', async () => {
    const requester = await p.signup('CLIENT');
    const plain = await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ addressDetail: 'Apt 12.05, Block B' }) });
    assert.equal(plain.status, 201, 'a unit number works for any task');
    const tooLong = await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ addressDetail: 'x'.repeat(101) }) });
    assert.equal(tooLong.status, 400);
  });
});
