import 'fake-indexeddb/auto';
import { todayISO } from '@invoice/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Customer, type DocLine, type Offer } from './db';
import { applyOffers, checkCoupon } from './offers';
import { keepAsCredit, openCredits, payWithCredit, settlementOf } from './credit';
import { khataOf } from './khata';
import { cashDay } from './cashbook';
import { jobAdvance, refundAdvance, settleJobAdvance, takeAdvance } from './jobs';
import { billMoney, convertEstimate, newEstimateDraft, recordPayments, saveEstimate } from './repo';
import { buildDocDefinition } from './pdf/buildDoc';
import { pdfInputFor } from './pdf';
import { PermissionError, ensureBusinessRecords, newCreditNoteDraft, newInvoiceDraft, putRecord, saveCreditNote, saveInvoice, settingsOf, type Actor } from './repo';

const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'A' };
export const TODAY = todayISO(); // local date, as the app uses

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await putRecord('customers', owner, { id: 'c1', name: 'Mehta', phone: '+919876543210', billingAddress: {}, openingBalance: 0 } as Customer);
});

const line = (extra = {}) => ({ id: 'l', name: 'Wire 1mm', qty: 2, unit: 'mtr', rate: 5000, rateIncludesTax: false, taxPct: 0, ...extra });

describe('R4.1 billing', () => {
  it('non-returnable lines: only the owner can take them back', async () => {
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(owner, { ...d, lines: [line({ nonReturnable: true })] }, { finalize: true });
    const note = await newCreditNoteDraft(staff, inv.id);
    expect(note.lines[0]!.nonReturnable).toBe(true);
    await expect(saveCreditNote(staff, { ...note, reason: 'return' }, { finalize: true })).rejects.toBeInstanceOf(PermissionError);
    const n2 = await newCreditNoteDraft(owner, inv.id);
    await expect(saveCreditNote(owner, { ...n2, reason: 'return' }, { finalize: true })).resolves.toMatchObject({ status: 'saved' });
  });

  it('private notes never reach the PDF; photos print on the next page', async () => {
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(owner, { ...d, lines: [line({ nonReturnable: true })], privateNotes: 'SECRET-MARGIN', photos: ['data:image/jpeg;base64,AAAA'] }, { finalize: true });
    const input = await pdfInputFor('invoice', inv, await settingsOf('b1'));
    const def = JSON.stringify(buildDocDefinition(input, inv.totals));
    expect(def).not.toContain('SECRET-MARGIN');
    expect(def).toContain('Non-returnable');
    expect(def).toContain('data:image/jpeg;base64,AAAA');
    const noPhotos = await pdfInputFor('invoice', inv, { ...(await settingsOf('b1')), design: { ...(await settingsOf('b1')).design, show: { ...(await settingsOf('b1')).design.show, photos: false } } });
    expect(JSON.stringify(buildDocDefinition(noPhotos, inv.totals))).not.toContain('base64,AAAA');
  });
});

describe('R4.2 offers', () => {
  const offer = (o: Partial<Offer>): Offer => ({ id: o.id ?? 'o', businessId: 'b1', createdAt: '', updatedAt: '', updatedBy: '', name: 'Deal', active: true, kind: 'amount', ...o }) as Offer;
  const l = (id: string, rate: number, taxPct = 0): DocLine => ({ id, itemId: id, name: id, qty: 1, unit: 'pcs', rate, rateIncludesTax: false, taxPct });

  it('₹ off the bill over a minimum, spread over the lines; the customer saves exactly that', () => {
    const lines = [l('a', 60000, 18), l('b', 40000, 18)];
    const out = applyOffers(lines, [offer({ amount: 10000, minBill: 100000 })], new Map(), []);
    const off = out.reduce((a, x) => a + (x.discount?.value ?? 0), 0);
    // ₹100 off what the customer pays = 84.75 before 18% tax.
    expect(Math.abs(off * 1.18 - 10000)).toBeLessThan(3);
    expect(applyOffers([l('a', 50000)], [offer({ amount: 10000, minBill: 100000 })], new Map(), [])[0]!.discount).toBeUndefined();
  });

  it('a coupon applies only with its code, and only as often as allowed', async () => {
    const c = offer({ kind: 'percent', pct: 10, code: 'DIWALI10', maxUses: 1 });
    expect(applyOffers([l('a', 10000)], [c], new Map(), [])[0]!.discount).toBeUndefined();
    expect(applyOffers([l('a', 10000)], [c], new Map(), [], undefined, 'diwali10')[0]!.discount).toEqual({ type: 'pct', value: 10 });
    await putRecord('offers', owner, c);
    expect(await checkCoupon('b1', 'nope')).toMatchObject({ ok: false });
    expect(await checkCoupon('b1', 'diwali10')).toMatchObject({ ok: true });
    const d = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...d, coupon: 'DIWALI10', lines: [l('a', 10000)] }, { finalize: true });
    expect(await checkCoupon('b1', 'DIWALI10')).toMatchObject({ ok: false });
  });
});

describe('R4.3 credit notes and advances', () => {
  const sell = async (rate: number, customer = true) => {
    const d = await newInvoiceDraft(owner);
    return saveInvoice(owner, { ...d, billTo: customer ? { customerId: 'c1', name: 'Mehta', address: {} } : { customerId: null, name: 'Walk-in', address: {} }, lines: [line({ rate, qty: 1 })] }, { finalize: true });
  };

  it('a return kept as credit closes the bill without cash, then pays a later bill', async () => {
    const inv = await sell(100000);
    await recordPayments(owner, inv.id, [{ mode: 'cash', amount: 100000 }], { date: TODAY });
    const n = await newCreditNoteDraft(owner, inv.id);
    const note = await saveCreditNote(owner, { ...n, reason: 'return' }, { finalize: true });
    expect((await settlementOf(note)).state).toBe('open');
    expect(await keepAsCredit(owner, note)).toBe(100000);
    expect((await billMoney(inv.id)).refundDue).toBe(0);
    expect(await settlementOf(note)).toMatchObject({ state: 'credit', left: 100000, due: 0 });
    expect((await khataOf('b1', (await db.customers.get('c1'))!)).balance).toBe(-100000);
    // Nothing more to refund or keep.
    expect(await keepAsCredit(owner, note)).toBe(0);
    const next = await sell(60000);
    expect((await openCredits('b1', { customerId: 'c1' }))[0]!.left).toBe(100000);
    expect(await payWithCredit(owner, next, note.id, 100000)).toBe(60000);
    expect((await billMoney(next.id)).pending).toBe(0);
    expect((await settlementOf(note)).left).toBe(40000);
    expect((await openCredits('b1', { number: note.number }))[0]!.left).toBe(40000);
    expect((await khataOf('b1', (await db.customers.get('c1'))!)).balance).toBe(-40000);
    // The drawer only saw the first cash payment.
    expect((await cashDay('b1', TODAY)).expected).toBe(100000);
  });

  it('an estimate advance (walk-in too) pays its bill; a declined one is returned', async () => {
    const d = await newEstimateDraft(owner);
    const est = await saveEstimate(owner, { ...d, billTo: { customerId: null, name: 'Walk-in', address: {} }, lines: [line({ rate: 50000, qty: 1 })] }, { finalize: true });
    await takeAdvance(owner, est, { amount: 20000, mode: 'upi', date: TODAY });
    expect(await jobAdvance('b1', est.id)).toBe(20000);
    const bill = await saveInvoice(owner, await convertEstimate(owner, est.id), { finalize: true });
    expect(await settleJobAdvance(owner, bill)).toBe(20000);
    expect((await billMoney(bill.id)).pending).toBe(30000);
    expect(await jobAdvance('b1', est.id)).toBe(0);

    const d2 = await newEstimateDraft(owner);
    const e2 = await saveEstimate(owner, { ...d2, billTo: { customerId: 'c1', name: 'Mehta', address: {} }, lines: [line({ rate: 50000, qty: 1 })] }, { finalize: true });
    await takeAdvance(owner, e2, { amount: 10000, mode: 'cash', date: TODAY });
    await refundAdvance(owner, e2, { amount: 10000, mode: 'cash', date: TODAY });
    expect(await jobAdvance('b1', e2.id)).toBe(0);
  });
});


describe('Wi-Fi printer address', () => {
  it('accepts IPv4 addresses only', async () => {
    const { isIpAddress } = await import('./printer');
    expect(isIpAddress('192.168.1.50')).toBe(true);
    expect(isIpAddress(' 10.0.0.7 ')).toBe(true);
    expect(isIpAddress('192.168.1.256')).toBe(false);
    expect(isIpAddress('192.168.1')).toBe(false);
    expect(isIpAddress('printer.local')).toBe(false);
  });
});

describe('R4.6 logins, locks and Tally', () => {
  it('locked bills: no edits or cancelling, owner included', async () => {
    const { billLocked } = await import('@invoice/shared');
    expect(billLocked('2026-10-05', { until: '2026-10-31' }, '2026-11-25')).toBe(true);
    expect(billLocked('2026-11-01', { until: '2026-10-31' }, '2026-11-25')).toBe(false);
    expect(billLocked('2026-11-10', { afterDays: 7 }, '2026-11-25')).toBe(true);
    expect(billLocked('2026-11-20', { afterDays: 7 }, '2026-11-25')).toBe(false);
    const { cancelInvoice } = await import('./repo');
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(owner, { ...d, date: '2026-01-05', lines: [line()] }, { finalize: true });
    await putRecord('settings', owner, { ...(await settingsOf('b1')), booksClosedUntil: '2026-01-31' });
    await expect(saveInvoice(owner, { ...inv, lines: [line({ qty: 5 })] }, { finalize: false })).rejects.toBeInstanceOf(PermissionError);
    await expect(cancelInvoice(owner, inv.id)).rejects.toBeInstanceOf(PermissionError);
  });

  it('a view-only login changes nothing; the warehouse only bills and challans, with a photo', async () => {
    const { markDelivered, warehouseList } = await import('./deliveries');
    const ro: Actor = { ...staff, access: 'readonly' };
    const wh: Actor = { ...staff, access: 'warehouse' };
    await expect(putRecord('customers', ro, { id: 'c9', name: 'X', billingAddress: {}, openingBalance: 0 } as Customer)).rejects.toBeInstanceOf(PermissionError);
    await expect(putRecord('customers', wh, { id: 'c9', name: 'X', billingAddress: {}, openingBalance: 0 } as Customer)).rejects.toBeInstanceOf(PermissionError);
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(owner, { ...d, lines: [line()], deliveryDate: TODAY }, { finalize: true });
    expect((await warehouseList('b1', { delivered: false })).map((r) => r.doc.id)).toEqual([inv.id]);
    await expect(markDelivered(wh, 'invoice', inv.id)).rejects.toThrow();
    await markDelivered(wh, 'invoice', inv.id, 'data:image/jpeg;base64,PHOTO');
    expect((await db.invoices.get(inv.id))!.deliveryPhoto).toBe('data:image/jpeg;base64,PHOTO');
    expect(await warehouseList('b1', { delivered: false })).toEqual([]);
    expect((await warehouseList('b1', { delivered: true })).length).toBe(1);
  });

  it('staff may cancel a bill only when allowed', async () => {
    const { cancelInvoice } = await import('./repo');
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(owner, { ...d, lines: [line()] }, { finalize: true });
    await expect(cancelInvoice(staff, inv.id)).rejects.toBeInstanceOf(PermissionError);
    await cancelInvoice({ ...staff, cancelBills: true }, inv.id);
    expect((await db.invoices.get(inv.id))!.status).toBe('cancelled');
  });

  it('Tally vouchers balance: debits equal credits on every voucher', async () => {
    const { buildTallyXml } = await import('./tally');
    const d = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...d, lines: [line({ taxPct: 18, rate: 33333 }), line({ id: 'l2', taxPct: 5, rate: 999 })] }, { finalize: true });
    const { xml, counts } = await buildTallyXml('b1', '2000-01-01', '2100-01-01', false);
    expect(counts.sales).toBe(1);
    for (const v of xml.split('<VOUCHER ').slice(1)) {
      const amounts = [...v.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Math.round(Number(m[1]) * 100));
      expect(amounts.length).toBeGreaterThan(1);
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(0);
    }
    expect(xml).toContain('<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>');
  });
});

describe('R4.7 stores and staff', () => {
  it('a transfer moves stock between two stores, adding the item where missing', async () => {
    const { transferStock, transfersOf } = await import('./transfers');
    const { setOpeningStock, stockLevels } = await import('./stock');
    await ensureBusinessRecords('b2', 'Branch');
    const item = await putRecord('items', owner, { id: 'it1', name: 'Fan', unit: 'pcs', rate: 150000, taxPct: 18, barcode: '8901' } as never);
    await setOpeningStock(owner, item as never, 10);
    await transferStock(owner, { businessId: 'b2', name: 'Branch', isOwner: true }, 'Test Co', [{ itemId: 'it1', qty: 4 }], { note: 'van' });
    expect((await stockLevels('b1')).get('it1')).toBe(6);
    const there = await db.items.where('businessId').equals('b2').toArray();
    expect(there).toHaveLength(1);
    expect(there[0]!.barcode).toBe('8901');
    expect((await stockLevels('b2')).get(there[0]!.id)).toBe(4);
    // A second transfer finds the same item there.
    await transferStock(owner, { businessId: 'b2', name: 'Branch', isOwner: true }, 'Test Co', [{ itemId: 'it1', qty: 1 }]);
    expect(await db.items.where('businessId').equals('b2').count()).toBe(1);
    expect((await transfersOf('b2')).every((x) => !x.out)).toBe(true);
    await expect(transferStock(staff, { businessId: 'b2', name: 'Branch', isOwner: true }, 'Test Co', [{ itemId: 'it1', qty: 1 }])).rejects.toBeInstanceOf(PermissionError);
  });

  it('salary: unmarked days are present; advances are recovered from salary', async () => {
    const { markAttendance, monthSheet, giveAdvance, paySalary } = await import('./staffPay');
    const emp = await putRecord('employees', owner, { id: 'e1', name: 'Raju', pay: 'month', rate: 3000000, active: true } as never);
    await markAttendance(owner, 'e1', '2026-11-03', 'absent');
    await markAttendance(owner, 'e1', '2026-11-04', 'half');
    const s = await monthSheet('b1', emp as never, '2026-11', '2026-11-30');
    expect(s.paidDays).toBe(28.5);
    expect(s.earned).toBe(Math.round((3000000 * 28.5) / 30));
    await giveAdvance(owner, emp as never, { amount: 500000, mode: 'cash', date: '2026-11-10' });
    expect((await monthSheet('b1', emp as never, '2026-11', '2026-11-30')).advanceLeft).toBe(500000);
    await paySalary(owner, emp as never, '2026-11', { amount: s.earned - 500000, mode: 'cash', date: '2026-11-30' }, 500000);
    const after = await monthSheet('b1', emp as never, '2026-11', '2026-11-30');
    expect(after.due).toBe(0);
    expect(after.advanceLeft).toBe(0);
    // Cash out = advance + net salary = what was earned.
    const out = (await db.expenses.where('businessId').equals('b1').toArray()).reduce((a, e) => a + e.amount, 0);
    expect(out).toBe(s.earned);
  });
});

describe('R4.8 phone alerts', () => {
  it('morning: low stock; evening: today’s summary (generic when it is for tomorrow)', async () => {
    const { shopAlerts, nextAt, DEFAULT_ALERTS } = await import('./alerts');
    const { setOpeningStock } = await import('./stock');
    const now = new Date(2026, 10, 25, 12, 0);
    expect(nextAt('09:30', now).getDate()).toBe(26);
    expect(nextAt('21:00', now).getDate()).toBe(25);
    const item = await putRecord('items', owner, { id: 'it2', name: 'Bulb', unit: 'pcs', rate: 10000, taxPct: 0, lowStock: 5 } as never);
    await setOpeningStock(owner, item as never, 2);
    const list = await shopAlerts(owner, DEFAULT_ALERTS, { canSeeMoney: true, storeName: 'Test Co', now });
    const low = list.find((a) => a.id === 101);
    expect(low?.body).toContain('Bulb');
    expect(list.find((a) => a.id === 103)?.title).toContain('Today');
    const late = await shopAlerts(owner, DEFAULT_ALERTS, { canSeeMoney: false, storeName: '', now: new Date(2026, 10, 25, 22, 0) });
    // Low stock, and the morning reminder to open the store (day-end closing is on by default).
    expect(late.map((a) => a.id)).toEqual([101, 106]);
  });
});

describe('same item twice', () => {
  it('adds to the existing line unless price, size, serials or discount differ', async () => {
    const { addOrMerge } = await import('./mergeLines');
    const a: Parameters<typeof addOrMerge>[1] = { id: 'a', itemId: 'i1', qty: 2, rate: 100, unit: 'pcs', taxPct: 18 };
    expect(addOrMerge([a], { ...a, id: 'b', qty: 3 })).toEqual([{ ...a, qty: 5 }]);
    expect(addOrMerge([a], { ...a, id: 'b', rate: 90 })).toHaveLength(2);
    expect(addOrMerge([a], { ...a, id: 'b', discount: { type: 'pct', value: 5 } })).toHaveLength(2);
    expect(addOrMerge([a], { ...a, id: 'b', serials: ['IMEI9'] })).toHaveLength(2);
    expect(addOrMerge([a], { ...a, id: 'b', itemId: null })).toHaveLength(2);
  });
});
