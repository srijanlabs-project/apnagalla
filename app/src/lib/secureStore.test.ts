import { describe, expect, it, vi } from 'vitest';

// The phone app: a native platform with a Capacitor-style plugin. Like the real one, the plugin
// answers every property name, including `then`, so awaiting the plugin itself would never finish.
const saved = vi.hoisted(() => new Map<string, string>());
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('./storage', () => ({ kv: { get: async () => null, set: async () => undefined, remove: async () => undefined } }));
vi.mock('capacitor-secure-storage-plugin', () => {
  const methods: Record<string, (o: { key: string; value?: string }) => Promise<unknown>> = {
    get: async ({ key }) => {
      if (!saved.has(key)) throw new Error('Item with given key does not exist');
      return { value: saved.get(key) };
    },
    set: async ({ key, value }) => void saved.set(key, value!),
    remove: async ({ key }) => void saved.delete(key),
  };
  const proxy = new Proxy({}, { get: (_, prop) => methods[String(prop)] ?? (() => new Promise(() => undefined)) });
  return { SecureStoragePlugin: proxy };
});

const { secure } = await import('./secureStore');

describe('secure store on the phone', () => {
  it('reads, writes and removes without hanging (app start reads the login here)', async () => {
    expect(await secure.get('auth.tokens')).toBeNull();
    await secure.set('auth.tokens', { access: 'a' });
    expect(await secure.get('auth.tokens')).toEqual({ access: 'a' });
    await secure.remove('auth.tokens');
    expect(await secure.get('auth.tokens')).toBeNull();
  }, 2000);
});
