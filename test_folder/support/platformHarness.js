// In-memory ConnectMyTask platform for workflow tests.
//
// Boots the real Express app (routes, auth/role middleware, Zod validation,
// controllers, services, real payment/escrow service) on an ephemeral port.
// Only the persistence layer (repositories + Prisma client), Stripe, geocoding
// and the Gemini subtask generator are replaced with in-memory fakes, so the
// tests never touch Neon, Stripe or Google APIs and can run offline.
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const JWT_SECRET = 'workflow-test-secret';

function mockModule(relativePath, exports) {
  const id = require.resolve(path.join(SRC, relativePath));
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const copy = (value) => (value == null ? value : structuredClone(value));
const now = () => new Date();

function createStore() {
  return {
    seq: 0,
    users: [],
    providerProfiles: [],
    certificates: [],
    tasks: [],
    bids: [],
    subtasks: [],
    progress: [],
    activities: [],
    notifications: [],
    disputes: [],
    verifications: [],
    ratings: [],
    payments: [],
    savedTasks: [],
    tickets: [],
    supportActivities: [],
    stripeSessions: new Map(),
  };
}

const store = createStore();
const nextId = () => ++store.seq;

// ---------------------------------------------------------------- helpers
const findUser = (id) => store.users.find((u) => u.id === Number(id)) || null;
const findTask = (id) => store.tasks.find((t) => t.id === Number(id)) || null;
const userLite = (id) => {
  const u = findUser(id);
  return u ? { id: u.id, name: u.name, email: u.email, role: u.role, profilePhotoUrl: u.profilePhotoUrl || null } : null;
};
const safeUser = (user) => {
  if (!user) return user;
  const { passwordHash: _p, failedLoginAttempts: _f, lockoutUntil: _l, tokenVersion: _t, ...safe } = user;
  return copy(safe);
};
const taskWithCounts = (task) => task && copy({
  ...task,
  _count: { bids: store.bids.filter((b) => b.taskId === task.id).length },
  createdBy: userLite(task.createdById),
  assignedProvider: task.assignedProviderId ? userLite(task.assignedProviderId) : null,
});
const ratingStats = (userId) => {
  const list = store.ratings.filter((r) => r.toUserId === userId);
  const avg = list.length ? list.reduce((s, r) => s + r.rating, 0) / list.length : null;
  return { _avg: { rating: avg }, _count: { rating: list.length } };
};
const logActivity = (data) => {
  const row = { id: nextId(), createdAt: now(), ...data };
  store.activities.push(row);
  return copy(row);
};
const pushNotification = (data) => {
  const row = { id: nextId(), isRead: false, createdAt: now(), ...data };
  store.notifications.push(row);
  return copy(row);
};

// ----------------------------------------------------------- fake prisma
// Used directly by auth middleware, task-lock transactions and support routes.
const fakePrisma = {
  $queryRaw: async () => [],
  $transaction: async (work) => (typeof work === 'function' ? work(fakePrisma) : Promise.all(work)),
  user: {
    findUnique: async ({ where }) => copy(findUser(where.id)),
    findMany: async ({ where } = {}) => store.users
      .filter((u) => !where?.role || String(u.role).toUpperCase() === String(where.role.equals || where.role).toUpperCase())
      .map((u) => ({ id: u.id })),
  },
  task: {
    findUnique: async ({ where }) => copy(findTask(where.id)),
    findFirst: async ({ where }) => {
      const t = findTask(where.id);
      return t && !t.isDeleted ? copy(t) : null;
    },
  },
  bid: {
    findFirst: async ({ where }) => copy(store.bids.find((b) => b.taskId === where.taskId && b.providerId === where.providerId) || null),
  },
  paymentTransaction: {
    findFirst: async ({ where }) => copy(store.payments.find((p) => p.id === where.id
      && (p.payerId === where.OR?.[0]?.payerId || p.providerId === where.OR?.[1]?.providerId)) || null),
  },
  supportTicket: {
    create: async ({ data }) => {
      const row = { id: nextId(), status: 'OPEN', priority: 'NORMAL', evidenceUrls: [], createdAt: now(), updatedAt: now(), ...data };
      store.tickets.push(row);
      return copy({ ...row, requester: userLite(row.requesterId), task: row.taskId ? { id: row.taskId, title: findTask(row.taskId)?.title } : null });
    },
    findMany: async ({ where }) => copy(store.tickets.filter((t) => !where.requesterId || t.requesterId === where.requesterId)),
    count: async ({ where }) => store.tickets.filter((t) => !where.requesterId || t.requesterId === where.requesterId).length,
    findFirst: async ({ where }) => copy(store.tickets.find((t) => t.id === where.id && (!where.requesterId || t.requesterId === where.requesterId)) || null),
  },
  supportActivity: { create: async ({ data }) => { store.supportActivities.push(data); return data; } },
  notification: { create: async ({ data }) => pushNotification(data) },
};

// ------------------------------------------------------------ fake stripe
class FakeStripe {
  constructor() {
    this.checkout = {
      sessions: {
        create: async (data) => {
          const id = `cs_test_${nextId()}`;
          const session = {
            id,
            url: `https://checkout.stripe.test/${id}`,
            status: 'open',
            payment_status: 'unpaid',
            amount_total: data.line_items[0].price_data.unit_amount,
            currency: data.line_items[0].price_data.currency,
            metadata: data.metadata,
            payment_intent: `pi_test_${id}`,
          };
          store.stripeSessions.set(id, session);
          return copy(session);
        },
        retrieve: async (id) => copy(store.stripeSessions.get(id)),
        expire: async (id) => {
          const s = store.stripeSessions.get(id);
          s.status = 'expired';
          return copy(s);
        },
      },
    };
    this.refunds = { create: async () => ({ id: `re_test_${nextId()}`, status: 'succeeded' }) };
    this.webhooks = { constructEvent: () => { throw new Error('Webhooks are not used in workflow tests'); } };
  }
}

// ------------------------------------------------------ mocked modules
function installMocks() {
  process.env.NODE_ENV = 'test';
  mockModule('config/env.js', {
    env: {
      NODE_ENV: 'test',
      PORT: 0,
      DATABASE_URL: 'postgresql://in-memory/never-used',
      AI_SERVICE_URL: 'http://127.0.0.1:9',
      JWT_SECRET,
      FRONTEND_URL: 'http://localhost:5173',
      OPENAI_API_KEY: '',
      GEMINI_API_KEY: '',
      STRIPE_SECRET_KEY: 'sk_test_in_memory',
      STRIPE_WEBHOOK_SECRET: 'whsec_in_memory',
      STRIPE_CURRENCY: 'vnd',
    },
  });
  mockModule('database/prisma.js', { prisma: fakePrisma });
  const stripeId = require.resolve('stripe', { paths: [ROOT] });
  require.cache[stripeId] = { id: stripeId, filename: stripeId, loaded: true, exports: FakeStripe };

  // Geocoding: the real service calls Google. Any HCMC ward + street resolves
  // to a fixed trusted point near Nguyen Hue, Ben Thanh.
  mockModule('modules/geocoding/service.js', {
    normalizeText: (v) => String(v || '').toLowerCase().trim(),
    verifyAddress: async ({ district, streetName }) => {
      if (!district || !streetName) throw Object.assign(new Error('Address could not be verified'), { statusCode: 400 });
      return { address: `${streetName}, ${district}, Ho Chi Minh City`, latitude: 10.7739, longitude: 106.7036 };
    },
  });
  mockModule('modules/tasks/subtaskTemplates.js', {
    buildFallbackTitles: () => [],
    generateSuggestedSubtasks: async () => [25, 50, 75, 100].map((p, i) => ({
      title: `Checkpoint ${i + 1}`, order: i + 1, progressPercent: p, status: 'PENDING',
    })),
  });

  mockModule('modules/auth/repository.js', {
    findUserByEmail: async (email) => copy(store.users.find((u) => u.email === email) || null),
    findUserById: async (id) => copy(findUser(id)),
    createUser: async (data) => {
      const row = { id: nextId(), status: 'ACTIVE', tokenVersion: 0, rating: 0, createdAt: now(), ...data };
      store.users.push(row);
      return copy(row);
    },
    updateUserLoginState: async (id, data) => copy(Object.assign(findUser(id), data)),
  });

  const profileFor = (userId) => store.providerProfiles.find((p) => p.userId === userId) || null;
  mockModule('modules/users/repository.js', {
    createUser: async (data) => { const row = { id: nextId(), ...data }; store.users.push(row); return copy(row); },
    getUserById: async (id) => {
      const u = findUser(id);
      if (!u) return null;
      const profile = profileFor(u.id);
      return copy({ ...u, providerProfile: profile && { ...profile, certificates: store.certificates.filter((c) => c.providerId === u.id) } });
    },
    getPublicUserById: async (id) => {
      const u = findUser(id);
      return u ? copy({ id: u.id, name: u.name, role: u.role, rating: u.rating, profilePhotoUrl: u.profilePhotoUrl || null }) : null;
    },
    toSafePrivateUser: safeUser,
    updateProfile: async (id, data) => safeUser(Object.assign(findUser(id), data)),
    upsertProviderProfile: async (userId, data) => {
      let p = profileFor(userId);
      if (!p) { p = { id: nextId(), userId, specialties: [] }; store.providerProfiles.push(p); }
      Object.assign(p, data);
      return copy({ ...p, certificates: store.certificates.filter((c) => c.providerId === userId) });
    },
    getProviderProfileByUserId: async (userId) => copy(profileFor(userId)),
    createProviderCertificate: async (data) => { const row = { id: nextId(), uploadedAt: now(), ...data }; store.certificates.push(row); return copy(row); },
    getProviderCertificateById: async (id) => copy(store.certificates.find((c) => c.id === id) || null),
    updateProviderCertificateVerification: async (id, data) => copy(Object.assign(store.certificates.find((c) => c.id === id), data)),
    getLatestProviderRatingsSummary: async (providerId) => {
      const s = ratingStats(providerId);
      return { averageRating: s._avg.rating || 0, totalReviews: s._count.rating };
    },
  });

  const filterTasks = (filters = {}) => store.tasks.filter((t) => !t.isDeleted
    && (!filters.status || t.status === filters.status)
    && (!filters.category || t.category === filters.category));

  const taskRepository = {
    getTaskById: async (id) => taskWithCounts(findTask(id)),
    createTask: async (data) => {
      const row = {
        id: nextId(), siteVersion: 1, assignedProviderId: null, escrowStatus: 'NONE', paymentStatus: 'UNPAID',
        escrowAmount: null, escrowHeldAt: null, escrowReleasedAt: null, biddingEndsAt: null, isDeleted: false,
        isOverdue: false, createdAt: now(), ...data,
      };
      store.tasks.push(row);
      return copy(row);
    },
    createSubtasksForTask: async (taskId, list) => {
      for (const s of list) store.subtasks.push({ id: nextId(), taskId, ...s });
      return { count: list.length };
    },
    createTaskActivity: async (data) => logActivity(data),
    markTasksOverdue: async () => ({ newlyNotified: [], marked: [] }),
    getTaskOverdueStates: async () => [],
    listExpiredBiddingTasks: async () => [],
    getProviderRatingStats: async () => [],
    autoAssignProviderFromBid: async () => null,
    listTasks: async (filters) => filterTasks(filters).map(taskWithCounts),
    listTasksByRequester: async (userId) => filterTasks().filter((t) => t.createdById === userId).map(taskWithCounts),
    listAssignedTasksForProvider: async (userId) => filterTasks().filter((t) => t.assignedProviderId === userId).map(taskWithCounts),
    updateTaskStatus: async (id, status) => taskWithCounts(Object.assign(findTask(id), { status })),
    updateTask: async (id, data) => taskWithCounts(Object.assign(findTask(id), data)),
    assignProviderFromBid: async (taskId, bidId) => {
      const task = findTask(taskId);
      const bid = store.bids.find((b) => b.id === bidId);
      if (!bid || bid.taskId !== taskId) throw Object.assign(new Error('Bid not found for this task'), { statusCode: 404 });
      if (!['OPEN', 'BIDDING'].includes(task.status) || task.assignedProviderId) {
        throw Object.assign(new Error('Task is no longer available for assignment'), { statusCode: 409 });
      }
      Object.assign(task, {
        assignedProviderId: bid.providerId, status: 'ASSIGNED', biddingEndsAt: now(), escrowStatus: 'PENDING_DEPOSIT',
        paymentStatus: 'ESCROW_PENDING', escrowAmount: bid.price, escrowHeldAt: null, escrowReleasedAt: null,
      });
      bid.status = 'ACCEPTED';
      store.bids.filter((b) => b.taskId === taskId && b.id !== bidId).forEach((b) => { b.status = 'REJECTED'; });
      return copy(bid);
    },
    getUserLocationById: async (id) => findUser(id)?.location || null,
    getProviderProfileByUserId: async (userId) => copy(profileFor(userId)),
    listProgressUpdatesForTask: async (taskId) => copy(store.progress.filter((p) => p.taskId === taskId).reverse()),
    listSubtasksForTask: async (taskId) => copy(store.subtasks.filter((s) => s.taskId === taskId)),
    listDisputesForTask: async (taskId) => copy(store.disputes.filter((d) => d.taskId === taskId)),
    listTaskActivity: async (taskId) => copy(store.activities.filter((a) => a.taskId === taskId).reverse()),
    listPaymentTransactionsForTask: async (taskId) => copy(store.payments.filter((p) => p.taskId === taskId)),
    getSubtaskById: async (taskId, subtaskId) => copy(store.subtasks.find((s) => s.taskId === taskId && s.id === subtaskId) || null),
    updateSubtaskStatus: async (taskId, subtaskId, status) => {
      const s = store.subtasks.find((x) => x.taskId === taskId && x.id === subtaskId);
      if (!s) return { count: 0 };
      s.status = status;
      return { count: 1 };
    },
    createTaskProgressUpdate: async (data) => { const row = { id: nextId(), createdAt: now(), ...data }; store.progress.push(row); return copy(row); },
    countProgressUpdatesForTask: async (taskId) => store.progress.filter((p) => p.taskId === taskId).length,
    createDispute: async (data) => { const row = { id: nextId(), createdAt: now(), ...data }; store.disputes.push(row); return copy(row); },
    findDisputeById: async (id) => copy(store.disputes.find((d) => d.id === id) || null),
    updateDispute: async (id, data) => copy(Object.assign(store.disputes.find((d) => d.id === id), data)),
    listAllDisputes: async () => copy(store.disputes),
    saveTaskForUser: async (userId, taskId) => { const row = { id: nextId(), userId, taskId }; store.savedTasks.push(row); return copy(row); },
    unsaveTaskForUser: async (userId, taskId) => {
      const before = store.savedTasks.length;
      store.savedTasks = store.savedTasks.filter((s) => !(s.userId === userId && s.taskId === taskId));
      return before - store.savedTasks.length;
    },
    listSavedTasksForUser: async (userId) => store.savedTasks.filter((s) => s.userId === userId)
      .map((s) => ({ ...copy(s), task: taskWithCounts(findTask(s.taskId)) })),
  };
  mockModule('modules/tasks/repository.js', taskRepository);

  const bidWithProvider = (bid) => {
    const u = findUser(bid.providerId);
    return copy({
      ...bid,
      amount: bid.price,
      provider: {
        id: u.id, name: u.name, skills: u.skills || '',
        providerProfile: { specialties: profileFor(u.id)?.specialties || [] },
        ratingsReceived: store.ratings.filter((r) => r.toUserId === u.id).map((r) => ({ rating: r.rating })),
        _count: { tasksAssigned: store.tasks.filter((t) => t.assignedProviderId === u.id).length },
      },
    });
  };
  mockModule('modules/bids/repository.js', {
    createBid: async (data) => { const row = { id: nextId(), createdAt: now(), ...data }; store.bids.push(row); return copy(row); },
    getTaskById: async (id) => taskWithCounts(findTask(id)),
    listBidsForTask: async (taskId) => store.bids.filter((b) => b.taskId === taskId).map(bidWithProvider),
    listBidsForProvider: async (providerId) => store.bids.filter((b) => b.providerId === providerId)
      .map((b) => ({ ...copy(b), task: copy(findTask(b.taskId)) })),
    updateTaskStatus: async (taskId, status) => copy(Object.assign(findTask(taskId), { status })),
    markTaskAsBidding: async (taskId, biddingStartedAt, biddingEndsAt) => copy(Object.assign(findTask(taskId), { status: 'BIDDING', biddingStartedAt, biddingEndsAt })),
  });

  mockModule('modules/ratings/repository.js', {
    findTaskForRating: async (taskId) => {
      const t = findTask(taskId);
      return t ? { id: t.id, title: t.title, status: t.status, createdById: t.createdById, assignedProviderId: t.assignedProviderId } : null;
    },
    findExistingRating: async (taskId, fromUserId, toUserId) => copy(store.ratings.find((r) => r.taskId === taskId && r.fromUserId === fromUserId && r.toUserId === toUserId) || null),
    createRating: async (data) => { const row = { id: nextId(), createdAt: now(), ...data }; store.ratings.push(row); return copy(row); },
    listRatingsForUser: async (userId) => copy(store.ratings.filter((r) => r.toUserId === userId)),
    getRatingStatsForUser: async (userId) => ratingStats(userId),
    listLatestCommentRatingsForUser: async (userId, limit = 5) => copy(store.ratings.filter((r) => r.toUserId === userId && r.comment).slice(-limit)),
    updateUserRating: async (userId, value) => { const u = findUser(userId); if (u) u.rating = value; return copy(u); },
  });

  mockModule('modules/notifications/repository.js', {
    findUserById: async (id) => copy(findUser(id)),
    findTaskById: async (id) => copy(findTask(id)),
    createNotification: async (data) => pushNotification(data),
    listNotificationsByRecipient: async (recipientId) => copy(store.notifications.filter((n) => n.recipientId === recipientId).reverse()),
    getNotificationById: async (id) => copy(store.notifications.find((n) => n.id === id) || null),
    markNotificationAsRead: async (id) => copy(Object.assign(store.notifications.find((n) => n.id === id), { isRead: true })),
  });

  mockModule('modules/tracking/repository.js', {
    getTaskById: async (taskId) => copy(findTask(taskId)),
    getVerificationByRequestId: async (requestId) => copy(store.verifications.find((v) => v.requestId === requestId) || null),
    getLatestVerification: async (taskId, providerId) => copy([...store.verifications].reverse().find((v) => v.taskId === taskId && v.providerId === providerId) || null),
    createVerification: async (data) => { const row = { id: nextId(), ...data }; store.verifications.push(row); return copy(row); },
    revokeTaskVerifications: async (taskId, reason, revokedAt = now()) => {
      let count = 0;
      for (const v of store.verifications) {
        if (v.taskId === taskId && v.revokedAt == null) { v.revokedAt = revokedAt; v.revokeReason = reason; count += 1; }
      }
      return { count };
    },
  });

  const paymentView = (p) => copy({ ...p, task: findTask(p.taskId), provider: p.providerId ? userLite(p.providerId) : null });
  mockModule('modules/payments/repository.js', {
    getTaskById: async (taskId) => {
      const t = findTask(taskId);
      return t ? copy({ ...t, bids: store.bids.filter((b) => b.taskId === t.id && b.status === 'ACCEPTED') }) : null;
    },
    createPaymentTransaction: async (data) => { const row = { id: nextId(), createdAt: now(), ...data }; store.payments.push(row); return paymentView(row); },
    getPaymentByCheckoutSessionId: async (sessionId) => copy(store.payments.find((p) => p.checkoutSessionId === sessionId) || null),
    updatePaymentStatus: async (id, data) => copy(Object.assign(store.payments.find((p) => p.id === id), data)),
    updateTaskState: async (taskId, data) => copy(Object.assign(findTask(taskId), data)),
    listPaymentsByPayer: async (payerId) => store.payments.filter((p) => p.payerId === payerId).map(paymentView),
    listPaymentsByTask: async (taskId) => store.payments.filter((p) => p.taskId === taskId).map(paymentView),
    findLatestSuccessfulEscrowDeposit: async (taskId) => copy([...store.payments].reverse()
      .find((p) => p.taskId === taskId && p.type === 'ESCROW_DEPOSIT' && p.status === 'SUCCESS') || null),
    findSuccessfulEscrowRelease: async (taskId) => copy(store.payments
      .find((p) => p.taskId === taskId && p.type === 'ESCROW_RELEASE' && p.status === 'SUCCESS') || null),
    hasProviderCompletionConfirmation: async (taskId, providerId) => store.activities
      .some((log) => log.taskId === taskId && log.actorId === providerId && log.action === 'PROGRESS_MARKED_COMPLETED'),
    hasActiveDispute: async (taskId) => store.disputes
      .some((d) => d.taskId === taskId && ['OPEN', 'UNDER_REVIEW'].includes(d.status)),
    getPlatformFeeConfig: async () => null,
    createTaskActivity: async (data) => logActivity(data),
  });
}

// ------------------------------------------------------------- platform
async function startPlatform() {
  installMocks();
  // Expected 4xx errors are logged by the app's error handler and request logger;
  // keep test output readable unless WORKFLOW_TEST_VERBOSE=true.
  if (process.env.WORKFLOW_TEST_VERBOSE !== 'true') {
    console.error = () => {};
    console.log = () => {};
    console.info = () => {};
  }
  // eslint-disable-next-line global-require
  const app = require(path.join(SRC, 'app.js'));
  // eslint-disable-next-line global-require
  const { signToken } = require(path.join(SRC, 'shared/middlewares/auth.js'));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function api(method, urlPath, { token, body } = {}) {
    const response = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, body: data };
  }

  let accountSeq = 0;
  async function signup(role, overrides = {}) {
    accountSeq += 1;
    const res = await api('POST', '/api/auth/signup', {
      body: {
        fullName: `Workflow ${role} ${accountSeq}`,
        email: `wf-${role.toLowerCase()}-${accountSeq}@example.test`,
        password: 'WorkflowPass123!',
        role,
        location: 'Ben Thanh',
        ...overrides,
      },
    });
    if (res.status !== 201) throw new Error(`signup ${role} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return { ...res.body.user, token: res.body.accessToken };
  }

  function createAdmin() {
    const admin = { id: nextId(), name: 'Workflow Admin', email: `admin-${store.seq}@example.test`, role: 'ADMIN', status: 'ACTIVE', tokenVersion: 0 };
    store.users.push(admin);
    return { ...admin, token: signToken(admin) };
  }

  // Simulates the requester paying on the Stripe Checkout page (test card).
  function payCheckout(sessionId) {
    const session = store.stripeSessions.get(sessionId);
    if (!session) throw new Error(`Unknown Checkout session ${sessionId}`);
    session.status = 'complete';
    session.payment_status = 'paid';
  }

  const futureIso = (days = 7) => new Date(Date.now() + days * 86400000).toISOString();
  const taskPayload = (overrides = {}) => ({
    title: 'Fix leaking kitchen sink',
    description: 'The kitchen sink pipe leaks under the cabinet and needs repair.',
    category: 'HOME_REPAIR',
    budget: 650000,
    maxBids: 5,
    location: 'Ben Thanh',
    district: 'Ben Thanh',
    streetName: '12 Nguyen Hue',
    siteAddress: '12 Nguyen Hue, Ben Thanh, Ho Chi Minh City',
    dueDate: futureIso(),
    ...overrides,
  });
  const gpsFix = (task, overrides = {}) => ({
    requestId: `verify_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`,
    lat: task.siteLatitude,
    lng: task.siteLongitude,
    accuracy: 12,
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  // Drives a task to a given point in the lifecycle through the public API.
  async function advanceTask(stage, { requester, provider, payload, bidAmount = 600000 } = {}) {
    const stages = ['CREATED', 'BID', 'ASSIGNED', 'FUNDED', 'VERIFIED', 'PENDING_CONFIRMATION', 'PAID'];
    const target = stages.indexOf(stage);
    const ctx = { requester, provider };
    const expect = (res, status, label) => {
      if (res.status !== status) throw new Error(`${label}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)}`);
      return res.body;
    };
    ctx.task = expect(await api('POST', '/api/tasks', { token: requester.token, body: taskPayload(payload) }), 201, 'create task');
    if (target >= 1) {
      ctx.bid = expect(await api('POST', `/api/tasks/${ctx.task.id}/bids`, { token: provider.token, body: { amount: bidAmount, message: 'Ready to help' } }), 201, 'bid');
    }
    if (target >= 2) {
      expect(await api('PATCH', `/api/tasks/${ctx.task.id}/assign-provider`, { token: requester.token, body: { bidId: ctx.bid.id } }), 200, 'assign');
    }
    if (target >= 3) {
      ctx.checkout = expect(await api('POST', '/api/payments/create', { token: requester.token, body: { taskId: ctx.task.id, flow: 'ESCROW_DEPOSIT' } }), 201, 'checkout');
      payCheckout(ctx.checkout.sessionId);
      expect(await api('POST', '/api/payments/confirm-session', { token: requester.token, body: { sessionId: ctx.checkout.sessionId } }), 200, 'confirm');
    }
    if (target >= 4) {
      expect(await api('POST', `/api/tracking/tasks/${ctx.task.id}/verify`, { token: provider.token, body: gpsFix(findTask(ctx.task.id)) }), 201, 'verify');
    }
    if (target >= 5) {
      expect(await api('POST', `/api/tasks/${ctx.task.id}/progress`, { token: provider.token, body: { progressPercent: 100, note: 'Done', markAsCompleted: true } }), 201, 'complete');
    }
    if (target >= 6) {
      expect(await api('POST', `/api/tasks/${ctx.task.id}/confirm-completion`, { token: requester.token }), 200, 'confirm completion');
    }
    return ctx;
  }

  return {
    api,
    signup,
    createAdmin,
    payCheckout,
    taskPayload,
    gpsFix,
    advanceTask,
    store,
    dbTask: (id) => copy(findTask(id)),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { startPlatform };
