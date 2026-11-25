# ApnaGalla

Offline-first invoicing for small businesses: an Android app (Capacitor + React + Ionic) and a web app built from the same code, plus a Node/Postgres backend on Railway. No Google Play Services or Firebase on the device.

Product docs: `PLAN.md` (phase 1 plan) and `SPEC.md` (functional spec).

## Repository layout
| Folder | What |
|---|---|
| `shared/` | Types, validation (zod) and helpers used by both app and server |
| `server/` | API: Fastify + Drizzle ORM + PostgreSQL (embedded PGlite locally) |
| `app/` | React + Ionic UI, Dexie (IndexedDB) local database, Capacitor Android project in `app/android` |

## Milestone status
Release 1 is in progress; see PLAN.md §10 for the step list.
- **R1.6 Printing and languages:**
  - Bluetooth thermal printing (classic + BLE, 58 / 80 mm), receipts drawn as a picture so every script, logo and UPI QR print; auto-print after a counter sale;
  - app in English, Hindi, Gujarati and Punjabi (More → Language); receipts in the store's receipt language;
  - translations: `npm run i18n -w @invoice/app -- check | export FILE.csv | import FILE.csv` (review sheet: `docs/translations-review.csv`).
- **R1.5 Catalogue:**
  - category tree (3 levels), item code, MRP (optional bill column), purchase price hidden from staff by default;
  - import items and customers from Excel / CSV with a preview, update-or-skip for matches;
  - GSTIN check with the GST records through GSTZen (server-side; the key is a Railway variable).
- **R1.4 Counter:**
  - New sale screen: search, tap or scan items, quantities, hold and resume bills;
  - payments as dated entries (cash / UPI / card / bank / cheque, split, change to give back, UPI QR on screen); the owner voids mistakes;
  - returns by any staff member, with refunds of overpaid money;
  - item barcodes with an in-app camera scanner (no Google services);
  - area billing by sq ft / running ft (store setting);
  - delivery date and person on bills, a phone alert the day before (9 AM by default), deliveries on Home.
- **R1.3 GST billing:**
  - store GST registration (regular / composition / not registered) with an offline GSTIN check;
  - tax invoices and bills without GST, each with its own number series; HSN/SAC on items and lines;
  - place of supply from the shipping or billing address; CGST + SGST within the state, IGST outside;
  - credit notes against a saved invoice (owner only), which lower what the customer owes;
  - number pattern and digits in Invoice settings (GST limit: 16 characters);
  - numbering: each person has their own series by default (staff letters on the Team screen, works offline without limits), or one shared series with blocks per phone.
- **R1.2 Sync:**
  - every phone and the web share the store's data;
  - sync runs on app open, when the internet returns, 2 s after each save and every 3 minutes;
  - invoice numbers come from the server; offline, each phone holds a block of 10;
  - the server enforces who may change what (owner-only settings, staff and web limits on saved invoices).
- **R1.1 Accounts and stores:**
  - several stores per owner, with a store switcher;
  - staff in several stores; the owner pauses or turns on staff per store;
  - one phone per login (a new phone signs the old one out), plus a web login;
  - device list with remote sign-out;
  - the web app can't create or edit invoices.
- **M2 Core invoicing (offline):**
  - business profile with logo and signature; bank accounts and UPI IDs;
  - invoice settings: prefixes, financial-year numbering, defaults, custom fields, units, tax rates, reminder text;
  - customers (with opening balance) and the items catalogue (including "price includes tax");
  - invoice and estimate editor: item and overall discounts, **Set final amount**, extra charges, round-off;
  - draft → save → edit history → cancel; duplicate; estimate → invoice;
  - one payment entry per invoice (Unpaid / Partly paid / Paid, never more than the total);
  - 3 PDF designs (Classic / Modern / Minimal) with a live preview, A4/A5, UPI QR with the pending amount, amount in words;
  - share the PDF through the Android share sheet (WhatsApp, Print, Drive…) and send a WhatsApp reminder.

  Everything is stored on the phone and queued for sync. **Sync itself arrives in M3**; until then, data stays on the device it was entered on. Invoice numbers are per device until M3 switches to server-allocated blocks.
- **M1 Foundation:**
  - phone + OTP login (test mode);
  - device sessions with token refresh and logout;
  - onboarding: name, create a business, or join by invite;
  - owner/staff roles;
  - team invites;
  - offline local database schema;
  - app shell with tabs and an online/sync indicator;
  - Android debug build;
  - Railway config.
- Next: **M3 sync and team.**

## Run locally
Requires Node 22+.

```powershell
npm install
Copy-Item server/.env.example server/.env   # then set JWT_SECRET to a long random string
npm run dev:server                           # API on http://localhost:3000 (embedded Postgres in server/.data)
npm run dev:app                              # App on http://localhost:5173
```

In local dev, OTP SMS is **not** sent:
- the code is printed in the server log;
- with `OTP_FIXED_CODE=123456` in `server/.env`, that code always works.

To test phone-only flows (invoices, credit notes) in a browser, start the app with
`npm run dev -w @invoice/app -- --mode phone` (uses `app/.env.phone`; development builds only).

Tests and type checks:

```powershell
npm test
npm run typecheck
```

## Android build
Requires the Android SDK and JDK 21 (Android Studio's bundled JBR works).

```powershell
cd app
$env:VITE_API_URL = "http://<your PC's LAN IP>:3000"   # or the Railway https URL
npm run android:sync
cd android
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
.\gradlew.bat assembleDebug
```

The APK is written to `app/android/app/build/outputs/apk/debug/app-debug.apk`.
- Android emulator: use `http://10.0.2.2:3000` to reach a server running on your PC.
- Real phone: it must be on the same Wi-Fi, and Windows Firewall must allow port 3000.

The Android package ID is **`in.apnagalla.app`** (in `app/capacitor.config.ts` and `app/android/app/build.gradle`). It's permanent once the app is on the Play Store, so never change it.

## Deploy the API to Railway
1. Create a Railway project.
2. Add a **PostgreSQL** database.
3. Add a service from this repo and set its build / start commands and `/health` check as listed in `docs/operations.md` (there is no `railway.json`).
4. Set these service variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = a long random string
   - `CORS_ORIGINS` = the web app URL, once it exists
   - `OTP_PROVIDER` = `console` and `ALLOW_CONSOLE_OTP` = `true` **until DLT approval** (codes appear in Railway logs). After approval: `OTP_PROVIDER` = `msg91`, plus `MSG91_AUTH_KEY` and `MSG91_OTP_TEMPLATE_ID`.
   - GSTIN lookup (optional): `GST_API_PROVIDER` = `gstzen` and `GST_API_KEY` = the GSTZen secret key. Optional: `GST_API_URL` (default `https://my.gstzen.in/api/gstin-validator/`), `GST_API_VERSION` (1.0), `GST_API_TIMEOUT_MS` (12000), `GST_LOOKUPS_PER_DAY` (200)
5. Database migrations run automatically when the server starts.

## API (v1)
| Method | Path | Who |
|---|---|---|
| POST | `/v1/auth/otp/request` · `/v1/auth/otp/verify` · `/v1/auth/refresh` | public |
| POST | `/v1/auth/logout` | signed in |
| GET / PATCH | `/v1/me` | signed in |
| GET | `/v1/me/sessions` | signed in (my devices) |
| DELETE | `/v1/me/sessions/:sessionId` | signed in (sign out one of my devices) |
| POST | `/v1/businesses` | signed in (up to 10 owned stores) |
| GET | `/v1/businesses/:id` | active member |
| GET | `/v1/businesses/:id/team` | owner |
| POST / DELETE | `/v1/businesses/:id/invites[/:inviteId]` | owner |
| DELETE | `/v1/businesses/:id/members/:userId` | owner |
| POST | `/v1/businesses/:id/members/:userId/deactivate` · `/activate` | owner (pause / turn on a staff member) |
| POST | `/v1/businesses/:id/sync/push` | active member (rules per role / client) |
| GET | `/v1/businesses/:id/sync/pull?since=N` | active member |
| POST | `/v1/businesses/:id/numbers/reserve` | active member; shared series `invoice`, `bill`, `credit`, `estimate` (the web gets estimate numbers only); returned numbers first |
| POST | `/v1/businesses/:id/numbers/return` | active member (unused numbers a phone gives back) |
| POST | `/v1/businesses/:id/members/:userId/series-code` | owner (change a staff member's series letter before it is used) |
| GET | `/v1/businesses/:id/gstin/:gstin` | active member (GSTIN lookup, cached 30 days, daily limit per store) |
| POST | `/v1/invites/:id/accept` · `/v1/invites/:id/decline` | the invited phone number |

### OTP security limits
- One code per number every 30 seconds.
- 5 codes per number per hour, and 30 per IP address per hour.
- A code expires after 5 minutes and allows 5 attempts.
- Codes are stored only as an HMAC (keyed hash), never in plain text.
- Refresh tokens are rotated each time they are used.
- Logging out takes effect immediately.
