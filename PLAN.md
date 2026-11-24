# ApnaGalla — Phase 1 Plan

Status: **approved** (M1 built) · App name: **ApnaGalla** · Date: 24 Nov 2026

## 1. Goal
A simple, offline-first invoicing app for small businesses. The owner and staff use it on several Android phones (and in a browser), and it syncs to the business's own online database. It never needs Google services on the device. Its standout feature: **photograph a handwritten bill → get a draft invoice**.

## 2. Decisions so far
| Topic | Decision |
|---|---|
| App approach | **Capacitor + React**: one web app, packaged as an Android app and also hosted as a website |
| Distribution | **Google Play Store** (plus the web version) |
| Google services | None on the device (no Firebase, no Google services) |
| Users | **Owner + staff** on several phones, sharing one business account |
| Login | **Phone number + SMS OTP** from day one (Indian SMS provider such as MSG91 or 2Factor; needs TRAI DLT registration) |
| Tax | Simple tax % per item or line (no GST rules) |
| Data | Offline-first on the phone; syncs to an online database whenever there is internet |
| Invoice numbers | One series per business, shared by all phones; **blocks of numbers reserved for offline use** |
| Backend hosting | **Railway**: Node API + PostgreSQL + storage bucket |
| Bill scanning | Photo → draft **sales invoice** → user checks and saves. Online only (photos taken offline wait in a queue). **Free AI vision tier now**, provider swappable later |

## 3. Phase 1 features
1. **Login and setup:** phone OTP → create a business (name, logo, address, phone, UPI ID, bank details, invoice prefix) → done in about 2 minutes.
2. **Team:** the owner adds staff by phone number; staff sign in with OTP and join the business.
3. **Customers:** name, phone, address, opening balance; running balance and a customer statement.
4. **Items catalogue:** name, unit, default price, tax %.
5. **Invoices:** add items from the catalogue (or free-typed lines), quantity, rate, discount, tax %, round-off, due date, notes.
6. **Estimates:** a quotation that converts to an invoice in one tap.
7. **Payments:** set each invoice to **Unpaid / Paid / Partially paid** (enter the amount paid; pending is calculated; it can never exceed the invoice total); overdue list. Details in [SPEC.md](SPEC.md) §3.
8. **PDF and sharing:** a clean A4/A5 invoice PDF in one of **3 designs** with logo, **UPI QR code** and bank details; share by WhatsApp, email or any app; WhatsApp payment-reminder message ready to send.
9. **Dashboard:** this month's sales, money received, money outstanding, overdue count, recent invoices.
10. **Scan bill → draft invoice:** see section 7.
11. **Account and Play Store essentials:** in-app "Delete my account", privacy policy link, logout from all devices.

**Not in phase 1:** expenses / profit & loss, purchases and stock, GST and e-way bills, receipt-printer support, recurring invoices, more than one business per login, Hindi interface.

## 4. Roles
| Action | Owner | Staff |
|---|---|---|
| Create invoices, estimates, customers; record payments | ✅ | ✅ |
| Edit or delete a saved invoice or payment | ✅ | ❌ (owner can allow edits later) |
| See dashboard totals and all reports | ✅ | Own invoices only |
| Business settings, items catalogue prices, team | ✅ | ❌ |

## 5. Architecture
```
Android app (Capacitor)  ┐
Web app (browser)        ┘ React + TypeScript + Vite + Ionic UI
   │  Local DB: IndexedDB (Dexie) — all data available offline
   │  Sync queue + photo upload queue
   ▼ HTTPS (JWT)
Railway
   ├─ API service: Node + TypeScript (Fastify)
   │    ├─ Auth (SMS OTP via MSG91/2Factor)
   │    ├─ Sync endpoints (push / pull)
   │    ├─ Invoice-number allocator
   │    └─ Scan service → AI vision provider adapter (free tier first)
   ├─ PostgreSQL (source of truth)
   └─ Storage bucket (bill photos, logos)
```
- **Device features through Capacitor plugins (no Google services needed):** camera / gallery, filesystem, share sheet, network status.
- **PDFs are generated on the phone**, so sharing also works offline.

## 6. Sync design
- Every record has an **ID generated on the phone** (UUID), plus `business_id`, `updated_at`, `updated_by`, `device_id`, `deleted` (soft delete).
- **Push:** local changes queue up and are sent in batches when online.
- **Pull:** the server keeps an increasing change number for every change; each phone asks for "all changes since #N".
- **Conflicts:** if two phones edit the same record, the latest edit wins. Conflicts stay rare because:
  - payments are **only ever added**, never edited in place (a correction is a reversal plus a new entry);
  - staff can't edit saved invoices;
  - balances and invoice statuses are **calculated from the records**, never stored, so they can't fall out of step.
- **Online:** sync runs on app open, on reconnect, after each save (debounced) and every few minutes.

## 7. Invoice numbering
- One series per business, e.g. `INV/26-27/0001`; the **prefix is configurable, and numbering restarts each financial year** (1 April).
- **Online:** the server gives out the next number straight away (strictly in order).
- **Offline:** each phone holds a **reserved block of 10 numbers**, topped up automatically when online and fewer than 3 remain.
- **Known trade-offs (accepted):** numbers can be out of date order across phones, and an unused block can leave gaps.

## 8. Scan bill → draft invoice
1. Take a photo or pick one from the gallery (multi-page allowed) → it is resized and compressed on the phone.
2. **Offline:** the photo is saved locally as "Waiting to scan". **Online:** it uploads to the API.
3. The server sends it to the AI vision provider with a fixed output format:
   `{customer_name, phone, date, items:[{name, qty, unit, rate, tax_pct}], discount, total, notes}`
4. Back on the phone:
   - customer and items are **matched to existing records** (unknown ones marked "New");
   - uncertain fields are highlighted;
   - a mismatch between the bill's total and the calculated total gets a warning.
5. The user checks it → **Save** (never saved automatically). The photo stays attached to the invoice.
6. **Provider adapter:** free tier now (rate-limited; images may be used for training under free-tier terms, which we tell users), switched to a paid no-training provider later by changing a setting.
7. A monthly scan limit per business protects the free quota.

## 9. Main screens
Login (phone → OTP) · Business setup · Home dashboard · Invoices list / detail / editor · Estimates · Customers list / detail (statement) · Items · Record payment · Scan bill → review draft · Team · Settings (business, invoice, account deletion) · Sync status indicator

## 10. Milestones
| # | Milestone | Outcome |
|---|---|---|
| M1 | Foundation | Repo, React + Capacitor app shell, local DB, Railway API + Postgres, OTP login (test mode) |
| M2 | Core invoicing | Customers, items, invoices, estimates, PDF + share, working fully offline |
| M3 | Sync + team | Push/pull sync, numbering blocks, staff invites, roles |
| M4 | Payments + dashboard | Payments, statuses, overdue, reminders, dashboard |
| M5 | Bill scanning | Upload queue, AI adapter, review screen, matching |
| M6 | Release | Privacy policy, account deletion, Play Store build and listing, web deploy |

M1 and M2 are done. From here the work follows the client-approved **4 releases** in the
"ApnaGalla — Retailer Requirements" doc (24 Nov 2026); M3–M6 are folded into them.

### Release 1 (P0) — daily billing, shared and safe
Built in this order; each step is tested and committed before the next.

| Step | Scope | Status |
|---|---|---|
| R1.1 Accounts and stores | Several stores per owner (up to 10), staff in several stores with a role per store, owner pauses / turns on staff per store, one phone per login (new phone signs the old one out) + web login, device list with remote sign-out, web can't create or edit invoices, store switcher | Done (branch `feat/r1-accounts-stores`) |
| R1.2 Sync | Push/pull of all store records (latest edit wins per record; server enforces owner-only settings, staff/web limits on saved invoices), server-allocated numbers per store and series (online: one at a time; offline: block of 10), sync on open / reconnect / after save / every 3 min, sync status chip | Done |
| R1.3 GST billing | Store GST type (regular / composition / unregistered), GST and non-GST bills with their own series, HSN, CGST+SGST / IGST from place of supply (shipping address), credit notes, number pattern | |
| R1.4 Counter | Quick-sale screen, camera barcode, sq ft / running ft billing, dated part-payments with modes and split, on-screen UPI QR, returns, delivery date + day-before alert | |
| R1.5 Catalogue | Category tree, item barcode / HSN / purchase price / MRP, Excel import of items and customers, GSTIN check via the client's GST API | |
| R1.6 Print and languages | Bluetooth thermal printing (2" / 3"), English / Hindi / Gujarati / Punjabi | |
| R1.7 Admin and security | Admin panel (create / suspend stores), app PIN, secure token storage, tenant-isolation tests, rate limits, backups, monitoring | |

Known gaps after R1.2:
- A phone signed out because the same login was used on a new phone loses changes it had not
  uploaded yet. Sync runs 2 s after every save, so this is usually nothing; a grace upload for the
  old phone is a later improvement.
- Records sync whole: if two phones edit the same customer at the same time, the later save wins
  for every field of that customer.
- Server data is kept as JSON per record (`sync_records`); typed tables for reports come with R2.

## 11. Your action items (can run in parallel with the build)
- [ ] Start **TRAI DLT registration** with an SMS provider (business entity, sender ID, OTP template). Takes days to weeks; until it's done, OTP runs in test mode.
- [ ] Create a **Google Play developer account**.
- [ ] Sign up for **Railway**.
- [ ] Get an API key for the **free AI vision tier**.
- [ ] Choose an **app name** (and a domain for the web app and privacy policy, optional).

## 12. Risks
- **DLT approval delay:** affects only real SMS sending, not development.
- **Free AI tier limits or terms change:** the adapter makes switching providers a settings change.
- **Number gaps or out-of-order numbers when offline:** accepted; blocks kept small.
- **Losing data that hasn't synced yet** (phone lost or app uninstalled while offline): there's a "last synced" indicator, and the app warns before logout if anything is still unsynced.
