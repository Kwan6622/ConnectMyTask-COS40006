const { prisma } = require('../../database/prisma');

async function createReview(data) {
  return prisma.review.create({ data });
}

async function getReviewsForProvider(providerId) {
  return prisma.review.findMany({
    where: {
      task: {
        assignedProviderId: providerId,
      },
    },
    // Public endpoint: never return whole rows (password hash, home or site address).
    include: {
      task: { select: { id: true, title: true, category: true } },
      reviewer: { select: { id: true, name: true, profilePhotoUrl: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

module.exports = {
  createReview,
  getReviewsForProvider,
};

