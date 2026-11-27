import { API_URL } from '../config';
import { CLIENT_KIND } from './platform';
import { APP_VERSION_LABEL } from './version';

/**
 * Crash reports to our own server (no outside service): uncaught errors, failed promises and screen
 * crashes. Each message is sent once per app run; reports wait in storage while offline.
 */
export interface CrashReport {
  message: string;
  stack?: string;
  where?: string;
  url: string;
  version: string;
  client: string;
  at: string;
  businessId?: string;
}

const KEY = 'crash-queue';
const seen = new Set<string>();
let context: { businessId?: string } = {};

export const setCrashContext = (c: { businessId?: string }) => {
  context = c;
};

function queue(): CrashReport[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as CrashReport[];
  } catch {
    return [];
  }
}
function save(list: CrashReport[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-20)));
  } catch {
    /* storage full or blocked: drop it */
  }
}

export async function flushCrashes(): Promise<void> {
  const list = queue();
  if (!list.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
  try {
    const r = await fetch(`${API_URL}/v1/client-errors`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reports: list }) });
    if (r.ok) save([]);
  } catch {
    /* try again next time */
  }
}

export function reportCrash(err: unknown, where?: string) {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
  const key = `${e.message}|${where ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  save([
    ...queue(),
    {
      message: e.message.slice(0, 500),
      stack: e.stack?.slice(0, 4000),
      where: where?.slice(0, 200),
      url: typeof location !== 'undefined' ? location.pathname : '',
      version: APP_VERSION_LABEL,
      client: CLIENT_KIND,
      at: new Date().toISOString(),
      businessId: context.businessId,
    },
  ]);
  void flushCrashes();
}

/** Catches what nothing else catches. Call once at start-up. */
export function installCrashReports() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (ev) => reportCrash(ev.error ?? ev.message, 'window.onerror'));
  window.addEventListener('unhandledrejection', (ev) => reportCrash(ev.reason, 'unhandledrejection'));
  window.addEventListener('online', () => void flushCrashes());
  void flushCrashes();
}
