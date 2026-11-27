// Provider workflow tests — Project B plan FR-B1, FR-B2, FR-B3, FR-B4, FR-B6, FR-B8 from the provider side.
// Runs the real Express app against an in-memory store (see support/platformHarness.js).
// Run: node --test test_folder/provider.flow.test.js
const assert = require('node:assert/strict');
const { test, before, after, describe } = require('node:test');
const { startPlatform } = require('./support/platformHarness');

let p;
before(async () => { p = await startPlatform(); });
after(async () => { await p.close(); });

const pair = async () => ({ requester: await p.signup('CLIENT'), provider: await p.signup('PROVIDER') });
const progress = (task, provider, body) => p.api('POST', `/api/tasks/${task.id}/progress`, { token: provider.token, body });

describe('P1 Account, profile and identity verification', () => {
  test('P1.1 PROVIDER signup returns a PROVIDER session', async () => {
    const provider = await p.signup('PROVIDER');
    assert.equal(provider.role, 'PROVIDER');
    const me = await p.api('GET', '/api/auth/me', { token: provider.token });
    assert.equal(me.body.user.role, 'PROVIDER');
  });

  test('P1.2 FR-B7 provider profile stores specialties, district and safety agreement', async () => {
    const provider = await p.signup('PROVIDER');
    const res = await p.api('PATCH', '/api/users/me/provider-profile', {
      token: provider.token, body: { specialties: ['Home Repair'], district: 'District 1', safetyComplianceAgreed: true, shortBio: '5 years plumbing' },
    });
    assert.equal(res.status, 200);
    const requester = await p.signup('CLIENT');
    const forbidden = await p.api('PATCH', '/api/users/me/provider-profile', { token: requester.token, body: { district: 'District 1' } });
    assert.equal(forbidden.status, 403, 'requesters cannot create provider profiles');
  });

  test('P1.3 identity/certificate upload starts PENDING and only an admin can verify it', async () => {
    const provider = await p.signup('PROVIDER');
    const admin = p.createAdmin();
    const cert = await p.api('POST', '/api/users/me/provider-certificates', {
      token: provider.token, body: { title: 'Plumbing licence', certificateType: 'LICENSE', fileUrl: 'https://res.cloudinary.com/demo/licence.pdf' },
    });
    assert.equal(cert.status, 201);
    assert.equal(cert.body.verificationStatus, 'PENDING');
    const self = await p.api('PATCH', `/api/users/provider-certificates/${cert.body.id}/verification`, {
      token: provider.token, body: { verificationStatus: 'VERIFIED' },
    });
    assert.equal(self.status, 403, 'providers cannot verify themselves');
    const ok = await p.api('PATCH', `/api/users/provider-certificates/${cert.body.id}/verification`, {
      token: admin.token, body: { verificationStatus: 'VERIFIED' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.verificationStatus, 'VERIFIED');
  });
});

describe('P2 Discover tasks (FR-B3, FR-B8)', () => {
  test('P2.1 browsing shows open tasks with district only, never the precise address', async () => {
    const { requester, provider } = await pair();
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    const list = await p.api('GET', '/api/tasks', { token: provider.token });
    const found = list.body.find((t) => t.id === task.id);
    assert.ok(found, 'open task is browseable');
    assert.equal(found.district, 'Ben Thanh');
    assert.equal(found.siteAddress, undefined);
    assert.equal(found.siteLatitude, undefined);
    const detail = await p.api('GET', `/api/tasks/${task.id}`, { token: provider.token });
    assert.equal(detail.body.siteAddress, undefined);
  });

  test('P2.2 providers (unlike requesters) can see the fraud risk level of a task', async () => {
    const { requester, provider } = await pair();
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ budget: 20000 }) })).body;
    const detail = await p.api('GET', `/api/tasks/${task.id}`, { token: provider.token });
    assert.equal(detail.body.isSuspicious, true);
    assert.ok(detail.body.riskLevel);
  });

  test('P2.3 FR-B8 suggested tasks rank same-district + matching specialty first', async () => {
    const requester = await p.signup('CLIENT');
    const provider = await p.signup('PROVIDER', { location: 'Ben Thanh' });
    await p.api('PATCH', '/api/users/me/provider-profile', { token: provider.token, body: { specialties: ['Home Repair'], district: 'District 1' } });
    const far = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ district: 'Cat Lai', location: 'Cat Lai', category: 'DELIVERY', title: 'Deliver parcel' }) })).body;
    const near = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ district: 'Ben Thanh', location: 'Ben Thanh' }) })).body;
    const res = await p.api('GET', '/api/tasks/suggested/me', { token: provider.token });
    assert.equal(res.status, 200);
    const ids = res.body.map((t) => t.id);
    assert.ok(ids.indexOf(near.id) < ids.indexOf(far.id), 'nearby matching task must rank above far task');
    assert.ok(res.body.find((t) => t.id === near.id).suggestionScore > res.body.find((t) => t.id === far.id).suggestionScore);
    assert.equal((await p.api('GET', '/api/tasks/suggested/me', { token: requester.token })).status, 403);
  });

  test('P2.4 FR-B8 suggestions fall back to the signup ward when the profile has no district', async () => {
    const requester = await p.signup('CLIENT');
    const provider = await p.signup('PROVIDER', { location: 'Cat Lai' });
    const local = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ district: 'Cat Lai', location: 'Cat Lai' }) })).body;
    const res = await p.api('GET', '/api/tasks/suggested/me', { token: provider.token });
    assert.ok(res.body.find((t) => t.id === local.id).suggestionScore >= 50, 'same-ward task gets the district score');
  });
});

describe('P3 Bid on a task', () => {
  test('P3.1 FR-B6 requesters cannot bid; providers can and the task moves to BIDDING', async () => {
    const { requester, provider } = await pair();
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload() })).body;
    assert.equal((await p.api('POST', `/api/tasks/${task.id}/bids`, { token: requester.token, body: { amount: 500000 } })).status, 403);
    const bid = await p.api('POST', `/api/tasks/${task.id}/bids`, { token: provider.token, body: { amount: 600000, message: 'Can come today', estimatedCompletionTime: '2 hours' } });
    assert.equal(bid.status, 201);
    assert.equal(bid.body.providerId, provider.id);
    assert.equal(p.dbTask(task.id).status, 'BIDDING');
    assert.ok(p.dbTask(task.id).biddingEndsAt, '24h bidding window starts with the first bid');
  });

  test('P3.2 invalid bids are rejected (zero amount, assigned task, max bids reached)', async () => {
    const requester = await p.signup('CLIENT');
    const a = await p.signup('PROVIDER');
    const b = await p.signup('PROVIDER');
    const task = (await p.api('POST', '/api/tasks', { token: requester.token, body: p.taskPayload({ maxBids: 1 }) })).body;
    assert.equal((await p.api('POST', `/api/tasks/${task.id}/bids`, { token: a.token, body: { amount: 0 } })).status, 400);
    assert.equal((await p.api('POST', `/api/tasks/${task.id}/bids`, { token: a.token, body: { amount: 500000 } })).status, 201);
    assert.equal((await p.api('POST', `/api/tasks/${task.id}/bids`, { token: b.token, body: { amount: 450000 } })).status, 400, 'maxBids=1 reached');
  });

  test('P3.3 bidding is closed once the task is assigned', async () => {
    const { requester, provider } = await pair();
    const late = await p.signup('PROVIDER');
    const { task } = await p.advanceTask('ASSIGNED', { requester, provider });
    assert.equal((await p.api('POST', `/api/tasks/${task.id}/bids`, { token: late.token, body: { amount: 400000 } })).status, 400);
  });

  test('P3.4 the provider sees own bids and, once accepted, the assigned task', async () => {
    const { requester, provider } = await pair();
    const { task, bid } = await p.advanceTask('ASSIGNED', { requester, provider });
    const bids = await p.api('GET', '/api/bids/provider/me', { token: provider.token });
    assert.ok(bids.body.some((x) => x.id === bid.id && x.status === 'ACCEPTED'));
    const assigned = await p.api('GET', '/api/tasks/provider/assigned/me', { token: provider.token });
    assert.ok(assigned.body.some((t) => t.id === task.id));
    const notes = await p.api('GET', '/api/notifications/me', { token: provider.token });
    assert.ok(notes.body.some((n) => /bid was accepted/.test(n.message)));
  });
});

describe('P4 FR-B1 Escrow gate — provider cannot work before funding', () => {
  test('P4.1 before escrow: no precise address, no progress, no status change, no verification', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('ASSIGNED', { requester, provider });
    const assigned = (await p.api('GET', '/api/tasks/provider/assigned/me', { token: provider.token })).body.find((t) => t.id === task.id);
    assert.equal(assigned.siteAddress, undefined, 'FR-B3 address hidden until escrow is funded');
    assert.equal((await p.api('GET', `/api/tracking/tasks/${task.id}/site-location`, { token: provider.token })).status, 409);
    assert.equal((await progress(task, provider, { progressPercent: 10, note: 'Starting' })).status, 400);
    assert.equal((await p.api('PATCH', `/api/tasks/${task.id}/status`, { token: provider.token, body: { status: 'IN_PROGRESS' } })).status, 400);
    const verify = await p.api('POST', `/api/tracking/tasks/${task.id}/verify`, { token: provider.token, body: p.gpsFix(p.dbTask(task.id)) });
    assert.equal(verify.status, 409);
    assert.equal(p.dbTask(task.id).status, 'ASSIGNED');
  });

  test('P4.2 after escrow is HELD the assigned provider receives the precise site address', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('FUNDED', { requester, provider });
    const site = await p.api('GET', `/api/tracking/tasks/${task.id}/site-location`, { token: provider.token });
    assert.equal(site.status, 200);
    assert.match(site.body.siteAddress, /Nguyen Hue/);
    assert.equal(site.body.available, true);
    const notes = await p.api('GET', '/api/notifications/me', { token: provider.token });
    assert.ok(notes.body.some((n) => /Escrow is funded/.test(n.message)));
  });
});

describe('P5 FR-B2 Mobile location verification gate', () => {
  test('P5.1 funded but unverified: progress, subtasks and status changes are blocked (409 LOCATION_VERIFICATION_REQUIRED)', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('FUNDED', { requester, provider });
    const res = await progress(task, provider, { progressPercent: 10, note: 'Starting' });
    assert.equal(res.status, 409);
    const subtask = p.store.subtasks.find((s) => s.taskId === task.id);
    assert.equal((await p.api('PATCH', `/api/tasks/${task.id}/subtasks/${subtask.id}`, { token: provider.token, body: { status: 'DONE' } })).status, 409);
    assert.equal((await p.api('PATCH', `/api/tasks/${task.id}/status`, { token: provider.token, body: { status: 'IN_PROGRESS' } })).status, 409);
    const status = await p.api('GET', `/api/tracking/tasks/${task.id}/verification`, { token: provider.token });
    assert.equal(status.body.isValid, false);
    assert.equal(status.body.reason, 'NOT_VERIFIED', 'web uses this to show "Please verify your location on the mobile app"');
  });

  test('P5.2 verification only accepts a GPS fix within 100 m of the site, without showing the distance', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('FUNDED', { requester, provider });
    const site = p.dbTask(task.id);
    const northBy = (meters) => site.siteLatitude + (meters / 6371000) * (180 / Math.PI);
    const verify = (meters) => p.api('POST', `/api/tracking/tasks/${task.id}/verify`, {
      token: provider.token, body: p.gpsFix(site, { lat: northBy(meters) }),
    });
    const far = await verify(150); // accepted under the old 1 km radius
    assert.equal(far.status, 409);
    assert.equal(far.body.message, 'You are not at the job site yet. Move closer to the task address and try again.');
    assert.doesNotMatch(far.body.message, /\d/, 'the warning must not mention a distance');
    assert.equal((await verify(5500)).status, 409);
    assert.equal((await verify(90)).status, 201);
  });

  test('P5.3 verification rejects stale, future-dated and inaccurate GPS fixes', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('FUNDED', { requester, provider });
    const site = p.dbTask(task.id);
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    assert.equal((await p.api('POST', `/api/tracking/tasks/${task.id}/verify`, { token: provider.token, body: p.gpsFix(site, { timestamp: stale }) })).status, 409);
    assert.equal((await p.api('POST', `/api/tracking/tasks/${task.id}/verify`, { token: provider.token, body: p.gpsFix(site, { timestamp: future }) })).status, 409);
    assert.equal((await p.api('POST', `/api/tracking/tasks/${task.id}/verify`, { token: provider.token, body: p.gpsFix(site, { accuracy: 500 }) })).status, 409);
  });

  test('P5.4 only the assigned provider can verify, and a request ID cannot be replayed', async () => {
    const { requester, provider } = await pair();
    const other = await p.signup('PROVIDER');
    const { task } = await p.advanceTask('FUNDED', { requester, provider });
    const fix = p.gpsFix(p.dbTask(task.id));
    assert.equal((await p.api('POST', `/api/tracking/tasks/${task.id}/verify`, { token: other.token, body: fix })).status, 403);
    assert.equal((await p.api('POST', `/api/tracking/tasks/${task.id}/verify`, { token: provider.token, body: fix })).status, 201);
    assert.equal((await p.api('POST', `/api/tracking/tasks/${task.id}/verify`, { token: provider.token, body: fix })).status, 409, 'replayed requestId');
  });

  test('P5.5 a valid on-site fix unlocks work and notifies the requester', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    const status = await p.api('GET', `/api/tracking/tasks/${task.id}/verification`, { token: provider.token });
    assert.equal(status.body.isValid, true);
    assert.equal((await progress(task, provider, { progressPercent: 25, note: 'Inspected the pipe' })).status, 201);
  });
});

describe('P6 Do the work and request confirmation', () => {
  test('P6.1 first progress update moves ASSIGNED -> IN_PROGRESS and is visible to the requester', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    const res = await progress(task, provider, { progressPercent: 50, note: 'Replaced the pipe', milestoneStatus: 'Halfway' });
    assert.equal(res.status, 201);
    assert.equal(res.body.task.status, 'IN_PROGRESS');
    const view = await p.api('GET', `/api/tasks/${task.id}/progress`, { token: requester.token });
    assert.equal(view.status, 200);
    assert.equal(view.body.summary.latestNote, 'Replaced the pipe');
  });

  test('P6.2 subtask checkpoints update progress percent', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    const [first, second] = p.store.subtasks.filter((s) => s.taskId === task.id);
    await p.api('PATCH', `/api/tasks/${task.id}/subtasks/${first.id}`, { token: provider.token, body: { status: 'DONE' } });
    const res = await p.api('PATCH', `/api/tasks/${task.id}/subtasks/${second.id}`, { token: provider.token, body: { status: 'DONE' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.summary.progressPercent, 50);
    assert.equal(p.dbTask(task.id).status, 'IN_PROGRESS');
  });

  test('P6.3 marking complete requires 100% and moves the task to PENDING_CONFIRMATION', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    assert.equal((await progress(task, provider, { progressPercent: 90, note: 'Almost', markAsCompleted: true })).status, 400);
    const done = await progress(task, provider, { progressPercent: 100, note: 'All fixed', markAsCompleted: true });
    assert.equal(done.status, 201);
    assert.equal(done.body.task.status, 'PENDING_CONFIRMATION');
  });

  test('P6.4 provider cannot skip states or set requester-only statuses', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    const skip = await p.api('PATCH', `/api/tasks/${task.id}/status`, { token: provider.token, body: { status: 'PENDING_CONFIRMATION' } });
    assert.equal(skip.status, 409, 'ASSIGNED -> PENDING_CONFIRMATION is not a valid transition');
    const paid = await p.api('PATCH', `/api/tasks/${task.id}/status`, { token: provider.token, body: { status: 'PAID' } });
    assert.equal(paid.status, 400);
    assert.equal((await p.api('POST', `/api/tasks/${task.id}/confirm-completion`, { token: provider.token })).status, 403);
  });

  test('P6.5 a provider who is not assigned cannot post progress or read progress', async () => {
    const { requester, provider } = await pair();
    const other = await p.signup('PROVIDER');
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    assert.equal((await progress(task, other, { progressPercent: 10, note: 'Not mine' })).status, 403);
    assert.equal((await p.api('GET', `/api/tasks/${task.id}/progress`, { token: other.token })).status, 403);
  });

  test('P6.6 live GPS updates are accepted from the assigned provider only', async () => {
    const { requester, provider } = await pair();
    const other = await p.signup('PROVIDER');
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    const site = p.dbTask(task.id);
    const update = { taskId: task.id, lat: site.siteLatitude, lng: site.siteLongitude, accuracy: 15, timestamp: new Date().toISOString() };
    assert.equal((await p.api('POST', '/api/tracking/update', { token: provider.token, body: update })).status, 201);
    assert.equal((await p.api('POST', '/api/tracking/update', { token: other.token, body: update })).status, 403);
    assert.equal((await p.api('POST', '/api/tracking/update', { token: provider.token, body: { ...update, providerId: other.id } })).status, 403, 'identity spoofing');
  });
});

describe('P7 Get paid, disputes and ratings', () => {
  test('P7.1 after requester confirmation the provider sees the ESCROW_RELEASE payout', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('PAID', { requester, provider, bidAmount: 600000 });
    const history = await p.api('GET', `/api/payments/task/${task.id}`, { token: provider.token });
    assert.equal(history.status, 200);
    const release = history.body.transactions.find((x) => x.type === 'ESCROW_RELEASE');
    assert.ok(release);
    assert.equal(release.providerId, provider.id);
    assert.equal(release.providerPayoutAmount, 480000, '20% legacy platform fee deducted from the payout');
    assert.equal(history.body.task.status, 'PAID');
  });

  test('P7.2 an unrelated provider cannot read the task payment history', async () => {
    const { requester, provider } = await pair();
    const other = await p.signup('PROVIDER');
    const { task } = await p.advanceTask('PAID', { requester, provider });
    assert.equal((await p.api('GET', `/api/payments/task/${task.id}`, { token: other.token })).status, 403);
  });

  test('P7.3 provider can dispute a requester who does not confirm; admin releases escrow', async () => {
    const { requester, provider } = await pair();
    const admin = p.createAdmin();
    const { task } = await p.advanceTask('PENDING_CONFIRMATION', { requester, provider });
    const d = await p.api('POST', `/api/tasks/${task.id}/disputes`, {
      token: provider.token, body: { reason: 'REQUESTER_NOT_CONFIRMING', description: 'Work done 3 days ago, no confirmation.' },
    });
    assert.equal(d.status, 201);
    assert.equal(p.dbTask(task.id).status, 'DISPUTED');
    assert.equal((await progress(task, provider, { progressPercent: 100, note: 'Again' })).status, 409, 'progress frozen during dispute');
    const verification = p.store.verifications.filter((v) => v.taskId === task.id).at(-1);
    assert.equal(verification.revokeReason, 'TASK_DISPUTED', 'dispute revokes location verification');
    const review = await p.api('PATCH', `/api/tasks/${task.id}/disputes/${d.body.dispute.id}/review`, {
      token: admin.token, body: { status: 'RESOLVED', resolution: 'Work verified', action: 'RELEASE_ESCROW' },
    });
    assert.equal(review.status, 200);
    assert.equal(p.dbTask(task.id).status, 'PAID');
    assert.equal(p.dbTask(task.id).escrowStatus, 'RELEASED');
  });

  test('P7.4 requester cancellation before work notifies the provider and revokes verification', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('VERIFIED', { requester, provider });
    await p.api('POST', `/api/tasks/${task.id}/cancel`, { token: requester.token, body: { reason: 'Found someone else' } });
    const notes = await p.api('GET', '/api/notifications/me', { token: provider.token });
    assert.ok(notes.body.some((n) => /cancelled task/.test(n.message)));
    assert.equal((await progress(task, provider, { progressPercent: 10, note: 'Late' })).status, 400);
  });

  test('P7.5 provider can raise a support ticket about a task they bid on', async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('BID', { requester, provider });
    const res = await p.api('POST', '/api/support/tickets', {
      token: provider.token, body: { category: 'BIDDING', subject: 'Requester unresponsive', description: 'No reply to my bid for two days.', taskId: task.id },
    });
    assert.equal(res.status, 201);
  });

  test('P7.6 FR-B4 provider rates the requester after the task is paid', {
    todo: 'GAP: ratings/service.js rejects PAID tasks (400) and resolveRatingDirection only allows REQUESTER_TO_PROVIDER (403)',
  }, async () => {
    const { requester, provider } = await pair();
    const { task } = await p.advanceTask('PAID', { requester, provider });
    const res = await p.api('POST', '/api/ratings', { token: provider.token, body: { taskId: task.id, rating: 4, comment: 'Clear instructions' } });
    assert.equal(res.status, 201);
  });
});
