import { IonChip, IonIcon, IonLabel, IonSpinner, useIonAlert } from '@ionic/react';
import { liveQuery } from 'dexie';
import { alertCircleOutline, cloudDoneOutline, cloudOfflineOutline, cloudUploadOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { useOnline } from '../lib/network';
import { syncAgain } from '../lib/syncEngine';
import { useSyncState } from '../lib/useSync';

function ago(iso: string | null) {
  if (!iso) return 'not yet';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? 'just now' : `${min} min ago`;
}

/** Header chip: Offline / syncing / N changes waiting / problem / synced. Tap for details and to sync now. */
export default function SyncBadge() {
  const online = useOnline();
  const sync = useSyncState();
  const [pending, setPending] = useState(0);
  const [alert] = useIonAlert();

  useEffect(() => {
    const sub = liveQuery(() => db.outbox.count()).subscribe({ next: setPending, error: () => setPending(0) });
    return () => sub.unsubscribe();
  }, []);

  const problem = online && (sync.lastError || sync.rejected.length > 0);

  function details() {
    const lines = [
      online ? `Last synced: ${ago(sync.lastSyncAt)}.` : 'You are offline. Changes are saved on this phone and sync when you are back online.',
      pending ? `${pending} change(s) waiting to upload.` : 'All changes uploaded.',
      sync.lastError ? `Problem: ${sync.lastError}` : '',
      ...sync.rejected.slice(0, 3).map((r) => `Not saved on the server (${r.table}): ${r.reason}`),
    ].filter(Boolean);
    void alert({
      header: 'Sync',
      message: lines.join('\n\n'),
      buttons: online ? [{ text: 'Close', role: 'cancel' }, { text: 'Sync now', handler: () => void syncAgain() }] : ['OK'],
    });
  }

  let chip;
  if (!online) {
    chip = (
      <IonChip color="warning" outline aria-label="Offline">
        <IonIcon icon={cloudOfflineOutline} />
        <IonLabel>Offline{pending ? ` · ${pending}` : ''}</IonLabel>
      </IonChip>
    );
  } else if (sync.running) {
    chip = (
      <IonChip color="primary" outline aria-label="Syncing">
        <IonSpinner name="crescent" style={{ width: 16, height: 16 }} />
        {pending > 0 && <IonLabel>{pending}</IonLabel>}
      </IonChip>
    );
  } else if (problem) {
    chip = (
      <IonChip color="danger" outline aria-label="Sync problem">
        <IonIcon icon={alertCircleOutline} />
        {pending > 0 && <IonLabel>{pending}</IonLabel>}
      </IonChip>
    );
  } else if (pending > 0) {
    chip = (
      <IonChip color="primary" outline aria-label={`${pending} changes waiting to sync`}>
        <IonIcon icon={cloudUploadOutline} />
        <IonLabel>{pending}</IonLabel>
      </IonChip>
    );
  } else {
    chip = (
      <IonChip color="success" outline aria-label="All changes synced">
        <IonIcon icon={cloudDoneOutline} />
      </IonChip>
    );
  }
  return (
    <span onClick={details} role="button" tabIndex={0}>
      {chip}
    </span>
  );
}
