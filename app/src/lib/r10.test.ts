import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { eInvoiceJson, eInvoiceProblems, ewayBillJson, uqc } from './einvoice';
import { makeBackup, readBackup, restoreBackup, restorePlan } from './backup';
import { deleteRecord, ensureBusinessRecords, newInvoiceDraft, putRecord, saveInvoice, type Actor } from './repo';

export const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
export const line = (id: string, name: string, qty: number, rate: number, extra = {}) => ({ id, name, qty, unit: 'pcs', rate, rateIncludesTax: false, taxPct: 0, ...extra });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await db.profiles.update('b1', { gstType: 'regular', taxIdValue: '27AAPFU0939F1ZV', legalName: 'Test Co Pvt Ltd', address: { line1: 'Shop 4, MG Road', city: 'Pune', state: 'Maharashtra', pin: '411001' } });
});

describe('R10.1 e-invoice and e-way bill', () => {
  it('builds the IRP 1.1 JSON for an inter-state B2B bill and the e-way bill file', async () => {
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(
      owner,
      {
        ...d,
        date: '2026-11-20',
        taxMode: 'gst',
        billTo: { customerId: null, name: 'Gujarat Traders', taxId: '24AAACG1234A1Z5', address: { line1: 'Ring Road', city: 'Surat', state: 'Gujarat', pin: '395003' } },
        lines: [line('a', 'Ceiling fan', 10, 200000, { taxPct: 18, hsn: '8414', unit: 'pcs' }), line('b', 'Wire', 2, 150000, { taxPct: 18, hsn: '8544', unit: 'box' })],
      },
      { finalize: true },
    );
    const profile = (await db.profiles.get('b1'))!;
    expect(eInvoiceProblems('invoice', inv, profile)).toEqual([]);
    const j = eInvoiceJson('invoice', inv, profile);
    expect(j.DocDtls).toEqual({ Typ: 'INV', No: inv.number, Dt: '20/11/2026' });
    expect(j.SellerDtls).toMatchObject({ Gstin: '27AAPFU0939F1ZV', Pin: 411001, Stcd: '27' });
    expect(j.BuyerDtls).toMatchObject({ Gstin: '24AAACG1234A1Z5', Pos: '24', Pin: 395003, Stcd: '24' });
    expect(j.ItemList.map((i) => [i.HsnCd, i.Unit, i.AssAmt, i.IgstAmt, i.CgstAmt])).toEqual([
      ['8414', 'NOS', 20000, 3600, 0],
      ['8544', 'BOX', 3000, 540, 0],
    ]);
    expect(j.ValDtls).toMatchObject({ AssVal: 23000, IgstVal: 4140, CgstVal: 0, TotInvVal: inv.totals.grandTotal / 100 });
    const ewb = ewayBillJson(inv, profile, { mode: 1, distanceKm: 265.4, vehicleNo: 'mh 12-ab 1234' });
    expect(ewb.billLists[0]).toMatchObject({ fromStateCode: 27, toStateCode: 24, toPincode: 395003, transDistance: 265, vehicleNo: 'MH12AB1234', igstValue: 4140 });
    expect(ewb.billLists[0]!.itemList[0]).toMatchObject({ hsnCode: 8414, qtyUnit: 'NOS', igstRate: 18, cgstRate: 0 });
  });

  it('says what is missing', async () => {
    await putRecord('items', owner, { id: 'x', name: 'X', unit: 'kg', rate: 100, taxPct: 5 } as never);
    const d = await newInvoiceDraft(owner);
    const inv = await saveInvoice(owner, { ...d, taxMode: 'gst', lines: [line('a', 'Rice', 1, 10000, { taxPct: 5 })] }, { finalize: true });
    const problems = eInvoiceProblems('invoice', inv, (await db.profiles.get('b1'))!);
    expect(problems).toEqual(expect.arrayContaining(['The buyer’s GSTIN is missing (e-invoices are for B2B bills)', 'Every item needs an HSN code']));
    expect(uqc('Kg')).toBe('KGS');
    expect(uqc('thela')).toBe('OTH');
  });
});

describe('R10.2 backup and restore', () => {
  it('a backup brings back deleted and missing records, never older copies over newer work', async () => {
    await putRecord('customers', owner, { id: 'c1', name: 'Mehta', billingAddress: {}, openingBalance: 0 } as never);
    await putRecord('customers', owner, { id: 'c2', name: 'Shah', billingAddress: {}, openingBalance: 0 } as never);
    await putRecord('items', owner, { id: 'i1', name: 'Fan', unit: 'pcs', rate: 100, taxPct: 0 } as never);
    const file = readBackup(JSON.stringify(await makeBackup('b1', 'Test Co')));
    expect(file.tables.customers).toHaveLength(2);
    await deleteRecord('customers', owner, 'c1');
    await db.customers.delete('c2');
    await new Promise((r) => setTimeout(r, 5));
    await putRecord('items', owner, { ...(await db.items.get('i1'))!, rate: 200 });
    const plan = await restorePlan(file);
    expect(plan.map((p) => [p.table, p.rows.map((r) => r.id)])).toEqual([['customers', ['c1', 'c2']]]);
    expect(await restoreBackup(owner, file)).toBe(2);
    expect((await db.customers.get('c1'))!.deleted).toBe(false);
    expect((await db.customers.get('c2'))!.name).toBe('Shah');
    expect((await db.items.get('i1'))!.rate).toBe(200);
    await expect(restoreBackup(owner, { ...file, businessId: 'other' })).rejects.toThrow();
    expect(() => readBackup('{"hello":1}')).toThrow();
  });
});
