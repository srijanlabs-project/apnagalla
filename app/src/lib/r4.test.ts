import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Customer } from './db';
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
