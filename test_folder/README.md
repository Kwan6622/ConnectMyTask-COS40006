# ConnectMyTask workflow tests

This folder contains an API-level end-to-end test for both sides of the task
workflow:

1. requester and provider signup/login
2. role authorization checks
3. requester creates a task
4. provider submits a bid
5. requester assigns the provider
6. requester creates an escrow Checkout session
7. provider verifies the task location
8. provider posts 100% progress
9. requester confirms completion
10. escrow is released and both users can read the final payment history

The test uses Node's built-in `node:test` runner and requires no extra package.
It creates unique accounts on each run, so it must target a disposable test
database. Do not point it at production.

## Run

Start the backend first:

```powershell
npm run dev
```

From the project root:

```powershell
node --test test_folder/workflow.e2e.test.js
```

Optional environment variables:

```powershell
$env:E2E_BASE_URL = "http://localhost:4000"
$env:E2E_PASSWORD = "E2eTestPassword123!"
```

The backend must have `GEOCODING_API_KEY` configured. The workflow creates the
task at Nguyen Hue, Ben Thanh, so the address verification step is exercised
with a real geocoding result rather than bypassed coordinates.

## Stripe payment checkpoint

The test always verifies that the backend creates an escrow Checkout session.
Stripe requires a real test-mode card or webhook to move that session to
`ESCROW_HELD`; the test never fakes that state.

For a fully interactive run, set `E2E_INTERACTIVE_PAYMENT=true`. The test will
pause after creating Checkout, print the URL, and ask for the session ID after
you pay with the Stripe test card `4242 4242 4242 4242`:

```powershell
$env:E2E_INTERACTIVE_PAYMENT = "true"
node --test test_folder/workflow.e2e.test.js
```

Alternatively, `TEST_PAYMENT_SESSION_ID` can provide the ID while the test is
running in an automated harness. It must match the session created by that
same test run. If neither option is set, the deterministic pre-payment portion
passes and the test stops at the external payment checkpoint.
