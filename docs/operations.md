# ApnaGalla — operations

Railway project **ApnaGalla** (production). Services: `@invoice/server` (API, deployed from GitHub
`main`) and `Postgres`.

## Service settings (in Railway, not in the repo)
`railway.json` was removed on 25 Nov 2026 (Railway ends Config-as-Code on 1 Dec 2026). The same
settings now live on the `@invoice/server` service:

| Setting | Value |
|---|---|
| Build command | `npm run build:server` |
| Start command | `npm run start:server` (runs database migrations, then the API) |
| Health check | `/health`, 60 s timeout |
| Restart policy | on failure, 5 retries |
| Watch paths (auto-deploy) | `/server/**`, `/shared/**`, `/package.json`, `/package-lock.json` |

## Variables (`@invoice/server`)
| Variable | Purpose |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | long random string; changing it signs everyone out |
| `CORS_ORIGINS` | web app address(es), comma-separated, once the web app has a domain |
| `OTP_PROVIDER` / `ALLOW_CONSOLE_OTP` / `OTP_FIXED_CODE` | test mode until DLT is approved; **remove `OTP_FIXED_CODE` before real users** |
| `ADMIN_PHONES` | mobile numbers allowed into the admin panel (`/admin`, web only), comma-separated |
| `GST_API_PROVIDER` = `gstzen`, key in `GST_VALIDATION_API_KEY` (or `GST_API_KEY`) | GSTIN lookup |
| `RATE_LIMIT_PER_MINUTE` | optional, default 600 per login |
| `ANTHROPIC_API_KEY` | bill scanning (photo of a supplier bill → purchase draft). Unset = the Scan button is hidden. `SCAN_MODEL` (default `claude-opus-5-5`), `SCAN_PER_DAY` (default 100 per store) |
| `RESEND_API_KEY`, `EXPORT_EMAIL_FROM` | nightly Excel by email (Resend; the "from" domain must be verified in Resend) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | nightly Excel to Google Drive (OAuth app, scope `drive.file`, redirect `<PUBLIC_URL>/v1/exports/callback/google`) |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | nightly Excel to OneDrive (Entra app, `Files.ReadWrite offline_access`, redirect `<PUBLIC_URL>/v1/exports/callback/onedrive`) |
| `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` | nightly Excel to Dropbox (scoped app, `files.content.write`, redirect `<PUBLIC_URL>/v1/exports/callback/dropbox`) |
| `PUBLIC_URL` | this server's address, default `https://invoiceserver-production.up.railway.app` |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | plan payments by Razorpay payment link |
| `RAZORPAY_WEBHOOK_SECRET` | the webhook secret; in Razorpay add a webhook to `<PUBLIC_URL>/v1/billing/razorpay-webhook` for the event `payment_link.paid` |
| `PLANS_ENFORCED` | `true` applies plan limits (staff, bills a month, scans a day). Leave unset until the client has set the plans |
| `TRIAL_DAYS` / `GRACE_DAYS` / `REFERRAL_DISCOUNT_PCT` | defaults 30 / 7 / 10 |
| `APNAGALLA_LEGAL_NAME`, `APNAGALLA_GSTIN`, `APNAGALLA_ADDRESS`, `PLAN_SAC` | printed on the GST invoice ApnaGalla gives each paying store (SAC default 997331) |

The nightly Excel runs inside the server every 5 minutes and sends each store's file once a day, after
the hour the owner picked (India time). Cloud sign-ins are stored encrypted with a key derived from
`JWT_SECRET`: changing `JWT_SECRET` means owners connect their cloud folder again.

## Backups
Two independent layers on the `Postgres` service:

1. **Scheduled volume backups** — daily (kept 6 days), weekly (27 days), monthly (89 days).
   Railway dashboard → Postgres → Backups, or `railway postgres pitr backup list --service Postgres`.
2. **Point-in-time recovery (PITR)** — every change is archived to a private Railway bucket
   (pgBackRest: weekly full + daily differential backups, about 4 weeks kept).
   Status: `railway postgres pitr status --service Postgres`.

### Restoring
Restores always go into a **new** Postgres service; the live database is not touched until you
switch to it.

- To a moment in time (e.g. just before a bad import):
  `railway postgres pitr restore --service Postgres --at 2026-12-01T10:30:00+05:30`
- From a scheduled / manual backup: `railway postgres pitr backup list --service Postgres`, then
  `railway postgres pitr backup restore …` with the backup's ID.

Then check the restored data, point `DATABASE_URL` of `@invoice/server` at the new service
(`${{NewService.DATABASE_URL}}`), redeploy, and check `/health`. Phones keep working offline
meanwhile and sync when the API is back.

Before a risky change (big import, migration), take a manual backup:
`railway postgres pitr backup create --service Postgres`.

## Monitoring
- **Uptime:** GitHub Actions workflow `Uptime` calls `/health` (which also checks the database)
  every 10 minutes; a failed run emails the repository admins (GitHub → Settings →
  Notifications → Actions: "Send notifications for failed workflows only").
- **Tests:** workflow `CI` runs the type check and all tests on every push.
- **Logs:** Railway → `@invoice/server` → Logs. Errors are logged with the request id; tokens are
  redacted.
- **Audit log:** sensitive actions per store (staff paused, payments voided, bills cancelled,
  store suspended…) — admin panel → store → Log.

## Admin panel
Web only, at `https://<web app>/admin`, for numbers in `ADMIN_PHONES`. Lists every store; create a
store for an owner's phone; suspend (with a reason) / reactivate. A suspended store is refused on
every request until reactivated.

## Security baseline (R1.7)
- Store isolation: an automated test calls every store route as an outsider (must be 403) and
  anonymously (must be 401); new routes are covered automatically.
- Rate limit per login (or per IP when not signed in); OTP has its own limits.
- Security headers (helmet); CORS limited to the Android app and `CORS_ORIGINS` in production.
- Browser logins expire after 7 days unused; phones after 90; one phone per login.
- Phones: login tokens in Android Keystore-encrypted storage; optional (or store-required for
  staff) PIN / fingerprint app lock.
