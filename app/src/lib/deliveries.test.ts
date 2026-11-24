import 'fake-indexeddb/auto';
import { addDaysISO, todayISO } from '@invoice/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { deliveriesFor, markDelivered } from './deliveries';
import { ensureBusinessRecords, newInvoiceDraft, saveInvoice, type Actor } from './repo';

const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Ravi', role: 'staff', seriesCode: 'B' };
const line = { id: 'l1', name: 'Glass', qty: 1, unit: 'pcs', rate: 10000, rateIncludesTax: false, taxPct: 0 };
const party = { customerId: null, name: 'Mehta', address: {} };

async function bill(deliveryDate: string, assignee?: Actor) {
  const d = await newInvoiceDraft(owner);
  return saveInvoice(
    owner,
    { ...d, lines: [line], billTo: party, deliveryDate, deliveryAssignee: assignee ? { userId: assignee.userId, name: assignee.userName } : null },
    { finalize: true },
  );
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
});

describe('deliveries', () => {
  it('groups by overdue / today / tomorrow; staff see theirs and unassigned ones; marking delivered removes it', async () => {
    const today = todayISO();
    const late = await bill(addDaysISO(today, -2));
    await bill(today, owner);
    const tmr = await bill(addDaysISO(today, 1), staff);
    await bill(addDaysISO(today, 5));

    const all = await deliveriesFor(owner);
    expect(all.map((d) => d.when)).toEqual(['overdue', 'today', 'tomorrow', 'later']);
    // Staff don't see the owner's own delivery.
    expect((await deliveriesFor(staff)).map((d) => d.doc.id)).not.toContain(all[1]!.doc.id);
    expect((await deliveriesFor(staff)).map((d) => d.doc.id)).toContain(tmr.id);

    await markDelivered(staff, 'invoice', late.id);
    const done = (await db.invoices.get(late.id))!;
    expect(done.deliveredByName).toBe('Ravi');
    expect(done.history.at(-1)!.action).toBe('delivered');
    expect((await deliveriesFor(owner)).map((d) => d.doc.id)).not.toContain(late.id);
  });
});
