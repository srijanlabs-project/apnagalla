import { describe, expect, it } from 'vitest';
import { gstzenProvider, parseGstzen } from '../src/gst/gstzen';

/** The GST portal's own shape (many GST data APIs pass it through). */
const portalShape = {
  status: 1,
  data: {
    gstin: '24AABCP1234K1ZP',
    lgnm: 'PATEL TRADERS PRIVATE LIMITED',
    tradeNam: 'PATEL TRADERS',
    sts: 'Active',
    dty: 'Regular',
    rgdt: '01/07/2017',
    pradr: { addr: { bno: '12', bnm: 'Shanti Complex', st: 'Station Road', loc: 'Kalupur', dst: 'Ahmedabad', stcd: 'Gujarat', pncd: '380001' } },
  },
};

/** A snake_case shape with a bare request status. */
const snakeShape = { status: 'success', valid: true, company_details: { legal_name: 'ABC LLP', trade_name: 'ABC', gstin_status: 'Cancelled', registration_date: '2019-04-01', address: '5 MG Road, Pune', pincode: '411001' } };

describe('GSTZen adapter', () => {
  it('reads the GST portal field names', () => {
    expect(parseGstzen('24AABCP1234K1ZP', portalShape)).toMatchObject({
      legalName: 'PATEL TRADERS PRIVATE LIMITED',
      tradeName: 'PATEL TRADERS',
      status: 'Active',
      active: true,
      taxpayerType: 'Regular',
      registeredOn: '2017-07-01',
      address: { line1: '12, Shanti Complex', line2: 'Station Road, Kalupur', city: 'Ahmedabad', state: 'Gujarat', pin: '380001' },
    });
  });

  it('reads snake_case names and ignores a bare request status', () => {
    expect(parseGstzen('27AAPFU0939F1ZV', snakeShape)).toMatchObject({ legalName: 'ABC LLP', status: 'Cancelled', active: false, registeredOn: '2019-04-01', address: { line1: '5 MG Road, Pune', pin: '411001', state: 'Maharashtra' } });
  });

  it('treats valid:false as not found, and logs only field names when it cannot read the answer', () => {
    expect(parseGstzen('27AAPFU0939F1ZV', { valid: false, message: 'Invalid GSTIN' })).toBeNull();
    const logs: string[] = [];
    expect(parseGstzen('27AAPFU0939F1ZV', { result: { foo: 'SECRET VALUE' } }, (m) => logs.push(m))).toBeNull();
    expect(logs[0]).toContain('result.foo');
    expect(logs[0]).not.toContain('SECRET VALUE');
  });

  it('sends POST with the Token and x-api-version headers and the gstin in the body', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const p = gstzenProvider({
      url: 'https://my.gstzen.in/api/gstin-validator/',
      key: 'k123',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response(JSON.stringify(portalShape), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch,
    });
    expect((await p.lookup('24AABCP1234K1ZP'))?.legalName).toBe('PATEL TRADERS PRIVATE LIMITED');
    expect(seen!.init.method).toBe('POST');
    expect(seen!.init.headers).toMatchObject({ Token: 'k123', 'x-api-version': '1.0', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(seen!.init.body))).toEqual({ gstin: '24AABCP1234K1ZP' });
  });
});
