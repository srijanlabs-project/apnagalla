import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('./secureStore', () => ({
  secure: {
    get: async (k: string) => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: async (k: string, v: unknown) => void store.set(k, structuredClone(v)),
    remove: async (k: string) => void store.delete(k),
  },
}));

const lock = await import('./appLock');

beforeEach(() => store.clear());

describe('app lock PIN', () => {
  it('stores only a salted hash and checks the PIN', async () => {
    expect(await lock.lockEnabled()).toBe(false);
    await lock.setPin('4821', true);
    const saved = JSON.stringify([...store.values()]);
    expect(saved).not.toContain('4821');
    expect(await lock.lockEnabled()).toBe(true);
    expect(await lock.biometricOn()).toBe(true);
    expect(await lock.checkPin('4821')).toEqual({ ok: true, triesLeft: 5 });
  });

  it('allows 5 wrong tries, then only an OTP reset; a right PIN resets the count', async () => {
    await lock.setPin('123456', false);
    expect((await lock.checkPin('000000')).triesLeft).toBe(4);
    expect((await lock.checkPin('123456')).ok).toBe(true);
    for (let i = 4; i >= 0; i--) expect((await lock.checkPin('999999')).triesLeft).toBe(i);
    // Locked out: even the right PIN no longer works.
    expect(await lock.checkPin('123456')).toEqual({ ok: false, triesLeft: 0 });
    await lock.clearLock();
    expect(await lock.lockEnabled()).toBe(false);
  });

  it('only 4 to 6 digits', async () => {
    expect(lock.validPin('123')).toBe(false);
    expect(lock.validPin('12a4')).toBe(false);
    expect(lock.validPin('1234567')).toBe(false);
    await expect(lock.setPin('12', false)).rejects.toThrow();
  });
});
