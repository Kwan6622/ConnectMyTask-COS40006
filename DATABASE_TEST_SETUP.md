# ConnectMyTask Database Test Setup

## Isolated database

- Neon project: `polished-night-84339447`
- Region: Singapore (`aws-ap-southeast-1`)
- Parent: production branch `br-cold-star-b3afdc3z` (read only during setup)
- Test branch: `e2e-test-20261020` (`br-lucky-heart-b3zzinct`)
- Test database: `connectmytask_test` (created empty inside the test branch)
- Automatic expiry: 2026-11-18 23:59 UTC
- Local application endpoint: `http://localhost:4000`
- Local Web endpoint: `http://localhost:5173`
- Mobile API endpoint: `http://192.168.1.214:4000/api` for the current LAN run; Metro is `exp://192.168.1.214:8081`. No database credentials are present in Mobile/Web.

The production URL was preserved in gitignored `.env.production.local` and `database/.env.production.local`; both have mode `600`. Active local `.env` files point to the test database and also have mode `600`. Connection strings and secrets are intentionally omitted.

The final read-only production snapshot remains 11 users and 0 tasks, with no `admin.test@gmail.com`; this setup performed no production write. That pre-existing 0-task state predates this isolated test setup and was not repaired here.

## Schema and migrations

- `SELECT 1`: PASS
- Prisma schema validation: PASS
- Applied migrations: 15/15
- Migration status: up to date
- Schema drift after reconciliation: empty diff
- Required support/GPS tables and bid/GPS/support indexes: present
- Production migrations/reset/seed: not run
- Final production verification used a read-only transaction; `admin.test@gmail.com` is absent and no test tasks were created there

The Prisma model was aligned with already-existing migration history for task urgency/risk, legacy on-site columns, delete actions, bidding index and unique task/provider bids. No migration record was fabricated.

## Seed result

- Users: 21 (10 REQUESTER, 10 PROVIDER, 1 ADMIN)
- Provider profiles: 10
- Demo tasks/bids: 5/5
- Stripe payment rows: 1 pending test Checkout; no successful payment or real charge
- Support tickets/messages: 1/1 from API smoke testing
- GPS verifications: 0 (funding prerequisite deliberately not bypassed)
- Idempotent seed rerun: PASS; all records reported `EXISTS`
- Outbound email: no outbound email transport is implemented or invoked by the seed

## Verification results

- Login: 21/21 PASS
- Admin stats/users: 200; requester access to Admin API: 403
- Public task list and provider bids: 200
- Assignment: PASS for payment and GPS demo tasks
- Unfunded provider progress: rejected
- Stripe test Checkout: created; duplicate request reused the same pending transaction
- Unauthorized provider payment: 403
- GPS: unfunded assigned provider 409; wrong provider 403
- Customer Support: create/list/admin reply PASS
- Backend focused tests: 23 passed, 0 failed
- Web production build: PASS
- Mobile TypeScript: PASS
- Mobile focused tests: 3 passed, 0 failed

## Known limits / remaining work

- Stripe Checkout is pending manual test-card completion while the local Stripe listener is running; webhook-confirmed `HELD`, release and refund were not claimed as live E2E results.
- Real database GPS verification cannot proceed until that task has webhook-confirmed funded escrow. Inside/outside 1 km, stale, replay, expiry and authorization cases passed isolated focused tests only.
- `npx expo install --check` reports six Expo SDK 57 patch-level packages behind the preferred versions. Dependencies were not upgraded automatically.
- The Neon test branch expires automatically; recreate the branch/database and rerun migrations/seed after expiry.
