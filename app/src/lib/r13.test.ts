import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDay, cashDay } from './cashbook';
import { db } from './db';
import { billingBlocked, unclosedDays } from './dayEnd';
import { ensureBusinessRecords, newInvoiceDraft, putRecord, saveInvoice, type Actor } from './repo';
import { checkInPlanned, planSummary, planVisits, plannedFor, visitsIn } from './visits';

const owner: Actor = { businessId: 'b1', userId: 'u-owner', userName: 'Owner', role: 'owner' };
const staff: Actor = { businessId: 'b1', userId: 'u-staff', userName: 'Ravi', role: 'staff', seriesCode: 'A' };

async function billOn(date: string) {
  const d = await newInvoiceDraft(owner);
  await saveInvoice(owner, { ...d, date, lines: [{ id: 'l', name: 'Rice', qty: 1, unit: 'kg', rate: 5000, rateIncludesTax: true, taxPct: 0 }] }, { finalize: true });
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await ensureBusinessRecords('b1', 'Test Co');
  await putRecord('customers', owner, { id: 'c1', name: 'Hotel Raj', billingAddress: {}, openingBalance: 0 } as never);
  await putRecord('customers', owner, { id: 'c2', name: 'Mehta Stores', billingAddress: {}, openingBalance: 0 } as never);
});

describe('Softer day-end', () => {
  it('reminds after one unclosed day and stops billing only after two (default)', async () => {
    const s = { ...(await db.settings.get('b1'))!, dayEndFrom: '2026-11-01' };
    await billOn('2026-11-20');
    const now = new Date(2026, 10, 21, 10);
    expect(await unclosedDays('b1', s, now)).toEqual(['2026-11-20']);
    expect(await billingBlocked('b1', s, now)).toBeNull();
    expect(await billingBlocked('b1', { ...s, dayEndMode: 'next' }, now)).toMatchObject({ date: '2026-11-20', count: 1 });
    await billOn('2026-11-21');
    const later = new Date(2026, 10, 22, 10);
    expect(await billingBlocked('b1', s, later)).toMatchObject({ date: '2026-11-20', count: 2 });
    expect(await billingBlocked('b1', { ...s, dayEndMode: 'remind' }, later)).toBeNull();
    // Closing the older day (at the expected amount) lifts the stop.
    await closeDay(owner, await cashDay('b1', '2026-11-20'), (await cashDay('b1', '2026-11-20')).expected, 'Closed at the expected amount');
    expect(await billingBlocked('b1', s, later)).toBeNull();
  });
});

describe('Planned visits', () => {
  it('owner plans, salesperson checks in, the summary counts done and missed', async () => {
    const ravi = { userId: staff.userId, name: 'Ravi' };
    expect(await planVisits(owner, '2026-11-20', ravi, [{ id: 'c1', name: 'Hotel Raj' }, { id: 'c2', name: 'Mehta Stores' }])).toBe(2);
    // Planning the same customer again for that day is skipped.
    expect(await planVisits(owner, '2026-11-20', ravi, [{ id: 'c1', name: 'Hotel Raj' }])).toBe(0);
    const plans = await plannedFor('b1', '2026-11-20', staff.userId);
    expect(plans.map((p) => p.customerName)).toEqual(['Hotel Raj', 'Mehta Stores']);
    // Not visited yet: a plan is not a visit.
    expect(await visitsIn('b1', '2026-11-20', '2026-11-20')).toHaveLength(0);
    await checkInPlanned(staff, plans[0]!, { lat: 26.9, lng: 75.8, accuracy: 20 });
    expect(await visitsIn('b1', '2026-11-20', '2026-11-20')).toHaveLength(1);
    expect(await planSummary('b1', '2026-11-14', '2026-11-20', '2026-11-21')).toEqual([{ userId: staff.userId, name: 'Ravi', planned: 2, done: 1, missed: 1, open: 0 }]);
  });
});
