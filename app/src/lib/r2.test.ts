import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { cashDay, closeDay } from './cashbook';
import { db, type Customer, type Item, type Supplier } from './db';
import { applyAdvance, khataOf, receivables, receiveKhataPayment, statementTable } from './khata';
import { applyScan, cancelPurchase, newPurchaseDraft, newPurchaseOrder, payables, purchaseLineFromItem, recordSupplierPayment, saveExpense, savePurchase, supplierLedger } from './purchases';
import { ensureBusinessRecords, newCreditNoteDraft, newInvoiceDraft, newId, putRecord, recordPayments, saveCreditNote, saveInvoice, type Actor } from './repo';
import { adjustStock, isLow, setOpeningStock, stockLevels, suggestedOrder } from './stock';
import { REPORTS, todaySummary } from './reports';

const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'A' };
const TODAY = new Date().toISOString().slice(0, 10);

let rice: Item;
let gupta: Customer;
let wholesaler: Supplier;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await db.profiles.update('b1', { gstType: 'regular', taxIdValue: '27AAPFU0939F1ZV', address: { state: 'Maharashtra' } });
  rice = await putRecord('items', owner, { id: 'rice', name: 'Rice', unit: 'bag', rate: 50000, rateIncludesTax: false, taxPct: 5, purchasePrice: 40000, lowStock: 5 } as Item);
  gupta = await putRecord('customers', owner, { id: 'gupta', name: 'Gupta', billingAddress: { state: 'Maharashtra' }, openingBalance: 10000 } as Customer);
  wholesaler = await putRecord('suppliers', owner, { id: 'sup', name: 'Wholesaler', address: {}, openingBalance: 0, taxId: '27AAPFU0939F1ZV' } as Supplier);
});

async function sell(qty: number, customer: Customer | null = null, actor = owner) {
  const d = await newInvoiceDraft(actor);
  return saveInvoice(
    actor,
    {
      ...d,
      lines: [{ id: newId(), itemId: rice.id, name: 'Rice', qty, unit: 'bag', rate: 50000, rateIncludesTax: false, taxPct: 5 }],
      billTo: customer ? { customerId: customer.id, name: customer.name, address: customer.billingAddress } : { customerId: null, name: 'Walk-in', address: {} },
    },
    { finalize: true },
  );
}

async function buy(qty: number, rate = 42000) {
  const d = await newPurchaseDraft(owner, { supplier: wholesaler });
  return savePurchase(owner, { ...d, supplierBillNo: 'W-1', lines: [{ ...purchaseLineFromItem(rice, qty), rate, mrp: 60000, salePrice: 52000 }] }, { finalize: true });
}

describe('stock', () => {
  it('adds opening stock and purchases, takes away sales, puts back returns', async () => {
    await setOpeningStock(owner, rice, 10);
    await buy(20);
    const inv = await sell(4);
    const note = await newCreditNoteDraft(owner, inv.id);
    await saveCreditNote(owner, { ...note, reason: 'return', lines: note.lines.map((l) => ({ ...l, qty: 1 })) }, { finalize: true });
    expect((await stockLevels('b1')).get('rice')).toBe(27);
  });

  it('ignores cancelled purchases, voided changes and drafts; counts set the shelf number', async () => {
    await setOpeningStock(owner, rice, 10);
    const p = await buy(5);
    await cancelPurchase(owner, p.id);
    const d = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...d, lines: [{ id: 'x', itemId: 'rice', name: 'Rice', qty: 3, unit: 'bag', rate: 1, rateIncludesTax: false, taxPct: 0 }] }, { finalize: false });
    await adjustStock(owner, rice, { kind: 'adjust', qty: -2, reason: 'damage' });
    expect((await stockLevels('b1')).get('rice')).toBe(8);
    await adjustStock(staff, rice, { kind: 'count', counted: 3 });
    expect((await stockLevels('b1')).get('rice')).toBe(3);
    expect(isLow(rice, 3)).toBe(true);
    expect(suggestedOrder(rice, 3)).toBe(7);
  });
});

describe('purchases', () => {
  it('saving a bill updates the item cost, MRP and price, and new lines become items', async () => {
    const d = await newPurchaseDraft(owner, { supplier: wholesaler });
    await savePurchase(
      owner,
      { ...d, lines: [{ ...purchaseLineFromItem(rice, 2), rate: 42000, mrp: 60000, salePrice: 52000 }, { id: 'n', name: 'Dal', qty: 3, unit: 'kg', rate: 9000, rateIncludesTax: false, taxPct: 5 }] },
      { finalize: true },
    );
    const updated = await db.items.get('rice');
    expect(updated).toMatchObject({ purchasePrice: 42000, mrp: 60000, rate: 52000, supplierId: 'sup' });
    const dal = (await db.items.toArray()).find((i) => i.name === 'Dal');
    expect(dal?.purchasePrice).toBe(9000);
    expect((await stockLevels('b1')).get(dal!.id)).toBe(3);
  });

  it('supplier ledger: bills add, payments and returns take away', async () => {
    const bill = await buy(10, 40000); // 4000.00 + 5% = 4200.00
    expect(bill.totals.grandTotal).toBe(420000);
    await recordSupplierPayment(owner, { supplierId: 'sup', amount: 200000, mode: 'cash', date: TODAY });
    const ret = await newPurchaseDraft(owner, { returnOf: bill });
    await savePurchase(owner, { ...ret, lines: ret.lines.map((l) => ({ ...l, qty: 1 })) }, { finalize: true });
    const { balance } = await supplierLedger('b1', 'sup');
    expect(balance).toBe(420000 - 200000 - 42000);
    expect((await payables('b1')).get('sup')).toBe(balance);
    expect((await stockLevels('b1')).get('rice')).toBe(9);
  });

  it('numbers purchase orders per person', async () => {
    const a = await newPurchaseOrder(owner, null, []);
    await putRecord('purchaseOrders', owner, a);
    const b = await newPurchaseOrder(owner, null, []);
    const c = await newPurchaseOrder(staff, null, []);
    expect(a.number).toMatch(/^PO\/\d{2}-\d{2}\/1$/);
    expect(b.number).toMatch(/\/2$/);
    expect(c.number).toMatch(/\/A1$/);
  });
});

describe('khata', () => {
  it('a khata payment settles the opening balance, then the oldest bills, and keeps the rest as advance', async () => {
    const first = await sell(1, gupta); // 525.00
    const second = await sell(2, gupta); // 1050.00
    // Owes 100 opening + 525 + 1050 = 1675.00; pays 2000.00.
    await receiveKhataPayment(owner, gupta, { amount: 200000, mode: 'cash', date: TODAY });
    const k = await khataOf('b1', gupta);
    expect(k.balance).toBe(-32500);
    expect(k.advance).toBe(32500);
    expect(k.pendingBills).toEqual([]);
    const pays = await db.payments.toArray();
    expect(pays.find((p) => p.invoiceId === first.id)?.amount).toBe(52500);
    expect(pays.find((p) => p.invoiceId === second.id)?.amount).toBe(105000);
    expect(new Set(pays.map((p) => p.receiptId)).size).toBe(1);
  });

  it('a part payment pays the oldest bill first; an advance pays a later bill without changing the balance', async () => {
    await receiveKhataPayment(owner, gupta, { amount: 60000, mode: 'upi', date: TODAY }); // opening 100 + 500 advance
    expect((await khataOf('b1', gupta)).advance).toBe(50000);
    const bill = await sell(1, gupta); // 525.00
    const before = (await khataOf('b1', gupta)).balance;
    await applyAdvance(owner, gupta, bill, 52500);
    const k = await khataOf('b1', gupta);
    expect(k.balance).toBe(before);
    expect(k.advance).toBe(0);
    expect(k.pendingBills[0]?.pending).toBe(2500);
    expect((await receivables('b1'))[0]).toMatchObject({ balance: 2500 });
  });

  it('statement brings the balance forward and ends at what is due', async () => {
    await sell(1, gupta);
    const tbl = await statementTable('b1', gupta, TODAY, TODAY);
    expect(tbl.foot?.[0]?.[4]).toBe(10000 + 52500);
  });
});

describe('cash book', () => {
  it('counts cash in and out of the drawer; the day-end count carries to the next day', async () => {
    const inv = await sell(1);
    await recordPayments(owner, inv.id, [{ mode: 'cash', amount: 52500 }], { date: TODAY });
    await saveExpense(owner, { id: 'e1', businessId: 'b1', createdAt: '', updatedAt: '', updatedBy: '', category: 'tea', amount: 5000, mode: 'cash', date: TODAY });
    await recordSupplierPayment(owner, { supplierId: 'sup', amount: 10000, mode: 'cash', date: TODAY });
    await receiveKhataPayment(owner, gupta, { amount: 10000, mode: 'upi', date: TODAY });
    const day = await cashDay('b1', TODAY);
    expect(day.opening).toBe(0);
    expect(day.expected).toBe(52500 - 5000 - 10000);
    expect(day.otherModes.upi).toBe(10000);
    await closeDay(owner, day, 37000);
    const closed = await cashDay('b1', TODAY);
    expect(closed.close?.difference).toBe(-500);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect((await cashDay('b1', tomorrow)).opening).toBe(37000);
  });
});

describe('reports', () => {
  it('every report runs and adds up', async () => {
    await setOpeningStock(owner, rice, 10);
    await buy(5);
    const inv = await sell(2, gupta);
    await recordPayments(owner, inv.id, [{ mode: 'upi', amount: 50000 }], { date: TODAY });
    await saveExpense(owner, { id: 'e1', businessId: 'b1', createdAt: '', updatedAt: '', updatedBy: '', category: 'rent', amount: 100000, mode: 'bank', date: TODAY });
    for (const r of REPORTS) {
      const tbl = await r.run({ businessId: 'b1', from: TODAY, to: TODAY, stores: [{ id: 'b1', name: 'Test Co' }] });
      expect(tbl.columns.length, r.id).toBeGreaterThan(0);
      for (const row of tbl.rows) expect(row.length, r.id).toBe(tbl.columns.length);
    }
    const sales = await REPORTS.find((r) => r.id === 'sales')!.run({ businessId: 'b1', from: TODAY, to: TODAY });
    expect(sales.foot?.[0]?.[2]).toBe(105000);
    const gst = await REPORTS.find((r) => r.id === 'gstSummary')!.run({ businessId: 'b1', from: TODAY, to: TODAY });
    // Output CGST 25.00 (half of 5% on 1000) less input CGST 52.50 (half of 5% on 2100).
    expect(gst.foot?.[0]?.[2]).toBe(2500 - 5250);
    const profit = await REPORTS.find((r) => r.id === 'profit')!.run({ businessId: 'b1', from: TODAY, to: TODAY });
    // Sold 2 bags for 1000.00 before tax; cost now 420.00 a bag; rent 1000.00.
    expect(profit.foot?.[0]?.[1]).toBe(100000 - 84000 - 100000);
    const today = await todaySummary('b1', true);
    expect(today).toMatchObject({ sales: 105000, bills: 1, upi: 50000, credit: 55000, lowStock: 0 });
    expect(today.receivable).toBe(10000 + 55000);
  });
});

describe('bill scan', () => {
  it('matches the supplier by GSTIN and items by name; new ones stay new lines', async () => {
    const d = await newPurchaseDraft(owner);
    const p = await applyScan(
      owner,
      d,
      {
        supplierName: 'Some Other Name',
        supplierGstin: '27AAPFU0939F1ZV',
        billNo: 'W-77',
        date: '2026-01-05',
        hasGst: true,
        igst: false,
        lines: [
          { name: 'rice', hsn: '1006', qty: 3, unit: 'bag', rate: 410.5, taxPct: 5, mrp: 0 },
          { name: 'Sugar 1kg', hsn: '', qty: 10, unit: 'pkt', rate: 42, taxPct: 5, mrp: 48 },
        ],
        total: 1734.03,
      },
      'data:image/jpeg;base64,xx',
    );
    expect(p.supplier?.supplierId).toBe('sup');
    expect(p.supplierBillNo).toBe('W-77');
    expect(p.lines[0]).toMatchObject({ itemId: 'rice', name: 'Rice', qty: 3, rate: 41050, unit: 'bag' });
    expect(p.lines[1]).toMatchObject({ itemId: null, name: 'Sugar 1kg', rate: 4200, mrp: 4800, unit: 'pkt' });
    expect(p.photo).toBe('data:image/jpeg;base64,xx');
    const unknown = await applyScan(owner, d, { supplierName: 'New Wholesale', supplierGstin: '', billNo: '', date: 'bad', hasGst: false, igst: false, lines: [], total: 0 }, null);
    expect((await db.suppliers.get(unknown.supplier!.supplierId))?.name).toBe('New Wholesale');
    expect(unknown.date).toBe(d.date);
    expect(unknown.taxMode).toBe('none');
  });
});

