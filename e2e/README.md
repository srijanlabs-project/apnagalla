# Sanity tests (mandatory around every deploy)

Two checks, both run with Playwright in the installed Chrome at phone size (375 × 812).

## 1. Before deploying: `npm run sanity`

Taps through the critical shop flows on the phone version of the app, on this computer
(start the `api` and `app-as-phone` servers from `.claude/launch.json` first):

1. Log in with the test login (first run creates "Sanity Test Store")
2. Home: four quick buttons and the figures
3. Add an item
4. Add a customer
5. Counter sale, cash with change given back
6. "20 rice" in New sale (sell by amount; counted items are not offered)
7. Credit bill, then Received from the To collect list
8. Bill detail and its More menu
9. Return items → credit note draft
10. Estimate for a customer
11. New expense from Home
12. Cash book: formula help, day-end count
13. Reports: search, open Sales report
14. More: search; switch to Hindi and back
15. No screen threw an error anywhere above

The test login stays signed in between runs (kept in `e2e/.profile/`), because the server allows only
a few OTP codes per number per hour. Test number: `9000000001` (change with `E2E_PHONE`).

## 2. After deploying: `npm run sanity:prod`

Checks production: server and database up, the web app opens without errors, admin opens, signed-out
API calls are refused, and (with a test login) sign in → read the store → save and delete a customer →
live gift-voucher check.

Production signs in with real SMS codes, so the test-login part runs only on request: sign in once on
the app with the test number to receive a code, then run with `$env:E2E_PHONE` and `$env:E2E_OTP` set
for that run. Without them, the public checks still run.

Reports: `npx playwright show-report e2e-report` (screenshots and a trace for every failure).
