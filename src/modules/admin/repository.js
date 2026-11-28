// Money really still in escrow: a confirmed deposit whose task is still HELD.
// Checking the task too keeps older deposit rows (released before the deposit
// row was updated) out of the "held" totals and the release list.
const HELD_DEPOSIT_WHERE = {
  status: 'SUCCESS',
  type: 'ESCROW_DEPOSIT',
  lifecycleStatus: 'ESCROW_HELD',
  task: { escrowStatus: 'HELD' },
};

const { prisma } = require('../../database/prisma');
const { getWard, getCity } = require('../../shared/administrativeUnits');

async function getAdminStats() {
  const [totalUsers, activeTasks, suspiciousTasks, disputes, pendingCertificates, openSupportTickets, heldAgg, releasedAgg] = await Promise.all([
    prisma.user.count(),
    prisma.task.count({
      where: {
        isDeleted: false,
        status: {
          in: ['OPEN', 'BIDDING', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_CONFIRMATION'],
        },
      },
    }),
    prisma.task.count({
      where: {
        isDeleted: false,
        isSuspicious: true,
      },
    }),
    prisma.dispute.count({
      where: {
        status: {
          in: ['OPEN', 'UNDER_REVIEW'],
        },
      },
    }),
    prisma.providerCertificate.count({
      where: {
        verificationStatus: 'PENDING',
      },
    }),
    prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    prisma.paymentTransaction.aggregate({
      _sum: { escrowHeldAmount: true },
      where: HELD_DEPOSIT_WHERE,
    }),
    // Settlements only: the deposit row carries the same fee and must not count twice.
    prisma.paymentTransaction.aggregate({
      _sum: { providerPayoutAmount: true, platformFeeAmount: true },
      where: { status: 'SUCCESS', type: 'ESCROW_RELEASE', lifecycleStatus: 'RELEASED' },
    }),
  ]);

  const escrowHeldPayments = await prisma.paymentTransaction.count({ where: HELD_DEPOSIT_WHERE });

  // Items an admin still has to act on, shown as a small badge on each tab.
  const [lockedUsers, unreviewedSuspicious, escrowNeedsAction] = await Promise.all([
    prisma.user.count({ where: { status: 'LOCKED', lockedUntil: { gt: new Date() } } }),
    prisma.task.count({ where: { isDeleted: false, isSuspicious: true, reviewedByAdminAt: null } }),
    // Frozen by a dispute, or confirmed complete but not yet paid out.
    prisma.task.count({
      where: {
        isDeleted: false,
        OR: [{ escrowStatus: 'FROZEN' }, { escrowStatus: 'HELD', status: 'COMPLETED' }],
      },
    }),
  ]);

  return {
    totalUsers,
    activeTasks,
    suspiciousTasks,
    disputes,
    pendingCertificates,
    openSupportTickets,
    escrowHeldPayments,
    totalEscrowHeldAmount: Number(heldAgg?._sum?.escrowHeldAmount || 0),
    totalReleasedPayments: Number(releasedAgg?._sum?.providerPayoutAmount || 0),
    totalPlatformRevenue: Number(releasedAgg?._sum?.platformFeeAmount || 0),
    attention: {
      users: lockedUsers,
      tasks: unreviewedSuspicious,
      certificates: pendingCertificates,
      payments: escrowNeedsAction,
      disputes,
      support: openSupportTickets,
    },
  };
}

async function listUsers() {
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, status: true, createdAt: true,
      warningCount: true, lockedUntil: true, locationId: true, location: true,
      _count: { select: { tasksCreated: true, tasksAssigned: true, disputesOpened: true, supportTickets: true } },
      // Documents an admin has already verified, so they can be opened from the user list.
      providerProfile: {
        select: {
          certificates: {
            where: { verificationStatus: 'VERIFIED' },
            select: { id: true, title: true, certificateType: true, fileUrl: true, verifiedAt: true },
            orderBy: [{ verifiedAt: 'desc' }, { id: 'desc' }],
          },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  // Average rating each user has received, and how many ratings.
  const ratings = await prisma.rating.groupBy({
    by: ['toUserId'],
    _avg: { rating: true },
    _count: { rating: true },
  });
  const ratingByUser = new Map(ratings.map((row) => [row.toUserId, row]));

  return users.map(({ providerProfile, ...user }) => {
    const ward = getWard(user.locationId);
    const rating = ratingByUser.get(user.id);
    return {
      ...user,
      cityId: ward?.cityId ?? null,
      cityName: getCity(ward?.cityId)?.name ?? null,
      averageRating: rating ? Math.round(Number(rating._avg.rating || 0) * 10) / 10 : null,
      ratingCount: rating ? Number(rating._count.rating || 0) : 0,
      verifiedDocuments: providerProfile?.certificates || [],
    };
  });
}

const getUserForAdmin = id => prisma.user.findUnique({
  where: { id },
  select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, warningCount: true, lockedUntil: true },
});

const updateUserStatus = (id, status) => prisma.user.update({
  where: { id },
  data: { status, tokenVersion: { increment: 1 } },
  select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
});

async function listAdminTasks({ suspiciousOnly = false } = {}) {
  return prisma.task.findMany({
    where: {
      ...(suspiciousOnly ? { isSuspicious: true } : {}),
      isDeleted: false,
    },
    include: {
      createdBy: {
        select: { id: true, name: true, email: true },
      },
      assignedProvider: {
        select: { id: true, name: true, email: true },
      },
      _count: {
        select: {
          bids: true,
          disputes: true,
        },
      },
      locationVerifications: {
        orderBy: [{ verifiedAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { providerId: true, siteVersion: true, expiresAt: true, revokedAt: true },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

const getTaskForAdmin = id => prisma.task.findFirst({
  where: { id, isDeleted: false },
  select: {
    id: true,
    status: true,
    escrowStatus: true,
    paymentStatus: true,
    _count: {
      select: {
        disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
      },
    },
  },
});

async function updateTaskStatusByAdmin(taskId, fromStatus, toStatus, adminId, reason) {
  return prisma.$transaction(async (tx) => {
    const result = await tx.task.updateMany({
      where: { id: taskId, status: fromStatus, isDeleted: false },
      data: {
        status: toStatus,
        ...(toStatus === 'CANCELLED' ? { canceledAt: new Date(), cancellationReason: reason } : {}),
      },
    });
    if (result.count !== 1) {
      throw Object.assign(new Error('Task status changed; refresh and try again'), { statusCode: 409 });
    }
    await tx.taskActivityLog.create({
      data: {
        taskId,
        actorId: adminId,
        action: 'ADMIN_STATUS_CHANGED',
        message: `Admin changed task status from ${fromStatus} to ${toStatus}.`,
        metadata: { fromStatus, toStatus, reason },
      },
    });
    return tx.task.findUnique({ where: { id: taskId } });
  });
}

async function getPlatformFeeSettings() {
  const [config, audits] = await Promise.all([
    prisma.platformFeeConfig.findUnique({ where: { id: 1 } }),
    prisma.platformFeeAudit.findMany({
      where: { configId: 1 },
      include: { changedBy: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    }),
  ]);
  return { config, audits };
}

async function updatePlatformFeeSettings(nextConfig, adminId, reason) {
  return prisma.$transaction(async (tx) => {
    const previous = await tx.platformFeeConfig.findUnique({ where: { id: 1 } });
    if (!previous) throw Object.assign(new Error('Platform fee settings migration is required'), { statusCode: 503 });
    const updated = await tx.platformFeeConfig.update({
      where: { id: 1 },
      data: { ...nextConfig, version: { increment: 1 }, updatedById: adminId },
    });
    await tx.platformFeeAudit.create({
      data: {
        configId: 1,
        changedById: adminId,
        previousValue: {
          feeType: previous.feeType,
          percentageRate: previous.percentageRate,
          fixedAmount: previous.fixedAmount,
          isActive: previous.isActive,
          version: previous.version,
        },
        newValue: {
          feeType: updated.feeType,
          percentageRate: updated.percentageRate,
          fixedAmount: updated.fixedAmount,
          isActive: updated.isActive,
          version: updated.version,
        },
        reason,
      },
    });
    return updated;
  });
}

/**
 * Hides a task (kept in the database), cancels it with the admin's reason and
 * closes its pending bids. Returns the task and the providers whose bids closed.
 */
async function softDeleteTask(taskId, adminId, reason) {
  return prisma.$transaction(async (tx) => {
    const pendingBids = await tx.bid.findMany({ where: { taskId, status: 'PENDING' }, select: { providerId: true } });
    await tx.bid.updateMany({ where: { taskId, status: 'PENDING' }, data: { status: 'REJECTED' } });
    const now = new Date();
    const task = await tx.task.update({
      where: { id: taskId },
      data: {
        isDeleted: true,
        deletedAt: now,
        reviewedByAdminAt: now,
        reviewedByAdminId: adminId,
        status: 'CANCELLED',
        canceledAt: now,
        cancellationReason: reason,
      },
    });
    await tx.taskActivityLog.create({
      data: {
        taskId,
        actorId: adminId,
        action: 'TASK_REMOVED_BY_ADMIN',
        message: `An admin removed this task: ${reason}`,
        metadata: { reason, closedBids: pendingBids.length },
      },
    });
    return { task, bidderIds: [...new Set(pendingBids.map((bid) => bid.providerId))] };
  });
}

async function markTaskReviewed(taskId, adminId) {
  return prisma.task.update({
    where: { id: taskId },
    data: {
      reviewedByAdminAt: new Date(),
      reviewedByAdminId: adminId,
    },
  });
}

async function listCertificates() {
  return prisma.providerCertificate.findMany({
    include: {
      provider: {
        select: { id: true, name: true, email: true },
      },
      verifiedByAdmin: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: [{ uploadedAt: 'desc' }, { id: 'desc' }],
  });
}

async function verifyCertificate(certificateId, adminId, status) {
  return prisma.providerCertificate.update({
    where: { id: certificateId },
    data: {
      verificationStatus: status,
      verifiedAt: new Date(),
      verifiedByAdminId: adminId,
      rejectionReason: status === 'REJECTED' ? 'Rejected by admin review.' : null,
    },
  });
}

async function listPayments(filters = {}) {
  const where = {};
  if (filters.lifecycleStatus) {
    where.lifecycleStatus = filters.lifecycleStatus;
  }
  if (filters.heldOnly) Object.assign(where, HELD_DEPOSIT_WHERE);

  return prisma.paymentTransaction.findMany({
    where,
    include: {
      task: {
        select: {
          id: true,
          title: true,
          status: true,
          createdById: true,
          assignedProviderId: true,
        },
      },
      payer: {
        select: { id: true, name: true, email: true },
      },
      provider: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

async function getPaymentById(id) {
  return prisma.paymentTransaction.findUnique({
    where: { id },
    include: {
      task: true,
      payer: { select: { id: true, name: true, email: true } },
      provider: { select: { id: true, name: true, email: true } },
    },
  });
}

async function updatePaymentTransaction(id, data) {
  return prisma.paymentTransaction.update({
    where: { id },
    data,
  });
}

async function updateTaskById(taskId, data) {
  return prisma.task.update({
    where: { id: taskId },
    data,
  });
}

module.exports = {
  getAdminStats,
  listUsers,
  getUserForAdmin,
  updateUserStatus,
  listAdminTasks,
  getTaskForAdmin,
  updateTaskStatusByAdmin,
  getPlatformFeeSettings,
  updatePlatformFeeSettings,
  softDeleteTask,
  markTaskReviewed,
  listCertificates,
  verifyCertificate,
  listPayments,
  getPaymentById,
  updatePaymentTransaction,
  updateTaskById,
};
