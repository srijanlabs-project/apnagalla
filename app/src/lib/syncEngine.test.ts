import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/* A tiny in-memory "server" standing in for the API. */
const server = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>>(), // `${table}:${id}` -> data
  log: [] as { table: string; id: string; data: Record<string, unknown>; seq: number }[],
  seq: 0,
  next: 1,
  online: true,
  rejectTables: new Set<string>(),
}));

vi.mock('./platform', () => ({ CLIENT_KIND: 'mobile', CAN_CREATE_INVOICES: true, WEB_INVOICE_NOTE: '' }));
vi.mock('./api', async () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
    ) {
      super(message);
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
      reserveNumbers: async (_biz: string, body: { count: number }) => {
        offline();
        const numbers = Array.from({ length: body.count }, () => server.next++);
        return { numbers };
      },
    },
  };
});

const { db, getMeta } = await import('./db');
const repo = await import('./repo');
const { syncNow } = await import('./syncEngine');

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
  server.next = 1;
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

  it('keeps a block of numbers for offline saving and refuses to invent numbers when it runs out', async () => {
    await syncNow(['b1'], 'b1'); // tops up invoice + estimate blocks
    server.online = false;
    const save = async () => repo.saveInvoice(owner, { ...(await repo.newInvoiceDraft(owner)), lines: [line] }, { finalize: true });

    const first = await save();
    expect(first.number).toMatch(/\/0001$/);
    // Offline: the rest of the block is used in order.
    const numbers = [first.number];
    for (let i = 0; i < 9; i++) numbers.push((await save()).number);
    expect(new Set(numbers).size).toBe(10);
    await expect(save()).rejects.toBeInstanceOf(repo.NumberingError);

    // Back online: numbers come straight from the server again.
    server.online = true;
    const online = await save();
    expect(online.number).not.toBe('');
    expect(numbers).not.toContain(online.number);
    expect((await getMeta<number[]>(repo.numberPoolKey('b1', 'invoice', '26-27'))) ?? []).toEqual([]);
  });
});
