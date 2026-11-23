# ApnaGalla — Phase 1 Functional Spec

Companion to [PLAN.md](PLAN.md). This spec describes **what each part does and how**. Items marked **❓** are open decisions for you.

---

## 1. Business profile
Set up during onboarding; editable later in **Settings → Business** (owner only).

| Field | Required | Shown on invoice | Notes |
|---|---|---|---|
| Business name | ✅ | ✅ header | Trade name |
| Legal name | – | optional | If different from the trade name |
| Logo | – | ✅ (toggle) | PNG/JPG, auto-resized |
| Address (line 1, line 2, city, state, PIN) | ✅ city/state | ✅ | |
| Phone | ✅ | ✅ | Defaults to the owner's login phone |
| Email, website | – | ✅ if filled | |
| Tax ID (label + value) | – | ✅ if filled | Free text, e.g. label "GSTIN" or "PAN". No GST rules applied |
| Authorised signature | – | ✅ (toggle) | Image upload or drawn on screen |
| Default notes | – | ✅ | e.g. "Thank you for your business" |
| Default terms & conditions | – | ✅ | Multi-line |
| Currency | ✅ | ✅ | INR (₹) fixed in phase 1 |
| Financial year start | ✅ | – | Default 1 April (used for number resets) |

**Snapshot rule:** when an invoice is saved, it stores a **copy** of the business details, customer details and item names/prices as they were at that moment. Editing the business address or a customer later **does not change past invoices**. This matters for record keeping.

---

## 2. Bank & payment details (shown on the invoice so customers can pay)
**Settings → Payment details** (owner only).

**Bank accounts:** you can add several.
- Fields: account holder name, bank name, account number, IFSC, branch (optional), account type (Current or Savings).
- Mark one as **Default**; it prints on every invoice.
- Change it per invoice from a dropdown, or choose "Don't show".

**UPI IDs:** you can add several.
- Fields: UPI ID (e.g. `shop@okbank`) and payee name.
- Mark one as **Default**.
- The invoice PDF shows a **UPI QR code with the balance due already filled in**, plus the invoice number as the payment note. The customer scans it and pays the exact amount.
- If there's no balance due, no QR is printed.

**Other payment instructions:** a free-text box, e.g. "Cheques in favour of …".

---

## 3. Payments: kept simple, one invoice at a time ✅ decided
Payment is recorded **on the invoice itself**. There's no separate payments ledger, no splitting one payment across invoices, and no advances.

**On the invoice screen → "Update payment":**
| Choice | What happens |
|---|---|
| **Unpaid** | Paid = ₹0, pending = full total |
| **Paid** | Paid = full total, pending = ₹0 |
| **Partially paid** | Enter the **amount paid**; pending is calculated automatically (total − paid) |

**Rules**
- **The amount paid can never exceed the invoice total.** The app blocks it with the message "Amount cannot be more than the invoice total ₹X".
- ✅ **One payment per invoice, no instalments.** An invoice holds a single payment entry: amount paid, date (defaults to today), and an optional mode (Cash, UPI, Bank, Cheque, Other). If the customer later pays the rest, the payment is **updated** (e.g. Partially paid → Paid), not added as a second entry. Each update is kept in the invoice history.
- **Overdue** is calculated automatically: unpaid or partially paid, and past the due date.
- **Cancelled** invoices show no payment status.
- The **pending amount** feeds into: the UPI QR (amount pre-filled), the WhatsApp reminder, the dashboard "Outstanding" figure, and the customer's total pending.
- **Customer screen:** total billed, total paid and total pending, worked out from that customer's invoices.
- **Who can change it:** staff can record a payment or increase the amount paid. Only the owner can reduce it or reset it to Unpaid.
- **WhatsApp reminder:** a ready-made message, e.g. "Hi {name}, ₹{pending} is pending against invoice {no} dated {date}. Pay via UPI: {link}". The owner can edit the template.

---

## 4. Invoice: every field

### 4.1 Header
| Field | Notes |
|---|---|
| Invoice number | Automatic (see PLAN §7). The owner can edit it before saving, and a duplicate is blocked |
| Invoice date | Defaults to today |
| Payment terms → due date | Due on receipt, Net 7, 15, 30, or a custom date |
| Reference / PO number | Optional |
| **Custom fields (up to 3)** ✅ phase 1 | The business defines labels once (e.g. "Vehicle No.", "Order ID"), then fills them per invoice |

### 4.2 Customer
- **Bill To:** pick an existing customer or **add a new one inline**. A "Walk-in / Cash customer" option needs no details.
- Fields: name, phone, email, address, tax ID (optional).
- **Ship To:** optional, either "Same as billing" or a different address.

### 4.3 Line items
| Column | Notes |
|---|---|
| Item | Picked from the catalogue (search), or typed freely. A typed item can be saved to the catalogue |
| Description | Optional second line |
| Qty | Decimals allowed (e.g. 2.5) |
| Unit | pcs, kg, box, hr, etc. (from the item; editable) |
| Rate | From the catalogue; editable |
| Discount | **% or ₹**, per line (see §6) |
| Tax % | From the catalogue; editable (0, 5, 12, 18, 28, or a custom value) |
| Amount | Calculated |

Lines can be reordered.

### 4.4 Summary (all calculated)
| Line | Notes |
|---|---|
| Subtotal | Sum of (qty × rate) |
| Item discounts | Total of all line discounts |
| Overall discount | % or ₹ (see §6) |
| Taxable amount | |
| Tax | Breakdown by rate, e.g. "Tax @5%: ₹45.00", "Tax @18%: ₹145.80" |
| Additional charges | Delivery, packing, etc., with an optional tax % |
| Round off | Nearest ₹1; can be turned off |
| **Grand total** | |
| Amount in words | e.g. "Rupees One Thousand Nine Hundred Only" |
| Paid / Pending | From the invoice's payment status (§3) |

### 4.5 Footer
Notes · Terms & conditions · Bank details · UPI QR · Signature · Footer text (e.g. "This is a computer-generated invoice").

### 4.6 Invoice lifecycle
| Action | Owner | Staff | Notes |
|---|---|---|---|
| Save as **Draft** | ✅ | ✅ | No number used yet; doesn't count in totals |
| **Save** (final) | ✅ | ✅ | Number assigned; counts in totals |
| Edit after saving | ✅ | ❌ | Each edit is recorded in history (who, when, what) |
| **Cancel** | ✅ | ❌ | The number is kept and the invoice is marked CANCELLED. Not deleted, so there are no number gaps |
| Delete | Drafts only | Drafts only | Saved invoices can't be deleted |
| Duplicate | ✅ | ✅ | Copies into a new draft |
| Share PDF, print, send reminder | ✅ | ✅ | |

**Estimates** have the same fields, their own number series (`EST/26-27/0001`), and statuses Open / Accepted / Declined / Converted. **Convert to invoice** copies everything into a new invoice.

---

## 5. Invoice designs (templates) ✅ decided
**The business chooses one design, and every invoice and estimate uses it.** It can be changed in Settings at any time; the change applies to all PDFs, including old invoices when they are re-shared.

| | |
|---|---|
| **Built-in designs (3)** | **Classic** (bordered table, traditional), **Modern** (clean, colour header band), **Minimal** (black and white, ink-saving) |
| **Customise** | Theme colour, font size (S/M/L), paper size **A4 or A5** |
| **Show/hide toggles** | Logo, tax ID, Ship To, item description, unit column, discount column, tax column, bank details, UPI QR, signature, terms, amount in words |
| **Per-invoice override** | ❌ Not allowed: one design for the whole business |
| **Live preview** | See the change instantly while customising |
| **Not in phase 1** | Drag-and-drop design builder; uploading your own template; receipt printer (2"/3") format |

**How it works:** each design is an HTML/CSS layout turned into a PDF on the phone, so it works offline. Every design reads the same invoice data, so new designs can be added later without touching anything else.

---

## 6. Discounts and tax: exact calculation

### 6.1 Item-wise discount
- Per line, entered as either **%** or **₹ (flat, for the whole line)**.
- `Line gross = qty × rate`
- `Line discount = gross × % ÷ 100`, or the flat ₹ amount (capped at gross)
- `Line net = gross − line discount`

### 6.2 Overall (invoice-level) discount
- Entered as **% or ₹**, applied **after** item discounts.
- ✅ **Always applied before tax** (there is no after-tax option). The overall discount is shared across lines in proportion to each line's net amount, so each line's tax is calculated on its reduced value. This keeps the tax correct when lines have **different tax rates**.

### 6.3 Tax
- `Line taxable = line net − its share of the overall discount`
- `Line tax = line taxable × tax% ÷ 100`
- ✅ **"Rate includes tax"** toggle per item (and editable per line). When on, the rate you type is the final price including tax, and the app works out the price before tax: `base rate = rate ÷ (1 + tax%/100)`. Example: ₹118 incl. 18% → base ₹100.00, tax ₹18.00. The invoice shows the before-tax rate and the tax separately.
- Rounding: each line is rounded to 2 decimals; the grand total is rounded to the nearest ₹1 (can be turned off), and the difference shows as **Round off**.

### 6.3a "Set final amount": the app works out the discount ✅ decided
For a price agreed with the customer (e.g. "make it ₹1,800 all-inclusive").
- On the invoice, tap **"Set final amount"** and enter the target total **including tax**.
- The app works out the **overall discount (before tax)** needed to land exactly on that amount, then recalculates every line's taxable value and tax.
- Formula: `discount fraction d = 1 − Target ÷ Σ(line net × (1 + tax%))`, then `overall discount ₹ = d × Σ line net`. Any 1–2 paise left over from rounding goes into Round off.
- **Rules:**
  - the target can't be higher than the current total (that would be a negative discount; the user is told to change rates instead);
  - the target can't be ₹0 or less.
- The result appears in the normal overall-discount field (as ₹), so the user can see and adjust it.
- **Worked example** (same items as §6.4, target ₹1,800):
  - Σ(net × (1+tax)) = 900 × 1.18 + 1,000 × 1.05 = 2,112.00
  - d = 1 − 1,800 ÷ 2,112 = 14.77%
  - Overall discount = 14.77% of ₹1,900 = **₹280.68**
  - Line A: share 132.95 → taxable 767.05 → tax 138.07
  - Line B: share 147.73 → taxable 852.27 → tax 42.61
  - Taxable 1,619.32 + tax 180.68 = **₹1,800.00** ✔

### 6.4 Worked example
| Line | Qty × Rate | Gross | Item disc | Net | Overall disc share | Taxable | Tax % | Tax |
|---|---|---|---|---|---|---|---|---|
| A | 2 × ₹500 | 1,000.00 | 10% = 100.00 | 900.00 | 90.00 | 810.00 | 18% | 145.80 |
| B | 1 × ₹1,000 | 1,000.00 | – | 1,000.00 | 100.00 | 900.00 | 5% | 45.00 |
| **Total** | | **2,000.00** | **100.00** | **1,900.00** | **190.00** (10%) | **1,710.00** | | **190.80** |

Overall discount 10% of ₹1,900 = ₹190, shared 900 : 1000 → ₹90 and ₹100.

| Summary | ₹ |
|---|---|
| Subtotal | 2,000.00 |
| Item discounts | −100.00 |
| Overall discount (10%) | −190.00 |
| Taxable amount | 1,710.00 |
| Tax @18% | 145.80 |
| Tax @5% | 45.00 |
| Round off | −0.80 |
| **Grand total** | **1,900.00** |

---

## 7. Other settings
- **Invoice settings:** prefix, starting number, reset each financial year (on or off), default payment terms, default tax %, round-off on or off, business design (one of 3), custom field labels (up to 3).
- **Units list:** editable.
- **Tax rates list:** editable (quick-pick when building an invoice).
- **WhatsApp reminder template.**
- **Team:** invite staff by phone, remove staff, see who created each invoice.

---

## 8. Complete development list

### M1 — Foundation
1. Monorepo setup: `app/` (React + Vite + TypeScript + Ionic) and `server/` (Node + Fastify + TypeScript); linting, formatting, CI.
2. Capacitor Android project; app icon, splash screen, package ID.
3. Local database (Dexie) with a schema for all entities and version upgrades.
4. Server: PostgreSQL schema plus migrations (Drizzle), a config/secrets system, health check.
5. Railway: API service, Postgres, storage bucket; staging and production environments.
6. Auth:
   - phone OTP request and verify (provider adapter, test mode until DLT approval);
   - login sessions per device with automatic refresh;
   - per-number rate limits on OTP requests (stop abuse).
7. Onboarding: create the business, set up the profile, invite staff and join flow.
8. App shell: bottom navigation, + button, offline/sync indicator, error handling.

### M2 — Core invoicing (offline)
9. Business profile, logo and signature upload, bank accounts, UPI IDs.
10. Settings: invoice settings, units, tax rates.
11. Customers: list, search, add/edit, opening balance.
12. Items catalogue: list, search, add/edit, rate includes tax, default tax and unit.
13. **Calculation engine** (one shared module with unit tests covering every case in §6, including "rate includes tax" and "Set final amount").
14. Invoice editor: header, customer pick or inline add, lines, discounts, charges, summary, custom fields.
15. Invoice list (filters: status, date, customer; search) and invoice detail.
16. Invoice lifecycle: draft, save, edit history, cancel, duplicate.
17. Estimates: editor, list, statuses, convert to invoice.
18. PDF engine plus the **3 designs** (Classic, Modern, Minimal), customisation, live preview, A4/A5.
19. UPI QR generation and amount in words.
20. Share (WhatsApp, email, any app) and print through the system print dialog.

### M3 — Sync and team
21. Server sync API: push (batch, idempotent) and pull (change number), per-business isolation.
22. Client sync engine: change queue, retry and back-off, triggers (open, reconnect, after save, timer).
23. Conflict handling (latest edit wins) and handling of deleted records.
24. Invoice and estimate number allocator: server sequence plus offline blocks, financial-year reset.
25. Roles and permissions enforced on **both** the app and the server.
26. Multi-device: first login on a new phone downloads all data, with a progress bar.
27. Warning before logout when unsynced data exists; "last synced" time.

### M4 — Payments and dashboard
28. Invoice payment update: Unpaid / Paid / Partially paid (one payment entry per invoice, amount entered, pending calculated, capped at the invoice total).
29. Overdue logic; payment change history.
30. Customer detail: total billed, paid and pending, plus a statement (on-screen and as a PDF to share).
31. WhatsApp reminder with an editable template.
32. Dashboard: sales, received, outstanding, overdue, recent activity; staff see only their own figures.

### M5 — Bill scanning
33. Camera/gallery capture, crop, multi-page, compression.
34. Offline photo queue ("Waiting to scan"), upload with retry.
35. Server scan endpoint: store the image in the bucket, call the AI through a provider adapter (free tier), check the result against the fixed format.
36. Matching names to existing customers and catalogue items (fuzzy matching).
37. Review screen: uncertain fields highlighted, total-mismatch warning, add new items/customer → save as invoice.
38. Monthly scan limit per business; usage counter.

### M6 — Release
39. Privacy policy and terms pages (hosted).
40. In-app **account deletion** (Play requirement), plus the server-side deletion job.
41. Security pass: storing login tokens securely on the phone, HTTPS only, server input validation, checks that one business can never see another's data.
42. Testing:
    - unit tests (calculations, sync, numbering);
    - API tests;
    - end-to-end tests of the main flows;
    - real-device testing on 2–3 Android phones, including offline-to-online scenarios.
43. Web app deploy (Railway or static hosting).
44. Play Store: signed app bundle, store listing, screenshots, Data Safety form, internal test track → production.
45. Basic monitoring: server logs, crash and error reporting (a provider that doesn't need Google, e.g. Sentry).

---

## 9. Decisions log
| # | Topic | Decision |
|---|---|---|
| 1 | Custom invoice fields | ✅ Phase 1, up to 3 |
| 2 | Per-invoice design override | ❌ No: one design for the whole business |
| 3 | Overall discount | ✅ Before tax only, plus **"Set final amount"** that works out the discount automatically (§6.3a) |
| 4 | Rate includes tax | ✅ Yes, per item and per line |
| 5 | Number of designs | ✅ 3 (Classic, Modern, Minimal) |
| 6 | Payments | ✅ Per invoice: Unpaid / Paid / Partially paid; pending calculated; never more than the invoice total; no advances or credit |
| 7 | Instalments | ❌ No: one payment entry per invoice, updated if more is paid later |
