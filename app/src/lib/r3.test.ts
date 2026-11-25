import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Customer } from './db';
import { jobAdvance, newJob, nextStage, saveJob, setStage, settleJobAdvance, takeAdvance } from './jobs';
import { khataOf } from './khata';
import { billMoney, convertEstimate, ensureBusinessRecords, newInvoiceDraft, putRecord, saveInvoice, type Actor } from './repo';
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

