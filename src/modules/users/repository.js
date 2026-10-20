const { prisma } = require('../../database/prisma');

async function createUser(data) {
  return prisma.user.create({ data });
}

async function getUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    include: {
      providerProfile: {
        include: {
          certificates: {
            orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
          },
        },
      },
    },
  });
}

async function getPublicUserById(id) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, role: true, profilePhotoUrl: true, rating: true, bio: true,
      providerProfile: {
        select: {
          specialties: true, district: true, city: true, safetyComplianceAgreed: true, shortBio: true,
          certificates: {
            where: { verificationStatus: 'VERIFIED' },
            select: { id: true, title: true, certificateType: true, verificationStatus: true, uploadedAt: true, verifiedAt: true },
            orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
          },
        },
      },
    },
  });
}

function toSafePrivateUser(user) {
  const { passwordHash: _passwordHash, failedLoginAttempts: _failedLoginAttempts, lockoutUntil: _lockoutUntil, tokenVersion: _tokenVersion, ...safe } = user;
  return safe;
}

async function updateProfile(id, data) {
  const user = await prisma.user.update({
    where: { id },
    data,
    include: {
      providerProfile: {
        include: { certificates: { orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }] } },
      },
    },
  });
  return toSafePrivateUser(user);
}

async function upsertProviderProfile(userId, data) {
  return prisma.providerProfile.upsert({
    where: { userId },
    update: data,
    create: {
      userId,
      ...data,
    },
    include: {
      certificates: {
        orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
      },
    },
  });
}

async function getProviderProfileByUserId(userId) {
  return prisma.providerProfile.findUnique({
    where: { userId },
    include: {
      certificates: {
        orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
      },
    },
  });
}

async function createProviderCertificate(data) {
  return prisma.providerCertificate.create({
    data,
  });
}

async function getProviderCertificateById(id) {
  return prisma.providerCertificate.findUnique({
    where: { id },
  });
}

async function updateProviderCertificateVerification(id, data) {
  return prisma.providerCertificate.update({
    where: { id },
    data,
  });
}

async function getLatestProviderRatingsSummary(providerId) {
  const [aggregate, latest] = await prisma.$transaction([
    prisma.rating.aggregate({
      where: { toUserId: providerId },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.rating.findMany({
      where: {
        toUserId: providerId,
        comment: {
          not: null,
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      include: {
        fromUser: {
          select: {
            id: true,
            name: true,
            profilePhotoUrl: true,
          },
        },
      },
    }),
  ]);

  return {
    averageRating: Number(aggregate?._avg?.rating || 0),
    totalReviews: Number(aggregate?._count?.rating || 0),
    latestComments: latest,
  };
}

module.exports = {
  createUser,
  getUserById,
  getPublicUserById,
  toSafePrivateUser,
  updateProfile,
  upsertProviderProfile,
  getProviderProfileByUserId,
  createProviderCertificate,
  getProviderCertificateById,
  updateProviderCertificateVerification,
  getLatestProviderRatingsSummary,
};

