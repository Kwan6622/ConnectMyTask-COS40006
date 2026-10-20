const assert = require('node:assert/strict');
const { test } = require('node:test');
const readline = require('node:readline/promises');

const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const PASSWORD = process.env.E2E_PASSWORD || 'E2eTestPassword123!';

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: 'Bearer ' + options.token } : {}),
      ...options.headers,
    },
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { response, body };
}

async function expectStatus(path, expectedStatus, options = {}) {
  const result = await request(path, options);
  assert.equal(
    result.response.status,
    expectedStatus,
    `${options.method || 'GET'} ${path} expected ${expectedStatus}, got ${result.response.status}: ${JSON.stringify(result.body)}`
  );
  return result.body;
}

async function createAccount(role, suffix) {
  const email = `e2e-${role.toLowerCase()}-${Date.now()}-${suffix}@example.test`;
  const body = await expectStatus('/api/auth/signup', 201, {
    method: 'POST',
    body: JSON.stringify({
      fullName: `E2E ${role} ${suffix}`,
      email,
      password: PASSWORD,
      role,
    }),
  });

  assert.ok(body.accessToken, `${role} signup did not return an access token`);
  assert.equal(body.user.role, role);
  return { ...body.user, token: body.accessToken, email };
}

async function getPaymentSessionId(checkout, taskId) {
  if (process.env.TEST_PAYMENT_SESSION_ID) {
    return process.env.TEST_PAYMENT_SESSION_ID;
  }

  if (process.env.E2E_INTERACTIVE_PAYMENT !== 'true') {
    console.warn(
      `Payment checkpoint reached for task ${taskId}. Open ${checkout.paymentUrl} with a Stripe test card, then rerun in interactive mode with E2E_INTERACTIVE_PAYMENT=true.`
    );
    return null;
  }

  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Open this Checkout URL and pay with a Stripe test card:\n${checkout.paymentUrl}`);
    return (await input.question('After payment, enter the Checkout session ID: ')).trim();
  } finally {
    input.close();
  }
}

test('requester and provider complete the task lifecycle', async () => {
  await expectStatus('/health', 200);

  const requester = await createAccount('CLIENT', 'requester');
  const provider = await createAccount('PROVIDER', 'provider');

  const requesterMe = await expectStatus('/api/auth/me', 200, { token: requester.token });
  assert.equal(requesterMe.user.id, requester.id);
  assert.equal(requesterMe.user.role, 'REQUESTER');

  const providerMe = await expectStatus('/api/auth/me', 200, { token: provider.token });
  assert.equal(providerMe.user.id, provider.id);
  assert.equal(providerMe.user.role, 'PROVIDER');

  await expectStatus('/api/tasks', 403, {
    method: 'POST',
    token: provider.token,
    body: JSON.stringify({
      title: 'Provider must not create requester tasks',
      description: 'Authorization check',
      category: 'OTHER',
      budget: 100,
      location: 'District 1',
      district: 'District 1',
      siteAddress: '1 Test Street, District 1',
      siteLatitude: 10.7769,
      siteLongitude: 106.7009,
    }),
  });

  const task = await expectStatus('/api/tasks', 201, {
    method: 'POST',
    token: requester.token,
    body: JSON.stringify({
      title: `E2E lifecycle ${Date.now()}`,
      description: 'End-to-end task lifecycle test',
      category: 'HOME_REPAIR',
      budget: 650000,
      maxBids: 5,
      location: 'District 1',
      district: 'District 1',
      siteAddress: '1 Test Street, District 1, Ho Chi Minh City',
      siteLatitude: 10.7769,
      siteLongitude: 106.7009,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  });
  assert.ok(task.id);
  assert.equal(task.createdById, requester.id);
  assert.ok(['OPEN', 'BIDDING'].includes(task.status));

  await expectStatus(`/api/tasks/${task.id}/bids`, 403, {
    method: 'POST',
    token: requester.token,
    body: JSON.stringify({ amount: 600000, message: 'Requester cannot bid' }),
  });

  const bid = await expectStatus(`/api/tasks/${task.id}/bids`, 201, {
    method: 'POST',
    token: provider.token,
    body: JSON.stringify({
      amount: 600000,
      message: 'I can complete this task safely.',
      estimatedCompletionTime: '2 days',
    }),
  });
  assert.ok(bid.id);
  assert.equal(bid.providerId, provider.id);
  assert.equal(Number(bid.price || bid.amount), 600000);

  const bids = await expectStatus(`/api/tasks/${task.id}/bids`, 200, { token: requester.token });
  assert.ok(bids.some((item) => item.id === bid.id));

  const assignment = await expectStatus(`/api/tasks/${task.id}/assign-provider`, 200, {
    method: 'PATCH',
    token: requester.token,
    body: JSON.stringify({ bidId: bid.id }),
  });
  assert.equal(assignment.success, true);
  assert.equal(assignment.bid.id, bid.id);

  const assignedTask = await expectStatus(`/api/tasks/${task.id}`, 200);
  assert.equal(assignedTask.assignedProviderId, provider.id);
  assert.equal(assignedTask.status, 'ASSIGNED');

  await expectStatus('/api/payments/create', 403, {
    method: 'POST',
    token: provider.token,
    body: JSON.stringify({ taskId: task.id, flow: 'ESCROW_DEPOSIT' }),
  });

  const checkout = await expectStatus('/api/payments/create', 201, {
    method: 'POST',
    token: requester.token,
    body: JSON.stringify({ taskId: task.id, flow: 'ESCROW_DEPOSIT' }),
  });
  assert.equal(checkout.flow, 'ESCROW_DEPOSIT');
  assert.ok(checkout.paymentUrl);
  assert.ok(checkout.sessionId);
  assert.ok(checkout.transactionId);

  const pendingPayment = await expectStatus(`/api/payments/task/${task.id}`, 200, {
    token: requester.token,
  });
  assert.ok(Array.isArray(pendingPayment));
  assert.ok(pendingPayment.some((payment) => payment.id === checkout.transactionId));

  const providerBids = await expectStatus('/api/bids/provider/me', 200, { token: provider.token });
  assert.ok(providerBids.some((item) => item.id === bid.id));
  const providerTasks = await expectStatus('/api/tasks/provider/assigned/me', 200, { token: provider.token });
  assert.ok(providerTasks.some((item) => item.id === task.id));
  const requesterTasks = await expectStatus('/api/tasks/requester/me', 200, { token: requester.token });
  assert.ok(requesterTasks.some((item) => item.id === task.id));

  const paymentSessionId = await getPaymentSessionId(checkout, task.id);
  if (!paymentSessionId) {
    return;
  }

  assert.equal(
    paymentSessionId,
    checkout.sessionId,
    'The supplied session ID must belong to the Checkout session created by this test run'
  );
  const confirmation = await expectStatus('/api/payments/confirm-session', 200, {
    method: 'POST',
    token: requester.token,
    body: JSON.stringify({ sessionId: checkout.sessionId }),
  });
  assert.equal(confirmation.success, true);

  const fundedTask = await expectStatus(`/api/tasks/${task.id}`, 200);
  assert.equal(fundedTask.escrowStatus, 'HELD');
  assert.equal(fundedTask.paymentStatus, 'ESCROW_HELD');

  const verification = await expectStatus(`/api/tracking/tasks/${task.id}/verify`, 201, {
    method: 'POST',
    token: provider.token,
    body: JSON.stringify({
      requestId: `e2e_${Date.now()}_location`,
      lat: fundedTask.siteLatitude,
      lng: fundedTask.siteLongitude,
      accuracy: 10,
      timestamp: new Date().toISOString(),
    }),
  });
  assert.equal(verification.isValid, true);

  const progress = await expectStatus(`/api/tasks/${task.id}/progress`, 201, {
    method: 'POST',
    token: provider.token,
    body: JSON.stringify({
      progressPercent: 100,
      note: 'Work completed and ready for requester confirmation.',
      markAsCompleted: true,
    }),
  });
  assert.equal(progress.task.status, 'PENDING_CONFIRMATION');

  const completion = await expectStatus(`/api/tasks/${task.id}/confirm-completion`, 200, {
    method: 'POST',
    token: requester.token,
  });
  assert.equal(completion.success, true);
  assert.equal(completion.task.status, 'PAID');
  assert.equal(completion.task.escrowStatus, 'RELEASED');

  const finalTask = await expectStatus(`/api/tasks/${task.id}`, 200);
  assert.equal(finalTask.status, 'PAID');
  const paymentHistory = await expectStatus(`/api/payments/task/${task.id}`, 200, {
    token: provider.token,
  });
  assert.ok(paymentHistory.some((payment) => payment.type === 'ESCROW_RELEASE'));
});
