const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { evaluateTaskRisk } = require('../../src/modules/tasks/riskEvaluator');

dotenv.config({ path: 'database/.env' });
dotenv.config();

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = '123456';

const requesterSeeds = [
  {
    name: 'Nguyen Minh Anh',
    email: 'requester1@gmail.com',
    phone: '0901000001',
    role: 'REQUESTER',
    skills: 'Task posting, home services',
    bio: 'Requester focused on reliable home service providers.',
    availability: 'Weekdays 8:00 - 18:00',
    profilePhotoUrl:
      'https://res.cloudinary.com/dgwxtzios/image/upload/v1773652699/cgvy9assrqvzfqtfyyg5.png',
  },
  {
    name: 'Tran Bao Chau',
    email: 'requester2@gmail.com',
    phone: '0901000002',
    role: 'REQUESTER',
    skills: 'Office errands, delivery tasks',
    bio: 'Requester managing office and personal errands.',
    availability: 'Daily 9:00 - 21:00',
    profilePhotoUrl:
      'https://res.cloudinary.com/dgwxtzios/image/upload/v1773652699/cgvy9assrqvzfqtfyyg5.png',
  },
  {
    name: 'Pham Thu Trang',
    email: 'requester5@gmail.com',
    phone: '0901000005',
    role: 'REQUESTER',
    skills: 'Household services',
    bio: 'Requester profile used for suspicious-task demo in capstone class.',
    availability: 'Daily 8:00 - 20:00',
    profilePhotoUrl:
      'https://res.cloudinary.com/dgwxtzios/image/upload/v1773652699/cgvy9assrqvzfqtfyyg5.png',
  },
  {
    name: 'Hoang Minh Duc',
    email: 'requester4@gmail.com',
    phone: '0901000004',
    role: 'REQUESTER',
    skills: 'Tech and office support requests',
    bio: 'Requester account for payment-step demo scenarios.',
    availability: 'Mon-Fri 9:00 - 18:00',
    profilePhotoUrl:
      'https://res.cloudinary.com/dgwxtzios/image/upload/v1773652699/cgvy9assrqvzfqtfyyg5.png',
  },
  {
    name: 'Le Quynh Nhu',
    email: 'requester3@gmail.com',
    phone: '0901000003',
    role: 'REQUESTER',
    skills: 'Family errands and tutoring tasks',
    bio: 'Requester who posts recurring family support tasks.',
    availability: 'Daily 7:00 - 22:00',
    profilePhotoUrl:
      'https://res.cloudinary.com/dgwxtzios/image/upload/v1773652699/cgvy9assrqvzfqtfyyg5.png',
  },
];

const providerSeeds = [
  {
    name: 'Le Thanh Dat',
    email: 'provider1@gmail.com',
    phone: '0902000001',
    role: 'PROVIDER',
    skills: 'HOME_REPAIR',
    bio: '2+ years of home repair and appliance installation experience.',
    availability: 'Mon-Sat 8:00 - 18:00',
  },
  {
    name: 'Pham Gia Han',
    email: 'provider2@gmail.com',
    phone: '0902000002',
    role: 'PROVIDER',
    skills: 'CLEANING',
    bio: 'Detail-focused cleaner for apartments and small offices.',
    availability: 'Daily 7:00 - 20:00',
  },
  {
    name: 'Vo Hoang Nam',
    email: 'provider3@gmail.com',
    phone: '0902000003',
    role: 'PROVIDER',
    skills: 'DELIVERY',
    bio: 'Fast city delivery provider for urgent same-day tasks.',
    availability: 'Daily 8:00 - 22:00',
  },
  {
    name: 'Bui Kim Ngan',
    email: 'provider4@gmail.com',
    phone: '0902000004',
    role: 'PROVIDER',
    skills: 'IT_SUPPORT',
    bio: 'Laptop troubleshooting and software setup specialist.',
    availability: 'Mon-Fri 9:00 - 19:00',
  },
  {
    name: 'Dang Quoc Viet',
    email: 'provider5@gmail.com',
    phone: '0902000005',
    role: 'PROVIDER',
    skills: 'MOVING',
    bio: 'Furniture moving and heavy-item transport support.',
    availability: 'Mon-Sun 6:00 - 20:00',
  },
];

const taskTemplates = [
  {
    title: 'Install new ceiling fan in bedroom',
    description:
      'Need a technician to remove old fan and install a new ceiling fan. Basic tools are available.',
    category: 'HOME_REPAIR',
    budget: 450000,
    location: 'District 10, Ho Chi Minh City',
    dueDate: '2026-03-28T17:00:00.000Z',
  },
  {
    title: 'Weekly deep cleaning for apartment',
    description:
      'Looking for a provider to deep clean 2-bedroom apartment every Saturday morning.',
    category: 'CLEANING',
    budget: 700000,
    location: 'Binh Thanh, Ho Chi Minh City',
    dueDate: '2026-03-30T17:00:00.000Z',
  },
  {
    title: 'Same-day document delivery',
    description:
      'Deliver contract documents from District 3 to District 1 before 4 PM today.',
    category: 'DELIVERY',
    budget: 180000,
    location: 'District 3, Ho Chi Minh City',
    dueDate: '2026-03-15T09:00:00.000Z',
  },
  {
    title: 'Fix laptop overheating issue',
    description:
      'Laptop gets hot quickly and shuts down when rendering videos. Need hardware check and cleanup.',
    category: 'IT_SUPPORT',
    budget: 600000,
    location: 'Phu Nhuan, Ho Chi Minh City',
    dueDate: '2026-03-26T17:00:00.000Z',
  },
  {
    title: 'Move furniture between apartments',
    description:
      'Need help moving furniture and 12 boxes from District 7 to Thu Duc this weekend.',
    category: 'MOVING',
    budget: 1200000,
    location: 'District 7, Ho Chi Minh City',
    dueDate: '2026-03-24T17:00:00.000Z',
  },
];

const providerFeedbackComments = {
  5: [
    'Very professional and on time.',
    'Excellent quality, would hire again.',
    'Great communication throughout the task.',
    'Handled the work smoothly and carefully.',
  ],
  4: [
    'Good work and easy to coordinate.',
    'Reliable overall, minor delays only.',
    'Solid quality and polite communication.',
    'Met expectations for this task.',
  ],
  3: [
    'Work was okay but a bit slow.',
    'Task completed, but communication could improve.',
    'Acceptable result with some follow-up needed.',
  ],
};

const requesterFeedbackComments = {
  5: [
    'Clear instructions and easy to work with.',
    'Friendly requester and prompt confirmation.',
    'Well organized, smooth workflow.',
    'Very respectful and responsive.',
  ],
  4: [
    'Good requester, requirements were mostly clear.',
    'Cooperative and polite during the task.',
    'Payment and communication were fine.',
    'Generally good experience.',
  ],
  3: [
    'Requester was okay, but requirements changed a few times.',
    'Need clearer scope next time.',
    'Task was manageable but coordination was average.',
  ],
};

function clampRating(value) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function pickComment(poolByScore, score, index) {
  const pool = poolByScore[score] || poolByScore[4];
  return pool[index % pool.length];
}

async function upsertUser(seed, passwordHash) {
  return prisma.user.upsert({
    where: { email: seed.email },
    update: {
      name: seed.name,
      passwordHash,
      role: seed.role,
      phone: seed.phone,
      skills: seed.skills,
      bio: seed.bio || null,
      availability: seed.availability || null,
      profilePhotoUrl: seed.profilePhotoUrl || null,
    },
    create: {
      name: seed.name,
      email: seed.email,
      passwordHash,
      role: seed.role,
      phone: seed.phone,
      skills: seed.skills,
      bio: seed.bio || null,
      availability: seed.availability || null,
      profilePhotoUrl: seed.profilePhotoUrl || null,
    },
  });
}

async function resetTaskData() {
  // Remove dependent records first to satisfy FK constraints.
  await prisma.paymentTransaction.deleteMany();
  await prisma.savedTask.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.taskActivityLog.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.taskProgressUpdate.deleteMany();
  await prisma.bid.deleteMany();
  await prisma.rating.deleteMany();
  await prisma.review.deleteMany();
  await prisma.trackingLog.deleteMany();
  await prisma.aiInsight.deleteMany();
  await prisma.task.deleteMany();
}

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  await resetTaskData();

  const requesters = [];
  for (const requesterSeed of requesterSeeds) {
    const requester = await upsertUser(requesterSeed, passwordHash);
    requesters.push(requester);
  }

  const providers = [];
  for (const providerSeed of providerSeeds) {
    const provider = await upsertUser(providerSeed, passwordHash);
    providers.push(provider);
  }

  const tasks = [];
  for (let index = 0; index < taskTemplates.length; index += 1) {
    const risk = evaluateTaskRisk({
      category: taskTemplates[index].category,
      budget: taskTemplates[index].budget,
    });
    const task = await prisma.task.create({
      data: {
        title: taskTemplates[index].title,
        description: taskTemplates[index].description,
        category: taskTemplates[index].category,
        budget: taskTemplates[index].budget,
        isSuspicious: risk.isSuspicious,
        suspiciousReason: risk.suspiciousReason,
        riskLevel: risk.riskLevel,
        location: taskTemplates[index].location,
        dueDate: new Date(taskTemplates[index].dueDate),
        createdById: requesters[index % requesters.length].id,
        status: 'OPEN',
        imageUrls: [],
      },
    });
    tasks.push(task);
  }

  const requester5 = requesters.find((user) => user.email === 'requester5@gmail.com');
  let suspiciousDemoTask = null;
  if (requester5) {
    const suspiciousTemplate = {
      title: 'Full apartment deep cleaning',
      description:
        'Need full cleaning for a 2-bedroom apartment, kitchen and bathroom included.',
      category: 'CLEANING',
      budget: 50000,
      location: 'District 2, Ho Chi Minh City',
      dueDate: '2026-03-29T17:00:00.000Z',
    };
    const risk = evaluateTaskRisk(suspiciousTemplate);
    suspiciousDemoTask = await prisma.task.create({
      data: {
        ...suspiciousTemplate,
        dueDate: new Date(suspiciousTemplate.dueDate),
        createdById: requester5.id,
        status: 'OPEN',
        imageUrls: [],
        isSuspicious: risk.isSuspicious,
        suspiciousReason: risk.suspiciousReason,
        riskLevel: risk.riskLevel,
      },
    });
    tasks.push(suspiciousDemoTask);
  }

  const requester4 = requesters.find((user) => user.email === 'requester4@gmail.com');
  const provider4 = providers.find((user) => user.email === 'provider4@gmail.com');
  let requester4PaymentDemoTask = null;

  if (requester4 && provider4) {
    const paymentDemoTemplate = {
      title: 'Office network troubleshooting (payment demo)',
      description:
        'Need provider to stabilize office Wi-Fi and resolve router disconnects for 8 employees.',
      category: 'IT_SUPPORT',
      budget: 900000,
      location: 'District 1, Ho Chi Minh City',
      dueDate: '2026-03-31T17:00:00.000Z',
    };
    const risk = evaluateTaskRisk(paymentDemoTemplate);

    requester4PaymentDemoTask = await prisma.task.create({
      data: {
        ...paymentDemoTemplate,
        dueDate: new Date(paymentDemoTemplate.dueDate),
        createdById: requester4.id,
        assignedProviderId: provider4.id,
        status: 'AWAITING_PAYMENT',
        imageUrls: [],
        isSuspicious: risk.isSuspicious,
        suspiciousReason: risk.suspiciousReason,
        riskLevel: risk.riskLevel,
        escrowStatus: 'NONE',
        paymentStatus: 'UNPAID',
      },
    });

    tasks.push(requester4PaymentDemoTask);

    await prisma.bid.create({
      data: {
        taskId: requester4PaymentDemoTask.id,
        providerId: provider4.id,
        price: 850000,
        message: 'Can resolve office network stability in one visit.',
        estimatedCompletionTime: '4 hours',
        status: 'ACCEPTED',
      },
    });

    await prisma.taskActivityLog.createMany({
      data: [
        {
          taskId: requester4PaymentDemoTask.id,
          actorId: requester4.id,
          action: 'PROVIDER_ASSIGNED',
          message: 'Requester selected provider4 from bids.',
        },
        {
          taskId: requester4PaymentDemoTask.id,
          actorId: provider4.id,
          action: 'PROGRESS_MARKED_COMPLETED',
          message: 'Provider completed work and task moved to awaiting payment.',
        },
      ],
    });
  }

  // Task 2 -> has multiple bids, status BIDDING.
  await prisma.bid.create({
    data: {
      taskId: tasks[1].id,
      providerId: providers[0].id,
      price: 650000,
      message: 'I can handle weekly deep cleaning with eco-friendly products.',
      estimatedCompletionTime: '3 hours',
      status: 'PENDING',
    },
  });
  await prisma.bid.create({
    data: {
      taskId: tasks[1].id,
      providerId: providers[1].id,
      price: 620000,
      message: 'Experienced apartment cleaner, available every Saturday.',
      estimatedCompletionTime: '2.5 hours',
      status: 'PENDING',
    },
  });
  await prisma.task.update({
    where: { id: tasks[1].id },
    data: { status: 'BIDDING' },
  });

  // Task 3 -> provider selected, status ASSIGNED.
  const acceptedBidTask3 = await prisma.bid.create({
    data: {
      taskId: tasks[2].id,
      providerId: providers[2].id,
      price: 175000,
      message: 'Can deliver in under 90 minutes.',
      estimatedCompletionTime: '90 minutes',
      status: 'ACCEPTED',
    },
  });
  await prisma.bid.create({
    data: {
      taskId: tasks[2].id,
      providerId: providers[0].id,
      price: 200000,
      message: 'Delivery support with tracking updates.',
      estimatedCompletionTime: '2 hours',
      status: 'REJECTED',
    },
  });
  await prisma.task.update({
    where: { id: tasks[2].id },
    data: {
      status: 'ASSIGNED',
      assignedProviderId: acceptedBidTask3.providerId,
      escrowStatus: 'PENDING_DEPOSIT',
      paymentStatus: 'ESCROW_PENDING',
      escrowAmount: tasks[2].budget,
    },
  });

  // Task 4 -> in progress.
  const acceptedBidTask4 = await prisma.bid.create({
    data: {
      taskId: tasks[3].id,
      providerId: providers[3].id,
      price: 580000,
      message: 'I can do thermal cleanup and fan servicing.',
      estimatedCompletionTime: '1 day',
      status: 'ACCEPTED',
    },
  });
  await prisma.task.update({
    where: { id: tasks[3].id },
    data: {
      status: 'IN_PROGRESS',
      assignedProviderId: acceptedBidTask4.providerId,
      escrowStatus: 'HELD',
      paymentStatus: 'ESCROW_HELD',
      escrowAmount: tasks[3].budget,
      escrowHeldAt: new Date('2026-03-16T06:00:00.000Z'),
    },
  });

  // Progress updates for in-progress task.
  // Use deterministic timestamps so timeline order is stable in demos.
  await prisma.taskProgressUpdate.create({
    data: {
      taskId: tasks[3].id,
      providerId: acceptedBidTask4.providerId,
      progressPercent: 35,
      note: 'Completed diagnostics and fan cleaning. Replacing thermal paste next.',
      milestoneStatus: 'Diagnostics completed',
      createdAt: new Date('2026-03-16T08:00:00.000Z'),
    },
  });
  await prisma.taskProgressUpdate.create({
    data: {
      taskId: tasks[3].id,
      providerId: acceptedBidTask4.providerId,
      progressPercent: 70,
      note: 'Thermal module serviced and stress test started.',
      milestoneStatus: 'Hardware service in progress',
      createdAt: new Date('2026-03-16T12:00:00.000Z'),
    },
  });

  // Task 5 -> pending requester confirmation (provider marked work done).
  const acceptedBidTask5 = await prisma.bid.create({
    data: {
      taskId: tasks[4].id,
      providerId: providers[4].id,
      price: 1150000,
      message: 'Full moving service with 2 helpers and truck.',
      estimatedCompletionTime: '4 hours',
      status: 'ACCEPTED',
    },
  });
  await prisma.task.update({
    where: { id: tasks[4].id },
    data: {
      status: 'PENDING_CONFIRMATION',
      assignedProviderId: acceptedBidTask5.providerId,
      escrowStatus: 'HELD',
      paymentStatus: 'ESCROW_HELD',
      escrowAmount: tasks[4].budget,
      escrowHeldAt: new Date('2026-03-15T09:00:00.000Z'),
    },
  });

  await prisma.taskProgressUpdate.create({
    data: {
      taskId: tasks[4].id,
      providerId: acceptedBidTask5.providerId,
      progressPercent: 100,
      note: 'Move completed. All items delivered and arranged at destination.',
      milestoneStatus: 'Final delivery completed',
    },
  });

  await prisma.paymentTransaction.createMany({
    data: [
      {
        taskId: tasks[3].id,
        payerId: tasks[3].createdById,
        providerId: acceptedBidTask4.providerId,
        amount: tasks[3].budget,
        method: 'STRIPE',
        type: 'ESCROW_DEPOSIT',
        escrowStatus: 'HELD',
        status: 'SUCCESS',
        paidAt: new Date('2026-03-16T06:00:00.000Z'),
        providerTransactionId: 'pi_demo_task4',
        note: 'Escrow funded in sandbox',
      },
      {
        taskId: tasks[4].id,
        payerId: tasks[4].createdById,
        providerId: acceptedBidTask5.providerId,
        amount: tasks[4].budget,
        method: 'STRIPE',
        type: 'ESCROW_DEPOSIT',
        escrowStatus: 'HELD',
        status: 'SUCCESS',
        paidAt: new Date('2026-03-15T09:00:00.000Z'),
        providerTransactionId: 'pi_demo_task5',
        note: 'Escrow funded in sandbox',
      },
    ],
  });

  await prisma.savedTask.createMany({
    data: [
      { userId: providers[0].id, taskId: tasks[0].id },
      { userId: providers[0].id, taskId: tasks[1].id },
      { userId: providers[1].id, taskId: tasks[2].id },
    ],
    skipDuplicates: true,
  });

  await prisma.notification.create({
    data: {
      recipientId: requesters[0].id,
      senderId: providers[1].id,
      taskId: tasks[1].id,
      message: `A provider wants to contact you regarding your task "${tasks[1].title}". Provider: ${providers[1].name}.`,
    },
  });

  await prisma.taskActivityLog.createMany({
    data: [
      {
        taskId: tasks[2].id,
        actorId: tasks[2].createdById,
        action: 'PROVIDER_ASSIGNED',
        message: 'Requester selected a provider and escrow is pending.',
      },
      {
        taskId: tasks[3].id,
        actorId: tasks[3].createdById,
        action: 'ESCROW_DEPOSIT_CONFIRMED',
        message: 'Escrow funded and provider started work.',
      },
      {
        taskId: tasks[3].id,
        actorId: acceptedBidTask4.providerId,
        action: 'PROGRESS_UPDATED',
        message: 'Provider posted progress milestones.',
      },
      {
        taskId: tasks[4].id,
        actorId: acceptedBidTask5.providerId,
        action: 'PROGRESS_MARKED_COMPLETED',
        message: 'Provider completed task and requested confirmation.',
      },
    ],
  });

  // Create realistic completed tasks and two-way ratings for demo.
  const providerRatingPatterns = {
    'provider1@gmail.com': [5, 5, 5, 4, 5],
    'provider2@gmail.com': [4, 4, 5, 4, 4],
    'provider3@gmail.com': [5, 4, 5, 4, 5],
    'provider4@gmail.com': [4, 4, 5, 4, 5],
    'provider5@gmail.com': [5, 5, 4, 5, 5],
  };
  const requesterRatingPatterns = {
    'requester1@gmail.com': [5, 4, 5, 5, 4],
    'requester2@gmail.com': [4, 4, 4, 5, 4],
    'requester3@gmail.com': [5, 5, 5, 4, 5],
    'requester4@gmail.com': [4, 5, 4, 5, 4],
    'requester5@gmail.com': [5, 5, 4, 5, 5],
  };
  const receivedProviderReviewCount = {};
  const receivedRequesterReviewCount = {};

  const completedRatingTasks = [];
  for (let index = 0; index < 25; index += 1) {
    const requester = requesters[index % requesters.length];
    const provider = providers[(index * 2 + 1) % providers.length];
    const dueDate = new Date(`2026-02-${String((index % 26) + 1).padStart(2, '0')}T10:00:00.000Z`);

    const completedTask = await prisma.task.create({
      data: {
        title: `Completed demo task #${index + 1}`,
        description: 'Completed task for rating and feedback demo data.',
        category: taskTemplates[index % taskTemplates.length].category,
        budget: 300000 + (index % 6) * 120000,
        location: taskTemplates[index % taskTemplates.length].location,
        dueDate,
        createdById: requester.id,
        assignedProviderId: provider.id,
        status: 'PAID',
        escrowStatus: 'RELEASED',
        paymentStatus: 'RELEASED',
        escrowAmount: 300000 + (index % 6) * 120000,
        escrowHeldAt: new Date(dueDate.getTime() - 1000 * 60 * 60 * 3),
        escrowReleasedAt: new Date(dueDate.getTime() + 1000 * 60 * 60),
        imageUrls: [],
      },
      select: {
        id: true,
        createdById: true,
        assignedProviderId: true,
      },
    });
    completedRatingTasks.push({ ...completedTask, index });
  }

  for (const item of completedRatingTasks) {
    const requester = requesters.find((u) => u.id === item.createdById);
    const provider = providers.find((u) => u.id === item.assignedProviderId);
    if (!requester || !provider) continue;

    const providerReviewIndex = receivedProviderReviewCount[provider.email] || 0;
    const requesterReviewIndex = receivedRequesterReviewCount[requester.email] || 0;
    const providerPattern = providerRatingPatterns[provider.email] || [4, 4, 5, 4, 4];
    const requesterPattern = requesterRatingPatterns[requester.email] || [4, 4, 5, 4, 4];

    const providerScore = clampRating(providerPattern[providerReviewIndex % providerPattern.length]);
    const requesterScore = clampRating(requesterPattern[requesterReviewIndex % requesterPattern.length]);

    receivedProviderReviewCount[provider.email] = providerReviewIndex + 1;
    receivedRequesterReviewCount[requester.email] = requesterReviewIndex + 1;

    await prisma.rating.createMany({
      data: [
        {
          taskId: item.id,
          fromUserId: item.createdById,
          toUserId: item.assignedProviderId,
          rating: providerScore,
          comment: pickComment(providerFeedbackComments, providerScore, item.index),
          createdAt: new Date(Date.UTC(2026, 1, (item.index % 25) + 1, 10, 0, 0)),
        },
        {
          taskId: item.id,
          fromUserId: item.assignedProviderId,
          toUserId: item.createdById,
          rating: requesterScore,
          comment: pickComment(requesterFeedbackComments, requesterScore, item.index),
          createdAt: new Date(Date.UTC(2026, 1, (item.index % 25) + 1, 12, 0, 0)),
        },
      ],
      skipDuplicates: true,
    });
  }

  // Keep existing user.rating field in sync for UI compatibility.
  for (const user of [...requesters, ...providers]) {
    const stats = await prisma.rating.aggregate({
      where: { toUserId: user.id },
      _avg: { rating: true },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        rating: Number((stats._avg.rating || 0).toFixed(2)),
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log('\n=== Seed completed successfully ===');
  // eslint-disable-next-line no-console
  console.log(`Tasks created: ${tasks.length}`);

  // eslint-disable-next-line no-console
  console.log('\nRequester test accounts (password: 123456):');
  requesters.forEach((requester) => {
    // eslint-disable-next-line no-console
    console.log(`- ${requester.email} / ${DEFAULT_PASSWORD}`);
  });

  // eslint-disable-next-line no-console
  console.log('\nProvider test accounts (password: 123456):');
  providerSeeds.forEach((provider) => {
    // eslint-disable-next-line no-console
    console.log(`- ${provider.email} / ${DEFAULT_PASSWORD}`);
  });

  if (suspiciousDemoTask) {
    // eslint-disable-next-line no-console
    console.log('\nSuspicious demo task:');
    // eslint-disable-next-line no-console
    console.log(`- Owner: requester5@gmail.com`);
    // eslint-disable-next-line no-console
    console.log(`- Task ID: ${suspiciousDemoTask.id}`);
    // eslint-disable-next-line no-console
    console.log(`- Title: ${suspiciousDemoTask.title}`);
    // eslint-disable-next-line no-console
    console.log(`- Budget: ${suspiciousDemoTask.budget.toLocaleString('en-US')} VND`);
    // eslint-disable-next-line no-console
    console.log(`- Flagged: ${suspiciousDemoTask.isSuspicious ? 'YES' : 'NO'} (${suspiciousDemoTask.riskLevel || 'N/A'})`);
  }

  if (requester4PaymentDemoTask) {
    // eslint-disable-next-line no-console
    console.log('\nRequester4 payment demo task:');
    // eslint-disable-next-line no-console
    console.log(`- Owner: requester4@gmail.com`);
    // eslint-disable-next-line no-console
    console.log(`- Assigned provider: provider4@gmail.com`);
    // eslint-disable-next-line no-console
    console.log(`- Task ID: ${requester4PaymentDemoTask.id}`);
    // eslint-disable-next-line no-console
    console.log(`- Status: ${requester4PaymentDemoTask.status}`);
  }
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
