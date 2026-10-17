# Customer Support & Complaint Management Progress

## Completed features
- Audited backend, Prisma, auth, web, mobile, task/payment/dispute, notifications and upload paths. Existing task disputes are separate from general support.
- Added authenticated ticket creation, own/admin ticket lists, search, filters, pagination, ticket detail, paginated conversation/activity, replies, admin status and priority updates.
- Added ownership checks to all ticket-specific reads and writes, validated related task/payment ownership, restricted admin updates, validated inputs/evidence URLs, and guarded reply/close races.
- Added activity timestamps and existing notification delivery for new tickets/replies and requester notification for staff replies/status changes.
- Added responsive web and mobile support screens, navigation, evidence image upload through existing Cloudinary helpers, loading/empty/success/error states.

## Changed files
- `database/prisma/schema.prisma`
- `database/prisma/migrations/20261017000000_customer_support/migration.sql`
- `src/app.js`; `src/modules/support/routes.js`; `src/modules/support/routes.test.js`
- `frontend-web/src/App.tsx`; `frontend-web/src/components/layout/Header.tsx`; `frontend-web/src/services/api.ts`; `frontend-web/src/pages/SupportPage.tsx`
- `frontend-mobile/src/components/MarketplaceHeader.tsx`; `frontend-mobile/src/services/api.ts`; `frontend-mobile/src/app/support.tsx`

## Test results
- Prisma schema validation and client generation: passed, no database connection or migration.
- Web TypeScript and production build: passed.
- Mobile TypeScript typecheck: passed.
- New web support page and mobile support screen/header ESLint: passed.
- Backend syntax check and mock-only HTTP API test: passed. Covers creation, owner/admin listing, IDOR, unauthorized status update, linked payment rejection, evidence URL rejection, replies, activity and closed-ticket conflict.
- Existing web Header/API files still have pre-existing `no-explicit-any` lint errors; no new support-file lint errors.
- No live database writes or end-to-end database test performed.

## Known issues and required database setup
- **Support is not operational against existing Neon until the new migration is reviewed and applied by an authorized operator.** The migration is prepared but was not run. Do not use a production migration command without approval.
- Existing Cloudinary environment configuration is required to upload evidence; ticket creation/replies without evidence do not require it.
- Notification records appear in the existing notification UI, but support ticket deep links are not part of the current notification model.
- Live end-to-end creation, replies and status transitions remain unverified because production Neon writes are prohibited and no isolated migrated test database was provided.

## Runtime investigation (2026-10-17)
- Reproduced authenticated `GET /api/support/tickets` returning 500. Backend log showed Prisma validation failure: pagination `skip` was undefined because Express 5 does not replace its `req.query` getter with parsed Zod defaults.
- Fixed support list, messages and activity handlers to use parsed query values directly. Authenticated read now returns 503 `SupportSetupPending`, correctly identifying the unapplied schema rather than a generic 500.
- A read-only `SELECT 1` succeeded on current Neon. Read-only metadata queries confirmed all three support tables and the customer-support migration record are absent; the existing `USERS`, `TASKS` and `PAYMENT_TRANSACTIONS` integer `id` columns match the migration's foreign keys.
- Reviewed migration SQL: it only creates three new tables and indexes, with no drops, alters, deletes, updates or backfills. It has not been applied.
- Migration-history audit found five migrations recorded on Neon but absent from this checkout (initial schema, 2026-09 schema alignment, admin users, unique bids and urgency/risk). Reconcile that history before choosing a migration deployment method; no migration command was run.
- Web and mobile ticket lists now show API errors without falsely showing “No tickets found”.
- Safe verification after the fix: authenticated support list returned 503 `SupportSetupPending`; backend health, public tasks and web URL returned 200; mock-only support API test, web build/lint and mobile typecheck/lint passed. No live writes or migration were performed.

## Migration preparation (awaiting approval)
- Recovered the five missing migration SQL files from another local Project B checkout; each SHA-256 exactly matches its applied Neon `_prisma_migrations` checksum. All 13 applied migrations now have matching local files. No migration record was inserted or edited.
- Read-only `prisma migrate status` reports exactly one pending migration: `20261017000000_customer_support`.
- Reviewed and refined that migration to use Prisma's expected column nullability and foreign-key actions. It only creates three new support tables, indexes, and constraints on those new tables. No existing table or row is changed.
- Read-only Neon checks: `SELECT 1` succeeded; support tables and colliding objects are absent; referenced `USERS`, `TASKS`, and `PAYMENT_TRANSACTIONS` IDs are all integer.
- Pending approval plan: apply only `20261017000000_customer_support` with `prisma migrate deploy` after rechecking status/checksum, regenerate Prisma Client if needed, restart backend, then verify authenticated ticket workflows and Web/Mobile against real data. No migration or ticket write has been run yet.
