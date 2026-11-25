import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Customer, type DocLine, type Offer } from './db';
import { applyOffers, checkCoupon } from './offers';
import { buildDocDefinition } from './pdf/buildDoc';
import { pdfInputFor } from './pdf';
import { PermissionError, ensureBusinessRecords, newCreditNoteDraft, newInvoiceDraft, putRecord, saveCreditNote, saveInvoice, settingsOf, type Actor } from './repo';

const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Staff', role: 'staff', seriesCode: 'A' };
export const TODAY = new Date().toISOString().slice(0, 10);

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

