# ConnectMyTask implementation plan

Audit date: 2026-10-20. Requirements: `/Users/dbaoo/Documents/COS40006/GROUP_LEADER_REQUIREMENTS.md`, covering all three source sections. This is a plan, not an implementation or migration approval.

## Baseline and evidence limits

Inspected checkout: `/Users/dbaoo/Documents/COS40005/ConnectMyTask-4 - Copy`. Local HEAD `d1857b8`; cached `origin/main` `ecfc77c`. Many existing working-tree changes cover performance, support, AI and mobile dependencies. Findings below describe actual local implementation, not assurances from previous conversations. Reconcile the intended baseline before coding; preserve unrelated edits. No fetch, commit, push, application changes, seed, data copy or migrations in this audit.

Reviewed backend modules/routes/services/repositories relevant to every requirement; Web/Mobile routes, forms, stores and API clients; Admin, auth, sockets, Prisma schema/migrations and payment flow. Static inspection is not runtime UI/Stripe verification. No live payment, login, GPS or mutating API tests were run. Task GET/list services can auto-assign/mark overdue, so they were deliberately not called against the live DB.

## Singapore database: independently verified

- Existing runtime DATABASE_URL identifies a pooled `ap-southeast-1` Neon endpoint. Only this database was queried; no credentials or row contents recorded.
- Explicit read-only transaction: 20 public tables including `_prisma_migrations`; 14 completed migration records, all corresponding local files present and SHA-256 checksums matching. No incomplete migration records. This establishes recorded history, not absence of schema drift.
- Application data: USERS=2; TASKS=1 (OPEN/NONE); TASK_SUBTASKS=4; TASK_ACTIVITY_LOGS=1. Other application tables empty, including payments, bids, tracking, disputes, ratings and support. Existing data cannot demonstrate funded/assigned/location workflows.
- Confirmed schema drift: DB TASKS has `isOnSite`, `onSiteVerifiedAt`, `urgency`, `riskAssessment`; USERS has `status`, `createdAt`, `tokenVersion`; these are missing from local Prisma models. Existing on-site fields alone cannot express provider binding, expiry or revocation. Local Bid model also omits the unique pair declared by the duplicate-bid migration; verify its live index before changing schema.
- Do not rerun/edit completed migrations or infer that empty tables mean migration failed. Reconcile catalog, Prisma models and history before authoring additive changes. No data backfill from the US database is proposed.

## Requirement coverage and implementation map

Paths below are relative to this project root; API paths include `/api`.

| Requirement | Existing implementation / evidence | Missing or broken; implementation targets |
|---|---|---|
| Task address privacy: precise address input, format validation, district-only browsing, assigned-provider reveal | Task.location is a single public string. `tasks/validation.js:createTaskSchema` only checks nonempty. Web `pages/TaskPostPage.tsx` and mobile `app/post-task.tsx` submit location. Public GET `/tasks` and `/tasks/:id`; `tasks/repository.js:requesterSelect/providerSelect` also include email/phone/certificate URLs. | Separate district/public area from private site address and coordinates in Task; validate create/edit fields server-side; preserve existing display compatibility. Authenticated participant detail projection must reveal precise site only to task owner/assigned provider (admin exception needs policy). Never expose it through browse/saved/suggested responses, user relations, sockets, notifications or logs. Audit free-text titles/descriptions/images for accidental address disclosure; structured-field redaction cannot remove arbitrary user text. |
| User phone, detailed address, durable profile editing | User.phone already exists; ProviderProfile has address/district/city. PATCH `/users/me` only accepts profile photo. Provider-specific endpoint `/users/me/provider-profile` exists. Web `ProfilePage.tsx` save delays locally; `stores/auth.store.ts:updateProfile` simulates save; mobile `store/authStore.ts:updateProfile` updates local state. | Add validated whitelist update for intended User fields and private general address; extend existing `/users/me` without breaking photo/provider-profile flows. Both clients use returned server user. Test `/auth/me` and fresh login after reload. Public `users/repository.js:getUserById` returns full user, including hash/private profile: replace public projection before adding sensitive fields. |
| GPS: assigned provider travels, enters task address, verifies within approximately 1 km, then progress | `tracking/*`: POST `/tracking/update`, TrackingLog(lat,lng,timestamp,taskId,providerId). Mobile `app/task-tracking.tsx` renders task activity, not GPS. Web `pages/TrackingPage.tsx` fabricates coordinates/provider and expects taskId; `App.tsx` mounts `/tracking`. | No GPS distance/accuracy/freshness verification or task-site coordinates. Existing update endpoint is unauthenticated and trusts providerId. `tracking/controller.js` uses global `io.emit`; `shared/socket.js` has no participant authorization. Authenticate writes, derive provider from token, validate assignment/funding and coordinates; add participant-only latest/history APIs, real mobile foreground acquisition, task-scoped verify/status APIs. Entered address must resolve to requester-stored site, never override target coordinates. Fix route `/tracking/:taskId`, invalid-ID loading, remove mock data. |
| Mobile verification gates provider Web and direct API updates | `tasks/service.js` checks assigned provider on status/progress/subtasks. No active verification model/service, expiry policy, status endpoint or Web blocking screen. | Persist task/provider-scoped verification; enforce on PATCH `/tasks/:id/status`, POST `/tasks/:id/progress`, PATCH `/tasks/:id/subtasks/:subtaskId` and all alternate writes. Web shows exact “Please verify your location on the mobile app”, hides work controls, retains safe reads; focus/polling rechecks. Mobile verification UI must be the intended path; a client header/platform label alone cannot prove app provenance. |
| Web/Mobile behavior consistency | Separate clients/stores; shared backend routes. Progress controls mainly use role/assignment/task-state, not a shared funding/location eligibility result. Mobile Checkout opens external URL; payment service builds Web redirects; Web confirms session. | Return consistent eligibility/reason/verification expiry from task progress/detail; align both clients' create/edit/profile/progress/status mapping and errors. Add allowlisted mobile callback if required for funding from mobile; preserve Web callback and backend confirmation. Review Admin web `pages/Admin/Dashboard.tsx`, mobile `app/admin-dashboard.tsx` for status parity. |
| Assignment before escrow, escrow before execution | Assignment sets ASSIGNED + PENDING_DEPOSIT. Payment create/confirm/webhook exist in `payments/{routes,controller,service,repository}.js`. Provider normal progress and most status changes require HELD. Existing enums represent this flow. | `tasks/service.js:updateTaskSubtaskStatus` has no HELD guard. Provider status transitions allow backward jumps; requester generic status can set PAID; task edit validation `.passthrough()` plus payload spreading permits protected state-field changes. Close alternate write paths before trusting any gate. |
| Trusted deposit, duplicates, completion/release, cancel/refund/disputes | POST `/payments/create`, `/payments/confirm-session`, `/payments/webhook`; Stripe server session retrieval and signature verification; raw webhook body mounted in app. `confirmTaskCompletion` checks owner; disputes freeze escrow; Admin routes require ADMIN. | Concurrent deposits can create multiple sessions; confirmation/webhook writes are non-atomic. Webhook completion lacks explicit paid-status check. Replay/late events can restore HELD after cancellation/refund. Completion writes COMPLETED before release; retry then fails. Release checks existing row before insert without concurrency protection and records internal payout only. Refund catches Stripe failure but records REFUNDED. Add transactional state transitions, idempotency/reconciliation and failure/retry tests; do not claim ledger entry is a real provider transfer. |

Backend paths in table abbreviate `src/modules/…`; Web/Mobile paths abbreviate `frontend-web/src/…` and `frontend-mobile/src/…`.

## Conflicts and decisions before implementation

1. **Travel before verification vs blocking Start/Moving:** DEMO_1 says Start → travel → verify, whereas Provider Web requirements block Start/Moving until verification. Proposed precedence: funding first; navigation/travel is a read-only mobile action before verification; work Start/Working/progress is enabled only after verification. If MOVING must be a persisted pre-verification state, explicitly revise the all-progress gate requirement before implementation.
2. **FUNDED/AWAITING_DEPOSIT names:** reuse HELD as FUNDED and ASSIGNED + PENDING_DEPOSIT as awaiting deposit. Avoid duplicate enums. Retain PENDING_CONFIRMATION and PAID settlement semantics; display completion/release separately. Treat MOVING_TO_LOCATION/WORKING as agreed execution milestones rather than automatically replacing existing task states.
3. **Address format:** Singapore DB region does not establish task geography. Current task UI/data are Vietnam-oriented. Decide supported country/address/postcode format; do not apply a Singapore-only regex solely because hosting moved. Regex validates syntax, not real location; choose a trusted site-coordinate capture/geocoding method. Clarify whether provider-entered address is confirmation or an actual search input.
4. **Short-lived verification:** proposed configurable defaults, subject to product approval: distance <=1,000 m; accuracy <=100 m; capture age <=60 s with bounded clock skew; verification TTL 30 minutes. Require current assignment, active task and HELD at verification and each mutation. Expiry blocks subsequent work updates until reverified; revoke on reassignment, site edits, cancellation, dispute/freeze or refund. Snapshot expiry checks atomically with updates to avoid races. Longer jobs need an explicit re-verification UX.
5. **Mobile provenance/spoofing:** authenticated coordinates, timestamps and challenge replay protection reduce misuse but cannot prove an honest GPS sensor or native client. Do not promise impossible protection from a user-agent header. Device attestation is separate scope if strict native-device proof is mandatory. Clearly document demo limitations.
6. **Privacy/admin/retention:** owner needs their own site address; assigned provider needs it to travel. Agree whether admin gets audited access for disputes. Keep profile home address distinct from per-task site. Proposed raw-GPS retention 24 hours, coarse verification audit until task/dispute closure +30 days; confirm policy before any deletion. No continuous background tracking is needed for this gate.
7. **Payment meaning:** current release is an internal accounting record, not Stripe Connect transfer. Agree academic test-mode scope, currency/fee rounding and payout meaning; real payout integration requires separate authorization. GPS failures must not trigger automatic refund/release.

## Phases, dependencies and acceptance tests

### P0 — Establish baseline and policies (blocks all schema/workflow implementation)

- Reconcile local checkout with the intended GitHub baseline without overwriting unrelated work. Catalogue schema drift and live indexes/constraints; maintain original migration checksums.
- Approve decisions above: geography, trusted site coordinates, stage ordering, verification lifetime/revocation, privacy/admin access and settlement semantics.
- Record role/state/endpoint permission matrix and safe test environment. Auth currently trusts JWT claims without checking DB suspension/tokenVersion; include this in gate security scope.
- Tests: fresh ephemeral test DB from migration history; compare Prisma model/catalog; prove existing records survive proposed additive changes. Run no migration against Singapore until separately authorized.

### P1 — Privacy, profile and address foundation (depends P0)

- Models: reconcile existing fields first; add only missing private User address and Task site/public district fields. Existing tasks with missing site remain readable but cannot verify/work until owner supplies a valid site; never guess coordinates.
- APIs: whitelist `/users/me`, `/tasks` create and `/tasks/:id` edit; reject protected role/owner/status/escrow/verification assignments. Keep task location snapshot independent of later profile edits.
- Public projections in users/tasks/ratings/reviews/notifications/support/socket payloads; preserve authorized admin/participant reads. Disable unauthenticated location publication.
- UI: profile and task create/edit forms in both clients, compatible typed responses.
- Tests: anonymous/unassigned/assigned/owner/admin field visibility; payload inspection (not just rendered UI); phone/address validation; unauthorized/mass-assignment attempts; refresh/current-user persistence; photo/provider-profile regression.

### P2 — Funding and state invariants (depends P0; protected-write work in P1)

- Centralize eligibility in existing task service/repository, no architecture rewrite: assigned active provider + HELD, monotonic allowed transitions, no generic paid-state bypass, subtask enforcement.
- Make deposit creation/confirm/webhook and release/refund concurrency-safe; reuse Stripe-supported idempotency and database transactions/constraints. Verify amount/currency/session-task binding and payment state server-side. Persist successful effects once; preserve recoverable pending/failed state on external failure.
- Allow completion-settlement retry after a partial failure; do not duplicate release/logs. Admin overrides must use authorized settlement/dispute actions, not bypass funding through generic task edits.
- Tests: OPEN→assignment→pending deposit→HELD; all unauthorized/unfunded progress endpoints; failed/pending/cancelled checkout; double-click/concurrent session confirmation/webhook replay; delayed webhook after refund/dispute; release failure then retry; refund API failure; dispute freeze and authorized admin resolution; correct smallest currency units/fees. Use Stripe mocks then explicitly configured test mode, never live charges.

### STEP 4 delivery — Deposit/Escrow Workflow Correction (2026-10-20)

Scope: escrow workflow only (the funding work in P2 plus payment controls in P4); no GPS verification implementation. Existing enums retained: ASSIGNED + PENDING_DEPOSIT means awaiting deposit; HELD means FUNDED. No schema/migration changes, production queries/writes, Stripe charges, seed/reset, commit or push.

Completed:
- [x] Assigned provider + HELD required for status, progress and subtask writes; monotonic provider states; task edits whitelist protected fields; requester/admin generic status cannot bypass settlement. First subtask work starts IN_PROGRESS, preventing cancellation as “not started”.
- [x] Task-row locks and shared scoped transaction serialize funding/work/dispute/cancel/release/refund, including existing Phase 3 tracking lock. Payment/activity/notification changes roll back together.
- [x] Checkout only after assignment; reuse pending Checkout; Stripe idempotency key; prohibit new direct payment bypass. Backend retrieves signed-webhook/session Stripe state and validates paid amount, currency and task/payer/session binding. Pending/failed cannot fund; duplicate confirmations do not duplicate effects or revive refunded tasks.
- [x] Completion rollback/retry, including historical COMPLETED+HELD, with one release ledger entry. Refund API failures do not falsely mark refunded; dispute closure cannot invent funding. Unfunded cancellation is UNPAID/NONE, not a fictitious refund.
- [x] Web/mobile deposit prompts and funded/blocked states; funding required for progress controls; retry completion controls; Web does not announce success for backend-pending confirmation. Mobile refreshes task state when returning from external Checkout.

Changed files (this step only): `src/database/taskTransaction.js`; `src/modules/tasks/{service,repository}.js`; `src/modules/payments/{service,repository,escrow.test}.js`; `src/modules/notifications/repository.js`; `frontend-web/src/pages/{TaskDetailPage,TaskProgressPage}.tsx`; `frontend-mobile/src/app/{task-detail,task-progress}.tsx`; this plan. Pre-existing changes are preserved.

Validation: `node --test src/modules/payments/escrow.test.js src/modules/tracking/tracking.test.js` — 10 passed, 0 failed (~0.2s), entirely mocked Prisma/Stripe. Covers unfunded/funded work, unauthorized provider, generic bypass, concurrent deposits/confirmations, pending/expired payment, webhook replay, Stripe amount/currency mismatch, late cancelled/disputed payment, rollback/retry release, refund failure/replay, unfunded dispute closure and Phase 3 tracking permissions. Web `npx tsc -b --pretty false` passed. Backend syntax and scoped whitespace checks passed. Mobile standard type-check is blocked by existing TypeScript 6 baseUrl deprecation; diagnostic override result recorded below.

Limitations / blockers: no production or real Stripe/browser/simulator E2E validation; mocked serialization does not prove real PostgreSQL race behavior. Existing release remains an internal ledger, not Stripe Connect payout. Late payments after cancellation/dispute intentionally fail closed and need manual reconciliation/refund; historical multiple pending Checkouts are not automatically repaired. Stripe API calls hold the task lock (30s timeout); operational timeout/idempotency-expiry recovery requires integration testing. Mobile still uses existing web Checkout return URL and requires returning to app; native deep-link callback not added. GPS verification/site data prerequisites from P3 remain incomplete. No existing database configuration was changed.

Mobile diagnostic check: `npx tsc --noEmit --ignoreDeprecations 6.0` — passed, no config/dependency changes.

### STEP 5 delivery — Trusted task-site GPS verification (2026-10-20)

Scope: P1 task-site privacy plus P3 backend/mobile GPS only. Project A was inspected first: its useful Expo foreground-permission UX was adapted, but its client-side geocoding/distance decision, unauthenticated providerId, global socket broadcast and local verified state were explicitly not reused as evidence. Step 3 participant-only tracking and Step 4 funded escrow/task locks remain in force. Step 6 Web blocking UI was not implemented.

Completed locally:
- [x] Added nullable Task district/private site address/coordinates/siteVersion fields and task/provider verification records. The additive migration preserves existing rows and adds tracking indexes; it is prepared only and not applied.
- [x] New task creation requires district, precise address and bounded coordinates. Edit API accepts only the same protected site fields while OPEN/BIDDING, increments siteVersion and revokes verification. Public task list/detail/saved/suggested responses remove private site fields and never fall back to legacy free-text location; owner and assigned-provider progress/list responses retain the site.
- [x] Authenticated `POST /api/tracking/tasks/:taskId/verify` computes Haversine distance server-side. Policy constants: 1,000 m radius, accuracy <=100 m, GPS age <=2 minutes, future skew <=15 seconds and 60-minute TTL. It requires assigned provider, active task and HELD escrow; requestId is unique, unknown/verified fields are rejected, prior verification is revoked and the accepted evidence is logged.
- [x] Verification status/latest/history are participant/admin-only. Foreground tracking updates require a current verification and fresh/accurate evidence. Dispute, cancellation and site change revoke verification; reassignment/siteVersion/task/funding state and expiry fail closed.
- [x] Every provider status, subtask and progress mutation now requires current verification in addition to assignment and funded escrow. Mobile requests foreground permission, captures high-accuracy evidence, shows Verify/reverify state and precise assigned address, blocks controls until verified, then records foreground updates every 30 seconds/20 metres.
- [x] Web and Mobile task-create forms capture private address and target coordinates; Expo location permission/config and the SDK-compatible `expo-location` package were added. No Web execution gate was added.

Changed in Step 5: `database/prisma/schema.prisma`, `database/prisma/migrations/20261020000000_task_location_verification/migration.sql`; `src/modules/tracking/*`; `src/modules/tasks/{controller,service,validation}.js`; `src/modules/payments/escrow.test.js`; `frontend-mobile/{app.json,package.json,package-lock.json}`, `frontend-mobile/src/app/{post-task,task-progress}.tsx`, `frontend-mobile/src/{services/api,store/taskStore,types/index,utils/locationVerification,__tests__/locationVerification.test}.ts`; `frontend-web/src/pages/TaskPostPage.tsx`; this plan.

Evidence: Prisma schema validation/client generation passed without a DB connection. Backend mock command `node --test src/modules/tracking/tracking.test.js src/modules/payments/escrow.test.js` — 13 passed, 0 failed; covers inside/outside 1 km, accuracy/freshness, wrong provider, unfunded escrow, replay, expiry, revocation, participant reads, progress gates, public privacy and escrow regressions. Mobile Jest — 2 passed, 0 failed; Mobile TypeScript passes with the existing TypeScript-6 deprecation override; Web TypeScript passes. `expo install --check` reports six pre-existing Expo patch-version mismatches; they were not upgraded under this scope.

Migration-blocked / limitations: code cannot use the new fields/table until the additive migration is separately reviewed on an isolated/direct-connection branch and approved for Singapore. Existing tasks retain null district/site fields; their legacy `location` is not exposed publicly and they cannot verify until the requester supplies coordinates. Requester coordinates are a persisted target, not proof that the typed address is geocoded correctly. The 60-minute TTL/100 m accuracy policy is a documented project default still requiring stakeholder approval. Device GPS can be spoofed without device attestation. Raw-log retention cleanup, real-device/simulator GPS, production concurrency, real participant polling and production E2E were not tested. The Web gate is delivered separately in Step 6 below.

### STEP 6 delivery — Provider Web GPS verification gate (2026-10-20)

Scope: Web execution gate and real tracking reads only. Step 4 funding and Step 5 verification rules were reused unchanged; no schema, migration, Mobile, payment, requester-confirmation or Admin business logic was changed. No database access, seed/reset, commit, push or deployment occurred.

Completed locally:
- [x] Assigned-provider Web task detail/progress now checks `GET /api/tracking/tasks/:taskId/verification`. Provider execution controls remain hidden unless escrow is HELD and verification is currently valid. Unfunded work shows exactly `Awaiting requester deposit`; funded/unverified work shows exactly `Please verify your location on the mobile app`.
- [x] Verification is refreshed on initial load, every 15 seconds, browser focus and tab visibility. A client expiry timer immediately reblocks controls, while backend validation remains authoritative. Progress and subtask handlers refresh verification again before their mutation, preventing a stale open page from submitting after expiry/revocation.
- [x] Existing requester completion/deposit/dispute controls remain independent of the provider GPS gate. Safe read-only progress/task information remains visible while provider controls are blocked.
- [x] Web tracking route is now `/tracking/:taskId`; missing/invalid IDs stop loading. Mock coordinates, provider identity, arrival estimate and route were removed. The page uses authenticated participant-only latest/history/verification APIs, polls real `TrackingLog` data, refreshes on focus and preserves the last successful view on transient errors.
- [x] Server enforcement remains on all three provider work paths: status, subtask and progress updates. Focused regression coverage now explicitly rejects expired and revoked verification for each path and rejects non-participant verification reads.

Changed in Step 6: `frontend-web/src/hooks/useTaskLocationVerification.ts`; `frontend-web/src/App.tsx`; `frontend-web/src/services/api.ts`; `frontend-web/src/types/index.ts`; `frontend-web/src/pages/{TaskDetailPage,TaskProgressPage,TrackingPage}.tsx`; `src/modules/payments/escrow.test.js`; `src/modules/tracking/tracking.test.js`; this plan.

Evidence: backend mocked tests — 14 passed, 0 failed (~0.18s); Web production build/type-check — passed (~13s); focused new Web files ESLint — passed; Mobile GPS Jest — 2 passed, 0 failed; Mobile TypeScript passed with `--ignoreDeprecations 6.0`. The standard Mobile type-check still exits on the pre-existing TypeScript 6 `baseUrl` deprecation. Full touched-file Web lint still reports pre-existing `no-explicit-any` violations in Task Detail/Progress/API files; no new violation remains in the Step 6 hook/tracking page.

Remaining blockers: no production/Neon writes or reads and no real browser+mobile multi-device E2E were performed. Therefore Mobile verification → Web unlock, real focus events, GPS expiry timing and participant privacy are proven by code paths/mocks/build only, not claimed as production E2E. Step 5's unapplied additive migration still blocks real runtime verification against Singapore, and the location-spoofing/retention/policy limitations remain unchanged.

### STEP 7 delivery — Admin Dashboard and Web/Mobile consistency (2026-10-20)

Scope: existing Admin, profile, support and execution-state consistency only. No new role, payment/GPS override, migration, production database access, Stripe charge, commit, push or deployment.

Completed locally:
- [x] Admin API remains mounted before 404 and protected by authenticated ADMIN middleware. Users list/status endpoints were connected to both clients; suspension increments `tokenVersion`, blocks future login and invalidates existing sessions. Admin/self suspension is blocked.
- [x] Admin Web/Mobile now load real users, tasks, certificates, payments, disputes and support tickets with retry/error states. Task rows show assignment, task, escrow, payment, GPS and dispute state. Web includes task-status filtering; status-changing actions retain confirmations and existing backend settlement rules.
- [x] Admin task deletion now rejects active HELD/FROZEN escrow and DISPUTED tasks. Payment release still delegates to the existing idempotent payment service; the dashboard cannot directly override GPS, task state or payment state. Private task coordinates/address are removed from Admin task-list output.
- [x] Dashboard aggregates now distinguish HELD money from RELEASED payout/revenue and include open support tickets, avoiding mixed/double-counted successful ledger rows.
- [x] Auth/self-profile responses no longer expose password/login-control fields; public user profiles exclude email, phone and certificate URLs. Authenticated Web/Mobile profile edits now persist only name/phone/bio through validated `/api/users/me`; email, role and status are not mass-assignable.
- [x] Mobile provider progress now refreshes GPS verification on focus, every 15 seconds and immediately before progress/subtask mutations; expiry reblocks locally. Web/Mobile use the same `Awaiting requester deposit` and `Please verify your location on the mobile app` execution states. Backend remains authoritative on every work mutation.

Changed in Step 7: `database/prisma/schema.prisma`; `src/modules/admin/{routes,controller,service,repository,admin.test}.js`; `src/modules/auth/service.js`; `src/modules/users/{routes,controller,service,repository,validation,profile.test}.js`; `src/shared/middlewares/{auth,auth.test}.js`; `src/modules/support/routes.test.js`; `frontend-web/src/{services/api,stores/auth.store,types/index}.ts`, `frontend-web/src/pages/{Admin/Dashboard,ProfilePage}.tsx`; `frontend-mobile/src/{services/api,store/authStore,types/index,utils/locationVerification}.ts`, `frontend-mobile/src/app/{admin-dashboard,profile,task-detail,task-progress}.tsx`, `frontend-mobile/src/__tests__/locationVerification.test.ts`; this plan.

Evidence: Prisma validation/client generation passed without DB access. Focused backend mocked suite — 23 passed, 0 failed (~0.48s); Web production build/type-check passed (~2.1s Vite build); Mobile TypeScript passed with the existing TypeScript-6 deprecation override; Mobile Jest — 3 passed, 0 failed; changed Mobile ESLint passed. Standard Mobile type-check still fails only on the pre-existing `baseUrl` deprecation. Web touched-file lint still reports existing `no-explicit-any` debt in legacy Admin/Profile/API/store files; production compilation passes.

Remaining blockers: no real Admin/browser/mobile E2E or Singapore DB read/write was performed. Step 5's unapplied additive GPS migration still blocks real GPS status/unlock against Singapore. The existing user-admin migration must already be present before `status`, `createdAt` and `tokenVersion` can run; it was not applied here. Support detail handling remains in the existing Support Center rather than duplicated in the dashboard. Admin dispute settlement/refund actions remain available only through the existing reviewed workflow and were not exercised against Stripe.

### P3 — Authoritative GPS verification (depends P1 site data + P2 funding)

Progress: **partial; prerequisite-blocked, not complete**. Implemented independent tracking hardening: authenticated `/tracking/update`, identity derived from JWT, assigned-provider/active-task/HELD checks inside a task-row-lock transaction; coordinate bounds; participant/admin-only GET `/tracking/tasks/:taskId/latest` and `/history` (latest 100, newest first); global GPS socket broadcast removed. Existing client-supplied providerId is optional but must match authentication. Tracking logs do not grant verification.

Validation result: `node --test src/modules/tracking/tracking.test.js` — 2 passed, 0 failed; tracking diff whitespace check passed. Tests mock Prisma entirely and do not connect to a database.

Prerequisite inspection: Task still has no persisted trusted site coordinates/address version and Phase 1 site capture is absent. Phase 2 alternative task mutation paths remain open. Full verify/status endpoints, durable verification/expiry/revocation, GPS capture/address confirmation UI and replay/freshness/distance enforcement remain unimplemented. Completing those safely needs the P1 site-data contract and P2 invariants; they were not added under Phase 3-only scope. No production DB access, migration or schema edit performed. Focused mocked tests in `src/modules/tracking/tracking.test.js` cover funding/permission reads and writes and coordinate validation; real concurrency and mobile end-to-end remain untested.

- Reuse tracking module and TrackingLog. Proposed POST `/tracking/tasks/:taskId/verify`, GET `/tracking/tasks/:taskId/verification`; participant-only latest/history endpoints aligned with clients. Keep legacy `/tracking/update` only as an authenticated tracking write, never as implicit verification.
- Add a small task/provider verification record (or extend existing on-site fields with provider/time/expiry/revocation/site-version evidence after schema review). Store accuracy, server distance/result and server timestamps; bind/revoke on relevant changes. Add task/provider/time indexes where needed.
- Mobile foreground permission/capture and address confirmation, pending/retry/denied/offline handling; backend computes distance to persisted site. Poll/focus refresh across clients. Restrict socket events to authenticated participant rooms if retaining sockets.
- Tests: inside/outside/boundary radius; low accuracy; future/stale timestamp; invalid lat/lng; denied permission; wrong task/provider; unfunded; spoofed verified flag; replay; expiry/revocation/site change/reassignment; concurrent freeze vs update; no location leakage across sockets/tasks.

### P4 — Uniform execution UI and Admin behavior (depends P2+P3)

Progress: **Web provider gate and tracking repair completed in Step 6; real cross-device acceptance evidence and the remaining cross-client/Admin consistency checks are pending.**

- Expose eligibility and safe reason codes through existing task detail/progress API. Gate all Web/mobile controls and preserve backend checks; Web displays exact required message. Safe details remain visible; verify funding before asking for GPS.
- Fix Web tracking route/data/loading and mobile activity-vs-location distinction; keep current visual style. Handle expired verification while page open, refresh after app switching, and any required mobile Stripe callback with allowlisted targets.
- Admin: retain `/admin` middleware and certificate/task/payment/dispute/support flows. Add verification audit visibility only as required for support; no new unrestricted state override. Missing Admin Users APIs in this checkout are a separate historical request, not silently part of the group document.
- Tests: same role/state produces same available actions on Web/mobile; unverified blocking text/hidden controls; forced API update rejected; mobile verify→Web focus unlock without relogin; expiry reblocks; requester confirmation works without provider GPS requirement; admin unauthorized requests rejected. Test iOS foreground GPS on device and simulator boundary scenarios, Android if supported.

### P5 — Regression evidence and handover (depends P1–P4)

- Run backend focused tests in isolated DB/mocks; current root package lacks a test script (support has `routes.test.js`). Add a small repeatable test command rather than claim full coverage.
- Existing checks: `npm run build` generates Prisma client only; `npm --prefix frontend-web run build`; `npm --prefix frontend-mobile run type-check`; mobile `test:ci` can pass with zero tests, so report actual counts. Inspect test setup before execution; no tests may target Singapore/US implicitly.
- Regression: registration/login, bidding/assignment, task browsing/privacy, profile photo/certificates, notifications, reviews, disputes, support and admin settlement. Measure gate lookup/verification query latency; verify indexes and avoid per-card GPS queries. Document known GPS spoofing and synthetic/test payment limitations.
- Future migration rollout requires separate approval: additive migration reviewed on disposable DB, existing-data compatibility verified, backup/rollback plan, then controlled Singapore rollout. No seed/reset/data-copy step.

## Completion checklist

- [ ] Baseline and policy conflicts resolved; approved permission/state matrix.
- [ ] Prisma/catalog drift reconciled; migration history preserved; missing-site tasks handled safely.
- [ ] District-only public responses; precise site restricted to approved identities.
- [ ] Validated phone/address/profile saves persist on both clients and `/auth/me`.
- [ ] No task edit/status/subtask route can bypass escrow or assignment checks.
- [ ] Stripe funding is backend-confirmed; deposit/release/refund retries and races tested.
- [ ] Task-scoped GPS uses real foreground location, distance/accuracy/freshness checks.
- [ ] Verification TTL/revocation enforced server-side on every provider work mutation.
- [ ] Web exact blocking text; mobile verification unlock and expiry refresh proven.
- [ ] Real protected tracking read/write APIs; no global coordinate broadcast/mock locations.
- [ ] Admin/dispute permissions and settlement rules preserved.
- [ ] Meaningful automated tests plus Web/iOS acceptance evidence recorded with failures/limitations.
- [ ] Approved additive rollout and handover completed only after separate authorization.

Principal risks: private-address/GPS leakage, task-edit mass assignment, stale JWT roles, existing schema drift, payment replay/races, client GPS spoofing, missing site coordinates on old tasks, geography/format assumptions, and long-job verification expiry. Current audit has not proven any new requirement end-to-end; it identifies work and acceptance evidence needed.
