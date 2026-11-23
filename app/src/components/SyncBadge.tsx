import { IonChip, IonIcon, IonLabel } from '@ionic/react';
import { liveQuery } from 'dexie';
import { cloudDoneOutline, cloudOfflineOutline, cloudUploadOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { useOnline } from '../lib/network';

/** Header chip: Offline / N changes waiting / Synced. (Actual syncing arrives in M3.) */
export default function SyncBadge() {
  const online = useOnline();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    const sub = liveQuery(() => db.outbox.count()).subscribe({ next: setPending, error: () => setPending(0) });
    return () => sub.unsubscribe();
  }, []);

  if (!online) {
    return (
      <IonChip color="warning" outline aria-label="Offline">
        <IonIcon icon={cloudOfflineOutline} />
        <IonLabel>Offline{pending ? ` · ${pending}` : ''}</IonLabel>
      </IonChip>
    );
  }
  if (pending > 0) {
    return (
      <IonChip color="primary" outline aria-label={`${pending} changes waiting to sync`}>
        <IonIcon icon={cloudUploadOutline} />
        <IonLabel>{pending}</IonLabel>
      </IonChip>
    );
  }
  return (
    <IonChip color="success" outline aria-label="All changes synced">
      <IonIcon icon={cloudDoneOutline} />
    </IonChip>
  );
}
