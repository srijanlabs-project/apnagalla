import { Preferences } from '@capacitor/preferences';

/**
 * Small key/value store for session data (tokens, cached profile).
 * Android: SharedPreferences (app-private). Web: localStorage.
 * TODO(M6 security pass): move tokens to encrypted storage on Android.
 */
export const kv = {
  async get<T>(key: string): Promise<T | null> {
    const { value } = await Preferences.get({ key });
    if (value == null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  },
  async set(key: string, value: unknown): Promise<void> {
    await Preferences.set({ key, value: JSON.stringify(value) });
  },
  async remove(key: string): Promise<void> {
    await Preferences.remove({ key });
  },
};

export const KEYS = {
  tokens: 'auth.tokens',
  me: 'auth.me',
  /** The store this device last worked in. */
  currentBusiness: 'auth.currentBusiness',
} as const;
