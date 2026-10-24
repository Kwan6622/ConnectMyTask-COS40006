const path = require('path');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const EXPECTED_DATABASE = 'connectmytask_test';
const EXPECTED_PROJECT_ID = 'polished-night-84339447';
const EXPECTED_BRANCH_ID = 'br-lucky-heart-b3zzinct';
const EXPECTED_BRANCH_NAME = 'e2e-test-20261020';
const EXPECTED_NEON_REGION = '.ap-southeast-1.aws.neon.tech';
const TEST_ACCOUNTS = [
  ...Array.from({ length: 10 }, (_, index) => ({
    email: `requester${index + 1}@gmail.com`,
    role: 'REQUESTER',
  })),
  ...Array.from({ length: 10 }, (_, index) => ({
    email: `provider${index + 1}@gmail.com`,
    role: 'PROVIDER',
  })),
  { email: 'admin.test@gmail.com', role: 'ADMIN' },
];

function getTestDatabaseUrl() {
  if (process.env.ALLOW_TEST_ACCOUNT_PASSWORD_RESET !== 'true') {
    throw new Error('Set ALLOW_TEST_ACCOUNT_PASSWORD_RESET=true to continue');
  }
  if (process.env.NEON_BRANCH !== EXPECTED_BRANCH_NAME) {
    throw new Error(`NEON_BRANCH must be ${EXPECTED_BRANCH_NAME}`);
  }

  const connectionString = process.env.NEON_TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error('NEON_TEST_DATABASE_URL is required; DATABASE_URL is not used');
  }

  const parsed = new URL(connectionString);
  if (
    parsed.pathname.slice(1) !== EXPECTED_DATABASE ||
    !parsed.hostname.endsWith(EXPECTED_NEON_REGION)
  ) {
    throw new Error('Refusing to connect: URL is not the configured Neon Singapore test database');
  }

  return connectionString;
}

async function main() {
  const password = process.env.TEST_ACCOUNT_PASSWORD;
  if (!password || password.length < 6) {
    throw new Error('TEST_ACCOUNT_PASSWORD must contain at least 6 characters');
  }

  const connectionString = getTestDatabaseUrl();
  const prisma = new PrismaClient({ datasources: { db: { url: connectionString } } });

  try {
    const [database] = await prisma.$queryRaw`
      SELECT
        current_database() AS name,
        current_setting('neon.project_id', true) AS project_id,
        current_setting('neon.branch_id', true) AS branch_id
    `;
    if (
      database.name !== EXPECTED_DATABASE ||
      database.project_id !== EXPECTED_PROJECT_ID ||
      database.branch_id !== EXPECTED_BRANCH_ID
    ) {
      throw new Error('Connected database does not match the isolated Neon TEST branch');
    }

    const accounts = await prisma.user.findMany({
      where: { email: { in: TEST_ACCOUNTS.map(({ email }) => email) } },
      select: { id: true, email: true, role: true },
    });
    if (accounts.length !== TEST_ACCOUNTS.length) {
      throw new Error('Expected demo accounts are missing; no passwords were changed');
    }

    const expectedRoles = new Map(TEST_ACCOUNTS.map(({ email, role }) => [email, role]));
    if (accounts.some(({ email, role }) => expectedRoles.get(email) !== role)) {
      throw new Error('A demo account has an unexpected role; no passwords were changed');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.$transaction(
      accounts.map(({ id }) =>
        prisma.user.update({ where: { id }, data: { passwordHash } }),
      ),
    );
    console.log(`Updated passwords for ${accounts.length} demo accounts on the isolated TEST branch.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  let message = error.message;
  for (const secret of [process.env.TEST_ACCOUNT_PASSWORD, process.env.NEON_TEST_DATABASE_URL]) {
    if (secret) message = message.replaceAll(secret, '[REDACTED]');
  }
  console.error(`Test account password reset failed: ${message}`);
  process.exitCode = 1;
});
