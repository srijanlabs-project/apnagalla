import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, type Customer } from './db';
import { jobAdvance, newJob, nextStage, saveJob, setStage, settleJobAdvance, takeAdvance } from './jobs';
import { khataOf } from './khata';
import { billMoney, convertEstimate, ensureBusinessRecords, putRecord, saveInvoice, type Actor } from './repo';

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
