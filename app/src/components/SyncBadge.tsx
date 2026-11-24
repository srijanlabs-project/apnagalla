import { IonChip, IonIcon, IonLabel, IonSpinner, useIonAlert } from '@ionic/react';
import { liveQuery } from 'dexie';
import { alertCircleOutline, cloudDoneOutline, cloudOfflineOutline, cloudUploadOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { t } from '../lib/i18n';
import { useOnline } from '../lib/network';
import { syncAgain } from '../lib/syncEngine';
import { useSyncState } from '../lib/useSync';

function lastSynced(iso: string | null) {
  if (!iso) return t('Last synced: not yet.');
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return min < 1 ? t('Last synced: just now.') : t('Last synced: {count} min ago.', { count: min });
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
      online ? lastSynced(sync.lastSyncAt) : t('You are offline. Changes are saved on this phone and sync when you are back online.'),
      pending ? (pending === 1 ? t('1 change waiting to upload.') : t('{count} changes waiting to upload.', { count: pending })) : t('All changes uploaded.'),
      sync.lastError ? t('Problem: {error}', { error: sync.lastError }) : '',
      ...sync.rejected.slice(0, 3).map((r) => t('Not saved on the server ({table}): {reason}', { table: r.table, reason: r.reason })),
    ].filter(Boolean);
    void alert({
      header: t('Sync'),
      message: lines.join('\n\n'),
      buttons: online ? [{ text: t('Close'), role: 'cancel' }, { text: t('Sync now'), handler: () => void syncAgain() }] : [t('OK')],
    });
  }

  let chip;
  if (!online) {
    chip = (
      <IonChip color="warning" outline aria-label={t('Offline')}>
        <IonIcon icon={cloudOfflineOutline} />
        <IonLabel>{t('Offline')}{pending ? ` · ${pending}` : ''}</IonLabel>
      </IonChip>
    );
  } else if (sync.running) {
    chip = (
      <IonChip color="primary" outline aria-label={t('Syncing')}>
        <IonSpinner name="crescent" style={{ width: 16, height: 16 }} />
        {pending > 0 && <IonLabel>{pending}</IonLabel>}
      </IonChip>
    );
  } else if (problem) {
    chip = (
      <IonChip color="danger" outline aria-label={t('Sync problem')}>
        <IonIcon icon={alertCircleOutline} />
        {pending > 0 && <IonLabel>{pending}</IonLabel>}
      </IonChip>
    );
  } else if (pending > 0) {
    chip = (
      <IonChip color="primary" outline aria-label={pending === 1 ? t('1 change waiting to sync') : t('{count} changes waiting to sync', { count: pending })}>
        <IonIcon icon={cloudUploadOutline} />
        <IonLabel>{pending}</IonLabel>
      </IonChip>
    );
  } else {
    chip = (
      <IonChip color="success" outline aria-label={t('All changes synced')}>
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
