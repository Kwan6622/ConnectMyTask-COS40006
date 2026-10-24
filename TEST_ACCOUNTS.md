# ConnectMyTask E2E Test Accounts

Environment: Neon branch `e2e-test-20261020`, database `connectmytask_test` (Singapore). These accounts do not exist in the production database through this setup.

Passwords are stored only in `.test-credentials.local.json` at the project root. The file is gitignored and has mode `600`; passwords are intentionally omitted here.

| Email | Role | Test group | Features | Creation / login |
|---|---|---:|---|---|
| requester1@gmail.com | REQUESTER | 1 | Payment / escrow | CREATED / PASS |
| requester2@gmail.com | REQUESTER | 1 | Payment / escrow | CREATED / PASS |
| provider1@gmail.com | PROVIDER | 1 | Bidding / escrow work gate | CREATED / PASS |
| provider2@gmail.com | PROVIDER | 1 | Bidding / escrow work gate | CREATED / PASS |
| requester3@gmail.com | REQUESTER | 2 | GPS verification | CREATED / PASS |
| requester4@gmail.com | REQUESTER | 2 | GPS verification | CREATED / PASS |
| provider3@gmail.com | PROVIDER | 2 | Mobile GPS / Web unlock | CREATED / PASS |
| provider4@gmail.com | PROVIDER | 2 | Wrong-provider GPS denial | CREATED / PASS |
| requester5@gmail.com | REQUESTER | 3 | Customer support | CREATED / PASS |
| requester6@gmail.com | REQUESTER | 3 | Complaints / notifications | CREATED / PASS |
| provider5@gmail.com | PROVIDER | 3 | Customer support | CREATED / PASS |
| provider6@gmail.com | PROVIDER | 3 | Complaints / notifications | CREATED / PASS |
| requester7@gmail.com | REQUESTER | 4 | Completion / disputes | CREATED / PASS |
| requester8@gmail.com | REQUESTER | 4 | Cancellation / refund rules | CREATED / PASS |
| provider7@gmail.com | PROVIDER | 4 | Progress / completion | CREATED / PASS |
| provider8@gmail.com | PROVIDER | 4 | Disputes / cancellation | CREATED / PASS |
| requester9@gmail.com | REQUESTER | 5 | Profile / privacy | CREATED / PASS |
| requester10@gmail.com | REQUESTER | 5 | Admin suspension checks | CREATED / PASS |
| provider9@gmail.com | PROVIDER | 5 | Private address / profile | CREATED / PASS |
| provider10@gmail.com | PROVIDER | 5 | Role authorization | CREATED / PASS |
| admin.test@gmail.com | ADMIN | 5 | Admin dashboard and permissions | CREATED / PASS |

All 10 providers have provider profiles. Five idempotent demo tasks and bids were created (task IDs 1–5, one per group). Task 1 has a Stripe test Checkout pending; no payment was marked successful. Task 2 is assigned but unfunded, so GPS verification correctly remains blocked. No GPS verification or successful escrow was faked.

Re-run safely with `ALLOW_TEST_DATABASE_SEED=true npm run prisma:seed:test`. The seed refuses non-test branch/database targets and never updates an existing account.
