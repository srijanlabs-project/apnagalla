import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeIndianMobile, type SyncPullResponse, type SyncPushResponse, type VerifyOtpResponse } from '@invoice/shared';
import { buildApp } from '../src/app';
import { openDatabase, type Database } from '../src/db/client';
import { otpRequests } from '../src/db/schema';
import { loadEnv } from '../src/env';
import type { OtpSender } from '../src/sms';

class FakeSender implements OtpSender {
  readonly name = 'fake';
  readonly last = new Map<string, string>();
  async sendOtp(phone: string, code: string) {
    this.last.set(phone, code);
  }
}

let app: FastifyInstance;
let database: Database;
const sender = new FakeSender();
let ipCounter = 0;

beforeAll(async () => {
  const env = loadEnv({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-123', OTP_FIXED_CODE: '' });
  database = await openDatabase({ pgliteDir: 'memory://' });
  await database.migrate(path.resolve(__dirname, '../drizzle'));
  app = await buildApp({ env, database, otpSender: sender, logger: false });
}, 60_000);

afterAll(async () => {
  await app?.close();
  await database?.close();
});

async function login(phone: string, client: 'mobile' | 'web' = 'mobile'): Promise<VerifyOtpResponse> {
  await database.db.delete(otpRequests).where(eq(otpRequests.phone, normalizeIndianMobile(phone)!));
  const ip = `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  await app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone }, remoteAddress: ip });
  const code = sender.last.get(normalizeIndianMobile(phone)!)!;
  const r = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone, code, client } });
  expect(r.statusCode).toBe(200);
  return r.json();
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const at = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString();

/** Owner + store + accepted staff member (staff logs in on a phone, owner too). */
async function setupStore(base: string) {
  const owner = await login(`${base}1`);
  const oH = bearer(owner.accessToken);
  const biz = (await app.inject({ method: 'POST', url: '/v1/businesses', headers: oH, payload: { name: `Store ${base}` } })).json<{ id: string }>();
  await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/invites`, headers: oH, payload: { phone: `${base}2` } });
  const staff = await login(`${base}2`);
  const sH = bearer(staff.accessToken);
  await app.inject({ method: 'POST', url: `/v1/invites/${staff.me.invites[0]!.id}/accept`, headers: sH });
  // The owner's browser login (allowed next to the phone).
  const wH = bearer((await login(`${base}1`, 'web')).accessToken);
  return { biz, owner, staff, oH, sH, wH };
}

function push(bizId: string, h: Record<string, string>, changes: { table: string; id: string; data: Record<string, unknown> }[]) {
  return app.inject({ method: 'POST', url: `/v1/businesses/${bizId}/sync/push`, headers: h, payload: { changes } });
}
async function pushOk(bizId: string, h: Record<string, string>, changes: { table: string; id: string; data: Record<string, unknown> }[]) {
  const r = await push(bizId, h, changes);
  expect(r.statusCode).toBe(200);
  return r.json<SyncPushResponse>().results;
}
async function pull(bizId: string, h: Record<string, string>, since = 0) {
  const r = await app.inject({ method: 'GET', url: `/v1/businesses/${bizId}/sync/pull?since=${since}`, headers: h });
  expect(r.statusCode).toBe(200);
  return r.json<SyncPullResponse>();
}

const invoice = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  status: 'saved',
  number: 'INV/26-27/0001',
  date: '2026-11-24',
  lines: [{ id: 'l1', name: 'Rice', qty: 1, rate: 10000 }],
  totals: { grandTotal: 10000 },
  payment: { status: 'unpaid', amountPaid: 0 },
  history: [],
  createdBy: 'x',
  updatedAt: at(0),
  ...extra,
});

describe('sync push / pull', () => {
  it("one phone's changes reach another phone of the same store, in order", async () => {
    const { biz, oH, sH } = await setupStore('960000000');
    const res = await pushOk(biz.id, oH, [
      { table: 'customers', id: 'c1', data: { id: 'c1', name: 'Gupta Store', updatedAt: at(0) } },
      { table: 'items', id: 'i1', data: { id: 'i1', name: 'Rice 5kg', rate: 59000, updatedAt: at(0) } },
    ]);
    expect(res.map((r) => r.status)).toEqual(['ok', 'ok']);

    const first = await pull(biz.id, sH);
    expect(first.changes.map((c) => [c.table, c.id])).toEqual([
      ['customers', 'c1'],
      ['items', 'i1'],
    ]);
    // Identity fields come from the server, not the client.
    expect(first.changes[0]!.data.businessId).toBe(biz.id);
    expect(first.more).toBe(false);

    // Nothing new after the cursor; a later change shows up on its own.
    expect((await pull(biz.id, sH, first.cursor)).changes).toEqual([]);
    await pushOk(biz.id, sH, [{ table: 'customers', id: 'c2', data: { id: 'c2', name: 'Verma', updatedAt: at(0) } }]);
    const next = await pull(biz.id, oH, first.cursor);
    expect(next.changes.map((c) => c.id)).toEqual(['c2']);
  });

  it('latest edit wins; an older copy arriving late is ignored', async () => {
    const { biz, oH, sH } = await setupStore('960000001');
    await pushOk(biz.id, oH, [{ table: 'customers', id: 'c1', data: { id: 'c1', name: 'New name', updatedAt: at(0) } }]);
    const late = await pushOk(biz.id, sH, [{ table: 'customers', id: 'c1', data: { id: 'c1', name: 'Old name', updatedAt: at(-10) } }]);
    expect(late[0]!.status).toBe('stale');
    expect(late[0]!.current?.name).toBe('New name');
    const { changes } = await pull(biz.id, sH);
    expect(changes.find((c) => c.id === 'c1')!.data.name).toBe('New name');
  });

  it('a record pushed to one store never appears in another', async () => {
    const a = await setupStore('960000002');
    const b = await setupStore('960000003');
    // Claims to belong to store B, but is pushed to store A: it is stored under A.
    await pushOk(a.biz.id, a.oH, [{ table: 'customers', id: 'spoof', data: { id: 'spoof', businessId: b.biz.id, name: 'X', updatedAt: at(0) } }]);
    expect((await pull(b.biz.id, b.oH)).changes.map((c) => c.id)).not.toContain('spoof');
    // And B's owner can't read A's data at all.
    expect((await app.inject({ method: 'GET', url: `/v1/businesses/${a.biz.id}/sync/pull`, headers: b.oH })).statusCode).toBe(403);
    expect((await push(a.biz.id, b.oH, [])).statusCode).toBe(403);
  });

  it('staff cannot change store details', async () => {
    const { biz, oH, sH } = await setupStore('960000004');
    const staffTry = await pushOk(biz.id, sH, [{ table: 'settings', id: biz.id, data: { id: biz.id, invoicePrefix: 'HACK', updatedAt: at(0) } }]);
    expect(staffTry[0]!.status).toBe('rejected');
    const ownerDoes = await pushOk(biz.id, oH, [{ table: 'settings', id: biz.id, data: { id: biz.id, invoicePrefix: 'SHT', updatedAt: at(0) } }]);
    expect(ownerDoes[0]!.status).toBe('ok');
  });

  it('staff can mark a saved bill delivered', async () => {
    const { biz, oH, sH } = await setupStore('960000016');
    await pushOk(biz.id, oH, [{ table: 'invoices', id: 'd1', data: invoice('d1', { number: 'INV/26-27/0099', deliveryDate: '2026-11-26', updatedAt: at(-5) }) }]);
    const r = await pushOk(biz.id, sH, [
      { table: 'invoices', id: 'd1', data: invoice('d1', { number: 'INV/26-27/0099', deliveryDate: '2026-11-26', deliveredAt: at(0), deliveredByName: 'Ravi', updatedAt: at(-4) }) },
    ]);
    expect(r[0]!.status).toBe('ok');
  });

  it('staff can record a payment on a saved invoice but not edit it or reduce the payment', async () => {
    const { biz, oH, sH } = await setupStore('960000005');
    await pushOk(biz.id, oH, [{ table: 'invoices', id: 'inv1', data: invoice('inv1', { updatedAt: at(-5) }) }]);

    const pay = await pushOk(biz.id, sH, [
      { table: 'invoices', id: 'inv1', data: invoice('inv1', { payment: { status: 'partial', amountPaid: 4000 }, history: [{ action: 'payment' }], updatedAt: at(-4) }) },
    ]);
    expect(pay[0]!.status).toBe('ok');

    const edit = await pushOk(biz.id, sH, [
      { table: 'invoices', id: 'inv1', data: invoice('inv1', { payment: { status: 'partial', amountPaid: 4000 }, lines: [], updatedAt: at(-3) }) },
    ]);
    expect(edit[0]).toMatchObject({ status: 'rejected', reason: 'Only the owner can edit a saved invoice' });

    const reduce = await pushOk(biz.id, sH, [{ table: 'invoices', id: 'inv1', data: invoice('inv1', { updatedAt: at(-2) }) }]);
    expect(reduce[0]).toMatchObject({ status: 'rejected', reason: 'Only the owner can reduce a recorded payment' });

    // Staff edit their own drafts freely; only drafts can be deleted.
    await pushOk(biz.id, sH, [{ table: 'invoices', id: 'd1', data: invoice('d1', { status: 'draft', number: '' }) }]);
    expect((await pushOk(biz.id, sH, [{ table: 'invoices', id: 'd1', data: invoice('d1', { status: 'draft', number: '', deleted: true, updatedAt: at(1) }) }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, oH, [{ table: 'invoices', id: 'inv1', data: invoice('inv1', { deleted: true, updatedAt: at(2) }) }]))[0]!.status).toBe('rejected');
  });

  it('the web cannot create invoices but can record payments', async () => {
    const owner = await login('9600000061');
    const oH = bearer(owner.accessToken);
    const biz = (await app.inject({ method: 'POST', url: '/v1/businesses', headers: oH, payload: { name: 'Web test' } })).json<{ id: string }>();
    const web = await login('9600000061', 'web');
    const wH = bearer(web.accessToken);

    expect((await pushOk(biz.id, wH, [{ table: 'invoices', id: 'w1', data: invoice('w1') }]))[0]!.status).toBe('rejected');
    await pushOk(biz.id, oH, [{ table: 'invoices', id: 'p1', data: invoice('p1', { updatedAt: at(-5) }) }]);
    const pay = await pushOk(biz.id, wH, [{ table: 'invoices', id: 'p1', data: invoice('p1', { payment: { status: 'paid', amountPaid: 10000 }, updatedAt: at(-1) }) }]);
    expect(pay[0]!.status).toBe('ok');
    // Estimates are fine on the web; invoice numbers are not handed to the web.
    expect((await pushOk(biz.id, wH, [{ table: 'estimates', id: 'e1', data: { id: 'e1', status: 'draft', updatedAt: at(0) } }]))[0]!.status).toBe('ok');
    const r = await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/numbers/reserve`, headers: wH, payload: { kind: 'invoice', period: '26-27', count: 1 } });
    expect(r.statusCode).toBe(403);
  });

  it('a paused staff member can neither push nor pull', async () => {
    const { biz, oH, sH, staff } = await setupStore('960000007');
    await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/members/${staff.me.user.id}/deactivate`, headers: oH });
    expect((await push(biz.id, sH, [])).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/sync/pull`, headers: sH })).statusCode).toBe(403);
  });

  it('rejects a push without a valid updatedAt', async () => {
    const { biz, oH } = await setupStore('960000008');
    const res = await pushOk(biz.id, oH, [{ table: 'customers', id: 'c1', data: { id: 'c1', name: 'X' } }]);
    expect(res[0]!.status).toBe('rejected');
  });
});

describe('invoice numbers', () => {
  it('hands out each number once per store and series, and skips numbers already used on a phone', async () => {
    const { biz, oH, sH } = await setupStore('960000009');
    const reserve = async (h: Record<string, string>, count: number, period = '26-27') =>
      (await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/numbers/reserve`, headers: h, payload: { kind: 'invoice', period, count } })).json<{
        numbers: number[];
      }>().numbers;

    expect(await reserve(oH, 1)).toEqual([1]);
    expect(await reserve(sH, 3)).toEqual([2, 3, 4]);
    expect(await reserve(oH, 1)).toEqual([5]);
    // Separate series per financial year and per kind.
    expect(await reserve(oH, 1, '27-28')).toEqual([1]);

    // A phone that numbered invoices before sync existed pushes INV/26-27/0041: the series moves past it.
    await pushOk(biz.id, oH, [{ table: 'invoices', id: 'old41', data: invoice('old41', { number: 'INV/26-27/0041' }) }]);
    expect(await reserve(sH, 1)).toEqual([42]);
  });

  it('keeps tax invoices, bills and credit notes in separate series, using the series a document names', async () => {
    const { biz, oH, wH } = await setupStore('960000010');
    const reserve = async (kind: string, h = oH) =>
      app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/numbers/reserve`, headers: h, payload: { kind, period: '26-27', count: 1 } });
    expect((await reserve('invoice')).json()).toEqual({ numbers: [1] });
    expect((await reserve('bill')).json()).toEqual({ numbers: [1] });
    expect((await reserve('credit')).json()).toEqual({ numbers: [1] });
    expect((await reserve('bill', wH)).statusCode).toBe(403);
    expect((await reserve('credit', wH)).statusCode).toBe(403);

    // A custom pattern can't be parsed, so the document says which series and number it used.
    await pushOk(biz.id, oH, [{ table: 'invoices', id: 'b9', data: invoice('b9', { number: 'BILL-2026-27-009', numberSeries: 'bill:26-27', numberSeq: 9 }) }]);
    expect((await reserve('bill')).json()).toEqual({ numbers: [10] });
    expect((await reserve('invoice')).json()).toEqual({ numbers: [2] });
  });
});

describe('credit notes', () => {
  const note = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    status: 'saved',
    number: 'CN/26-27/0001',
    numberSeries: 'credit:26-27',
    numberSeq: 1,
    invoiceId: 'inv1',
    lines: [],
    totals: { grandTotal: 5000 },
    history: [],
    createdBy: 'x',
    updatedAt: at(0),
    ...extra,
  });

  it('owner makes any, staff only returns, only on the phone, saved ones never deleted', async () => {
    const { biz, oH, sH, wH } = await setupStore('960000011');
    expect((await pushOk(biz.id, sH, [{ table: 'creditNotes', id: 'cn0', data: note('cn0', { reason: 'price' }) }]))[0]).toMatchObject({ status: 'rejected', reason: 'Only the owner can make this credit note' });
    // Staff may take a return on any bill.
    expect((await pushOk(biz.id, sH, [{ table: 'creditNotes', id: 'cn9', data: note('cn9', { reason: 'return', number: 'CN-B/26-27/0001', numberSeries: 'credit-B:26-27', numberSeq: 1 }) }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, sH, [{ table: 'creditNotes', id: 'cn9', data: note('cn9', { reason: 'return', status: 'cancelled', number: 'CN-B/26-27/0001', numberSeries: 'credit-B:26-27', numberSeq: 1, updatedAt: at(1) }) }]))[0]).toMatchObject({ reason: 'Only the owner can change a saved credit note' });
    expect((await pushOk(biz.id, wH, [{ table: 'creditNotes', id: 'cn1', data: note('cn1') }]))[0]).toMatchObject({ status: 'rejected', reason: 'Credit notes are made in the phone app' });
    expect((await pushOk(biz.id, oH, [{ table: 'creditNotes', id: 'cn1', data: note('cn1') }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, oH, [{ table: 'creditNotes', id: 'cn1', data: note('cn1', { deleted: true, updatedAt: at(1) }) }]))[0]).toMatchObject({
      status: 'rejected',
      reason: 'Only drafts can be deleted',
    });
    // Staff phones still receive them, so balances agree everywhere.
    expect((await pull(biz.id, sH)).changes.some((c) => c.table === 'creditNotes' && c.id === 'cn1')).toBe(true);
  });
});

describe('number series per person', () => {
  async function addStaff(bizId: string, oH: Record<string, string>, phone: string) {
    await app.inject({ method: 'POST', url: `/v1/businesses/${bizId}/invites`, headers: oH, payload: { phone } });
    const s = await login(phone);
    const h = bearer(s.accessToken);
    const me = (await app.inject({ method: 'POST', url: `/v1/invites/${s.me.invites[0]!.id}/accept`, headers: h })).json<VerifyOtpResponse['me']>();
    return { s, h, me };
  }

  it('staff get letters B, C… in join order; the owner has none; the owner can change an unused letter', async () => {
    const { biz, oH, sH, owner } = await setupStore('960000012');
    const c = await addStaff(biz.id, oH, '9600000123');
    expect(c.me.memberships.find((m) => m.businessId === biz.id)?.seriesCode).toBe('C');
    const team = (await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/team`, headers: oH })).json<{ members: { userId: string; seriesCode: string }[] }>();
    expect(team.members.map((m) => m.seriesCode)).toEqual(['', 'B', 'C']);

    const change = (userId: string, code: string) =>
      app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/members/${userId}/series-code`, headers: oH, payload: { code } });
    expect((await change(c.s.me.user.id, 'b')).statusCode).toBe(409); // B is taken
    expect((await change(owner.me.user.id, 'Z')).statusCode).toBe(400);
    expect((await change(c.s.me.user.id, 'r')).statusCode).toBe(200);

    // Once R is on a saved bill it can no longer change.
    await pushOk(biz.id, c.h, [{ table: 'invoices', id: 'r1', data: invoice('r1', { number: 'INV-R/26-27/0001', numberSeries: 'invoice-R:26-27', numberSeq: 1 }) }]);
    expect((await change(c.s.me.user.id, 'Q')).json()).toMatchObject({ error: 'code_used' });

    // Staff can't number a bill in someone else's series.
    const other = await pushOk(biz.id, sH, [{ table: 'invoices', id: 'x1', data: invoice('x1', { number: 'INV-R/26-27/0002', numberSeries: 'invoice-R:26-27', numberSeq: 2 }) }]);
    expect(other[0]).toMatchObject({ status: 'rejected', reason: "That is another person's number series" });
  });

  it('refuses a number that another document already has', async () => {
    const { biz, oH } = await setupStore('960000013');
    await pushOk(biz.id, oH, [{ table: 'invoices', id: 'a', data: invoice('a', { number: 'INV/26-27/0007' }) }]);
    const dup = await pushOk(biz.id, oH, [{ table: 'invoices', id: 'b', data: invoice('b', { number: 'INV/26-27/0007' }) }]);
    expect(dup[0]).toMatchObject({ status: 'rejected', reason: 'Number INV/26-27/0007 is already used' });
    // Editing the first one again is fine.
    expect((await pushOk(biz.id, oH, [{ table: 'invoices', id: 'a', data: invoice('a', { number: 'INV/26-27/0007', updatedAt: at(1) }) }]))[0]!.status).toBe('ok');
  });

  it('numbers given back are handed out again first; used or unknown ones are ignored', async () => {
    const { biz, oH, sH } = await setupStore('960000014');
    const reserve = async (count: number) =>
      (await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/numbers/reserve`, headers: oH, payload: { kind: 'invoice', period: '26-27', count } })).json<{ numbers: number[] }>()
        .numbers;
    expect(await reserve(10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await pushOk(biz.id, oH, [{ table: 'invoices', id: 'u3', data: invoice('u3', { number: 'INV/26-27/0003', numberSeries: 'invoice:26-27', numberSeq: 3 }) }]);
    const back = await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/numbers/return`, headers: oH, payload: { kind: 'invoice', period: '26-27', numbers: [3, 4, 5, 99] } });
    expect(back.statusCode).toBe(204);
    // Another phone gets 4 and 5 (3 was used, 99 never handed out), then new numbers.
    const r = await app.inject({ method: 'POST', url: `/v1/businesses/${biz.id}/numbers/reserve`, headers: sH, payload: { kind: 'invoice', period: '26-27', count: 3 } });
    expect(r.json()).toEqual({ numbers: [4, 5, 11] });
  });
});

describe('payment entries', () => {
  const pay = (id: string, extra: Record<string, unknown> = {}) => ({ id, invoiceId: 'inv1', kind: 'payment', amount: 5000, mode: 'cash', date: '2026-11-25', receivedBy: 'someone-else', updatedAt: at(0), ...extra });

  it('anyone adds them; nobody changes them; only the owner voids; never deleted', async () => {
    const { biz, oH, sH, staff, wH } = await setupStore('960000015');
    expect((await pushOk(biz.id, sH, [{ table: 'payments', id: 'p1', data: pay('p1') }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, wH, [{ table: 'payments', id: 'p2', data: pay('p2', { mode: 'upi' }) }]))[0]!.status).toBe('ok');
    // The server records who really took it.
    const stored = (await pull(biz.id, oH)).changes.find((c) => c.id === 'p1')!.data;
    expect(stored.receivedBy).toBe(staff.me.user.id);

    expect((await pushOk(biz.id, sH, [{ table: 'payments', id: 'bad', data: pay('bad', { amount: -5 }) }]))[0]!.status).toBe('rejected');
    expect((await pushOk(biz.id, oH, [{ table: 'payments', id: 'p1', data: { ...stored, amount: 9000, updatedAt: at(1) } }]))[0]).toMatchObject({
      reason: 'A recorded payment cannot be changed; void it instead',
    });
    const voided = { ...stored, voidedAt: at(1), voidedBy: 'x', voidReason: 'typo', updatedAt: at(1) };
    expect((await pushOk(biz.id, sH, [{ table: 'payments', id: 'p1', data: voided }]))[0]).toMatchObject({ reason: 'Only the owner can void a payment' });
    expect((await pushOk(biz.id, oH, [{ table: 'payments', id: 'p1', data: voided }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, oH, [{ table: 'payments', id: 'p1', data: { ...voided, deleted: true, updatedAt: at(2) } }]))[0]!.status).toBe('rejected');
  });
});

describe('purchase prices', () => {
  it('never reach staff unless the store allows it, and a staff edit keeps the cost', async () => {
    const { biz, oH, sH } = await setupStore('960000017');
    await pushOk(biz.id, oH, [{ table: 'items', id: 'i1', data: { id: 'i1', name: 'Tin', rate: 50000, purchasePrice: 38000, updatedAt: at(-5) } }]);
    const staffItem = (await pull(biz.id, sH)).changes.find((c) => c.id === 'i1')!.data;
    expect(staffItem.purchasePrice).toBeUndefined();
    expect((await pull(biz.id, oH)).changes.find((c) => c.id === 'i1')!.data.purchasePrice).toBe(38000);

    // Staff renames the item (their copy has no cost): the owner's cost survives.
    await pushOk(biz.id, sH, [{ table: 'items', id: 'i1', data: { ...staffItem, name: 'Tin 1L', updatedAt: at(-4) } }]);
    const after = (await pull(biz.id, oH)).changes.find((c) => c.id === 'i1')!.data;
    expect(after).toMatchObject({ name: 'Tin 1L', purchasePrice: 38000 });

    // The owner lets staff see cost.
    await pushOk(biz.id, oH, [{ table: 'settings', id: biz.id, data: { id: biz.id, staffSeeCost: true, updatedAt: at(-3) } }]);
    expect((await pull(biz.id, sH)).changes.find((c) => c.id === 'i1')!.data.purchasePrice).toBe(38000);
  });
});

describe('R2 tables', () => {
  const pullWith = async (bizId: string, h: Record<string, string>, schema?: number) => {
    const r = await app.inject({ method: 'GET', url: `/v1/businesses/${bizId}/sync/pull?since=0${schema ? `&schema=${schema}` : ''}`, headers: h });
    expect(r.statusCode).toBe(200);
    return r.json<SyncPullResponse>();
  };

  it('purchases stay with the owner unless staff may see costs; old apps never get R2 tables', async () => {
    const { biz, oH, sH } = await setupStore('987021000');
    const purchase = { id: 'p1', kind: 'bill', status: 'saved', supplier: { supplierId: 's1', name: 'W' }, lines: [], totals: { grandTotal: 100 }, updatedAt: at(0) };
    expect((await pushOk(biz.id, oH, [{ table: 'purchases', id: 'p1', data: purchase }]))[0]!.status).toBe('ok');
    const denied = await pushOk(biz.id, sH, [{ table: 'suppliers', id: 's2', data: { id: 's2', name: 'X', address: {}, openingBalance: 0, updatedAt: at(0) } }]);
    expect(denied[0]).toMatchObject({ status: 'rejected' });
    expect((await pullWith(biz.id, sH, 2)).changes.some((c) => c.table === 'purchases')).toBe(false);
    expect((await pullWith(biz.id, oH, 2)).changes.some((c) => c.table === 'purchases')).toBe(true);
    // An app from before R2 (no schema) doesn't get tables it can't store.
    expect((await pullWith(biz.id, oH)).changes.some((c) => c.table === 'purchases')).toBe(false);
    // Once the owner lets staff see costs, they can.
    await pushOk(biz.id, oH, [{ table: 'settings', id: biz.id, data: { id: biz.id, staffSeeCost: true, updatedAt: at(1) } }]);
    expect((await pushOk(biz.id, sH, [{ table: 'suppliers', id: 's2', data: { id: 's2', name: 'X', address: {}, openingBalance: 0, updatedAt: at(1) } }]))[0]!.status).toBe('ok');
    // Staff can't change a saved purchase.
    const edit = await pushOk(biz.id, sH, [{ table: 'purchases', id: 'p1', data: { ...purchase, notes: 'changed', updatedAt: at(2) } }]);
    expect(edit[0]!.status).toBe('rejected');
  });

  it('supplier payments and stock changes are added only; the owner voids them', async () => {
    const { biz, oH, sH } = await setupStore('987021010');
    await pushOk(biz.id, oH, [{ table: 'settings', id: biz.id, data: { id: biz.id, staffSeeCost: true, updatedAt: at(0) } }]);
    const pay = { id: 'sp1', supplierId: 's1', kind: 'payment', amount: 5000, mode: 'cash', date: '2026-11-25', updatedAt: at(0) };
    expect((await pushOk(biz.id, sH, [{ table: 'supplierPayments', id: 'sp1', data: pay }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, sH, [{ table: 'supplierPayments', id: 'sp1', data: { ...pay, amount: 1, updatedAt: at(1) } }]))[0]!.status).toBe('rejected');
    expect((await pushOk(biz.id, sH, [{ table: 'supplierPayments', id: 'sp1', data: { ...pay, voidedAt: at(1), updatedAt: at(1) } }]))[0]!.status).toBe('rejected');
    expect((await pushOk(biz.id, oH, [{ table: 'supplierPayments', id: 'sp1', data: { ...pay, voidedAt: at(1), voidReason: 'typo', updatedAt: at(1) } }]))[0]!.status).toBe('ok');

    const move = { id: 'm1', itemId: 'i1', itemName: 'Rice', qty: -2, kind: 'adjust', reason: 'damage', date: '2026-11-25', updatedAt: at(0) };
    expect((await pushOk(biz.id, sH, [{ table: 'stockMoves', id: 'm1', data: move }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, sH, [{ table: 'stockMoves', id: 'm2', data: { ...move, id: 'm2', kind: 'magic' } }]))[0]!.status).toBe('rejected');
    expect((await pushOk(biz.id, sH, [{ table: 'stockMoves', id: 'm1', data: { ...move, deleted: true, updatedAt: at(1) } }]))[0]!.status).toBe('rejected');

    // A khata payment on account names the customer instead of a bill.
    const onAccount = { id: 'pa', invoiceId: '', customerId: 'c1', kind: 'payment', amount: 100, mode: 'upi', date: '2026-11-25', updatedAt: at(0) };
    expect((await pushOk(biz.id, sH, [{ table: 'payments', id: 'pa', data: onAccount }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, sH, [{ table: 'payments', id: 'pb', data: { ...onAccount, id: 'pb', customerId: '' } }]))[0]!.status).toBe('rejected');

    // Expenses: anyone adds; only the owner changes.
    const exp = { id: 'e1', category: 'tea', amount: 2000, mode: 'cash', date: '2026-11-25', updatedAt: at(0) };
    expect((await pushOk(biz.id, sH, [{ table: 'expenses', id: 'e1', data: exp }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, sH, [{ table: 'expenses', id: 'e1', data: { ...exp, amount: 1, updatedAt: at(1) } }]))[0]!.status).toBe('rejected');
    expect((await pushOk(biz.id, oH, [{ table: 'expenses', id: 'e1', data: { ...exp, deleted: true, updatedAt: at(1) } }]))[0]!.status).toBe('ok');
  });
});

describe('cheques', () => {
  it('anyone marks a cheque cleared; only the owner voids', async () => {
    const { biz, oH, sH, staff } = await setupStore('987021020');
    const p = { id: 'cq', invoiceId: 'i1', kind: 'payment', amount: 5000, mode: 'cheque', chequeStatus: 'pending', date: '2026-11-25', receivedBy: staff.me.user.id, updatedAt: at(0) };
    expect((await pushOk(biz.id, sH, [{ table: 'payments', id: 'cq', data: p }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, sH, [{ table: 'payments', id: 'cq', data: { ...p, chequeStatus: 'cleared', chequeClearedAt: at(1), updatedAt: at(1) } }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, sH, [{ table: 'payments', id: 'cq', data: { ...p, chequeStatus: 'cleared', voidedAt: at(2), updatedAt: at(2) } }]))[0]!.status).toBe('rejected');
    expect((await pushOk(biz.id, sH, [{ table: 'payments', id: 'cq', data: { ...p, amount: 1, chequeStatus: 'cleared', updatedAt: at(3) } }]))[0]!.status).toBe('rejected');
    expect((await pushOk(biz.id, oH, [{ table: 'payments', id: 'cq', data: { ...p, chequeStatus: 'cleared', voidedAt: at(4), voidReason: 'Cheque bounced', updatedAt: at(4) } }]))[0]!.status).toBe('ok');
  });
});

describe('R4 payments', () => {
  it('a walk-in advance belongs to its estimate; credit-note money is a payment mode, not for suppliers', async () => {
    const { biz, oH } = await setupStore('987021030');
    const adv = { id: 'adv', invoiceId: '', customerId: null, jobId: 'est1', kind: 'payment', amount: 1000, mode: 'upi', date: '2026-11-25', updatedAt: at(0) };
    expect((await pushOk(biz.id, oH, [{ table: 'payments', id: 'adv', data: adv }]))[0]!.status).toBe('ok');
    expect((await pushOk(biz.id, oH, [{ table: 'payments', id: 'x', data: { ...adv, id: 'x', jobId: null } }]))[0]!.status).toBe('rejected');
    const cn = { id: 'cn', invoiceId: 'i1', creditNoteId: 'n1', kind: 'payment', amount: 500, mode: 'creditnote', date: '2026-11-25', updatedAt: at(0) };
    expect((await pushOk(biz.id, oH, [{ table: 'payments', id: 'cn', data: cn }]))[0]!.status).toBe('ok');
    const sp = { id: 'sp', supplierId: 's1', kind: 'payment', amount: 500, mode: 'creditnote', date: '2026-11-25', updatedAt: at(0) };
    expect((await pushOk(biz.id, oH, [{ table: 'supplierPayments', id: 'sp', data: sp }]))[0]!.status).toBe('rejected');
  });
});


describe('R4 logins and locks', () => {
  const setPerms = (bizId: string, oH: Record<string, string>, userId: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/v1/businesses/${bizId}/members/${userId}/permissions`, headers: oH, payload });

  it('an accountant login only views; the warehouse only marks deliveries and never sees costs', async () => {
    const { biz, oH, sH, staff } = await setupStore('987021040');
    await pushOk(biz.id, oH, [{ table: 'invoices', id: 'w1', data: invoice('w1', { updatedAt: at(-5) }) }]);

    expect((await setPerms(biz.id, oH, staff.me.user.id, { access: 'readonly' })).statusCode).toBe(200);
    const ro = await pushOk(biz.id, sH, [{ table: 'customers', id: 'c1', data: { id: 'c1', name: 'A', updatedAt: at(0) } }]);
    expect(ro[0]).toMatchObject({ status: 'rejected', reason: 'This login can only view the books' });
    expect((await pull(biz.id, sH)).changes.some((c) => c.id === 'w1')).toBe(true);

    await setPerms(biz.id, oH, staff.me.user.id, { access: 'warehouse' });
    const delivered = invoice('w1', { deliveredAt: at(0), deliveredByName: 'Store', deliveryPhoto: 'data:image/jpeg;base64,xx', history: [{ action: 'delivered' }], updatedAt: at(-4) });
    expect((await pushOk(biz.id, sH, [{ table: 'invoices', id: 'w1', data: delivered }]))[0]!.status).toBe('ok');
    const edit = await pushOk(biz.id, sH, [{ table: 'invoices', id: 'w1', data: { ...delivered, lines: [], updatedAt: at(-3) } }]);
    expect(edit[0]).toMatchObject({ status: 'rejected', reason: 'The warehouse login only marks deliveries' });
    const pay = await pushOk(biz.id, sH, [{ table: 'payments', id: 'p1', data: { id: 'p1', invoiceId: 'w1', kind: 'payment', amount: 100, mode: 'cash', date: '2026-11-25', updatedAt: at(0) } }]);
    expect(pay[0]!.status).toBe('rejected');
    // Costs never reach the warehouse, even if the store lets staff see them.
    await pushOk(biz.id, oH, [{ table: 'items', id: 'it1', data: { id: 'it1', name: 'Rice', purchasePrice: 4000, updatedAt: at(0) } }]);
    const item = (await pull(biz.id, sH)).changes.find((c) => c.id === 'it1');
    expect(item?.data?.purchasePrice).toBeUndefined();
  });

  it('staff cancel saved bills only when allowed', async () => {
    const { biz, oH, sH, staff } = await setupStore('987021050');
    await pushOk(biz.id, oH, [{ table: 'invoices', id: 'k1', data: invoice('k1', { updatedAt: at(-5) }) }]);
    const cancel = (m: number) => invoice('k1', { status: 'cancelled', history: [{ action: 'cancelled' }], updatedAt: at(m) });
    expect((await pushOk(biz.id, sH, [{ table: 'invoices', id: 'k1', data: cancel(-4) }]))[0]!.status).toBe('rejected');
    await setPerms(biz.id, oH, staff.me.user.id, { cancelBills: true });
    expect((await pushOk(biz.id, sH, [{ table: 'invoices', id: 'k1', data: cancel(-3) }]))[0]!.status).toBe('ok');
  });

  it('locked old bills take payments but nothing else, not even from the owner', async () => {
    const { biz, oH } = await setupStore('987021060');
    await pushOk(biz.id, oH, [
      { table: 'invoices', id: 'old', data: invoice('old', { date: '2026-10-05', updatedAt: at(-5) }) },
      { table: 'invoices', id: 'new', data: invoice('new', { number: 'INV/26-27/0002', date: '2026-11-20', updatedAt: at(-5) }) },
      { table: 'settings', id: biz.id, data: { id: biz.id, booksClosedUntil: '2026-10-31', updatedAt: at(-5) } },
    ]);
    const paid = { payment: { status: 'paid', amountPaid: 10000 }, updatedAt: at(-4) };
    expect((await pushOk(biz.id, oH, [{ table: 'invoices', id: 'old', data: invoice('old', { date: '2026-10-05', ...paid }) }]))[0]!.status).toBe('ok');
    const edit = await pushOk(biz.id, oH, [{ table: 'invoices', id: 'old', data: invoice('old', { date: '2026-10-05', ...paid, lines: [], updatedAt: at(-3) }) }]);
    expect(edit[0]).toMatchObject({ status: 'rejected', reason: 'This bill is locked (its period is closed). Make a credit note instead.' });
    expect((await pushOk(biz.id, oH, [{ table: 'invoices', id: 'new', data: invoice('new', { number: 'INV/26-27/0002', date: '2026-11-20', lines: [], updatedAt: at(-3) }) }]))[0]!.status).toBe('ok');
  });
});

describe('R4 staff pay and transfers', () => {
  it('staff pay records stay with the owner; stock transfers are a stock change', async () => {
    const { biz, oH, sH } = await setupStore('987021070');
    await pushOk(biz.id, oH, [
      { table: 'employees', id: 'e1', data: { id: 'e1', name: 'Raju', pay: 'month', rate: 100, active: true, updatedAt: at(0) } },
      { table: 'stockMoves', id: 't1', data: { id: 't1', itemId: 'i1', qty: -2, kind: 'transfer', reason: 'transfer', transferId: 'x', date: '2026-11-25', updatedAt: at(0) } },
    ]).then((r) => expect(r.map((x) => x.status)).toEqual(['ok', 'ok']));
    const r = await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/sync/pull?since=0&schema=4`, headers: sH });
    expect(r.json<SyncPullResponse>().changes.some((c) => c.table === 'employees')).toBe(false);
    const o = await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/sync/pull?since=0&schema=4`, headers: oH });
    expect(o.json<SyncPullResponse>().changes.some((c) => c.table === 'employees')).toBe(true);
    const old = await app.inject({ method: 'GET', url: `/v1/businesses/${biz.id}/sync/pull?since=0&schema=3`, headers: oH });
    expect(old.json<SyncPullResponse>().changes.some((c) => c.table === 'employees')).toBe(false);
    expect((await pushOk(biz.id, sH, [{ table: 'attendance', id: 'e1:2026-11-25', data: { id: 'e1:2026-11-25', employeeId: 'e1', date: '2026-11-25', status: 'absent', updatedAt: at(0) } }]))[0]!.status).toBe('rejected');
  });
});
