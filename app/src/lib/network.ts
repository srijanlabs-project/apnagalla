import { Network } from '@capacitor/network';
import { useEffect, useState } from 'react';

/** Live online/offline state (Capacitor Network plugin on Android, navigator.onLine on web). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    let cancelled = false;
    void Network.getStatus().then((s) => !cancelled && setOnline(s.connected));
    const handle = Network.addListener('networkStatusChange', (s) => setOnline(s.connected));
    return () => {
      cancelled = true;
      void handle.then((h) => h.remove());
    };
  }, []);
  return online;
}
