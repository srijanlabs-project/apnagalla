# ApnaGalla: how every money figure is calculated

*A guide for the reviewing Chartered Accountant. Written from the app's source code (branch `feat/r1-accounts-stores`, build R11). "Points to check" lists the questions we would like you to confirm or correct.*

## How the app works

- **All money is stored in whole paise** (₹1 = 100 paise). Quantities may have decimals (rounded to 3 places in stock).
- **Rounding rule everywhere:** round half up to the nearest paisa (0.5 paisa goes up). The rule ignores floating-point noise, so 1.005 does not become 1.0049999.
- **Nothing is "posted" and stored.** Stock, khata balances, bank balances, the cash book, the double-entry books, the trial balance and the GST returns are all **re-calculated from the source documents every time you open them**. Bills, payments, purchases, expenses and so on are the only records. So if an old document is edited, cancelled or voided, every report for past periods changes too. Only a "lock" setting stops this (see §1).
- Financial year: April–March. Labels look like "26-27".

---

## 1. Bill (invoice) totals

### Step by step, per line

1. **Rate before tax.** If the price is entered *including tax*:
   `Base rate = Price incl. tax ÷ (1 + GST%)`. This is not rounded at this step.
   If entered *excluding tax*: `Base rate = Price`.

2. **Gross** = `qty × base rate`, rounded to the paisa.

3. **Line discount**: a % of gross (at most 100%), or a fixed ₹ amount (at most the gross), rounded to the paisa. The discount always comes **off the pre-tax value**, even when the price was typed including tax.

4. **Net** = Gross − Line discount.

### Discount on the whole bill (before tax)
- `Overall discount` = % of Σ Net, or a fixed ₹ amount (at most Σ Net), rounded to the paisa.
- It is shared out to the lines **in proportion to each line's Net**, using the largest-remainder method, so the shares add up exactly. Any leftover paisa goes to the line with the biggest fraction (if two tie, the earlier line).
- **Taxable value of a line** = Net − its share of the overall discount.
- **Line GST** = `Taxable × GST%`, rounded to the paisa **for each line**. The bill's tax for each rate is the sum of the rounded line taxes.

### Additional charges (delivery, packing…)
- Each charge is entered **before tax** with its own GST% (a new charge **defaults to 0%**). `Charge tax = amount × rate`, rounded per charge, and added to that rate's tax.
- Charges are **not** reduced by the overall discount.

### Grand total and round-off
- `Before round-off = Σ taxable value + Σ charges + Σ tax`
- When "Round off to nearest ₹1" is on (the default), the total is rounded half up to whole rupees: `Round off = rounded total − total before round-off`, a figure between −₹0.50 and +₹0.50.

### "Set final amount" (bill target)
When the cashier types the final amount, the app works out the overall discount that gets there:
`d = 1 − (Target − charges incl. their tax) ÷ Σ(Net × (1 + GST%))`, then `Overall discount = d × Σ Net` (rounded).
This discount is shared out and taxed in the usual way. Any paise left over go into "Round off" (`Round off = Target − total before round-off`). The target can only **lower** a bill. It cannot be higher than the current total (it may be up to ½ paisa above, to allow for rounding).

### Worked example
Line A: 3 × ₹100 excl. 18%, line discount 10%. Line B: 1 × ₹236 incl. 18%. ₹50 off the bill. Delivery ₹40 at 0%.

| | A | B |
|---|---|---|
| Base rate | 100.00 | 236 ÷ 1.18 = 200.00 |
| Gross | 300.00 | 200.00 |
| Line discount | 30.00 | 0 |
| Net | 270.00 | 200.00 |
| Share of ₹50 (270:200) | 28.72 | 21.28 (B has the bigger remainder, so it gets the spare paisa) |
| Taxable | 241.28 | 178.72 |
| GST 18% (rounded per line) | 43.43 | 32.17 |

Taxable 420.00 + delivery 40.00 + tax 75.60 = 535.60 → round off +0.40 → **₹536.00**. CGST 37.80 + SGST 37.80.

**Price-including-tax example:** 1 × ₹100 incl. 18%: base 84.7458 → gross ₹84.75 → tax 15.255 → ₹15.26 → total ₹100.01 → round off −₹0.01 → ₹100.00. The 1 paisa that comes from working back the tax is absorbed by round-off. If round-off is off, the bill shows ₹100.01.

### Other rules
- "₹20 of dhania" in New sale: `qty = amount ÷ price incl. tax` (rounded to 3 decimals). The line is then calculated as above, so it may not come to exactly ₹20.
- Offers and coupons (% off, ₹ off, buy N get M free, combo price) are turned into **line discounts before tax**. A free unit = a discount equal to its base rate.
- Staff have a maximum discount %. A bigger discount needs the owner.
- **Editing saved bills:** the owner can still edit a saved invoice. Totals are re-calculated, the number stays, and a history line is added. Staff cannot. The lock settings `lockBillsAfterDays` and `booksClosedUntil` block edits and cancellations for older dates ("make a credit note instead").
- **Cancelling** a bill is allowed only when it has no payments and no credit notes. A cancelled bill leaves sales and GST but keeps its number (it is counted as cancelled in the GSTR-1 documents list).

**Points to check**

- Tax is rounded **line by line** and then added up, not worked out on the total for each rate. Is that acceptable on the tax invoice? (Rule 46 allows either way, but totals can differ from a rate-wise calculation by a few paise.)
- A "₹50 off" on a price-including-tax bill takes ₹50 off the *pre-tax* value, so the customer actually saves ₹59 at 18%. Is that the intended treatment?
- Additional charges default to 0% GST. Under the composite-supply rule, delivery and packing usually take the rate of the main supply.
- Round-off is booked to a "Round off" account (see §10). Please confirm that this is acceptable.
- The owner can edit a saved tax invoice until the lock period applies. Do you want a firm lock (for example, after GSTR-1 is filed)?

*Source: shared/src/calc.ts, app/src/lib/repo.ts (computeTotals, saveInvoice), app/src/lib/offers.ts, app/src/lib/fresh.ts, shared/src/locks.ts*

---

## 2. GST

### Store GST type
`gstType` is one of **regular**, **composition** or **unregistered**. Older stores with no type are treated as regular if their tax ID is a valid GSTIN, otherwise unregistered. **Only a regular store charges GST.** When a composition or unregistered store saves a bill, the tax mode is forced to "none".

### Tax mode of a bill
- `gst` = Tax Invoice. `none` = no GST.
- A regular store can still choose **"No GST"** for a bill. Its title is then "Bill of Supply", and all line and charge rates are set to 0. The entered price is used as-is: a price that included tax is **not** split into base and tax.
- Composition store bills say "Bill of Supply" and carry the declaration *"Composition taxable person, not eligible to collect tax on supplies"*. Unregistered stores print "Invoice".
- Bills saved before release R1.3 have mode "legacy": they show "Tax @x%" with no CGST/SGST split.

### Intra-state or inter-state
- **Place of supply** (fixed when the bill is saved) is taken from the first of these that is set: the state chosen by hand → the ship-to state → the bill-to address state → the buyer GSTIN's state code → the store's own state.
- **Store state** = the first two digits of the store GSTIN (for regular and composition stores), otherwise the state in the store address.
- `Inter-state = place of supply ≠ store state` → **IGST**. Otherwise **CGST + SGST**. SGST is labelled **UTGST** for stores in Chandigarh, A&N, Lakshadweep, DNH&DD and Ladakh.
- **Split:** for each rate, `CGST = round(tax ÷ 2)` and `SGST = tax − CGST`. An odd paisa goes to CGST.

### Rates and codes
- Default rate list: **0, 3, 5, 18, 40%** (the slabs from 22 Sep 2025). The store can edit it.
- HSN/SAC must be 4, 6 or 8 digits.
- **No cess field** (cess is always 0).
- GSTINs are checked offline (format, state code, mod-36 check digit). An online lookup is cached for 30 days.

### HSN summary report
Rows are grouped by HSN + rate + unit, using **GST bills less all credit notes**. CGST and SGST are split **line by line** here, so the totals can differ by a paisa or two from the bill-level split. The quantity in this report is the line quantity **without** the pack-unit factor. The GSTR-1 HSN table (§12) multiplies by the factor.

### Number series
- Series: `invoice`, `bill` (non-GST bills of a **regular** store), `estimate`, `credit`, `challan`, `order`, `proforma`.
- Default pattern `{PREFIX}-{CODE}/{FY}/{SEQ}`, for example INV/26-27/0001. A staff member's bills get a letter: INV-B/26-27/0001.
- Checks: at most 16 characters, only letters, digits, "-" and "/", and the number must restart each financial year with {FY} in the pattern.
- Default prefixes: INV, BOS, EST, CN, DC, SO, PI.
- Numbering is **per person by default** (each phone numbers its own series), or **shared** (each phone takes a block of numbers from the server).

**Points to check**

- "No GST" bills on a regular store are a separate series and are reported in GSTR-3B 3.1(e) as **non-GST supplies** (see §12). The app does not ask *why* a bill is non-GST. If the goods are in fact taxable, tax is under-reported. Should this option be limited (for example, to exempt items only)?
- Place of supply uses the **bill-to address before the buyer's GSTIN**. Please confirm that this order is right for your clients' B2B trade.
- Per-person series mean several series run at the same time. Each is reported separately in GSTR-1 Table 13.
- There is no reverse-charge or cess support, and no handling of exports or SEZ supplies.

*Source: shared/src/gst.ts, app/src/lib/gstView.ts, app/src/lib/repo.ts (settleGst, seriesOf, defaultSettings), app/src/lib/reports.ts (hsn)*

---

## 3. Credit notes, returns, exchange and refunds

- A credit note is always made **against one saved invoice**. Reasons: `return`, `price` (price cut) or `other`. Staff can make returns only. Price cuts, other reasons, edits and cancellation are for the owner.
- The draft copies the invoice's lines, customer, tax mode and place of supply. It keeps the **overall discount only if it was a %**. A fixed-₹ or "final amount" discount is **not** carried over, and neither are charges. Round-off follows the invoice.
- Its totals use the same calculation as §1. Limit: `credit note total ≤ invoice total − earlier saved credit notes`.
- **Effect on the bill:** `Due = max(0, invoice total − credit notes)`. If more has been paid than is now due, the difference is **refund due**.
- **Stock** comes back only for credit notes with reason "return".
- **GST:** the note carries the same CGST/SGST or IGST split as its invoice and reduces output tax in the month of the **note's date** (sales register, GSTR-3B, GSTR-1). The number comes from the `credit` series. There is one series for both GST and non-GST notes.
- **Settling the money owed back (once per note):**
  - *Refund* in cash, UPI, card, etc. This is a "refund" entry, at most the refund due.
  - *Keep as credit*: a refund entry in mode "credit note". No money moves, and the note holds the credit. Later bills can be paid with it (mode "credit note") until it is used up. Walk-in customers can use it by quoting the note number.
- **Exchange:** the refund due on the old bill pays the new bill through two "advance" entries (a refund on the old bill, a payment on the new one). No cash moves.
- Customer loyalty points earned are taken back on returns (§13).

**Points to check**

- The app does not check the Section 34 time limit for credit notes (30 November after the end of the financial year, or the annual return if earlier).
- If the bill had a fixed-₹ discount, the return is valued at the undiscounted price, capped at the invoice balance. Is that acceptable, or should the discount be shared out?
- Credit notes with reason "price" or "other" reduce output GST too. Please confirm that the conditions for reducing GST on a post-sale discount are met.
- Credit kept on a note is not shown as a negative balance in the "To collect" receivables report. The khata balance and the books do show it.

*Source: app/src/lib/repo.ts (credit notes, recordPayments), app/src/lib/ledger.ts, app/src/lib/credit.ts, app/src/lib/khata.ts (applyExchange)*

---

## 4. Payments

### Modes and what each one means

| Mode | Money lands in | Notes |
|---|---|---|
| cash | Cash drawer | `cashGot` (cash handed over) is kept for information only. The change given back has no effect on the books. |
| upi, card, bank, cheque, finance | A bank account (the one chosen, else the default) | Finance/EMI: the full amount goes to the bank on the payment date. |
| other | "Money in other modes" (current asset) | Never moves into cash or bank by itself. |
| advance | No money moves | Uses the customer's advance or an exchange (see §5). |
| creditnote | No money moves | Uses credit kept on a credit note. |
| points | Loyalty expense | Value = points × point value (§13). |
| buyback | Purchases | "Old item taken back" in part payment (§13). |
| voucher | Clears the gift-voucher liability | §13. |

### Rules
- Every payment or refund is a separate, unchangeable entry. Several entries make a split payment.
- **Payments on a bill cannot exceed what is pending, and refunds cannot exceed the refund due.**

- `Paid = Σ payments − Σ refunds` (voided entries are left out). `Pending = max(0, Due − Paid)`.
  Status: *credited* (Due = 0 after credit notes) / *paid* / *partial* / *unpaid*.
- **Overdue:** pending > 0 and the bill's due date is before today. The due date comes from the payment terms (default 0 days).
- **Cheques:** received cheques start as *pending*. In the books they sit in "Cheques not yet cleared" until they are marked *cleared*, then move to the bank on the clearing date. The cash-flow and bank book ignore a cheque until it clears. A **bounced** cheque is **voided** (owner only): the bill is pending again and the original entries disappear from every report, past periods included. No bounce charge is booked. Cheques paid **to** suppliers have no pending stage: they hit the bank on the payment date.
- **Voiding** (owner only): the entry stays visible, crossed out, with a reason. It drops out of all money figures, books and the cash book **retroactively**.
- **Instalment plans** (§13) are a schedule only. Payments fill instalments in order.

**Points to check**

- Card and finance payments are booked at the gross amount. Bank charges (MDR) and finance-scheme subvention are not recorded unless entered as an expense.
- Voiding or bouncing changes earlier periods instead of reversing on the void date. Is this acceptable once books are closed? (The lock setting covers edits to bills, but voiding is controlled only by the owner role.)
- Mode "other" money stays in a holding asset account forever.

*Source: app/src/lib/repo.ts (recordPayments, voidPayment), app/src/lib/ledger.ts, app/src/lib/cheques.ts, app/src/lib/money.ts*

---

## 5. Customer khata (account)

- **Balance** = `opening balance + saved bills − saved credit notes − payments received + refunds paid`. Moves inside the account (modes "advance" and "credit note") are left out because they net to zero. A negative balance means the store holds the customer's money.
- The **opening balance** is posted on the date the customer was created.
- **Receive payment** (khata screen), in this order:
  1. The opening balance still unpaid.
  2. **Pending bills, oldest first.**
  3. Anything left stays **on account as an advance**.
  One receipt id links the entries.
- **Advances:**
  - *Customer advance* = `money on account − money already used to settle the opening balance`. It can be used on any bill with "Use advance".
  - *Held advance* = money taken against a specific **estimate or job** (tagged with `jobId`). It does **not** settle the opening balance and can only pay the bill made from that estimate.
  - A rental deposit is taken as a khata payment (§13).
- **Credit limit:** a warning, or a block if `creditLimitBlocks` is on, when `current balance + unpaid part of the new bill > limit`.
- **Receivables report ("To collect")** covers named customers only: `opening + Σ(pending − refund due) per bill − net on-account money`. Overdue = pending on bills past their due date. **Unpaid walk-in bills are not in this report** (they do appear in the books under "Walk-in customers").

**Points to check**

- Advances against estimates, proformas and jobs are booked only as a credit to the customer (no GST). This is fine for goods, but for **services such as repair jobs**, GST is payable when an advance is received.
- Cash taken through "Receive payment" is used on the oldest bills automatically. Please confirm that this matches how your clients want receipts allocated.

*Source: app/src/lib/khata.ts*

---

## 6. Cash book and day-end

- **Opening cash** for a day = the last **day-end count**. If a day was not closed, the running expected figure carries on. **There is no opening cash balance setting**: the cash book starts from ₹0.
- **Expected cash** = `opening + cash in − cash out` for the day.
  - *In:* cash payments on bills and khata (less cash refunds), cash other income, cash loans received, cash gift-voucher sales, withdrawals from the bank, and positive corrections.
  - *Out:* cash paid to suppliers (supplier refunds count as in), cash expenses, cash loan repayments or loans given, cash interest and charges, deposits into the bank.
  - UPI, card and bank receipts are shown separately and do not touch the drawer. Advance, credit note, points, buyback and voucher payments are left out.
- **Day-end:** `Difference = counted − expected`. The next day's opening becomes the counted figure. In the books an excess is `Dr Cash / Cr Cash short-excess` and a shortage is the reverse. "Cash short-excess" is an indirect expense account.
- Day-end is compulsory: a day with any bill, payment or expense must be closed before billing on a later day. This applies from 27 Nov 2026 for existing stores. Default times: opening 09:00, closing 21:00.
- **Day-start count** (morning) is kept for the record only and never changes the cash book or the books.
- **Change given back:** only the bill amount is recorded as cash in. `cashGot` is for information.

**Points to check**

- There is no opening cash balance. On the first day-end, the cash already in the drawer shows up as a **"cash excess" (income)**. It should go to capital or opening balances instead.
- Owner capital put in or drawings taken in **cash** (journal entries, §10) affect cash in the books but **not the cash book**. The next count then shows a false difference, which is booked again to cash short-excess.
- Cash shortages and excesses go straight to profit and loss. Do you want a suspense account or staff recovery instead?

*Source: app/src/lib/cashbook.ts, app/src/lib/dayEnd.ts, app/src/lib/books.ts*

---

## 7. Purchases and suppliers

- **Purchase bill totals** use the **same calculation as sales** (§1): line discount, overall discount, charges with their own GST, round-off to ₹1 (on by default). A "no GST" purchase has all rates set to 0.
- **Tax mode of a new purchase:** GST if the supplier has a GSTIN **or** the store is regular. Otherwise none.
- **Input GST split:** IGST when the **supplier GSTIN's state** differs from the store state, otherwise CGST/SGST (CGST = round(tax/2)). A scanned bill showing IGST also sets inter-state.
- **Unit cost** (for the item's purchase price) = rate before tax ÷ pack factor.
- **Landed cost** (when "spread charges" is on, the default): `(line taxable value + bill charges × line taxable ÷ total taxable) ÷ base units`. The charges are spread **before tax**, and the tax on the charges is left out of cost. When a bill is saved with "update prices", items get the new landed cost as their **purchase price**. Owners can also update MRP and selling price. New lines automatically become new items.
- **Supplier balance (payables)** = `opening balance + purchase bills − purchase returns − payments + refunds from supplier`.
- **Bills to pay by due date:** payments and returns are used first against the opening balance, then against the **oldest bills**. Whatever is unpaid on a bill with a due date is listed, with days late.
- **Purchase returns** are separate purchase records (`kind = return`). They copy the original lines, reduce stock, reduce input GST in the month of the return, and reduce the supplier balance.
- Supplier payments: cash, UPI, bank, cheque, etc. They can be voided by the owner.
- **Purchase orders** have no accounting effect.

**Points to check**

- **Composition and unregistered stores:** purchases from a GSTIN supplier default to tax mode GST, so the input tax goes to "Input GST" in the books and to ITC in GSTR-3B. These stores cannot claim ITC, so for them the GST should be part of cost.
- Freight on purchases is spread into item cost, but **its GST** is kept as input tax. Please confirm.
- Inter-state on purchases is decided by the supplier's GSTIN only (not the place of supply on the supplier's bill).

*Source: app/src/lib/purchases.ts, app/src/lib/reports.ts (purchaseGst)*

---

## 8. Stock

- **Stock level** is never stored. It is added up from: opening stock entries, manual changes (damage, wastage, theft, expiry, gift, own use, production, count corrections), purchases (+), purchase returns (−), sales (−), return credit notes (+), delivery challans (−, and the bill made from a challan does not reduce stock again) and transfers. Drafts and cancelled documents are left out. Pack units multiply by `unitFactor`.
- Services, area-priced items, items with variants and items set "don't track stock" are not counted.
- **Valuation method: there is none (no FIFO and no weighted average).** Every stock value uses the item's **current purchase price**: `value = max(0, qty) × item.purchasePrice`. That price is the **latest landed cost** from the most recent purchase bill saved with "update prices", or whatever was typed in. Negative stock counts as 0 in value.
- **Opening stock:** valued at the item's *current* purchase price whenever the books are worked out. Changing the price later changes the old opening-stock value.
- **Wastage report:** `waste cost = qty wasted × purchase price`. `Margin = sales − qty sold × purchase price`.
- **Transfers between stores** (same owner): two stock entries, minus in one store and plus in the other. **No invoice, delivery challan or money entry** is made.
- **Godowns:** a location tag on stock entries for a stock-by-godown view. No accounting effect.
- **Batches and expiry:** on save, the earliest-expiring batch that has not expired (FEFO) is filled in. Batches are for tracking only; there is no batch-wise cost.
- **Consignment (sale or return):** a consignment challan takes goods **out of stock** when sent. What is sold is billed later. Returned goods come back in with a stock entry.

**Points to check**

- Valuing at the **latest purchase price** is not AS-2 cost (FIFO or weighted average). Is that acceptable for your clients, or do we need a proper method?
- Goods on consignment and goods on unbilled delivery challans are **left out of closing stock** even though they still belong to the store.
- Stock transfers between two stores that have **different GSTINs** (for example, in another state) are taxable supplies, but the app makes no tax invoice. Also, the sending store loses closing stock with no matching credit, and the receiving store gains stock with no purchase cost.
- Old gold or old items taken back (buyback) do not enter stock.

*Source: app/src/lib/stock.ts, app/src/lib/books.ts (closingStock), app/src/lib/transfers.ts, app/src/lib/batches.ts, app/src/lib/fresh.ts, app/src/lib/consignment.ts*

---

## 9. Expenses, other income, loans, money moves

- **Expenses:** a single gross amount, a category (rent, salary, electricity, transport, tea, repairs, phone, other, or the store's own), a mode and a bank account. There is **no GST field**: the GST on expense bills is not captured as input tax.
- **Staff pay:** monthly salary earned = `rate × paid days ÷ days in month`. Daily wage = `rate × paid days`. Absent counts as 0 days, half day as 0.5, present and leave as 1. Days not marked count as present. **Salary advances are booked as an expense when given.** When recovered from salary, no cash moves.
- **Repeating expenses** (for example, monthly rent) create normal expense entries when paid.
- **Other income** categories: interest, rent, commission, **scrap sale**, discount received, other. Booked as `Dr Cash/Bank, Cr Income`. There is no GST on these entries.
- **Loans:**
  - Taken: received (Dr cash/bank, Cr loan), repaid (Dr loan, Cr cash/bank), interest paid (Dr interest expense), charges (Dr bank and loan charges).
  - Given: given (Dr loan asset), received back (Cr loan asset), interest received (Cr interest income).
  - The loan balance counts **principal only**.
- **Money moves:** deposit (cash to bank), withdraw (bank to cash), transfer (bank to bank). These are contra entries.
- **"Correct balance to what the bank shows"** books the difference to **"Balance corrections" (suspense, an indirect expense)**.

**Points to check**

- Staff advances should be an asset (loans and advances) until recovered, not an expense.
- GST paid on expenses (rent, repairs, phone) is not claimed. Do you want an input-GST field on expenses?
- A scrap sale entered as "other income" carries no GST (scrap is usually taxable).
- Bank-balance corrections go straight to profit and loss through suspense.

*Source: app/src/lib/purchases.ts (expenses), app/src/lib/staffPay.ts, app/src/lib/money.ts, app/src/lib/books.ts*

---

## 10. Books (double entry)

The books are worked out from the records each time (see "How the app works"). Stock uses the **trading method**: opening stock is an expense when entered, purchases are an expense, and closing stock is added at the date of the report. Debit = +, credit = −.

### Posting rules

| Event | Debit | Credit |
|---|---|---|
| Customer opening balance (customer creation date) | Customer | Opening balances (capital) |
| Supplier opening balance | Opening balances | Supplier |
| Bank, loan or own-ledger opening balance | Bank / loan given / ledger | Opening balances (reversed for a loan taken) |
| Opening stock entry | Opening stock (direct expense), qty × current purchase price | Opening balances |
| **Sale bill** | Customer (or "Walk-in customers"): grand total | Sales: `grand total − GST − round off` (includes charges). Output CGST/SGST/IGST. Round off. |
| **Credit note** | Sales, Output GST, Round off (the reverse) | Customer |
| Payment received (cash/bank/other) | Cash / bank / other money | Customer |
| Refund paid | Customer | Cash / bank |
| Cheque received | Cheques not yet cleared | Customer |
| Cheque cleared (clearing date) | Bank | Cheques not yet cleared |
| Paid with points | Loyalty points used (indirect expense) | Customer |
| Paid with old item (buyback) | **Purchases** | Customer |
| Paid with gift voucher | Gift vouchers not yet used (liability) | Customer |
| Gift voucher sold | Cash / bank / other money | Gift vouchers not yet used |
| Advance used / credit note used / exchange | *no posting* (movement inside the customer account) | |
| Purchase bill | Purchases (`total − GST − round off`), Input CGST/SGST/IGST, round off | Supplier ("Purchases without a supplier" if none) |
| Purchase return | Supplier | Purchases, Input GST (the reverse) |
| Paid to supplier | Supplier | Cash / bank |
| Expense | Expense category (indirect) | Cash / bank |
| Other income | Cash / bank | Income category (indirect) |
| Loans | see §9 | |
| Cash ↔ bank move | To account | From account |
| Balance correction (+) | Bank / cash | Balance corrections (suspense) |
| Day-end excess / short | Cash / Cash short-excess | Cash short-excess / Cash |
| Owner capital / drawings | Cash or bank / Drawings | Capital / Cash or bank |
| Owner's journal | as entered (needs ≥ 2 lines, debits = credits, no line both) | |

**Account groups:** Output GST is under Duties and taxes (liability). **Input GST is a current asset.** Round off, Cash short-excess, Balance corrections, Loyalty and Interest are indirect expenses. Opening balances count as capital.

### Trial balance, P&L, balance sheet
- **Trial balance on a date** = the sum of all postings up to that date, plus closing stock: `Dr Closing stock (asset) / Cr "Closing stock taken off cost" (direct income)`, at the §8 value. It always balances.
- **Balance sheet:** a customer with a credit balance is shown as **"Advances from customers"**. A supplier with a debit balance is shown as an asset. *Profit so far* = −Σ(income + expense balances) up to the date, placed under capital.
- **There is no year-end closing.** Income and expense balances run from the first record ever, so "Profit so far" is **cumulative since the app was started**, not this year's profit. The balance sheet footnote says: "Stock at current cost. Check with your CA before filing."
- **Ledger of any account:** brought-forward balance, each posting, closing balance.
- Bills or credit notes saved before release R1.3 ("legacy") post **no GST lines**: their tax sits inside Sales.

**Points to check**

- The balance sheet needs a profit-and-loss appropriation and closing step for each year. At present the profits of all years are lumped together.
- Buyback is debited to *Purchases* while the item never enters stock (§8). Please confirm the treatment.
- There is no provision for depreciation, accruals or prepaid expenses except through manual journals.
- A cancelled or voided document disappears from every past period. There is no reversing entry.
- Because opening stock and closing stock are both valued at today's price, past trial balances change when item prices change.

*Source: app/src/lib/books.ts*

---

## 11. Reports: profit, receivables, payables

**There are two different profit figures, and they can disagree:**

1. **Profit report and P&L statement** (Reports → Money):
   - `Sales = Σ line taxable values of bills − Σ line taxable values of return credit notes`. This **excludes additional charges** and **excludes price-cut or other credit notes**.
   - `Cost of goods sold = Σ (qty sold − qty returned) × item's CURRENT purchase price`. An item with no purchase price costs 0 (the report warns about this).
   - `Gross profit = Sales − COGS`.
   - `Net profit = Gross profit − expenses − loan interest and charges + other income + interest received`.
   - Left out: round off, loyalty points, cash differences, balance corrections, wastage, buyback and stock adjustments.

2. **Books P&L** (trial balance): Sales including charges and all credit notes, `− (Opening stock + Purchases − Closing stock)`, minus every expense account (including round off, loyalty, cash short and suspense).

**Other reports:**

- Sales report: grand totals including GST, returns and pending, by day.
- Collections: by mode, net of refunds, leaving out advance and credit note.
- Day book, cash flow (cash and bank, pending cheques left out), bank statement.
- Staff, store, customer and item-wise sales.
- Slow movers and stock report (value at purchase price).
- Receivables and payables (formulas in §5 and §7). Bills to pay. Supplier dues.

**Points to check**

- Which profit should owners be shown? The report-based COGS ignores wastage, shrinkage and changes in purchase price.
- Charges such as delivery are income in the books but not in the profit report.

*Source: app/src/lib/reports.ts (itemSales, profit, netProfit, pnl), app/src/lib/books.ts*

---

## 12. GST returns

All return sheets are marked "Check with your CA before filing."

### GSTR-1 (one month, JSON in the GST offline-tool format, version GST3.2)
- Only **saved bills and notes with tax mode GST** are included.
- **B2B:** buyer GSTIN passes the offline check. Grouped by buyer GSTIN, invoice type "R", reverse charge "N", items by rate.
- **B2CL:** no valid GSTIN, **inter-state** and grand total **> ₹1,00,000** (`B2CL_LIMIT = 100_000_00` paise).
- **B2CS:** all other bills, grouped by INTRA/INTER × place of supply × rate, type "OE". Credit notes to **unregistered** buyers are **netted into B2CS** (there is no CDNUR table).
- **CDNR:** credit notes to registered buyers (note type "C").
- **HSN:** split into B2B and B2C (registered or not). Quantity = qty × pack factor. Unit codes: pcs→NOS, kg→KGS, ltr→LTR, box→BOX, and so on, with anything else as OTH. CGST/SGST split line by line. Lines with no HSN are reported as problems.
- **Documents issued:** each number series (from–to, total, cancelled). Invoices and bills go under doc no. 1, credit notes under doc no. 5. **Non-GST "bill" series numbers are listed under doc 1 too.**

- 0% lines on a tax invoice go into B2B/B2CS at rate 0. There is no nil-rated/exempt table (`nil`).

### GSTR-3B (any period)
- **3.1(a):** taxable value and tax of GST bills (rates above 0%) **less credit notes**.
- **3.1(c):** 0% lines on GST bills (nil-rated or exempt).
- **3.1(e) non-GST:** `grand total − round off` of **every non-GST bill**, net of non-GST credit notes. This includes the bills of composition and unregistered stores, and the "No GST" bills of a regular store.
- **4(A)(5) ITC:** all GST purchase bills less purchase returns (rates above 0%). There is **no 2B filter, no blocked credits under Section 17(5), no reversals**, and no GST from expenses.
- **5:** non-GST purchases and 0% purchase lines.
- **6.1 tax payable in cash:** IGST credit is used first against IGST. What is left is split equally against CGST and SGST, and any still unused goes to CGST. CGST credit is used against CGST and SGST credit against SGST. **CGST and SGST credit are never used against IGST.**

- Table 3.2 (inter-state supplies to unregistered persons), RCM, interest and late fee are not produced.

### GSTR-9 (financial year of the chosen end date)
4A B2C and 4B B2B (bills before credit notes, split by whether the buyer has a tax ID), 4N net of credit notes, 5D/5E nil, 5F non-GST, 6A ITC, 9 payable. All come from the same calculation as 3B.

### GSTR-2B matching
The store loads the 2B or 2A JSON. Its B2B invoices are matched to purchase bills (GST, kind = bill) by **supplier GSTIN + bill number**. Bill numbers are compared using letters and digits only, with leading zeros dropped. Results:
- **Matched** if total tax (IGST + CGST + SGST + cess) is within **₹1** of the books.
- **Differs** otherwise.
- **In 2B, not entered**.
- **Entered, not in 2B** (bills in the period only).

Taxable value is not compared, and credit or debit notes in 2B are ignored.

### Also available
E-invoice (IRP schema 1.1) and e-way bill JSON (the app's note says goods over ₹50,000 need one). Tally XML export of sales, credit notes and purchases.

**Points to check**

- Credit notes against **B2CL** invoices should be reported in CDNUR, not netted into B2CS.
- "No GST" bills of a regular store reported as **non-GST supplies** in 3.1(e) is likely wrong unless the goods really are outside GST. Exempt supplies belong in 3.1(c).
- Composition stores file CMP-08 and GSTR-4, not 3B. The app still produces a 3B and would show purchase ITC (§7).
- ITC equals all GST purchases. Rule 36(4), Section 17(5) and 2B-only eligibility are left to you.
- In the utilisation order, CGST and SGST credit are never used against IGST. Please confirm.
- Please check the GSTR-1 document numbers used for bills of supply.

*Source: app/src/lib/gstr1.ts, app/src/lib/gstReturns.ts, app/src/lib/gstr2b.ts, app/src/lib/einvoice.ts, app/src/lib/tally.ts*

---

## 13. Loyalty, vouchers, schemes, rentals, instalments, jewellery

- **Loyalty points** (off by default). Default rules: 1 point per ₹100 spent (`spendPerPoint = 10000` paise), 1 point = ₹1 when used (`pointValue = 100`), at least 50 points per use. Levels by spend in the last 12 months: Silver (×1), Gold from ₹25,000 (×1.5), Platinum from ₹1,00,000 (×2).
  - `Points = floor(floor(grand total incl. GST ÷ spendPerPoint) × multiplier)`.
  - A return takes back `floor(note total ÷ spendPerPoint)` at the base rate.
  - Using points is a **payment** after the sale. GST stays on the full bill, and the value goes to "Loyalty points used" (an expense). **No liability is set up when points are earned.**

- **Gift vouchers:** the sale is `Dr Cash/Bank, Cr Gift vouchers not yet used` (a liability) with **no GST at sale**. When the voucher pays a bill, the bill itself carries the GST (tax at redemption), and the liability is cleared against the customer. Vouchers can be single-use (anything left after the first bill "is gone") or many-use (never more than the amount), with an optional expiry. Vouchers can be used only online, to stop double use. **Unused or expired balances are never released**: the liability stays in the books.
- **Supplier schemes** (purchase targets): track progress only (taxable value or quantity bought less returns). A reward received is **not booked** unless entered as other income or a journal.
- **Rentals:** the deposit is taken as a **khata payment**, so it first settles the customer's opening balance and **oldest pending bills** (§5) before any of it stays as an advance. When goods come back, a draft bill is made: `rent = rate per day × days (at least 1) × qty`, plus late and damage charges. **All these lines are created at GST 0%, entered as including tax.**

- **Crates and containers:** the crate count and deposit are tracked in their own register. **Crate deposits make no cash or books entry.**

- **Instalments (shop's own EMI):** the full sale and GST are booked at the bill date. Schedule: `(grand total − down payment) ÷ count`, rounded down, with the last instalment taking the remainder. Weekly or monthly. Overdue instalments are listed. No interest.
- **Jewellery (weight-based pricing):** on the line, `metal = round(weight × (1 + wastage%) × fineness × day's rate per gram of 24K gold or 999 silver)`.
  - Fineness = karat ÷ 24 for gold, purity% ÷ 100 for silver.
  - `Making` = % of the metal value, or ₹ per gram × **net weight** (wastage not included).
  - `Price before GST = metal + making + stones`. The line then takes the item's GST rate (3% in the default list) on the whole amount, including making charges.
  - **Old gold taken in** = `weight × fineness × 24K/999 rate × (1 − deduction%)` (default deduction 2%). It is used as a "buyback" payment.

**Points to check**

- Loyalty points: should part of the sale be deferred (Ind AS 115 / AS 9), or a provision made for points earned but not yet used? GST stays on the full value because redemption is not treated as a discount.
- Rental bills at 0% GST: renting goods is normally a taxable service (often 18%). Rental deposits are used on old dues automatically.
- Crate deposits are cash received but not recorded in the cash book or the books.
- Jewellery making charges are taxed at the metal's rate on the same line. Please confirm, given how your clients' making charges are classified.
- Buyback of old gold from consumers: no purchase voucher or self-invoice is made, and no reverse-charge check is done.

*Source: app/src/lib/loyalty.ts, app/src/lib/retailExtras.ts, app/src/lib/shopKinds.ts, app/src/lib/modules.ts, app/src/screens/docs/LineEditor.tsx, app/src/screens/items/TradeScreens.tsx*

---

## 14. Top questions for the accountant

1. **Two profit figures:** the P&L report uses qty sold × *current* purchase price and leaves out charges. The books use opening + purchases − closing stock. Which should owners rely on?

2. **Stock valuation** is always the item's *latest* landed purchase price (no FIFO or average), and the same price is used for opening stock. Is that acceptable under AS-2?

3. **"No GST" bills on a regular store** go to a separate BOS series and into GSTR-3B 3.1(e) as non-GST supplies. Is there a risk of under-reporting tax?

4. **Composition and unregistered stores:** purchases default to GST mode, so input GST is booked as an asset and shown as ITC in 3B. Should it be part of cost instead?

5. **No year-end closing:** "Profit so far" on the balance sheet adds up profit since the first record ever.

6. **Books change retroactively:** edits by the owner, cancellations, voids and bounced cheques change closed periods unless the lock settings are used.

7. **No opening cash balance:** cash already in the drawer becomes "cash excess" income at the first day-end. Cash capital and drawings journals also cause false cash differences.

8. **Loyalty points** are an expense when used, with GST on the full bill and no liability when earned.

9. **Gift vouchers** are a liability at sale with GST at redemption. Expired or forfeited balances are never written back.

10. **Buyback / old gold as payment** is debited to Purchases but never enters stock, and there is no purchase document.

11. **GSTR-1:** credit notes on B2CL invoices are netted into B2CS (no CDNUR), there is no nil/exempt table, and non-GST bills are listed under doc no. 1.

12. **ITC in 3B** = all GST purchases (no 2B filter, no Section 17(5) block, no reversal). Expense GST is never captured. CGST and SGST credit are not used against IGST.

13. **Discounts typed in ₹ on price-including-tax bills** come off the pre-tax value (₹50 off = ₹59 saved at 18%). Line-wise tax rounding and round-off to ₹1 go to a "Round off" P&L account.

14. **Rentals and charges default to 0% GST:** rental, late and damage lines are made at 0%, and additional charges such as delivery default to 0%.

15. **Out of stock and books:** goods on consignment or unbilled challans, and stock transferred between stores (even across GSTINs, with no tax invoice), are missing from closing stock. Crate deposits and staff salary advances (booked as an expense) also need review.
