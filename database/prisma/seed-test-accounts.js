const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const prisma = new PrismaClient();
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CREDENTIALS_PATH = path.join(PROJECT_ROOT, '.test-credentials.local.json');
const EXPECTED_DATABASE = 'connectmytask_test';
const TEST_BRANCH_PATTERN = /^e2e-test-/;

const groups = [
  { number: 1, label: 'Payment / Escrow', requester: 1, provider: 1, category: 'HOME_REPAIR', district: 'District 1', budget: 650000 },
  { number: 2, label: 'GPS Verification', requester: 3, provider: 3, category: 'DELIVERY', district: 'District 3', budget: 180000 },
  { number: 3, label: 'Customer Support', requester: 5, provider: 5, category: 'IT_SUPPORT', district: 'District 5', budget: 450000 },
  { number: 4, label: 'Task Completion / Disputes', requester: 7, provider: 7, category: 'CLEANING', district: 'District 7', budget: 500000 },
  { number: 5, label: 'Profile / Privacy / Admin', requester: 9, provider: 9, category: 'MOVING', district: 'District 9', budget: 900000 },
];

function assertTestDatabase() {
  if (process.env.ALLOW_TEST_DATABASE_SEED !== 'true') {
    throw new Error('Refusing to seed: ALLOW_TEST_DATABASE_SEED=true is required');
  }
  if (!TEST_BRANCH_PATTERN.test(process.env.NEON_BRANCH || '')) {
    throw new Error('Refusing to seed: NEON_BRANCH must identify an e2e test branch');
  }
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Refusing to seed: database URL is missing');
  const parsed = new URL(connectionString);
  if (parsed.pathname.slice(1) !== EXPECTED_DATABASE) {
    throw new Error(`Refusing to seed: expected database ${EXPECTED_DATABASE}`);
  }
  if (!parsed.hostname.endsWith('.ap-southeast-1.aws.neon.tech')) {
    throw new Error('Refusing to seed: expected Neon Singapore endpoint');
  }
}

function generatePassword() {
  return `${crypto.randomBytes(18).toString('base64url')}aA1!`;
}

function loadCredentials(accountEmails) {
  let document = { database: EXPECTED_DATABASE, branch: process.env.NEON_BRANCH, accounts: {} };
  if (fs.existsSync(CREDENTIALS_PATH)) {
    document = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    if (document.database !== EXPECTED_DATABASE || document.branch !== process.env.NEON_BRANCH) {
      throw new Error('Existing credential file belongs to a different test database or branch');
    }
  }
  document.accounts ||= {};
  for (const email of accountEmails) {
    if (!document.accounts[email]) document.accounts[email] = generatePassword();
  }
  fs.writeFileSync(CREDENTIALS_PATH, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(CREDENTIALS_PATH, 0o600);
  return document.accounts;
}

function accountSeeds() {
  const requesters = Array.from({ length: 10 }, (_, index) => ({
    name: `Demo Requester ${index + 1}`,
    email: `requester${index + 1}@gmail.com`,
    role: 'REQUESTER',
    phone: `09010000${String(index + 1).padStart(2, '0')}`,
    bio: `ConnectMyTask requester test account ${index + 1}.`,
  }));
  const providers = Array.from({ length: 10 }, (_, index) => ({
    name: `Demo Provider ${index + 1}`,
    email: `provider${index + 1}@gmail.com`,
    role: 'PROVIDER',
    phone: `09020000${String(index + 1).padStart(2, '0')}`,
    skills: groups[index % groups.length].category,
    bio: `ConnectMyTask provider test account ${index + 1}.`,
  }));
  const admin = { name: 'Demo Administrator', email: 'admin.test@gmail.com', role: 'ADMIN', bio: 'Local E2E test administrator.' };
  return { requesters, providers, admin, all: [...requesters, ...providers, admin] };
}

async function ensureUser(seed, password) {
  const existing = await prisma.user.findUnique({ where: { email: seed.email } });
  if (existing) {
    if (existing.role !== seed.role) throw new Error(`Existing account has unexpected role: ${seed.email}`);
    const passwordMatches = await bcrypt.compare(password, existing.passwordHash);
    if (!passwordMatches) throw new Error(`Existing account is not managed by this test seed: ${seed.email}`);
    return { user: existing, status: 'EXISTS' };
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      name: seed.name,
      email: seed.email,
      passwordHash,
      role: seed.role,
      phone: seed.phone || null,
      skills: seed.skills || null,
      bio: seed.bio || null,
      availability: seed.role === 'PROVIDER' ? 'Demo availability' : null,
      status: 'ACTIVE',
    },
  });
  return { user, status: 'CREATED' };
}

async function ensureProviderProfile(provider, index) {
  const existing = await prisma.providerProfile.findUnique({ where: { userId: provider.id } });
  if (existing) return 'EXISTS';
  await prisma.providerProfile.create({
    data: {
      userId: provider.id,
      address: `${100 + index} Demo Street`,
      district: `District ${(index % 10) + 1}`,
      city: 'Ho Chi Minh City',
      specialties: [groups[index % groups.length].category],
      safetyComplianceAgreed: true,
      shortBio: `Provider profile for E2E group ${(index % groups.length) + 1}.`,
    },
  });
  return 'CREATED';
}

async function ensureScenario(group, requester, provider) {
  const title = `[DEMO G${group.number}] ${group.label}`;
  let task = await prisma.task.findFirst({ where: { title, createdById: requester.id } });
  let taskStatus = 'EXISTS';
  if (!task) {
    const now = new Date();
    const biddingEndsAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dueDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    task = await prisma.task.create({
      data: {
        title,
        description: `Safe E2E fixture for ${group.label}. Complete payment and GPS steps through the application only.`,
        category: group.category,
        budget: group.budget,
        maxBids: 10,
        location: group.district,
        district: group.district,
        siteAddress: `${group.number} Test Site Street, ${group.district}, Ho Chi Minh City`,
        siteLatitude: 10.7769 + group.number * 0.001,
        siteLongitude: 106.7009 + group.number * 0.001,
        urgency: 'NORMAL',
        status: 'OPEN',
        biddingStartedAt: now,
        biddingEndsAt,
        dueDate,
        escrowStatus: 'NONE',
        paymentStatus: 'UNPAID',
        createdById: requester.id,
      },
    });
    taskStatus = 'CREATED';
  }
  const bid = await prisma.bid.findUnique({
    where: { taskId_providerId: { taskId: task.id, providerId: provider.id } },
  });
  let bidStatus = 'EXISTS';
  if (!bid) {
    await prisma.bid.create({
      data: {
        taskId: task.id,
        providerId: provider.id,
        price: Math.round(group.budget * 0.95),
        message: `Demo bid for ${group.label}.`,
        estimatedCompletionTime: '1-2 days',
        status: 'PENDING',
      },
    });
    bidStatus = 'CREATED';
  }
  return { group: group.number, taskId: task.id, taskStatus, bidStatus };
}

async function main() {
  assertTestDatabase();
  const seeds = accountSeeds();
  const credentials = loadCredentials(seeds.all.map((account) => account.email));
  const usersByEmail = new Map();
  const accountResults = [];
  for (const seed of seeds.all) {
    const result = await ensureUser(seed, credentials[seed.email]);
    usersByEmail.set(seed.email, result.user);
    accountResults.push({ email: seed.email, role: seed.role, status: result.status });
  }
  const profileResults = [];
  for (let index = 0; index < seeds.providers.length; index += 1) {
    const seed = seeds.providers[index];
    const status = await ensureProviderProfile(usersByEmail.get(seed.email), index);
    profileResults.push({ email: seed.email, status });
  }
  const scenarioResults = [];
  for (const group of groups) {
    scenarioResults.push(await ensureScenario(
      group,
      usersByEmail.get(`requester${group.requester}@gmail.com`),
      usersByEmail.get(`provider${group.provider}@gmail.com`),
    ));
  }
  console.log(JSON.stringify({
    database: EXPECTED_DATABASE,
    branch: process.env.NEON_BRANCH,
    accounts: accountResults,
    providerProfiles: profileResults,
    scenarios: scenarioResults,
    credentialsFile: path.basename(CREDENTIALS_PATH),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(`Test seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
