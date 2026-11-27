import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { HIDDEN_BY_DEFAULT, homeCardsShown, setHomeCard } from './homeCards';

describe('Home cards', () => {
  beforeEach(async () => {
    await db.meta.clear();
  });

  it('hides suppliers, purchases, stock value and profit until switched on', async () => {
    const shown = await homeCardsShown();
    for (const k of HIDDEN_BY_DEFAULT) expect(shown.has(k)).toBe(false);
    expect(shown.has('collect')).toBe(true);
    expect(shown.has('deliveries')).toBe(true);
  });

  it('remembers what this phone switches on and off', async () => {
    await setHomeCard('profit', true);
    await setHomeCard('sales', false);
    const shown = await homeCardsShown();
    expect(shown.has('profit')).toBe(true);
    expect(shown.has('sales')).toBe(false);
    expect(shown.has('stock')).toBe(false);
  });
});
