const { prisma } = require('../../database/prisma');

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
      where: { status: 'SUCCESS', lifecycleStatus: 'ESCROW_HELD' },
    }),
    prisma.paymentTransaction.aggregate({
      _sum: { providerPayoutAmount: true, platformFeeAmount: true },
      where: { status: 'SUCCESS', lifecycleStatus: 'RELEASED' },
    }),
  ]);

  const escrowHeldPayments = await prisma.paymentTransaction.count({
    where: {
      lifecycleStatus: 'ESCROW_HELD',
    },
  });

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
  };
}

async function listUsers() {
  return prisma.user.findMany({
    select: {
      id: true, name: true, email: true, role: true, status: true, createdAt: true,
      _count: { select: { tasksCreated: true, tasksAssigned: true, disputesOpened: true, supportTickets: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

const getUserForAdmin = id => prisma.user.findUnique({
  where: { id },
  select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
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

async function softDeleteTask(taskId, adminId) {
  return prisma.task.update({
    where: { id: taskId },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
      reviewedByAdminAt: new Date(),
      reviewedByAdminId: adminId,
      status: 'CANCELLED',
    },
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
