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
| R1.3 GST billing | Store GST type (regular / composition / unregistered), GST and non-GST bills with their own series, HSN, CGST+SGST / IGST from place of supply (shipping address), credit notes, number pattern | Done |
| R1.4 Counter | Quick-sale screen, camera barcode, sq ft / running ft billing, dated part-payments with modes and split, on-screen UPI QR, returns, delivery date + day-before alert | Done |
| R1.5 Catalogue | Category tree, item barcode / HSN / purchase price / MRP, Excel import of items and customers, GSTIN check via the client's GST API | Done |
| R1.6 Print and languages | Bluetooth thermal printing (2" / 3"), English / Hindi / Gujarati / Punjabi | Done (translations to be reviewed; printing to be tried on real printers) |
| R1.7 Admin and security | Admin panel (create / suspend stores), app PIN, secure token storage, tenant-isolation tests, rate limits, backups, monitoring | Done (lock and fingerprint to be tried on a phone) |

### Release 2 — stock, purchases, money
Started 25 Nov 2026; built without stopping for each design question (owner's call), using the
defaults below. Each can still be changed.

| Step | Scope | Status |
|---|---|---|
| R2.1 Stock | Stock per item worked out from opening stock, adjustments (damage, theft, count, other), purchases, sales and returns; low-stock level per item, low-stock / reorder list, stock value at cost | Done |
| R2.2 Purchases | Suppliers (GSTIN, opening balance), purchase orders (PDF to WhatsApp, from the low-stock list), purchase bills that add stock and update cost / MRP, purchase returns, supplier ledger and payments, expenses with categories | Done |
| R2.3 Khata and cash | Running ledger per customer, khata payment settling oldest bills first (extra = advance, used later), credit limit warning, statement PDF for a date range, WhatsApp balance reminder with UPI link, daily cash book, day-end cash count | Done |
| R2.4 Dashboard and reports | Home: today's sales, cash, UPI, credit given, receivable, payable, low stock. Reports: sales (by day, staff, mode), items and categories, stock, GST (sales and purchase registers, HSN summary, tax summary), profit, day book, staff and store, deliveries, receivables and payables; Excel / PDF export | Done |
| R2.5 Backup and scanning | Nightly Excel by email / Google Drive / OneDrive / Dropbox; scan a supplier bill into a purchase draft. Both switch on when their keys are set | Done (switches on when keys are set) |

R2 decisions (defaults):
- Stock is never stored as one number (two phones would overwrite each other); it is added up from
  records: opening stock and adjustments (`stockMoves`, added only), saved purchase bills and
  purchase returns, saved bills (sales) and return credit notes. Selling below zero is allowed (the
  shop may not have entered all stock yet); the item shows a negative stock in red. Services and
  area-priced items don't track stock.
- Purchase orders and purchase bills don't need the legal number series: POs are numbered
  PO/{FY}/{person letter}{n} on the phone; purchase bills keep the supplier's bill number.
- Purchases, suppliers and the supplier ledger follow the store's "staff can see purchase prices"
  setting: when off, staff phones don't receive them and can't add them. Expenses can be added by
  anyone (petty cash), changed only by the owner.
- A khata payment is split on the phone into entries on the customer's oldest unpaid bills; what is
  left over is kept on account (advance) and can be used on a later bill ("Use advance"). The
  opening balance is settled first.
- Cash book is per store per day: opening (last day-end count) + cash received − cash refunds −
  cash expenses − cash supplier payments. Day-end saves the counted cash and the difference.
- Reports are worked out on the phone / web from the synced data, so they work offline.
- The nightly Excel and bill scanning run on the server and need keys the owner provides.
- Bill scanning: Claude reads the photo into a purchase draft (supplier by GSTIN or name, items by
  name; anything new stays a new line); the person checks every line before saving. A store can scan
  100 bills a day (`SCAN_PER_DAY`). Scanning the shop's own paper sales bills is R3.
- Reports done: sales by day (staff filter), money received by mode, item-wise, category-wise,
  delivery, stock (value at cost), low stock, slow movers, sales and purchase registers, HSN summary,
  GST summary (output − input), profit (current cost price), expenses, day book, receivables,
  payables, staff-wise and store-wise. Each shares as PDF or Excel.
- Not yet (R3 or later): GSTR-1 JSON export, custom saved reports, cheque bounce handling, auto UPI
  confirmation, credit limit blocking (it only warns), customer groups and price levels.

### Release 3 — shop types, plans, growth
Started 25 Nov 2026, built without stopping for each design question (owner's call), using the
defaults below. Each can still be changed.

| Step | Scope | Status |
|---|---|---|
| R3.1 Jobs | Job-work orders (measurement → quote → advance → in progress → ready → delivered, photos, due date) and repair job cards (device, IMEI, problem, accessories, technician); bill from the job with the advance used || Done |
| R3.2 Switching | Import items, customers, suppliers and balances from Vyapar, Khatabook or any Excel || Done |
| R3.3 Items | Variants (size / colour, own stock, barcode and price), several units per item (box = 12 pcs), price levels (retail / wholesale / special) by customer type || Done |
| R3.4 Electronics | Serial / IMEI per unit (in on purchase, out on sale), warranty dates, serial search, finance / EMI payment mode || Done |
| R3.5 Selling | Offers (category % off, buy X get Y, combo price), bulk price update with history, reorder suggestions from sales speed, barcode labels and price stickers || Done |
| R3.6 Control | Staff permissions per person, credit limit that can block, delivery challan, exchange in one bill, cheque tracking (pending / cleared / bounced), GSTR-1 export, custom saved reports || Done |
| R3.7 Plans | Free / paid plans, trial, coupon / referral / partner codes, payment link, GST invoice to the shop, renewal reminders, grace period; scan the shop's paper sales bills; photos on items and bills || Done (payments need Razorpay keys; plan prices from the client) |
| R3.8 Security | Scope and checklist for the external penetration test (the test itself is done by an outside firm) || Scope ready (docs/security-test-scope.md); test by an outside firm |

R3 decisions (defaults):
- Jobs are estimates with a job stage (work or repair), so quotes, area pricing, PDFs and "make
  bill" are shared. The advance is a khata payment on account tagged with the job, and is used on
  the bill automatically. Photos are small JPEGs (up to 6 per job); sync sends records in batches
  of at most ~4 MB so photos never make one upload too big.
- Variants are separate items grouped under a parent (e.g. "Shirt" → "Shirt · M · Red"), so stock,
  barcode and price per variant reuse everything items already do.
- Several units: an item has its base unit (stock is kept in it) and other units with a factor
  (box = 12 pcs) and their own price. A bill or purchase line in boxes moves 12 × the quantity.
- Price levels: retail (the item price), wholesale and special. A customer has a type (retail,
  wholesale, special); their bills use that level's price when the item has one.
- Serials: an item can "keep serial / IMEI numbers". Purchases record the numbers that came in,
  sales pick from the ones in stock; the bill prints them with the warranty end date.
- Offers apply themselves on the counter screen and in the bill editor as line discounts, shown as
  "Offer: …"; the cashier can remove one. Only the owner makes offers.
- Bulk price update: by category, ±% or ±₹, rounded to ₹1 / ₹5 / ₹10, preview first; each item keeps
  its last 20 price changes.
- Staff permissions per person: see costs and purchases, most discount %, view reports, edit items,
  delete drafts / customers. "Staff can see purchases and cost prices" becomes the starting value.
- Delivery challan: its own number series (DC); goods leave stock on the challan, and the bill made
  from it doesn't take them out again.
- Exchange: a return credit note on the old bill and the new bill in one step; the returned value
  pays the new bill (no cash moves unless there is a difference).
- Cheques: a cheque payment counts as received; it is listed as pending until marked cleared; a
  bounced cheque is voided by the owner and the bill is pending again.
- GSTR-1 export in the GST offline tool's JSON (B2B, B2C small, credit notes, HSN, documents) plus
  Excel; check with the CA before filing.
- Plans: the mechanism is built; the client sets plan names, prices and limits in the admin panel.
  New stores get a 30-day trial of the top plan, then 7 grace days, then the Free plan's limits
  (placeholder plans: Free, Basic ₹299 / month, Pro ₹599 / month, before GST). Codes: coupons (% off,
  ₹ off or free days, optionally a partner's), and each store's own referral code (10% off for the
  new shop). A paid link extends the plan and numbers a GST invoice AG/{FY}/{n} (SAC 997331, 18%).
  Limits are not enforced until the client switches them on (`PLANS_ENFORCED`). Payment by
  Razorpay payment link (keys needed); UPI autopay comes after the Razorpay account is ready.
- Paper sales bills: a photo of a bill-book page becomes a draft bill (customer, items, the paper's
  number as reference, the photo attached); saved, it gets a normal number.
- Not yet (later): UPI autopay mandates, Indian-language PDFs, pharmacy batches / expiry, store-wise
  limits on the number of stores (counted only when a store is created — to add with plans enforced),
  an SMS renewal reminder (the app shows one on Home).

### Release 4 — reach, control, many stores
Agreed 25 Nov 2026 (scope chosen by the owner from the client's R4 list plus their own points);
built without stopping for each design question, using the defaults below.

| Step | Scope | Status |
|---|---|---|
| R4.1 Billing | Barcode scan in the invoice / estimate editor (asks before adding a repeat), private notes on a bill (never printed), bill photos printed on a page after the bill, WhatsApp button straight to the customer's chat with the PDF, non-returnable items, "+ New" with invoice / estimate / delivery challan | Done |
| R4.2 Offers | ₹ off offers (with a minimum bill), coupon codes typed at billing (uses, dates, minimum bill) | Done |
| R4.3 Credit and advances | Return credit note: refund now or keep as credit (never both); pay with a credit note; advances on any estimate or challan, used on its bill | Done |
| R4.4 Job work | sq m and running metre, sizes in m / cm / mm, quantity typed directly; "work order" switch inside the estimate | Done |
| R4.5 Wi-Fi printing | Wi-Fi receipt printers by IP address; A4 printers through Android's print screen | Done |
| R4.6 Roles and control | Warehouse team (deliveries only, marks delivered with a photo), accountant (read-only login), lock old bills, "may cancel bills" permission, Tally export | Done |
| R4.7 Many stores and staff | Stock transfer between stores, owner dashboard across stores, staff attendance, salary and advances | Done |
| R4.8 Phone alerts | Low stock, overdue payments, daily summary as phone notifications (no Google services) | Done |

On hold (client's R4 list): customer khata link, WhatsApp catalogue / orders, voice billing,
recurring bills, review link, iOS app.

R4 decisions (defaults):
- Private notes: a separate "Notes for us" box on bills and estimates; shown in the app only, never
  on the PDF, receipt or WhatsApp text.
- WhatsApp: Android opens WhatsApp in the customer's chat (their number, even if not in contacts)
  with the PDF attached; the seller taps send. It uses WhatsApp's chat-id share, which is widely
  used but not documented by WhatsApp; if it fails, the normal share sheet opens.
- Warehouse and accountant are kinds of staff login (Team → a person → Kind of login), so invites
  and number series work as before. Warehouse sees bills, challans and job orders to deliver
  (More → Deliveries) and marks them delivered with a photo (stored on the bill); nothing else,
  and never cost prices. Accountant / CA sees everything (costs if the owner allows), including
  GSTR-1 and the Tally export, and changes nothing; the server refuses any change from them.
- "May cancel bills" is a staff permission (off by default). Old bills lock after N days and / or
  up to a "books closed" date (Invoice settings); a locked bill still takes payments and notes,
  nothing else, not even from the owner; corrections go on a credit note.
- Stock transfer: owner of both stores only; two linked stock entries (out of one store, into the
  other); the item in the other store is matched by barcode, then name, else copied there.
- Staff pay: staff are a list of people (with or without an app login), owner-only. Only
  absences are marked; unmarked days count as present. Monthly salary is earned per day; daily
  wage × days. Advances and salary are "Salary" expenses, so the cash book and profit stay right;
  an advance is recovered from a later salary.
- Wi-Fi printers: raw ESC/POS to the printer's IP address (port 9100); the phone and printer must
  be on the same Wi-Fi.
- Credit notes keep one choice: refund (cash / UPI / bank) or "keep as credit". Credit kept can
  pay any later bill of that customer (payment mode "Credit note"); for a walk-in, by the credit
  note number.
- Phone alerts are local notifications planned by the phone whenever the app runs or data changes
  (no Google push), set per phone in More → Phone alerts: low stock and overdue money each
  morning, the day's summary at closing time with the figures as of the last change synced.
- Tally export (Reports → GST): Tally's XML import with Sales, Credit Note and Purchase vouchers,
  ledgers Sales / Purchase / CGST / SGST / IGST (Input … for purchases) / Round Off, parties by
  customer / supplier name (walk-ins to Cash). Payments are not exported yet. The CA should check
  the ledger names once before the first import.

### Release 5 — global product reference
Agreed in outline 25 Nov 2026; plan and first decisions 26 Nov 2026. Barcodes are out of scope.

Goal: when a shop adds an item, it picks from a shared product list instead of typing everything.
A shop with its own catalogue mostly sees its own items; the shared list stays out of the way.

How it works:
- Global data kept by ApnaGalla: categories, generic items (Wheat Atta) with other names (आटा,
  gehun atta, ਆਟਾ), unit, HSN and GST rate; brands with common misspellings; pack sizes. Product =
  generic item + brand + pack (Aashirvaad Wheat Atta 5 kg). No prices: prices are always the shop's.
- Three things never mixed: generic item, product, the shop's own item (with its prices and stock).
- The owner picks the store's categories when the store is created, or later in Settings →
  Product list (several allowed). Each category's list downloads to every phone of the store's
  team (about 0.5–2 MB), then only changes; it works offline.
- A read-only suggestion list, never added to the shop's items in bulk. Picking a suggestion copies
  name, unit, category, HSN and GST into a new item of the shop; the shop adds price, cost, MRP
  and opening stock. Later changes to the global list don't change the shop's items.
- Typing "fortune oil 1" matches brand, generic item, size and unit on the phone (spelling
  mistakes and Indian-language names too); the shop's own items come first, so nothing is
  duplicated. A shop can switch suggestions off.
- A shop's own items stay private. Only the ApnaGalla team edits the global list (admin console,
  by hand or Excel).
- Starts inside the ApnaGalla server (own tables and download); a separate service for Quicksy and
  others when a second product needs it.

Decisions (26 Nov 2026):
- First data: ApnaGalla drafts a starter list (Excel) for the client to review before upload.
- First store categories: Kirana, Hardware (with electrical) and Garments.
- Suggestions appear in New item, and when an item not in the shop's catalogue is typed while
  billing (invoice, estimate, counter) or on a purchase bill.

| Step | Scope | Status |
|---|---|---|
| R5.1 Data store | Server tables (categories, generic items, other names, brands, packs, products), admin screens, Excel upload / download | Done |
| R5.2 Download | Each phone gets its store's categories, then only changes; kept offline | Done |
| R5.3 Search | Offline matching on the phone: brand + item + size + unit, misspellings, Hindi / Gujarati / Punjabi names; shop's items first | Done |
| R5.4 New item and onboarding | Suggestions fill New item; store categories at sign-up and in Settings; switch off | Done |
| R5.5 Billing and purchases | Suggestions for items not yet in the catalogue while billing and on purchase bills (saved as a new item) | Done |
| R5.6 Starter data | Draft list for Kirana, Hardware, Garments with HSN / GST for the client's review | Draft ready (docs/product-list-review.xlsx: 1,502 kirana, 1,505 hardware, 485 garments, 383 spellings); waiting for review |

How to load the list: admin console (web, /admin) → Product list → pick the section → Upload
sheet (.xlsx or .csv with the columns Category, Item, Brand, Size, Size unit, Sell unit, HSN, GST %,
Other names, Notes; other names separated by ";"). Re-uploading updates rows by item + brand + size;
"Replace the whole section" also removes rows not in the sheet. Other spellings: a two-column
sheet (Word, Means). Phones pick changes up within a few hours, or at once from More → Product list.

Still open: someone on the client side to keep the list clean over time; "learning" from names
many shops type that aren't in the list (later, needs consent in the terms); Excel import filling
missing HSN / GST from the list (later).

Pending (not scheduled yet):
- **iPhone app.** Needs an Apple Developer account ($99/yr), a Mac or cloud Mac builds, and an iPhone to
  test. Work: add the iOS project, icons and launch screen, permission texts (camera, Face ID,
  Bluetooth, notifications), BLE printers only on iPhone (Apple blocks classic Bluetooth printers),
  Face ID wording, Keychain cleared after reinstall, iPhone fonts for receipts, notch / home-bar
  layout, "Android app" texts. App Store also needs in-app account deletion, a reviewer login,
  a privacy policy and the privacy form. About 3–4 days plus Apple's approval and review.
  Open questions: Mac or cloud builds; individual or company account; are BLE-only printers OK.
- **Automatic APK downloads** (GitHub Releases on every deploy), later Google Play internal testing.

Known gaps after R1.2:
- A phone signed out because the same login was used on a new phone loses changes it had not
  uploaded yet. Sync runs 2 s after every save, so this is usually nothing; a grace upload for the
  old phone is a later improvement.
- Records sync whole: if two phones edit the same customer at the same time, the later save wins
  for every field of that customer.
- Server data is kept as JSON per record (`sync_records`); typed tables for reports come with R2.

R1.3 decisions and gaps:
- Store GST type lives in the business profile. A store set up earlier counts as regular only if
  its tax ID is a valid GSTIN; otherwise it is "not registered" and new bills carry no GST.
- Regular stores choose per bill: tax invoice (GST) or bill without GST (own series, BILL prefix).
  Composition and unregistered stores have one series and never charge GST.
- Place of supply: shipping address state → billing address state → buyer's GSTIN → store's state;
  it can be changed by hand. Same state = CGST + SGST (UTGST in UTs without a legislature),
  otherwise IGST. Split per tax rate; CGST takes the odd paisa.
- GSTIN check is offline (format, state code, check digit). Checking that it is active needs the
  client's GST API (R1.5).
- Credit notes: owner only, made from a saved invoice (lines copied, quantities editable), at most
  the invoice total less earlier notes; they lower what the customer owes. An invoice with credit
  notes can't be cancelled until they are.
- Default GST rates for new stores: 0, 3, 5, 18, 40 (GST 2.0 slabs).
- Not yet: reverse charge, e-invoice (IRN) / e-way bill, debit notes, HSN summary on the PDF.
- Numbering (decided 25 Nov 2026, replaces the block of 10 from R1.2), set in Invoice settings:
  - **Each person has their own series (default).** The owner's numbers have no letter
    (INV/26-27/0001); staff get B, C, D… in join order (INV-B/26-27/0001), which the owner can
    change on the Team screen until it is on a saved bill. Re-joining gives the old letter back.
    The phone numbers bills itself, continuing after the highest number it has seen in its
    series, so it never runs out offline. Estimates stay one shared series.
  - **One series for everyone.** Each phone holds a block sized to its own use (about 3 days,
    20–200), uses it first even when online, tops up at half. Unused numbers go back to the
    server on logout (and when the store switches mode or the year ends); the server hands
    them out again first, so gaps fill.
  - The server refuses a document whose number another document already has, and staff can
    only number bills in their own series.
  - Default bill-without-GST prefix is BOS so staff numbers fit GST's 16 characters.
  - Remaining gap: a removed or lost phone's unused block (shared mode) can't be returned.

R1.4 decisions (25 Nov 2026) and gaps:
- Payments are their own records (payments table), added and never edited; the owner voids a
  mistake. Paid / pending / refund due are worked out from entries + saved credit notes, never
  stored on the invoice. Old single paid amounts were converted to one entry each.
- Any staff member can take a return on any bill (credit note, reason "return") and refund what
  was overpaid; price cuts, editing saved notes and cancelling stay with the owner.
- Counter: walk-in customers pay in full; named customers may pay part or later. Hold = a draft
  marked held. UPI on screen is a QR for the exact amount; the cashier confirms receipt (no bank
  check). WhatsApp text bill for quick sales.
- Barcodes: in-app ZXing scanner (no Google services); USB/Bluetooth scanners work as keyboards.
- Area billing is a store setting; quantity comes from length × width × pieces (ft or inches).
- Delivery date + assignee on bills and estimates; local phone alert the day before at the
  store's alert time (default 09:00); Home lists overdue / today / tomorrow. Anyone can mark
  delivered.
- Not yet: stock (returns don't restock), delivery challan, exchange in one bill, staff discount
  limit, khata payments not tied to one bill (R2). Alerts only for the store open on the phone,
  and none on the web. Camera scanning and alerts need checking on a real phone.

R1.5 decisions (25 Nov 2026) and gaps:
- Categories: a tree up to 3 levels, owner-managed; items have one category.
- Items: code / SKU, MRP (warning above MRP; MRP column on bills is an Invoice design option, off
  by default), purchase price. "Staff can see purchase prices" is a store setting, off by default;
  when off, the server never sends cost to staff phones and keeps it when staff edit an item.
  (Staff phones that already received cost while it was allowed keep that copy.)
- Import from .xlsx / .csv with a preview; on matches the owner picks Update or Skip each time.
- GSTIN lookup: our server calls the client's GST API (key only in Railway), caches answers 30
  days and allows GST_LOOKUPS_PER_DAY calls per store (default 200). Provider: GSTZen
  (POST https://my.gstzen.in/api/gstin-validator/, headers Token + x-api-version 1.0, body
  {"gstin"}). Its response schema isn't public, so fields are read by name (GSTZen-style and GST
  portal names); if the legal name isn't found, the server logs the response's field names only.
  Confirmed live on Railway (25 Nov 2026): GSTZen answers {status, gstin, valid,
  company_details{legal_name, trade_name, company_status, gst_type, registration_date, pradr{addr1,
  street, city, pincode…}}}, mapped exactly. Railway reads the key from GST_VALIDATION_API_KEY;
  the plain endpoint + Token header is used (the other project's "j" endpoint needs a login).

### Releases 6–10 — everything in the Vyapar feature list
Planned 26 Nov 2026 from the Vyapar feature list the owner shared ("I want everything in ApnaGalla
too"). Each line of that list was checked against the app; what ApnaGalla already has is not
repeated here. The owner asked for R6 to be built in auto mode (defaults below, each can change).

Already in ApnaGalla (no work): GST / non-GST bills, inclusive / exclusive tax, 3 bill designs,
logo and signature, number patterns, line and bill discounts, CGST / SGST / IGST, estimates and
quotes → bill, duplicate, cancel, PDF, print (thermal, Wi-Fi, A4), WhatsApp share, UPI QR, counter
billing, barcode scan and labels, cash / UPI / card / bank / cheque / split, MRP, returns and credit
notes, categories in a tree, item photos, code / SKU, HSN, GST rate, cost / MRP / retail /
wholesale / special prices, several units, opening stock, live stock, stock value, low-stock alerts,
stock count and adjustments, transfer between stores, serial / IMEI, negative stock, Excel import,
purchase orders → purchase bills, purchase returns, supplier ledger and payments, khata with
opening balance, credit limit, statements, partial payments and advances settled oldest-first,
cheques, receivables / payables, cash book, day book, expenses, GSTR-1 (JSON and Excel), GST
summary for GSTR-3B, HSN summary, delivery challans, job orders, all-stores dashboard, staff logins
with roles and permissions, accountant login, devices, audit log (admin), nightly Excel backup to
email / Drive / OneDrive / Dropbox, Tally export, and phone alerts.

| Release | What it adds |
|---|---|
| **R6 Money and books** | Bank accounts with opening balance and a **bank book**; every UPI / card / bank / cheque entry goes to an account; **cash ↔ bank** deposits, withdrawals and transfers; **other income**; expenses with **own categories, paid-to, photo and repeating (rent, salary…)**; **loans** taken and given (EMI, interest); **payment receipts** (customer) and **payment vouchers** (supplier) as PDF / WhatsApp; reports: **bank statement, cash flow, profit & loss statement, other income**; financial-year filters; Home shows bank balance and this month's expenses and profit |
| R7 Accounts and GST returns | Ledgers for every party and account, **journal entries**, chart of accounts (Tally-style groups), **trial balance, balance sheet**, capital and drawings; **GSTR-2B match** (upload the portal file, see missing / mismatched bills), proper **GSTR-3B** and **GSTR-9** sheets, input / output tax registers, taxable / exempt / nil sales; owner **activity log** in the app |
| R8 Orders and stock depth | **Sales orders** (status, part delivered, pending order report, order → bill), **proforma invoice**, **batch and expiry** (pharmacy, FMCG: pick batch on sale, expiry report), **godowns** inside a store with transfers, **item stock history**, purchase **expenses spread into cost** (freight, loading), purchase **due dates and supplier reminders**, **recycle bin** (restore deleted items, customers, bills), **weighing-scale barcodes** (price / weight inside the barcode) |
| R9 Customers and online store | **Party groups**, **customer-specific prices**, **loyalty points**, **automatic payment reminders** (WhatsApp / SMS on a schedule), **online store** (catalogue link with prices, customer orders → bill), share catalogue, import phone contacts, email bills |
| R10 Government links and data | **E-invoice (IRN, QR)** and **e-way bill** through a GSP, **Tally import**, full **backup and restore** (Google Drive / file, one tap), field sales staff (visits with location, orders taken in the field), import from Vyapar backups |

Needed from the client for later releases: a GSP account for e-invoice / e-way bill (R10, paid,
e.g. through the GST API provider), the SMS DLT templates for automatic reminders (R9), and a
domain for the online store (R9).

#### Release 6 — money and books
Started 26 Nov 2026 in auto mode.

| Step | Scope | Status |
|---|---|---|
| R6.1 Accounts | Bank accounts get an opening balance (date) and can be marked "not on bills"; UPI / card / bank / cheque payments, supplier payments and expenses carry an account (picked when the store has more than one, else the default); cash ↔ bank deposits, withdrawals, transfers and balance corrections; bank book per account; Home: bank balance | |
| R6.2 Income and expenses | Other income (interest, rent received, commission, scrap sale, discount received, other + own categories); expenses with own categories, paid-to, bill photo; repeating expenses (every month / week) shown as "due" with a Pay button | |
| R6.3 Loans | Loans taken (bank, person) and given: opening balance, interest %, EMI; entries for money received / repaid, interest and charges, from cash or a bank account; loan statement | |
| R6.4 Receipts | Payment receipt for money received (bill or khata), payment voucher for money paid to a supplier: PDF, print and WhatsApp | |
| R6.5 Reports | Bank statement, cash flow (cash and bank, in and out by kind), profit & loss statement (sales − returns − cost of goods = gross profit; − expenses + other income − loan interest = net profit), other income; This / last financial year in date filters; Home: this month's expenses and profit | |

R6 decisions (defaults):
- Bank accounts already exist for printing on bills; they now also hold money. An entry without
  an account (all entries before R6) counts in the store's default account. UPI money goes to
  the default account unless another is picked.
- Cash ↔ bank moves, other income, loans and repeating expenses are owner-only (the accountant
  login sees them, other staff don't). Expenses can still be added by anyone (petty cash).
- Repeating expenses are never paid by themselves: the Expenses screen lists what is due and
  "Pay" records it, so two phones can't pay rent twice.
- Loan interest is an expense (loan taken) or other income (loan given); repaid principal is not
  an expense. EMI = principal + interest typed per payment (the bank's split), not worked out.
- Receipts are numbered from the entry (RC-date-short id); they are not a legal series.
- Profit & loss values goods sold at the item's current cost price, like the profit report.

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

R1.6 decisions (25 Nov 2026) and gaps:
- Thermal receipts are drawn on the phone and sent as a picture (ESC/POS raster), so all four
  scripts, the logo and the UPI QR print on cheap printers without Indian fonts. 58 mm (384 dots)
  or 80 mm (576 dots). Classic Bluetooth (paired printers, our own Android plugin) and BLE
  (@capacitor-community/bluetooth-le). Printer, paper width, logo and auto-print after a counter
  sale are kept per phone (More → Printer). The web shows a receipt preview instead.
- Receipt language: one store default (Invoice settings → Printed receipts). PDFs stay English
  (our PDF library can't join Indian-script letters).
- App language: each person picks it (More → Language); English text is the key (src/lib/i18n.ts,
  src/i18n/{hi,gu,pa}.json). 777 phrases translated by Claude; a native speaker should review
  docs/translations-review.csv (also the number words in shared/src/langs.ts). Corrections come
  back with `node scripts/i18n.mjs import FILE.csv` (placeholders are checked).
- Not yet: text sent to customers on WhatsApp / share stays English; Indian-language PDFs;
  printing untested on real printers.

R1.7 decisions (25 Nov 2026) and gaps:
- ApnaGalla admins are the phone numbers in the server variable `ADMIN_PHONES`, web only
  (/admin): list and search stores, create a store for an owner's number, suspend / reactivate
  (everyone in the store is blocked at once; the app shows "Store suspended"), and each store's
  audit log (team changes, voids, refunds, cancelled or edited bills, price and store changes).
- App lock (Android): 4–6 digit PIN plus optional fingerprint, asked on opening and after 5 minutes
  in the background; 5 wrong tries → verify with OTP (bills on the phone are kept). Optional for
  everyone, required for staff when the owner turns on Invoice settings → "Staff must lock the app".
- Login tokens are kept in Android's encrypted storage. Web sessions last 7 days of inactivity.
- Server: rate limit per login (600 requests a minute), security headers, only our own app
  origins in production, every store route tested against an outsider.
- Backups: Railway's daily / weekly / monthly Postgres backups plus point-in-time recovery.
  Restore steps and monitoring are in docs/operations.md (GitHub checks /health every 10 minutes).
- The Railway server and database run in US East (Virginia), not Singapore. Moving is possible later.
- Not yet: lock, fingerprint and secure storage untested on a real phone; `OTP_FIXED_CODE` must be
  removed before real users.
