import { IonButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonList, IonModal, IonNote, IonTitle, IonToolbar } from '@ionic/react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';

type Crash = Awaited<ReturnType<typeof api.adminCrashes>>['rows'][number];

/** Admin: crashes the app reported, grouped by message, newest first; tap one for its details. */
export default function AdminCrashes({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [rows, setRows] = useState<Crash[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (isOpen) void api.adminCrashes().then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [isOpen]);
  const groups = useMemo(() => {
    const m = new Map<string, Crash[]>();
    for (const r of rows ?? []) m.set(r.message ?? '', [...(m.get(r.message ?? '') ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('Crashes')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>{t('Close')}</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        {rows && rows.length === 0 && <p className="section-note ion-padding">{t('No crashes reported.')}</p>}
        <IonList>
          {groups.map(([message, list]) => (
            <IonItem key={message} button detail={false} onClick={() => setOpen(open === message ? null : message)}>
              <IonLabel className="ion-text-wrap">
                <h3>{message}</h3>
                <p>
                  {list[0]!.url} · {list[0]!.version} · {list[0]!.client} · {new Date(list[0]!.at).toLocaleString('en-IN')}
                </p>
                {open === message && <pre className="crash-stack">{list[0]!.stack ?? list[0]!.where ?? ''}</pre>}
              </IonLabel>
              <IonNote slot="end">×{list.length}</IonNote>
            </IonItem>
          ))}
        </IonList>
      </IonContent>
    </IonModal>
  );
}
