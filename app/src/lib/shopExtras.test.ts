import { describe, expect, it } from 'vitest';
import type { BusinessSettings } from './db';
import { extraOn } from './shopExtras';

const base = {} as BusinessSettings;

describe('Shop features', () => {
  it('keeps pharmacy, vouchers and rentals out until switched on', () => {
    expect(extraOn(base, 'pharmacy')).toBe(false);
    expect(extraOn(base, 'vouchers')).toBe(false);
    expect(extraOn(base, 'rentals')).toBe(false);
    expect(extraOn(base, 'jobs')).toBe(true);
  });

  it('stays on for features the shop already set up', () => {
    expect(extraOn({ ...base, jewellery: { gold24: 1, silver999: 1, date: '2026-11-27' } }, 'jewellery')).toBe(true);
    expect(extraOn({ ...base, onlineStore: { enabled: true, slug: 'x' } }, 'onlineStore')).toBe(true);
    expect(extraOn({ ...base, loyalty: { enabled: true } }, 'loyalty')).toBe(true);
  });

  it('follows the switch once chosen', () => {
    expect(extraOn({ ...base, extras: { pharmacy: true } }, 'pharmacy')).toBe(true);
    expect(extraOn({ ...base, extras: { jobs: false } }, 'jobs')).toBe(false);
    expect(extraOn({ ...base, jewellery: { gold24: 1, silver999: 1, date: '2026-11-27' }, extras: { jewellery: false } }, 'jewellery')).toBe(false);
  });
});

describe('Cash quick amounts', () => {
  it('offers exact, then the next round notes', async () => {
    const { cashSteps } = await import('./format');
    expect(cashSteps(542800)).toEqual([542800, 550000, 600000]);
    expect(cashSteps(50000)).toEqual([50000, 200000]);
    expect(cashSteps(12000)).toEqual([12000, 20000, 50000, 200000]);
  });
});
