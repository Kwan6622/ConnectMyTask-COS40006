const bidsRepository = require('./repository');
const notificationRepository = require('../notifications/repository');
const GLOBAL_MAX_BIDS = 100;
const DEFAULT_MAX_BIDS = 30;
const BIDDING_WINDOW_HOURS = 24;
const BID_SORT_OPTIONS = new Set(['NEWEST', 'PRICE_ASC', 'PRICE_DESC', 'EXPERTISE', 'RATING', 'EXPERIENCE']);

function normalizeRole(role) {
  return String(role || '').toUpperCase();
}

async function createBid(taskId, payload, currentUser) {
  if (normalizeRole(currentUser?.role) !== 'PROVIDER') {
    const err = new Error('Only providers can submit bids');
    err.statusCode = 403;
    throw err;
  }

  const task = await bidsRepository.getTaskById(taskId);
  if (!task) {
    const err = new Error('Task not found');
    err.statusCode = 404;
    throw err;
  }

  if (task.createdById === currentUser.id) {
    const err = new Error('You cannot bid on your own task');
    err.statusCode = 400;
    throw err;
  }

  if (!['OPEN', 'BIDDING'].includes(task.status)) {
    const err = new Error('Bids are only allowed for OPEN or BIDDING tasks');
    err.statusCode = 400;
    throw err;
  }

  if (task.status === 'BIDDING' && task.biddingEndsAt) {
    const endsAt = new Date(task.biddingEndsAt).getTime();
    if (!Number.isNaN(endsAt) && Date.now() > endsAt) {
      const err = new Error('Bidding deadline has passed for this task.');
      err.statusCode = 400;
      throw err;
    }
  }

  const currentBidCount = Number(task?._count?.bids || 0);
  const taskMaxBids = Math.min(Number(task?.maxBids || DEFAULT_MAX_BIDS), GLOBAL_MAX_BIDS);
  if (currentBidCount >= taskMaxBids || currentBidCount >= GLOBAL_MAX_BIDS) {
    const err = new Error('This task is no longer accepting bids.');
    err.statusCode = 400;
    throw err;
  }

  const bid = await bidsRepository.createBid({
    taskId,
    providerId: currentUser.id,
    price: payload.amount,
    message: payload.message || null,
    estimatedCompletionTime: payload.estimatedCompletionTime || null,
    status: 'PENDING',
  });

  if (task.status === 'OPEN') {
    const biddingStartedAt = new Date();
    const biddingEndsAt = new Date(biddingStartedAt.getTime() + BIDDING_WINDOW_HOURS * 60 * 60 * 1000);
    await bidsRepository.markTaskAsBidding(taskId, biddingStartedAt, biddingEndsAt);
  }

  await notificationRepository.createNotification({
    recipientId: task.createdById,
    senderId: currentUser.id,
    taskId,
    message: `A provider wants to contact you regarding your task. Provider: ${currentUser.name || currentUser.email}.`,
  });

  return bid;
}

function normalizeExpertise(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

function enrichBid(bid, taskCategory) {
  const ratings = bid.provider?.ratingsReceived || [];
  const ratingCount = ratings.length;
  const averageRating = ratingCount
    ? ratings.reduce((sum, item) => sum + Number(item.rating || 0), 0) / ratingCount
    : 0;
  const specialties = bid.provider?.providerProfile?.specialties || [];
  const skills = Array.isArray(bid.provider?.skills)
    ? bid.provider.skills
    : String(bid.provider?.skills || '').split(',');
  const category = normalizeExpertise(taskCategory);
  const expertiseMatch = [...specialties, ...skills].some(item => normalizeExpertise(item) === category);
  const { ratingsReceived: _ratings, _count, ...provider } = bid.provider || {};
  return {
    ...bid,
    provider: {
      ...provider,
      rating: averageRating,
      ratingCount,
      completedTasks: Number(_count?.tasksAssigned || 0),
      expertiseMatch,
    },
  };
}

function sortBids(bids, sort) {
  const newest = (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || Number(b.id) - Number(a.id);
  const comparators = {
    NEWEST: newest,
    PRICE_ASC: (a, b) => Number(a.price) - Number(b.price) || newest(a, b),
    PRICE_DESC: (a, b) => Number(b.price) - Number(a.price) || newest(a, b),
    EXPERTISE: (a, b) => Number(Boolean(b.provider?.expertiseMatch)) - Number(Boolean(a.provider?.expertiseMatch)) || newest(a, b),
    RATING: (a, b) => Number(b.provider?.rating || 0) - Number(a.provider?.rating || 0) || Number(b.provider?.ratingCount || 0) - Number(a.provider?.ratingCount || 0) || newest(a, b),
    EXPERIENCE: (a, b) => Number(b.provider?.completedTasks || 0) - Number(a.provider?.completedTasks || 0) || newest(a, b),
  };
  return [...bids].sort(comparators[sort] || comparators.NEWEST);
}

async function listBidsForTask(taskId, currentUser, sortRaw = 'NEWEST') {
  const task = await bidsRepository.getTaskById(taskId);
  if (!task) {
    const err = new Error('Task not found');
    err.statusCode = 404;
    throw err;
  }
  const role = normalizeRole(currentUser?.role);
  if (task.createdById !== currentUser?.id && role !== 'ADMIN') {
    throw Object.assign(new Error('Only the task requester or admin can view bids'), { statusCode: 403 });
  }
  const sort = String(sortRaw || 'NEWEST').toUpperCase();
  if (!BID_SORT_OPTIONS.has(sort)) {
    throw Object.assign(new Error('Unsupported bid sort option'), { statusCode: 400 });
  }
  const bids = await bidsRepository.listBidsForTask(taskId);
  return sortBids(bids.map(bid => enrichBid(bid, task.category)), sort);
}

async function listBidsForProvider(providerId, currentUser) {
  if (providerId !== currentUser.id) {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    throw err;
  }
  if (normalizeRole(currentUser.role) !== 'PROVIDER') {
    const err = new Error('Only providers can view provider bid history');
    err.statusCode = 403;
    throw err;
  }
  return bidsRepository.listBidsForProvider(providerId);
}

module.exports = {
  createBid,
  listBidsForTask,
  listBidsForProvider,
  sortBids,
};
