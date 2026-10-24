# Group 1 — live API / manual Checkout testing

Date: 2026-10-20. Database: `connectmytask_test`, branch `e2e-test-20261020`.
Only this isolated database was queried/written during this run.

Accounts: requester1@gmail.com / provider1@gmail.com.
Task ID: 6. Bid ID: 6. Current payment transaction ID: 3.

| Check | Result | Evidence |
|---|---|---|
| Isolated target | PASS | Both configured DB URLs point to the expected test endpoint/database; SELECT current_database() confirmed it. API-created task is present there. |
| Requester login | PASS | Real login API returned HTTP 200; identity matched test DB. |
| Provider login | PASS | Real login API returned HTTP 200; identity matched test DB. |
| Create task | PASS | POST /api/tasks returned 201; budget 650,000 VND. |
| Submit bid | PASS | POST /api/tasks/6/bids returned 201; bid 600,000 VND. |
| Assign provider | PASS | PATCH /api/tasks/6/assign-provider returned 200. |
| Unfunded Start Task | PASS | PATCH status IN_PROGRESS returned 400: requester must deposit escrow. |
| Unfunded progress | PASS | POST progress returned 400: requester must deposit escrow. |
| Agreed deposit rule | PASS | Accepted bid is the contract price: requester deposits 600,000 VND. Existing 20% platform fee is deducted within escrow (120,000 VND fee; 480,000 VND provider payout), not added to Checkout. |
| Old unpaid Checkout | PASS | The incorrect open 650,000 VND test session was expired through Stripe; transaction 2 is CANCELED/FAILED and remained unpaid. |
| Stripe test Checkout | PASS | Fresh API request returned 201; Stripe retrieval confirmed 600,000 VND, currency VND, livemode=false, open/unpaid. |
| Duplicate deposit | PASS | Repeated deposit request reused the same open session; no second current payment transaction was created. |
| Unauthorized deposit | PASS | Provider deposit attempt returned HTTP 403. |
| Amount/currency validation | PASS | Focused tests reject Stripe amount/currency mismatches before FUNDED state. VND remains zero-decimal. |
| Manual payment | PENDING | Waiting for user to complete test-card Checkout. |
| Webhook-confirmed funding | PENDING | Current DB: ASSIGNED / PENDING_DEPOSIT / ESCROW_PENDING. No confirmation API called to simulate webhook success. |
| Web/Mobile amount consistency | PASS (code/API) | Shared task API now returns escrowAmount 600,000; Web/Mobile show the agreed escrow amount. Web build and Mobile type-check passed. Manual rendered observation remains pending. |
| Focused regression | PASS | Backend escrow tests 11/11; Web production build; Mobile type-check; Mobile tests 3/3. |

Backend (4000), Web (5173), Metro (8081), and Stripe forwarding listener were running.
Login tests above are HTTP API checks, not manual UI login tests.
No real charges, production writes, resets, commits, or pushes.
Passwords, tokens, signing secrets, and Checkout session URLs are omitted.
