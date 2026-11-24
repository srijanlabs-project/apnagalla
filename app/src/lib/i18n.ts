import { LANGS, type Lang } from '@invoice/shared';
import gu from '../i18n/gu.json';
import hi from '../i18n/hi.json';
import pa from '../i18n/pa.json';
import { kv } from './storage';

/*
 * Translations. The English text itself is the key: t('Save invoice') looks it up in the
 * language's JSON file (app/src/i18n/hi.json …) and falls back to English when a phrase has no
 * translation yet. {name}-style placeholders are filled from `vars`.
 *
 * Each person picks the app's language on their phone; it is loaded before the app starts, and
 * changing it restarts the app. Printed bills use the store's bill language instead (billT).
 */

const DICTS: Record<Exclude<Lang, 'en'>, Record<string, string>> = { hi, gu, pa };
const KEY = 'app.language';
let current: Lang = 'en';

export function appLanguage(): Lang {
  return current;
}

/** Reads the saved language; call before the first render. */
export async function loadAppLanguage(): Promise<void> {
  try {
    const saved = await kv.get<Lang>(KEY);
    if (saved && LANGS.includes(saved)) current = saved;
  } catch {
    /* first run / storage blocked: English */
  }
  document.documentElement.lang = current;
}

export async function setAppLanguage(lang: Lang): Promise<void> {
  await kv.set(KEY, lang);
  window.location.reload();
}

function fill(text: string, vars?: Record<string, string | number>): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Translate into a given language (falls back to English). */
export function translate(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  const out = lang === 'en' ? text : (DICTS[lang][text] ?? text);
  return fill(out, vars);
}

/** Translate into the app's language. */
export function t(text: string, vars?: Record<string, string | number>): string {
  return translate(current, text, vars);
}
