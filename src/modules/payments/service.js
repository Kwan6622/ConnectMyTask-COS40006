const Stripe = require('stripe');
const paymentsRepository = require('./repository');
const notificationRepository = require('../notifications/repository');
const { env } = require('../../config/env');
const {
  LEGACY_PLATFORM_FEE_CONFIG,
  computeSettlementBreakdown,
  settlementFromDeposit,
} = require('./platformFee');

const stripe = env.STRIPE_SECRET_KEY
  ? new Stripe(env.STRIPE_SECRET_KEY)
  : null;

function ensureStripeConfigured() {
  if (!stripe) {
    const err = new Error('Stripe is not configured. Missing STRIPE_SECRET_KEY');
    err.statusCode = 500;
    throw err;
  }
}

function normalizeRole(role) {
  return String(role || '').toUpperCase();
}

function isRequesterRole(role) {
  const normalized = normalizeRole(role);
  return normalized === 'REQUESTER' || normalized === 'CLIENT';
}

function isAdminRole(role) {
  return normalizeRole(role) === 'ADMIN';
}

function toStripeAmount(amount, currency) {
  // VND is a zero-decimal currency in Stripe.
  if (currency.toLowerCase() === 'vnd') return Math.round(amount);
  return Math.round(amount * 100);
}

async function getCurrentPlatformFeeConfig() {
  if (typeof paymentsRepository.getPlatformFeeConfig !== 'function') return LEGACY_PLATFORM_FEE_CONFIG;
  try {
    return (await paymentsRepository.getPlatformFeeConfig()) || LEGACY_PLATFORM_FEE_CONFIG;
  } catch (error) {
    // Before the additive migration is reviewed/applied, preserve the established 20% policy.
    if (error?.code === 'P2021' || error?.code === 'P2022') return LEGACY_PLATFORM_FEE_CONFIG;
    throw error;
  }
}

function getAgreedEscrowAmount(task) {
  const acceptedBids = task?.bids || [];
  if (acceptedBids.length !== 1 || acceptedBids[0].providerId !== task.assignedProviderId) {
    throw Object.assign(new Error('Accepted bid requires reconciliation before escrow deposit'), { statusCode: 409 });
  }

  const amount = Number(acceptedBids[0].price || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error('Accepted bid amount is invalid'), { statusCode: 400 });
  }
  return amount;
}

async function createActivity(taskId, actorId, action, message, metadata) {
  await paymentsRepository.createTaskActivity({
    taskId,
    actorId: actorId || null,
    action,
    message,
    metadata: metadata || null,
  });
}

async function notifyParticipants(task, message, senderId = null) {
  const recipients = new Set();
  if (task.createdById) recipients.add(task.createdById);
  if (task.assignedProviderId) recipients.add(task.assignedProviderId);

  for (const recipientId of recipients) {
    if (senderId && recipientId === senderId) {
      continue;
    }
    await notificationRepository.createNotification({
      recipientId,
      senderId,
      taskId: task.id,
      message,
    });
  }
}

function getFlowFromPayload(task, payload) {
  if (payload.flow) return payload.flow;

  if (['ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION'].includes(task.status)) {
    return 'ESCROW_DEPOSIT';
  }

  return 'DIRECT_PAYMENT';
}

function assertRequesterOwnsTask(task, currentUser) {
  if (!isRequesterRole(currentUser?.role)) {
    const err = new Error('Only requesters can create payment for tasks');
    err.statusCode = 403;
    throw err;
  }

  if (task.createdById !== currentUser.id) {
    const err = new Error('You can only pay for your own task');
    err.statusCode = 403;
    throw err;
  }
}

function buildSuccessAndCancelUrls(taskId, flow) {
  const frontendBaseUrl = env.FRONTEND_URL || 'http://localhost:5173';

  if (flow === 'ESCROW_DEPOSIT') {
    return {
      successUrl: `${frontendBaseUrl}/tasks/${taskId}/progress?escrow=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${frontendBaseUrl}/tasks/${taskId}/progress?escrow=cancel`,
    };
  }

  return {
    successUrl: `${frontendBaseUrl}/tasks/${taskId}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${frontendBaseUrl}/tasks/${taskId}?payment=cancel`,
  };
}

async function createCheckoutPayment(payload, currentUser) {
  ensureStripeConfigured();
  if (!env.STRIPE_WEBHOOK_SECRET) throw Object.assign(new Error('Stripe webhook must be configured before accepting payments'), { statusCode: 503 });

  const task = await paymentsRepository.getTaskById(payload.taskId);
  if (!task) {
    const err = new Error('Task not found');
    err.statusCode = 404;
    throw err;
  }

  assertRequesterOwnsTask(task, currentUser);

  if (
    task.status === 'DISPUTED'
    || task.escrowStatus === 'FROZEN'
    || task.paymentStatus === 'FROZEN'
  ) {
    const err = new Error('Task payment flow is frozen while dispute is active');
    err.statusCode = 409;
    throw err;
  }

  const flow = getFlowFromPayload(task, payload);
  if (flow !== 'ESCROW_DEPOSIT') throw Object.assign(new Error('Tasks must be funded through escrow before work starts'), { statusCode: 409 });

  if (flow === 'ESCROW_DEPOSIT') {
    if (!task.assignedProviderId || task.status !== 'ASSIGNED' || task.isDeleted) {
      const err = new Error('Escrow deposit is only available after provider assignment');
      err.statusCode = 400;
      throw err;
    }

    if (['HELD', 'RELEASED'].includes(task.escrowStatus)) {
      const err = new Error('Escrow has already been deposited for this task');
      err.statusCode = 409;
      throw err;
    }

    // The accepted bid is the agreed contract price. The task budget remains the requester's estimate.
    const amount = getAgreedEscrowAmount(task);
    const settlement = computeSettlementBreakdown(amount, await getCurrentPlatformFeeConfig());
    if (!amount || amount <= 0) {
      const err = new Error('Task escrow amount is invalid');
      err.statusCode = 400;
      throw err;
    }

    const currency = (env.STRIPE_CURRENCY || 'vnd').toLowerCase();
    const { successUrl, cancelUrl } = buildSuccessAndCancelUrls(task.id, flow);
    const deposits = (await paymentsRepository.listPaymentsByTask(task.id)).filter(payment => payment.type === 'ESCROW_DEPOSIT');
    const pending = deposits.find(payment => payment.status === 'PENDING');
    if (pending && !pending.checkoutSessionId) throw Object.assign(new Error('Existing deposit requires reconciliation'), { statusCode: 409 });
    if (pending?.checkoutSessionId) {
      const existing = await stripe.checkout.sessions.retrieve(pending.checkoutSessionId);
      const matchesAgreement = Number(pending.amount) === amount
        && existing.amount_total === toStripeAmount(amount, currency)
        && existing.currency === currency;
      if (existing.status === 'open' && matchesAgreement) return { success: true, flow, paymentUrl: existing.url, sessionId: existing.id, transactionId: pending.id };
      if (existing.status === 'open') {
        const expired = await stripe.checkout.sessions.expire(existing.id);
        if (expired.status !== 'expired') throw Object.assign(new Error('Previous Checkout requires reconciliation'), { statusCode: 409 });
        await paymentsRepository.updatePaymentStatus(pending.id, { status: 'CANCELED', lifecycleStatus: 'FAILED' });
      } else {
        if (existing.payment_status === 'paid') return settleDeposit(existing, pending, task);
        if (existing.status !== 'expired') throw Object.assign(new Error('Payment is still processing'), { statusCode: 409 });
        await paymentsRepository.updatePaymentStatus(pending.id, { status: 'CANCELED', lifecycleStatus: 'FAILED' });
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: toStripeAmount(amount, currency),
            product_data: {
              name: `Escrow deposit: ${task.title}`,
              description: `Escrow hold for task #${task.id}`,
            },
          },
        },
      ],
      metadata: {
        taskId: String(task.id),
        payerId: String(currentUser.id),
        flow,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    }, { idempotencyKey: `escrow-${task.id}-${task.assignedProviderId}-${amount}-${currency}-${deposits.length}` });

    const paymentTransaction = await paymentsRepository.createPaymentTransaction({
      taskId: task.id,
      payerId: currentUser.id,
      providerId: task.assignedProviderId || null,
      amount,
      totalAmount: settlement.totalAmount,
      escrowHeldAmount: settlement.escrowHeldAmount,
      platformFeeAmount: settlement.platformFeeAmount,
      providerPayoutAmount: settlement.providerPayoutAmount,
      method: 'STRIPE',
      type: 'ESCROW_DEPOSIT',
      escrowStatus: 'PENDING_DEPOSIT',
      lifecycleStatus: 'PENDING',
      checkoutSessionId: session.id,
      providerTransactionId: null,
      status: 'PENDING',
      note: 'Escrow deposit initiated by requester',
      metadata: {
        flow,
        currency,
        feeSnapshot: {
          feeType: settlement.feeConfig.feeType,
          percentageRate: settlement.feeConfig.percentageRate,
          fixedAmount: settlement.feeConfig.fixedAmount,
          isActive: settlement.feeConfig.isActive,
          version: settlement.feeConfig.version,
          chargedTo: 'PROVIDER_PAYOUT',
        },
      },
    });

    await paymentsRepository.updateTaskState(task.id, {
      escrowStatus: 'PENDING_DEPOSIT',
      paymentStatus: 'ESCROW_PENDING',
      escrowAmount: amount,
    });

    await createActivity(task.id, currentUser.id, 'ESCROW_DEPOSIT_INITIATED', 'Requester initiated escrow deposit.', {
      amount,
      transactionId: paymentTransaction.id,
    });

    return {
      success: true,
      flow,
      paymentUrl: session.url,
      sessionId: session.id,
      transactionId: paymentTransaction.id,
    };
  }

}

async function confirmStripeSession(sessionId, currentUser) {
  ensureStripeConfigured();

  // The transaction is keyed by the checkout session ID returned at creation.
  // Handle lookup errors immediately so a faster database failure cannot become unhandled while Stripe responds.
  const paymentLookup = paymentsRepository.getPaymentByCheckoutSessionId(sessionId)
    .then((payment) => ({ payment }), (error) => ({ error }));
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const lookup = session.id === sessionId
    ? await paymentLookup
    : { payment: await paymentsRepository.getPaymentByCheckoutSessionId(session.id) };
  if (lookup.error) throw lookup.error;
  const payment = lookup.payment;
  if (!payment) {
    const err = new Error('Payment transaction not found');
    err.statusCode = 404;
    throw err;
  }
  if (payment.payerId !== currentUser.id) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }

  const task = await paymentsRepository.getTaskById(payment.taskId);
  if (!task) {
    const err = new Error('Task not found');
    err.statusCode = 404;
    throw err;
  }

  if (payment.type === 'ESCROW_DEPOSIT') return settleDeposit(session, payment, task);
  if (payment.status === 'SUCCESS') return { success: true, status: 'SUCCESS', task };
  if (!['COMPLETED', 'AWAITING_PAYMENT'].includes(task.status) || task.escrowStatus !== 'NONE') throw Object.assign(new Error('Legacy payment requires reconciliation'), { statusCode: 409 });

  if (session.payment_status === 'paid') {
    await paymentsRepository.updatePaymentStatus(payment.id, {
      status: 'SUCCESS',
      paidAt: new Date(),
      providerTransactionId: typeof session.payment_intent === 'string'
        ? session.payment_intent
        : payment.providerTransactionId,
    });

    const updatedTask = await paymentsRepository.updateTaskState(payment.taskId, {
      status: 'PAID',
      paymentStatus: 'RELEASED',
    });

    await createActivity(updatedTask.id, currentUser.id, 'DIRECT_PAYMENT_CONFIRMED', 'Direct task payment confirmed.', {
      transactionId: payment.id,
      paymentIntent: session.payment_intent,
    });

    await notifyParticipants(
      updatedTask,
      `Payment completed for task "${updatedTask.title}".`,
      currentUser.id
    );

    return { success: true, status: 'SUCCESS', flow: 'DIRECT_PAYMENT', task: updatedTask };
  }

  if (session.status === 'expired') {
    await paymentsRepository.updatePaymentStatus(payment.id, { status: 'FAILED' });
    return { success: false, status: 'FAILED' };
  }

  return { success: false, status: 'PENDING' };
}

async function releaseEscrowForTask(taskId, currentUser, options = {}) {
  const task = await paymentsRepository.getTaskById(taskId);
  if (!task) {
    const err = new Error('Task not found');
    err.statusCode = 404;
    throw err;
  }

  const canRequesterRelease = isRequesterRole(currentUser?.role) && task.createdById === currentUser.id;
  const canAdminRelease = isAdminRole(currentUser?.role);

  if (!canRequesterRelease && !canAdminRelease) {
    const err = new Error('Only task requester or admin can release escrow');
    err.statusCode = 403;
    throw err;
  }

  if (!task.assignedProviderId) {
    const err = new Error('Task has no assigned provider for escrow release');
    err.statusCode = 400;
    throw err;
  }

  const existingRelease = await paymentsRepository.findSuccessfulEscrowRelease(taskId);
  if (existingRelease) {
    const latestTask = await paymentsRepository.getTaskById(taskId);
    return { task: latestTask, transaction: existingRelease };
  }
  if (!canAdminRelease && (task.status !== 'COMPLETED' || task.escrowStatus !== 'HELD')) throw Object.assign(new Error('Requester confirmation is required before release'), { statusCode: 409 });
  const deposit = await paymentsRepository.findLatestSuccessfulEscrowDeposit(taskId);
  if (!deposit) throw Object.assign(new Error('No confirmed escrow deposit'), { statusCode: 409 });

  if (!['HELD', 'FROZEN'].includes(task.escrowStatus)) {
    const err = new Error('Escrow is not available for release');
    err.statusCode = 400;
    throw err;
  }

  const amount = Number(task.escrowAmount || deposit.totalAmount || deposit.amount || 0);
  const settlement = settlementFromDeposit(deposit, amount);
  if (!amount || amount <= 0) {
    const err = new Error('Invalid escrow amount for release');
    err.statusCode = 400;
    throw err;
  }

  const transaction = await paymentsRepository.createPaymentTransaction({
    taskId: task.id,
    payerId: task.createdById,
    providerId: task.assignedProviderId,
    amount: settlement.providerPayoutAmount,
    totalAmount: settlement.totalAmount,
    escrowHeldAmount: settlement.escrowHeldAmount,
    platformFeeAmount: settlement.platformFeeAmount,
    providerPayoutAmount: settlement.providerPayoutAmount,
    method: 'STRIPE',
    type: 'ESCROW_RELEASE',
    escrowStatus: 'RELEASED',
    lifecycleStatus: 'RELEASED',
    status: 'SUCCESS',
    heldAt: task.escrowHeldAt || null,
    releasedAt: new Date(),
    paidAt: new Date(),
    note: options.reason || 'Escrow released to provider',
    metadata: {
      releasedBy: currentUser.id,
      mode: options.reason || 'auto',
    },
  });

  const updatedTask = await paymentsRepository.updateTaskState(task.id, {
    status: 'PAID',
    escrowStatus: 'RELEASED',
    paymentStatus: 'RELEASED',
    escrowReleasedAt: new Date(),
  });

  await createActivity(task.id, currentUser.id, 'ESCROW_RELEASED', 'Escrow payment released to provider.', {
    transactionId: transaction.id,
    amount,
  });

  await notifyParticipants(updatedTask, `Escrow released successfully for task "${updatedTask.title}".`, currentUser.id);

  return {
    task: updatedTask,
    transaction,
  };
}

async function refundEscrowForTask(taskId, currentUser, options = {}) {
  const task = await paymentsRepository.getTaskById(taskId);
  if (!task) {
    const err = new Error('Task not found');
    err.statusCode = 404;
    throw err;
  }

  const canRequesterRefund = isRequesterRole(currentUser?.role) && task.createdById === currentUser.id;
  const canAdminRefund = isAdminRole(currentUser?.role);

  if (!canRequesterRefund && !canAdminRefund) {
    const err = new Error('Only task requester or admin can refund escrow');
    err.statusCode = 403;
    throw err;
  }
  if (task.escrowStatus === 'REFUNDED') return { task, transaction: (await paymentsRepository.listPaymentsByTask(task.id)).find(payment => payment.type === 'ESCROW_REFUND') };

  if (!['PENDING_DEPOSIT', 'HELD', 'FROZEN'].includes(task.escrowStatus)) {
    const err = new Error('Escrow is not refundable in current state');
    err.statusCode = 400;
    throw err;
  }

  const latestDeposit = await paymentsRepository.findLatestSuccessfulEscrowDeposit(taskId);
  const amount = Number(task.escrowAmount || latestDeposit?.totalAmount || latestDeposit?.amount || 0);
  const settlement = settlementFromDeposit(latestDeposit, amount);
  if (!amount || amount <= 0) {
    const err = new Error('Invalid escrow amount for refund');
    err.statusCode = 400;
    throw err;
  }

  if (!latestDeposit?.providerTransactionId) throw Object.assign(new Error('No confirmed Stripe deposit to refund'), { statusCode: 409 });
  ensureStripeConfigured();
  let stripeRefundId = null;
  if (stripe && latestDeposit?.providerTransactionId) {
    try {
      const refund = await stripe.refunds.create({
        payment_intent: latestDeposit.providerTransactionId,
      }, { idempotencyKey: `escrow-refund-${latestDeposit.id}` });
      if (refund.status !== 'succeeded') throw new Error('Refund is not yet confirmed');
      stripeRefundId = refund.id;
    } catch (_error) {
      throw Object.assign(new Error('Stripe refund not confirmed; retry settlement'), { statusCode: 502 });
    }
  }

  const transaction = await paymentsRepository.createPaymentTransaction({
    taskId: task.id,
    payerId: task.createdById,
    providerId: task.assignedProviderId,
    amount: settlement.totalAmount,
    totalAmount: settlement.totalAmount,
    escrowHeldAmount: settlement.escrowHeldAmount,
    platformFeeAmount: settlement.platformFeeAmount,
    providerPayoutAmount: settlement.providerPayoutAmount,
    method: 'STRIPE',
    type: 'ESCROW_REFUND',
    escrowStatus: 'REFUNDED',
    lifecycleStatus: 'REFUNDED',
    status: 'REFUNDED',
    paidAt: new Date(),
    note: options.reason || 'Escrow refunded',
    metadata: {
      refundedBy: currentUser.id,
      stripeRefundId,
    },
  });

  const updatedTask = await paymentsRepository.updateTaskState(task.id, {
    status: 'CANCELLED',
    escrowStatus: 'REFUNDED',
    paymentStatus: 'REFUNDED',
    canceledAt: new Date(),
    cancellationReason: options.reason || 'Escrow refunded',
  });

  await createActivity(task.id, currentUser.id, 'ESCROW_REFUNDED', 'Escrow refund completed.', {
    transactionId: transaction.id,
    amount,
    stripeRefundId,
  });

  await notifyParticipants(updatedTask, `Escrow refunded for task "${updatedTask.title}".`, currentUser.id);

  return {
    task: updatedTask,
    transaction,
  };
}

async function handleWebhook(signature, rawBody) {
  ensureStripeConfigured();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    const err = new Error('Missing STRIPE_WEBHOOK_SECRET');
    err.statusCode = 500;
    throw err;
  }

  const event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  const incoming = event.data.object;
  const payment = await paymentsRepository.getPaymentByCheckoutSessionId(incoming.id);
  if (!payment) return;
  if (payment.type === 'ESCROW_DEPOSIT') {
    return require('../../database/taskTransaction').withTaskLock(payment.taskId, async () => {
      const fresh = await paymentsRepository.getPaymentByCheckoutSessionId(incoming.id);
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
        return settleDeposit(await stripe.checkout.sessions.retrieve(incoming.id), fresh, await paymentsRepository.getTaskById(payment.taskId));
      }
      if (['checkout.session.async_payment_failed', 'checkout.session.expired'].includes(event.type) && fresh.status === 'PENDING') {
        const session = await stripe.checkout.sessions.retrieve(incoming.id);
        if (session.payment_status === 'paid') return settleDeposit(session, fresh, await paymentsRepository.getTaskById(payment.taskId));
        // Only terminal sessions permit a new attempt; open sessions remain reusable.
        if (session.status === 'expired') await paymentsRepository.updatePaymentStatus(fresh.id, { status: 'FAILED', lifecycleStatus: 'FAILED' });
      }
    });
  }
  // Legacy records use the same authenticated backend confirmation path.
  if (event.type === 'checkout.session.completed') return module.exports.confirmStripeSession(incoming.id, { id: payment.payerId });
  return;
}

async function listMyPayments(currentUser) {
  if (!isRequesterRole(currentUser?.role)) {
    throw Object.assign(new Error('Requester access required'), { statusCode: 403 });
  }

  const payments = await paymentsRepository.listPaymentsByPayer(currentUser.id);
  return payments.map((payment) => {
    const cardBrand = typeof payment.metadata?.cardBrand === 'string'
      ? payment.metadata.cardBrand.slice(0, 30)
      : null;
    const cardLast4 = /^\d{4}$/.test(String(payment.metadata?.cardLast4 || ''))
      ? String(payment.metadata.cardLast4)
      : null;
    const isRefund = payment.type === 'ESCROW_REFUND' || payment.status === 'REFUNDED';

    return {
      reference: `CMT-${String(payment.id).padStart(8, '0')}`,
      id: payment.id,
      taskId: payment.taskId,
      payerId: payment.payerId,
      providerId: payment.providerId,
      amount: payment.amount,
      agreedPrice: payment.amount,
      totalAmount: payment.totalAmount ?? payment.amount,
      platformFeeAmount: payment.platformFeeAmount ?? 0,
      providerPayoutAmount: payment.providerPayoutAmount ?? null,
      method: payment.method,
      type: payment.type,
      escrowStatus: payment.escrowStatus,
      lifecycleStatus: payment.lifecycleStatus,
      status: payment.status,
      note: payment.note,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
      heldAt: payment.heldAt,
      releasedAt: payment.releasedAt,
      task: payment.task ? {
        id: payment.task.id,
        title: payment.task.title,
        status: payment.task.status,
        paymentStatus: payment.task.paymentStatus,
        escrowStatus: payment.task.escrowStatus,
        originalBudget: payment.task.budget,
      } : null,
      provider: payment.provider ? {
        id: payment.provider.id,
        name: payment.provider.name,
      } : null,
      card: cardBrand && cardLast4 ? { brand: cardBrand, last4: cardLast4 } : null,
      refund: isRefund ? {
        amount: payment.amount,
        status: payment.status,
        date: payment.paidAt || payment.createdAt,
      } : null,
    };
  });
}

async function getTaskPaymentHistory(taskId, currentUser) {
  const task = await paymentsRepository.getTaskById(taskId);
  if (!task) {
    const err = new Error('Task not found');
    err.statusCode = 404;
    throw err;
  }

  const isParticipant = task.createdById === currentUser.id || task.assignedProviderId === currentUser.id;
  if (!isParticipant && !isAdminRole(currentUser.role)) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }

  const transactions = await paymentsRepository.listPaymentsByTask(taskId);

  return {
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      escrowStatus: task.escrowStatus,
      paymentStatus: task.paymentStatus,
      escrowAmount: task.escrowAmount ?? null,
      escrowHeldAt: task.escrowHeldAt,
      escrowReleasedAt: task.escrowReleasedAt,
    },
    transactions,
  };
}

module.exports = {
  createCheckoutPayment,
  confirmStripeSession,
  releaseEscrowForTask,
  refundEscrowForTask,
  handleWebhook,
  listMyPayments,
  getTaskPaymentHistory,
  computeSettlementBreakdown,
};

async function settleDeposit(session, payment, task) {
  if (!task) throw Object.assign(new Error('Task not found'), { statusCode: 404 });
  if (payment.status === 'SUCCESS') return { success: true, status: 'SUCCESS', flow: 'ESCROW_DEPOSIT', task };
  if (session.payment_status !== 'paid') return { success: false, status: 'PENDING', task };
  const currency = payment.metadata?.currency || (env.STRIPE_CURRENCY || 'vnd').toLowerCase();
  const agreedAmount = getAgreedEscrowAmount(task);
  if (Number(payment.amount) !== agreedAmount || session.id !== payment.checkoutSessionId || session.amount_total !== toStripeAmount(agreedAmount, currency) || session.currency !== currency || session.metadata?.taskId !== String(task.id) || session.metadata?.payerId !== String(payment.payerId) || session.metadata?.flow !== 'ESCROW_DEPOSIT') {
    throw Object.assign(new Error('Stripe payment details do not match escrow'), { statusCode: 409 });
  }
  if (task.status !== 'ASSIGNED' || task.isDeleted || task.assignedProviderId !== payment.providerId || !['NONE', 'PENDING_DEPOSIT'].includes(task.escrowStatus)) {
    throw Object.assign(new Error('Late payment requires reconciliation; task remains blocked'), { statusCode: 409 });
  }
  const now = new Date();
  await paymentsRepository.updatePaymentStatus(payment.id, { status: 'SUCCESS', escrowStatus: 'HELD', lifecycleStatus: 'ESCROW_HELD', paidAt: now, heldAt: now, providerTransactionId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id });
  const updated = await paymentsRepository.updateTaskState(task.id, { escrowStatus: 'HELD', paymentStatus: 'ESCROW_HELD', escrowHeldAt: now });
  await createActivity(task.id, payment.payerId, 'ESCROW_DEPOSIT_CONFIRMED', 'Escrow funding confirmed by Stripe.', { transactionId: payment.id });
  await notifyParticipants(updated, 'Escrow is funded. The assigned provider can start work.', payment.payerId);
  return { success: true, status: 'SUCCESS', flow: 'ESCROW_DEPOSIT', task: updated };
}

const { withTaskLock } = require('../../database/taskTransaction');
for (const name of ['releaseEscrowForTask', 'refundEscrowForTask']) {
  const action = module.exports[name];
  module.exports[name] = (taskId, ...args) => withTaskLock(taskId, () => action(taskId, ...args));
}
module.exports.createCheckoutPayment = (payload, user) => withTaskLock(payload.taskId, () => createCheckoutPayment(payload, user));
module.exports.confirmStripeSession = async (sessionId, user) => {
  const payment = await paymentsRepository.getPaymentByCheckoutSessionId(sessionId);
  if (!payment || payment.payerId !== user?.id) throw Object.assign(new Error('Payment not found or forbidden'), { statusCode: 403 });
  return withTaskLock(payment.taskId, () => confirmStripeSession(sessionId, user));
};
