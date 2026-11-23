# Galla

Offline-first invoicing for small businesses: an Android app (Capacitor + React + Ionic) and a web app built from the same code, plus a Node/Postgres backend on Railway. No Google Play Services or Firebase on the device.

Product docs: `PLAN.md` (phase 1 plan) and `SPEC.md` (functional spec).

## Repository layout
| Folder | What |
|---|---|
| `shared/` | Types, validation (zod) and helpers used by both app and server |
| `server/` | API: Fastify + Drizzle ORM + PostgreSQL (embedded PGlite locally) |
| `app/` | React + Ionic UI, Dexie (IndexedDB) local database, Capacitor Android project in `app/android` |

## Milestone status
- **M1 Foundation (this branch):**
  - phone + OTP login (test mode);
  - device sessions with token refresh and logout;
  - onboarding: name, create a business, or join by invite;
  - owner/staff roles;
  - team invites;
  - offline local database schema;
  - app shell with tabs and an online/sync indicator;
  - Android debug build;
  - Railway config.
- Next: **M2 core invoicing.**

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

The Android package ID is **`in.galla.app`** (in `app/capacitor.config.ts` and `app/android/app/build.gradle`). It's permanent once the app is on the Play Store, so never change it.

## Deploy the API to Railway
1. Create a Railway project.
2. Add a **PostgreSQL** database.
3. Add a service from this repo. `railway.json` sets the build and start commands and the `/health` check.
4. Set these service variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `NODE_ENV` = `production`
   - `JWT_SECRET` = a long random string
   - `CORS_ORIGINS` = the web app URL, once it exists
   - `OTP_PROVIDER` = `console` and `ALLOW_CONSOLE_OTP` = `true` **until DLT approval** (codes appear in Railway logs). After approval: `OTP_PROVIDER` = `msg91`, plus `MSG91_AUTH_KEY` and `MSG91_OTP_TEMPLATE_ID`.
5. Database migrations run automatically when the server starts.

## API (v1)
| Method | Path | Who |
|---|---|---|
| POST | `/v1/auth/otp/request` · `/v1/auth/otp/verify` · `/v1/auth/refresh` | public |
| POST | `/v1/auth/logout` | signed in |
| GET / PATCH | `/v1/me` | signed in |
| POST | `/v1/businesses` | signed in, not yet in a business |
| GET | `/v1/businesses/:id` | member |
| GET | `/v1/businesses/:id/team` | owner |
| POST / DELETE | `/v1/businesses/:id/invites[/:inviteId]` | owner |
| DELETE | `/v1/businesses/:id/members/:userId` | owner |
| POST | `/v1/invites/:id/accept` · `/v1/invites/:id/decline` | the invited phone number |

### OTP security limits
- One code per number every 30 seconds.
- 5 codes per number per hour, and 30 per IP address per hour.
- A code expires after 5 minutes and allows 5 attempts.
- Codes are stored only as an HMAC (keyed hash), never in plain text.
- Refresh tokens are rotated each time they are used.
- Logging out takes effect immediately.
