import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { db } from './db';
import { subscribeSyncState, syncNow, type SyncState } from './syncEngine';

const EVERY_MS = 3 * 60_000;
const AFTER_SAVE_MS = 2_000;

/**
 * Runs sync for all of this person's active stores: now, when the internet returns, when the app
 * comes back to the foreground, a couple of seconds after any local change, and every 3 minutes.
 */
export function useSyncTriggers(businessIds: string[], current: string) {
  const key = businessIds.join(',');
  useEffect(() => {
    const ids = key ? key.split(',') : [];
    const run = () => void syncNow(ids, current);
    run();

    const timer = setInterval(run, EVERY_MS);
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const outbox = liveQuery(() => db.outbox.count()).subscribe({
      next: (n) => {
        if (!n) return;
        clearTimeout(debounce);
        debounce = setTimeout(run, AFTER_SAVE_MS);
      },
    });
    const net = Network.addListener('networkStatusChange', (s) => s.connected && run());
    const resume = App.addListener('resume', run).catch(() => null); // not available on web
    return () => {
      clearInterval(timer);
      clearTimeout(debounce);
      outbox.unsubscribe();
      void net.then((h) => h.remove());
      void resume.then((h) => h?.remove());
    };
  }, [key, current]);
}

export function useSyncState(): SyncState {
  const [s, setS] = useState<SyncState | null>(null);
  useEffect(() => subscribeSyncState(setS), []);
  return s ?? { running: false, lastSyncAt: null, lastError: null, rejected: [] };
}
