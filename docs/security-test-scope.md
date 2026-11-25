# ApnaGalla: scope for the external penetration test

Prepared 25 Nov 2026 for the outside security firm, before public launch. The test itself is done
by that firm; this note says what to test, how to get access, and what we already know.

## What is in scope

| Part | Where | Notes |
|---|---|---|
| API server | `https://invoiceserver-production.up.railway.app` (Node, Fastify, Postgres) | All `/v1/...` routes. Use a staging copy if the firm prefers (see "Test accounts") |
| Web app | the web build of the app (React + Ionic), same API | Owner logins on a browser; invoices are made only in the phone app |
| Android app | debug APK (`ApnaGalla-railway-debug.apk`) or the Play build when ready | Capacitor WebView app with offline data (IndexedDB), Bluetooth printing, fingerprint lock |
| Admin panel | web `/admin`, only for numbers in `ADMIN_PHONES` | Create / suspend stores, plans and codes, audit log |
| Webhook | `POST /v1/billing/razorpay-webhook` | HMAC-signed by Razorpay |
| OAuth callbacks | `GET /v1/exports/callback/{google,onedrive,dropbox}` | Signed `state` (15 minutes) |

Out of scope: Railway's own platform, Razorpay / Google / Microsoft / Dropbox / GSTZen / Anthropic
services, denial-of-service load tests (rate limits exist; please agree any load test first).

## How the security is meant to work (please try to break it)

- **Login:** mobile number + SMS OTP. Access token 15 minutes; refresh token stored hashed, rotated
  on use; phone logins last 90 days, browser logins 7 days of no use. One phone per login (a new
  phone signs the old one out); the web can be open alongside.
- **Stores (tenants):** every store route checks the caller's membership and role. An automated
  test calls every `:businessId` route as an outsider (expects 403) and without a login (401).
  Tenant data is stored per store; please test cross-store access with two accounts.
- **Roles:** owner and staff, plus per-staff permissions (see costs, discount limit, reports, edit
  items, delete). The server enforces: owner-only tables, cost hiding (staff without cost access
  never receive purchase prices, purchases or suppliers), saved bills editable only by the owner,
  payments / stock changes added-only (only the owner voids), number series per person.
- **Sync:** phones push and pull records; the server never trusts identity fields from the phone
  (store, author, time capped at 5 minutes ahead).
- **Rate limits:** 600 requests a minute per login (per IP without one); OTP requests limited per
  number and per IP; GSTIN lookups and bill scans capped per store per day.
- **Headers / CORS:** helmet headers; only the app's own origins allowed in production.
- **Secrets:** API keys only in Railway variables. Cloud-folder sign-ins are stored encrypted
  (AES-256-GCM). Tokens on the phone are in Android's encrypted storage; app lock with PIN
  (PBKDF2, 150k rounds) or fingerprint.
- **Audit log:** voids, refunds, edited / cancelled bills, price and store changes, team and
  permission changes, admin actions, plan payments.

## Test accounts

Ask the ApnaGalla team for: two owner logins in two different stores, one staff login with
limited permissions, one admin login. Until real SMS is live (DLT), the test server can run with a
fixed test OTP (`OTP_FIXED_CODE`), which must never be set on the live server once real shops use it.

## Known and accepted for now

- `npm audit` (production dependencies) reports 3 moderate advisories in `react-router` 6
  (GHSA-wrjc-x8rr-h8h6 open redirect with a backslash in `<Link>` / `useNavigate`;
  GHSA-337j-9hxr-rhxg in server-side rendering hydration). The app has no server-side rendering
  and never builds links from outside input; the fix needs react-router 7.18, which Ionic's router
  doesn't support yet. To be upgraded when it does.
- OTP is in test mode until DLT registration is approved.
- The Android build tested so far is a debug build; the Play release build will be signed and
  minified.

## What we'd like back

Findings with severity, steps to reproduce and the affected route or screen, and a re-test after
fixes. Please don't keep or share any shop data you see.
