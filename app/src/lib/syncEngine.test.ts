import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/* A tiny in-memory "server" standing in for the API. */
const server = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(), // `${table}:${id}` -> data
  log: [] as { table: string; id: string; data: Record<string, unknown>; seq: number }[],
  seq: 0,
  next: {} as Record<string, number>,
  returned: [] as { kind: string; numbers: number[] }[],
  online: true,
  rejectTables: new Set<string>(),
}));

vi.mock('./platform', () => ({ CLIENT_KIND: 'mobile', CAN_CREATE_INVOICES: true, WEB_INVOICE_NOTE: '' }));
vi.mock('./api', async () => {
  class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  class NetworkError extends Error {}
  const offline = () => {
    if (!server.online) throw new NetworkError('offline');
  };
  return {
    ApiError,
    NetworkError,
    api: {
      syncPush: async (_biz: string, body: { changes: { table: string; id: string; data: Record<string, unknown> }[] }) => {
        offline();
        return {
          results: body.changes.map((c) => {
            const key = `${c.table}:${c.id}`;
            const cur = server.records.get(key);
            if (server.rejectTables.has(c.table)) return { table: c.table, id: c.id, status: 'rejected', reason: 'no', current: cur };
            if (cur && String(cur.updatedAt) > String(c.data.updatedAt)) return { table: c.table, id: c.id, status: 'stale', current: cur };
            server.records.set(key, c.data);
            server.log.push({ table: c.table, id: c.id, data: c.data, seq: ++server.seq });
            return { table: c.table, id: c.id, status: 'ok' };
          }),
        };
      },
      syncPull: async (_biz: string, since: number) => {
        offline();
        const changes = server.log.filter((l) => l.seq > since);
        return { changes, cursor: changes.length ? changes[changes.length - 1]!.seq : since, more: false };
      },
      returnNumbers: async (_biz: string, body: { kind: string; numbers: number[] }) => {
        offline();
        server.returned.push(body);
      },
      reserveNumbers: async (_biz: string, body: { kind: string; count: number }) => {
        offline();
        const numbers = Array.from({ length: body.count }, () => (server.next[body.kind] = (server.next[body.kind] ?? 0) + 1));
        return { numbers };
      },
    },
  };
});

const { db, getMeta } = await import('./db');
const repo = await import('./repo');
const { returnAllNumbers, syncNow } = await import('./syncEngine');

const owner = { businessId: 'b1', userId: 'u1', userName: 'Owner', role: 'owner' as const };
const line = { id: 'l1', name: 'Rice', qty: 1, unit: 'bag', rate: 10000, rateIncludesTax: false, taxPct: 0 };
const remote = (table: string, data: Record<string, unknown>) => {
  server.records.set(`${table}:${data.id}`, data);
  server.log.push({ table, id: String(data.id), data, seq: ++server.seq });
};

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  server.records.clear();
  server.log.length = 0;
  server.seq = 0;
  server.next = {};
  server.returned.length = 0;
  server.online = true;
  server.rejectTables.clear();
  await repo.ensureBusinessRecords('b1', 'Test Co');
});

afterAll(() => repo.setNumberAllocator(null));

describe('sync engine', () => {
  it('pushes local changes, empties the queue, and pulls changes made on other phones', async () => {
    await repo.putRecord('customers', owner, { id: 'c1', name: 'Gupta', billingAddress: {}, openingBalance: 0 });
    remote('items', { id: 'i1', businessId: 'b1', name: 'Rice', updatedAt: '2026-11-24T10:00:00.000Z' });

    await syncNow(['b1'], 'b1');

    expect(server.records.get('customers:c1')?.name).toBe('Gupta');
    expect(await db.outbox.count()).toBe(0);
    expect((await db.items.get('i1'))?.name).toBe('Rice');
  });

  it('never overwrites a local edit that has not been uploaded yet', async () => {
    remote('customers', { id: 'c1', businessId: 'b1', name: 'Server name', updatedAt: '2026-11-24T10:00:00.000Z' });
    server.online = false;
    await repo.putRecord('customers', owner, { id: 'c1', name: 'My new name', billingAddress: {}, openingBalance: 0 });
    // Pull alone (as if push failed) must keep the local edit.
    server.online = true;
    const pushSpy = (await import('./api')).api.syncPush;
    (await import('./api')).api.syncPush = async () => {
      throw new (await import('./api')).NetworkError();
    };
    await syncNow(['b1'], 'b1');
    expect((await db.customers.get('c1'))?.name).toBe('My new name');
    (await import('./api')).api.syncPush = pushSpy;
    // Next round uploads it.
    await syncNow(['b1'], 'b1');
    expect(server.records.get('customers:c1')?.name).toBe('My new name');
  });

  it("takes the server's copy when the server has a newer edit or refuses ours", async () => {
    remote('customers', { id: 'c1', businessId: 'b1', name: 'Newer on server', updatedAt: '2999-01-01T00:00:00.000Z' });
    await repo.putRecord('customers', owner, { id: 'c1', name: 'Older here', billingAddress: {}, openingBalance: 0 });
    await syncNow(['b1'], 'b1');
    expect((await db.customers.get('c1'))?.name).toBe('Newer on server');

    server.rejectTables.add('settings');
    remote('settings', { ...repo.defaultSettings('b1'), invoicePrefix: 'SRV', updatedAt: '2026-01-01T00:00:00.000Z' });
    await syncNow(['b1'], 'b1');
    const s = (await db.settings.get('b1'))!;
    await repo.putRecord('settings', owner, { ...s, invoicePrefix: 'MINE' });
    await syncNow(['b1'], 'b1');
    expect((await db.settings.get('b1'))?.invoicePrefix).toBe('SRV');
    expect(await db.outbox.count()).toBe(0);
  });

  const save = async (actor: import('./repo').Actor = owner) => repo.saveInvoice(actor, { ...(await repo.newInvoiceDraft(actor)), lines: [line] }, { finalize: true });

  it('series per person (default): numbers on the phone, never runs out offline, carries on after numbers seen elsewhere', async () => {
    // Another phone of the owner already used INV/26-27/0007 (e.g. the old phone).
    remote('invoices', { id: 'old', businessId: 'b1', status: 'saved', number: 'INV/26-27/0007', numberSeries: 'invoice:26-27', numberSeq: 7, date: '2026-11-20', lines: [], totals: { grandTotal: 0 }, updatedAt: '2026-11-20T10:00:00.000Z' });
    await syncNow(['b1'], 'b1');
    server.online = false;
    const numbers: string[] = [];
    for (let i = 0; i < 30; i++) numbers.push((await save()).number);
    expect(numbers[0]).toMatch(/^INV\/\d{2}-\d{2}\/0008$/);
    expect(new Set(numbers).size).toBe(30);
    // A staff member's numbers carry their letter, in their own series.
    const staff = { ...owner, userId: 'u2', role: 'staff' as const, seriesCode: 'B' };
    const b = await save(staff);
    expect(b.number).toMatch(/^INV-B\/\d{2}-\d{2}\/0001$/);
    expect(b.numberSeries).toMatch(/^invoice-B:/);
  });

  it('one shared series: a block sized to use, used first, refused when empty offline, given back on logout', async () => {
    const s = (await db.settings.get('b1'))!;
    await db.settings.put({ ...s, numberingMode: 'shared' });
    await syncNow(['b1'], 'b1'); // block of 20 (the minimum)
    expect(((await getMeta<number[]>(repo.numberPoolKey('b1', 'invoice', '26-27'))) ?? []).length).toBe(20);

    // Online, the block is still used first, so numbers stay dense.
    expect((await save()).number).toMatch(/\/0001$/);
    server.online = false;
    for (let i = 0; i < 19; i++) await save();
    await expect(save()).rejects.toBeInstanceOf(repo.NumberingError);

    server.online = true;
    expect((await save()).number).toMatch(/\/0021$/); // straight from the server
    await syncNow(['b1'], 'b1'); // tops up again
    const held = (await getMeta<number[]>(repo.numberPoolKey('b1', 'invoice', '26-27'))) ?? [];
    expect(held.length).toBeGreaterThan(0);
    await returnAllNumbers(['b1']);
    expect(server.returned.find((r) => r.kind === 'invoice')?.numbers).toEqual(held);
    expect(await getMeta(repo.numberPoolKey('b1', 'invoice', '26-27'))).toBeUndefined();
  });

  it('switching to series per person gives the shared block back', async () => {
    const s = (await db.settings.get('b1'))!;
    await db.settings.put({ ...s, numberingMode: 'shared' });
    await syncNow(['b1'], 'b1');
    await db.settings.put({ ...s, numberingMode: 'perPerson' });
    await syncNow(['b1'], 'b1');
    expect(server.returned.map((r) => r.kind)).toContain('invoice');
    expect(await getMeta(repo.numberPoolKey('b1', 'invoice', '26-27'))).toBeUndefined();
  });
});
