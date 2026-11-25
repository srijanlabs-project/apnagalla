import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Customer } from './db';
import { jobAdvance, newJob, nextStage, saveJob, setStage, settleJobAdvance, takeAdvance } from './jobs';
import { applyExchange, khataOf } from './khata';
import { cheques, markBounced, markCleared } from './cheques';
import { buildGstr1, uqcOf } from './gstr1';
import { draftFromPaperBill } from './paperBill';
import { PermissionError, biggestDiscountPct, newCreditNoteDraft as newNote, newEstimateDraft, recordPayments, saveCreditNote as saveNote, saveEstimate, billMoney, convertEstimate, ensureBusinessRecords, newInvoiceDraft, putRecord, saveInvoice, type Actor } from './repo';
import { createVariants, priceFor, repriceLines, unitOptions, variantsOf } from './pricing';
import { newPurchaseDraft, purchaseLineFromItem, savePurchase } from './purchases';
import { stockLevels, tracksStock } from './stock';
import { serialEvents, serialText, serialsInStock, warrantyEnd } from './serials';
import { newCreditNoteDraft, saveCreditNote } from './repo';
import type { Category, DocLine, Item, Offer } from './db';
import { OFF, applyOffers } from './offers';
import { applyBulkPrices, bulkPrices } from './pricing';
import { daysLeft, orderFor, salesSpeed } from './stock';

const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
const TODAY = new Date().toISOString().slice(0, 10);
let painter: Customer;

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  painter = await putRecord('customers', owner, { id: 'c1', name: 'Mehta', billingAddress: {}, openingBalance: 0 } as Customer);
});

describe('jobs', () => {
  it('quote → advance → stages → bill paid from the advance, khata unchanged', async () => {
    let job = await newJob(owner, 'work', painter);
    job = await saveJob(owner, {
      ...job,
      job: { ...job.job!, title: 'Hall painting' },
      lines: [{ id: 'l1', name: 'Painting labour', qty: 1, unit: 'job', rate: 1000000, rateIncludesTax: false, taxPct: 0 }],
    });
    expect(job.number).toBeTruthy();
    expect(nextStage(job.job!)).toBe('quoted');
    await takeAdvance(owner, job, { amount: 300000, mode: 'cash', date: TODAY });
    expect(await jobAdvance('b1', job.id)).toBe(300000);
    job = await setStage(owner, job, 'in_progress');
    job = await setStage(owner, job, 'delivered');
    expect(job.deliveredAt).toBeTruthy();
    expect(job.job!.stageHistory.map((h) => h.stage)).toEqual(['measure', 'in_progress', 'delivered']);

    const draft = await convertEstimate(owner, job.id);
    const bill = await saveInvoice(owner, draft, { finalize: true });
    expect(await settleJobAdvance(owner, bill)).toBe(300000);
    expect((await billMoney(bill.id)).pending).toBe(700000);
    expect(await jobAdvance('b1', job.id)).toBe(0);
    // Running it again does nothing: the advance is used up.
    expect(await settleJobAdvance(owner, bill)).toBe(0);
    const k = await khataOf('b1', painter);
    expect(k.balance).toBe(700000);
    expect(k.advance).toBe(0);
  });
});

describe('items: variants, units, price levels', () => {
  it('makes a variant for each size × colour, each with its own stock', async () => {
    const shirt = await putRecord('items', owner, { id: 'shirt', name: 'Shirt', unit: 'pcs', rate: 50000, rateIncludesTax: false, taxPct: 5, barcode: '111' } as Item);
    const made = await createVariants(owner, shirt, ['M', 'L'], ['Red', 'Blue']);
    expect(made.map((v) => v.name)).toEqual(['Shirt · M · Red', 'Shirt · M · Blue', 'Shirt · L · Red', 'Shirt · L · Blue']);
    expect(made[0]).toMatchObject({ variantOf: 'shirt', rate: 50000 });
    expect(made[0]!.barcode).toBeUndefined();
    const group = (await db.items.get('shirt'))!;
    expect(group.hasVariants).toBe(true);
    expect(tracksStock(group)).toBe(false);
    // Asking again only adds what is new.
    expect((await createVariants(owner, group, ['M', 'XL'], ['Red'])).map((v) => v.variantLabel)).toEqual(['XL · Red']);
    expect((await variantsOf('shirt')).length).toBe(5);
  });

  it('a box of 12 moves 12 pieces of stock; units and customer types set the price', async () => {
    const pen = await putRecord('items', owner, {
      id: 'pen',
      name: 'Pen',
      unit: 'pcs',
      rate: 1000,
      rateIncludesTax: false,
      taxPct: 18,
      purchasePrice: 600,
      prices: { wholesale: 800 },
      altUnits: [{ unit: 'box', factor: 12, rate: 11000 }],
    } as Item);
    expect(priceFor(pen, 'wholesale')).toBe(800);
    expect(priceFor(pen, 'special')).toBe(1000);
    expect(unitOptions(pen)).toEqual([
      { unit: 'pcs', factor: 1, rate: 1000 },
      { unit: 'box', factor: 12, rate: 11000 },
    ]);
    expect(unitOptions(pen, 'wholesale')[1]).toEqual({ unit: 'box', factor: 12, rate: 9600 });

    const p = await newPurchaseDraft(owner);
    await savePurchase(owner, { ...p, lines: [{ ...purchaseLineFromItem(pen, 5), unit: 'box', unitFactor: 12, rate: 7200 }] }, { finalize: true });
    expect((await stockLevels('b1')).get('pen')).toBe(60);
    expect((await db.items.get('pen'))!.purchasePrice).toBe(600);

    const d = await newInvoiceDraft(owner);
    const lines = [{ id: 'x', itemId: 'pen', name: 'Pen', qty: 2, unit: 'box', unitFactor: 12, rate: 11000, rateIncludesTax: false, taxPct: 18 }];
    await saveInvoice(owner, { ...d, lines }, { finalize: true });
    expect((await stockLevels('b1')).get('pen')).toBe(36);
    expect((await repriceLines(lines, 'wholesale'))[0]!.rate).toBe(9600);
  });
});

describe('serial / IMEI', () => {
  it('numbers come in on purchase, go out on sale, come back on a return', async () => {
    const phone = await putRecord('items', owner, { id: 'ph', name: 'Phone X', unit: 'pcs', rate: 1500000, rateIncludesTax: true, taxPct: 18, trackSerial: true, warrantyMonths: 12 } as Item);
    const p = await newPurchaseDraft(owner);
    await savePurchase(owner, { ...p, lines: [{ ...purchaseLineFromItem(phone, 3), serials: ['IMEI1', 'IMEI2', 'IMEI3'] }] }, { finalize: true });
    expect(await serialsInStock('b1', 'ph')).toEqual(['IMEI1', 'IMEI2', 'IMEI3']);
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(
      owner,
      { ...d, date: '2026-11-25', lines: [{ id: 'l', itemId: 'ph', name: 'Phone X', qty: 2, unit: 'pcs', rate: 1500000, rateIncludesTax: true, taxPct: 18, serials: ['IMEI1', 'IMEI3'], warrantyMonths: 12 }] },
      { finalize: true },
    );
    expect(await serialsInStock('b1', 'ph')).toEqual(['IMEI2']);
    expect((await stockLevels('b1')).get('ph')).toBe(1);
    expect(serialText(inv.lines[0]!, inv.date)).toBe('IMEI / S.No: IMEI1, IMEI3 · Warranty till 24/11/2027');
    const note = await newCreditNoteDraft(owner, inv.id);
    await saveCreditNote(owner, { ...note, reason: 'return', lines: note.lines.map((l) => ({ ...l, qty: 1, serials: ['IMEI3'] })) }, { finalize: true });
    expect(await serialsInStock('b1', 'ph')).toEqual(['IMEI2', 'IMEI3']);
    expect((await serialEvents('b1')).get('IMEI3')!.map((e) => e.kind)).toEqual(['bought', 'sold', 'returned_by_customer']);
    expect(warrantyEnd('2024-02-29', 12)).toBe('2025-02-28');
  });
});

describe('offers, bulk prices, reorder', () => {
  const offer = (o: Partial<Offer>): Offer => ({ id: 'o', businessId: 'b1', createdAt: '', updatedAt: '', updatedBy: '', name: 'Sale', active: true, kind: 'percent', ...o }) as Offer;
  const line = (id: string, itemId: string, qty: number, rate: number, extra: Partial<DocLine> = {}): DocLine => ({ id, itemId, name: itemId, qty, unit: 'pcs', rate, rateIncludesTax: false, taxPct: 0, ...extra });
  const items = new Map<string, Item>([
    ['tee', { id: 'tee', name: 'Tee', categoryId: 'shirts' } as Item],
    ['jean', { id: 'jean', name: 'Jean', categoryId: 'pants' } as Item],
    ['tee-m', { id: 'tee-m', name: 'Tee · M', variantOf: 'tee' } as Item],
  ]);
  const cats = [{ id: 'shirts', name: 'Shirts', parentId: null }, { id: 'pants', name: 'Pants', parentId: null }] as Category[];

  it('% off a category, buy X get Y, combo; hand discounts and removed offers stay', () => {
    const lines = [line('a', 'tee', 2, 50000), line('b', 'jean', 1, 100000), line('c', 'tee', 1, 50000, { discount: { type: 'amount', value: 100 } })];
    const out = applyOffers(lines, [offer({ pct: 10, categoryId: 'shirts' })], items, cats);
    expect(out[0]).toMatchObject({ discount: { type: 'pct', value: 10 }, offer: 'Sale' });
    expect(out[1]!.discount).toBeUndefined();
    expect(out[2]!.discount).toEqual({ type: 'amount', value: 100 });
    // The offer ended: its discount goes; a line the cashier took it off stays off.
    expect(applyOffers(out, [], items, cats)[0]).toMatchObject({ discount: null, offer: null });
    expect(applyOffers([{ ...out[0]!, offer: OFF, discount: null }], [offer({ pct: 10 })], items, cats)[0]!.discount).toBeNull();

    const bg = applyOffers([line('a', 'tee-m', 5, 50000)], [offer({ kind: 'buyget', itemId: 'tee', buyQty: 2, getQty: 1 })], items, cats);
    expect(bg[0]!.discount).toEqual({ type: 'amount', value: 50000 });

    const combo = applyOffers([line('a', 'tee', 1, 50000), line('b', 'jean', 1, 100000)], [offer({ kind: 'combo', combo: [{ itemId: 'tee', qty: 1 }, { itemId: 'jean', qty: 1 }], comboPrice: 120000 })], items, cats);
    expect(combo.reduce((a, l) => a + (l.discount?.value ?? 0), 0)).toBe(30000);
  });

  it('bulk price change rounds and keeps history; reorder follows sales speed', async () => {
    const a = await putRecord('items', owner, { id: 'a', name: 'Paint', unit: 'L', rate: 41000, rateIncludesTax: false, taxPct: 18, categoryId: 'p' } as Item);
    const b = await putRecord('items', owner, { id: 'b', name: 'Brush', unit: 'pcs', rate: 5000, rateIncludesTax: false, taxPct: 18 } as Item);
    const plan = bulkPrices([a, b], { categoryIds: new Set(['p']), by: 7, kind: 'pct', roundTo: 5 });
    expect(plan.map((x) => [x.item.id, x.to])).toEqual([['a', 44000]]);
    await applyBulkPrices(owner, plan);
    expect((await db.items.get('a'))!.priceHistory).toMatchObject([{ from: 41000, to: 44000, byName: 'Owner' }]);

    const d = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...d, lines: [line('x', 'b', 30, 5000)] }, { finalize: true });
    const speed = (await salesSpeed('b1', 30)).get('b')!;
    expect(speed).toBe(1);
    expect(daysLeft(5, speed)).toBe(5);
    expect(orderFor(5, speed, 15)).toBe(10);
  });
});

describe('staff permissions', () => {
  it('a staff bill with more discount than allowed needs the owner; offers do not count', async () => {
    const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'A', maxDiscountPct: 10 };
    const d = await newInvoiceDraft(staff);
    const lines = [{ id: 'l', name: 'Bag', qty: 1, unit: 'pcs', rate: 100000, rateIncludesTax: false, taxPct: 0, discount: { type: 'pct' as const, value: 15 } }];
    expect(biggestDiscountPct({ ...d, lines })).toBe(15);
    await expect(saveInvoice(staff, { ...d, lines }, { finalize: true })).rejects.toBeInstanceOf(PermissionError);
    await expect(saveInvoice(staff, { ...d, lines: [{ ...lines[0]!, offer: 'Diwali' }] }, { finalize: true })).resolves.toBeTruthy();
    const d2 = await newInvoiceDraft(staff);
    expect(biggestDiscountPct({ ...d2, lines: [{ ...lines[0]!, discount: null }], overallDiscount: { type: 'amount', value: 5000 } })).toBe(5);
  });
});

describe('delivery challan', () => {
  it('has its own number series, takes goods out of stock once, and its bill does not again', async () => {
    const cement = await putRecord('items', owner, { id: 'cem', name: 'Cement', unit: 'bag', rate: 40000, rateIncludesTax: false, taxPct: 28 } as Item);
    const p = await newPurchaseDraft(owner);
    await savePurchase(owner, { ...p, lines: [purchaseLineFromItem(cement, 50)] }, { finalize: true });
    const d = await newEstimateDraft(owner);
    const ch = await saveEstimate(owner, { ...d, challan: true, lines: [{ id: 'l', itemId: 'cem', name: 'Cement', qty: 20, unit: 'bag', rate: 40000, rateIncludesTax: false, taxPct: 28 }] }, { finalize: true });
    expect(ch.number.startsWith('DC')).toBe(true);
    expect(ch.numberSeries?.startsWith('challan:')).toBe(true);
    expect((await stockLevels('b1')).get('cem')).toBe(30);
    const bill = await saveInvoice(owner, await convertEstimate(owner, ch.id), { finalize: true });
    expect(bill.fromEstimateId).toBe(ch.id);
    expect((await stockLevels('b1')).get('cem')).toBe(30);
  });
});

describe('exchange and cheques', () => {
  const pay = (id: string, rate: number) => [{ id, name: 'Kurta', qty: 1, unit: 'pcs', rate, rateIncludesTax: false, taxPct: 0 }];

  it('exchange: the returned value pays the new bill, no cash moves', async () => {
    const d = await newInvoiceDraft(owner);
    const old = await saveInvoice(owner, { ...d, billTo: { customerId: 'c1', name: 'Mehta', address: {} }, lines: pay('a', 100000) }, { finalize: true });
    await recordPayments(owner, old.id, [{ mode: 'cash', amount: 100000 }], { date: TODAY });
    const note = await newNote(owner, old.id);
    await saveNote(owner, { ...note, reason: 'return' }, { finalize: true });
    expect((await billMoney(old.id)).refundDue).toBe(100000);
    const d2 = await newInvoiceDraft(owner);
    const fresh = await saveInvoice(owner, { ...d2, billTo: old.billTo, lines: pay('b', 130000) }, { finalize: true });
    expect(await applyExchange(owner, old.id, fresh)).toBe(100000);
    expect((await billMoney(old.id)).refundDue).toBe(0);
    expect((await billMoney(fresh.id)).pending).toBe(30000);
  });

  it('a cheque stays pending until cleared; bounced puts the bill back to pending', async () => {
    const d = await newInvoiceDraft(owner);
    const bill = await saveInvoice(owner, { ...d, lines: pay('a', 50000) }, { finalize: true });
    await recordPayments(owner, bill.id, [{ mode: 'cheque', amount: 50000, reference: '000123' }], { date: TODAY });
    let list = await cheques('b1');
    expect(list).toMatchObject([{ status: 'pending', amount: 50000, number: '000123' }]);
    await markCleared(owner, list[0]!);
    expect((await cheques('b1'))[0]!.status).toBe('cleared');
    const d2 = await newInvoiceDraft(owner);
    const bill2 = await saveInvoice(owner, { ...d2, lines: pay('b', 20000) }, { finalize: true });
    await recordPayments(owner, bill2.id, [{ mode: 'cheque', amount: 20000, reference: '999' }], { date: TODAY });
    list = await cheques('b1');
    await markBounced(owner, list.find((g) => g.number === '999')!);
    expect((await billMoney(bill2.id)).pending).toBe(20000);
  });
});

describe('GSTR-1', () => {
  it('splits a month into B2B, B2C small, credit notes, HSN and documents issued', async () => {
    await db.profiles.update('b1', { gstType: 'regular', taxIdValue: '27AAPFU0939F1ZV', address: { state: 'Maharashtra' } });
    const month = TODAY.slice(0, 7);
    const line = (rate: number) => [{ id: 'l', name: 'Paint', qty: 2, unit: 'ltr', rate, rateIncludesTax: false, taxPct: 18, hsn: '3209' }];
    const d1 = await newInvoiceDraft(owner);
    const b2b = await saveInvoice(owner, { ...d1, taxMode: 'gst', billTo: { customerId: null, name: 'Builder', taxId: '27AAPFU0939F1ZV', address: { state: 'Maharashtra' } }, lines: line(50000) }, { finalize: true });
    const d2 = await newInvoiceDraft(owner);
    await saveInvoice(owner, { ...d2, taxMode: 'gst', billTo: { customerId: null, name: 'Walk-in', address: {} }, lines: line(10000) }, { finalize: true });
    const n = await newNote(owner, b2b.id);
    await saveNote(owner, { ...n, reason: 'return', lines: n.lines.map((l) => ({ ...l, qty: 1 })) }, { finalize: true });
    const { json } = (await buildGstr1('b1', month)) as unknown as { json: Record<string, any> };
    expect(json.fp).toBe(`${month.slice(5)}${month.slice(0, 4)}`);
    expect(json.b2b[0].ctin).toBe('27AAPFU0939F1ZV');
    expect(json.b2b[0].inv[0]).toMatchObject({ inum: b2b.number, val: 1180, pos: '27', itms: [{ itm_det: { txval: 1000, rt: 18, camt: 90, samt: 90, iamt: 0 } }] });
    expect(json.b2cs).toEqual([{ sply_ty: 'INTRA', pos: '27', typ: 'OE', rt: 18, txval: 200, iamt: 0, camt: 18, samt: 18, csamt: 0 }]);
    expect(json.cdnr[0].nt[0]).toMatchObject({ ntty: 'C', val: 590 });
    expect(json.hsn.hsn_b2b[0]).toMatchObject({ hsn_sc: '3209', uqc: 'LTR', qty: 1, txval: 500 });
    expect(json.doc_issue.doc_det.map((d: { doc_num: number }) => d.doc_num)).toEqual([1, 5]);
    expect(json.doc_issue.doc_det[0].docs[0]).toMatchObject({ totnum: 2, cancel: 0, net_issue: 2 });
    expect(uqcOf('Pcs')).toBe('NOS');
    expect(uqcOf('sq ft')).toBe('SQF');
  });
});

describe('paper bill scan', () => {
  it('becomes a draft bill with the customer, items, paper number and photo', async () => {
    await putRecord('items', owner, { id: 'rice', name: 'Rice', unit: 'bag', rate: 50000, rateIncludesTax: false, taxPct: 5 } as Item);
    const inv = await draftFromPaperBill(
      owner,
      { supplierName: 'mehta', supplierGstin: '', billNo: '217', date: '2026-11-01', hasGst: false, igst: false, lines: [{ name: 'Rice', hsn: '', qty: 2, unit: 'bag', rate: 480, taxPct: 0, mrp: 0 }, { name: 'Oil 1L', hsn: '', qty: 1, unit: 'L', rate: 160, taxPct: 0, mrp: 0 }], total: 1120 },
      'data:image/jpeg;base64,xx',
    );
    expect(inv.status).toBe('draft');
    expect(inv.billTo?.customerId).toBe('c1');
    expect(inv.reference).toBe('Paper bill 217');
    expect(inv.lines.map((l) => [l.itemId, l.rate])).toEqual([['rice', 48000], [null, 16000]]);
    expect(inv.photos).toEqual(['data:image/jpeg;base64,xx']);
    expect(inv.date).toBe('2026-11-01');
  });
});

