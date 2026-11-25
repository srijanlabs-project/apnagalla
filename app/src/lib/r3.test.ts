import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Customer } from './db';
import { jobAdvance, newJob, nextStage, saveJob, setStage, settleJobAdvance, takeAdvance } from './jobs';
import { khataOf } from './khata';
import { billMoney, convertEstimate, ensureBusinessRecords, newInvoiceDraft, putRecord, saveInvoice, type Actor } from './repo';
import { createVariants, priceFor, repriceLines, unitOptions, variantsOf } from './pricing';
import { newPurchaseDraft, purchaseLineFromItem, savePurchase } from './purchases';
import { stockLevels, tracksStock } from './stock';
import type { Item } from './db';

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

