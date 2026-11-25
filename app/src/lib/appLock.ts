import { Capacitor } from '@capacitor/core';
import { secure } from './secureStore';
import { t } from './i18n';

/*
 * App lock (phone only): after the first OTP login the person sets a 4–6 digit PIN and may turn on
 * fingerprint. The app then asks for fingerprint or PIN when it starts, and after 5 minutes in
 * the background. 5 wrong PINs, or "Forgot PIN", mean verifying with an OTP again; the data on
 * the phone is kept. The PIN itself is never stored: only a salted, slow hash, in encrypted
 * storage.
 */

const KEY = 'app.lock';
export const MAX_TRIES = 5;
/** Coming back after this long in the background asks again. */
export const RELOCK_AFTER_MS = 5 * 60_000;
const ITERATIONS = 150_000;

interface LockConfig {
  salt: string;
  hash: string;
  biometric: boolean;
  failed: number;
}

export const lockSupported = () => Capacitor.isNativePlatform();

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hashPin(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS }, key, 256);
  return b64(bits);
}

async function load(): Promise<LockConfig | null> {
  return secure.get<LockConfig>(KEY);
}

export async function lockEnabled(): Promise<boolean> {
  return !!(await load());
}

export async function biometricOn(): Promise<boolean> {
  return !!(await load())?.biometric;
}

export const validPin = (pin: string) => /^\d{4,6}$/.test(pin);

export async function setPin(pin: string, biometric: boolean): Promise<void> {
  if (!validPin(pin)) throw new Error(t('The PIN must be 4 to 6 digits'));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  await secure.set(KEY, { salt: b64(salt), hash: await hashPin(pin, salt), biometric, failed: 0 } satisfies LockConfig);
}

export async function setBiometric(on: boolean): Promise<void> {
  const c = await load();
  if (c) await secure.set(KEY, { ...c, biometric: on });
}

/** Turns the lock off (after the PIN was checked, or after an OTP re-verification). */
export async function clearLock(): Promise<void> {
  await secure.remove(KEY);
}

/** Checks a PIN; after MAX_TRIES wrong ones the lock must be reset with an OTP. */
export async function checkPin(pin: string): Promise<{ ok: boolean; triesLeft: number }> {
  const c = await load();
  if (!c) return { ok: true, triesLeft: MAX_TRIES };
  if (c.failed >= MAX_TRIES) return { ok: false, triesLeft: 0 };
  const ok = (await hashPin(pin, fromB64(c.salt))) === c.hash;
  const failed = ok ? 0 : c.failed + 1;
  await secure.set(KEY, { ...c, failed });
  return { ok, triesLeft: Math.max(0, MAX_TRIES - failed) };
}

export async function triesLeft(): Promise<number> {
  const c = await load();
  return c ? Math.max(0, MAX_TRIES - c.failed) : MAX_TRIES;
}

/** Is a fingerprint (or face) enrolled on this phone? */
export async function biometricAvailable(): Promise<boolean> {
  if (!lockSupported()) return false;
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    return (await BiometricAuth.checkBiometry()).isAvailable;
  } catch {
    return false;
  }
}

/** Shows Android's fingerprint prompt; true when it succeeded. */
export async function unlockWithBiometric(): Promise<boolean> {
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({ reason: t('Unlock ApnaGalla'), cancelTitle: t('Use PIN'), androidTitle: t('Unlock ApnaGalla') });
    return true;
  } catch {
    return false;
  }
}
