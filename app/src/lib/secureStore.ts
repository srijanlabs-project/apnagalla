import { Capacitor } from '@capacitor/core';
import { kv } from './storage';

/**
 * Secrets (login tokens, app-lock PIN hash). On the phone they live in Android's Keystore-backed
 * encrypted storage, so another app or a copied backup can't reuse them; in a browser they fall
 * back to normal storage (browser logins expire after 7 days unused).
 */
const native = () => Capacitor.isNativePlatform();

async function plugin() {
  return (await import('capacitor-secure-storage-plugin')).SecureStoragePlugin;
}

export const secure = {
  async get<T>(key: string): Promise<T | null> {
    if (!native()) return kv.get<T>(key);
    try {
      const { value } = await (await plugin()).get({ key });
      return JSON.parse(value) as T;
    } catch {
      // Not stored yet (the plugin throws), or written by an older app version: move it over.
      const old = await kv.get<T>(key);
      if (old != null) {
        await secure.set(key, old);
        await kv.remove(key);
      }
      return old;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    if (!native()) return kv.set(key, value);
    await (await plugin()).set({ key, value: JSON.stringify(value) });
  },
  async remove(key: string): Promise<void> {
    if (!native()) return kv.remove(key);
    await (await plugin())
      .remove({ key })
      .catch(() => undefined);
    await kv.remove(key);
  },
};
