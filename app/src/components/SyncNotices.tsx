import { IonToast, useIonRouter } from '@ionic/react';
import { dismissSyncNotice } from '../lib/syncEngine';
import { t } from '../lib/i18n';
import { useSyncState } from '../lib/useSync';

const PATH: Partial<Record<string, string>> = {
  invoices: '/tabs/invoices',
  estimates: '/tabs/estimates',
  creditNotes: '/tabs/credit-notes',
  customers: '/tabs/customers',
  items: '/tabs/items',
  suppliers: '/tabs/suppliers',
  purchases: '/tabs/purchases',
};

/**
 * Tells the person when sync did not keep their change: another phone saved a newer edit of the same
 * bill or customer (theirs is kept), or the server refused it (e.g. a voucher already used up).
 */
export default function SyncNotices() {
  const sync = useSyncState();
  const router = useIonRouter();
  const conflict = sync.conflicts[0];
  const refused = !conflict ? sync.rejected.find((r) => PATH[r.table]) : undefined;
  const note = conflict ?? refused;
  if (!note) return null;
  const message = conflict
    ? t('{what} was changed on another phone at the same time. The newer version is kept; check it and edit again if needed.', { what: conflict.label || t('A record') })
    : t('Not saved on the server: {reason}', { reason: refused!.reason });
  const kind = conflict ? 'conflicts' : 'rejected';
  return (
    <IonToast
      isOpen
      message={message}
      color="warning"
      position="top"
      buttons={[
        ...(PATH[note.table] ? [{ text: t('Open'), handler: () => router.push(`${PATH[note.table]}/${note.id}`) }] : []),
        { text: t('OK'), role: 'cancel' },
      ]}
      onDidDismiss={() => dismissSyncNotice(kind, note.id)}
    />
  );
}
