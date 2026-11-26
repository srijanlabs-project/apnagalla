import { IonButton, IonIcon, IonSpinner, useIonAlert, useIonToast } from '@ionic/react';
import { cloudDownloadOutline, refreshOutline } from 'ionicons/icons';
import { useRef, useState } from 'react';
import { FormSection } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { backupFileName, makeBackup, readBackup, restoreBackup, restorePlan } from '../../lib/backup';
import { useBusiness } from '../../lib/business';
import { shareFile } from '../../lib/exportTable';
import { dateIN } from '../../lib/format';
import { t } from '../../lib/i18n';

/** One-tap backup file of the whole store, and restore from it (owner). */
export default function FullBackupScreen() {
  const { actor, profile, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const [busy, setBusy] = useState<'make' | 'read' | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const fail = (e: unknown) => void toast({ message: (e as Error).message, duration: 3000, color: 'danger' });
  if (!isOwner) return <PageShell title={t('Backup and restore')} backHref="/tabs/more">{t('Only the owner can do this.')}</PageShell>;

  async function backUp() {
    setBusy('make');
    try {
      const b = await makeBackup(actor.businessId, profile.name);
      const r = await shareFile(backupFileName(profile.name), new Blob([JSON.stringify(b)], { type: 'application/json' }), t('ApnaGalla backup of {store}', { store: profile.name }));
      if (r === 'downloaded') void toast({ message: t('Backup file downloaded'), duration: 1800 });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function restore(f: File) {
    setBusy('read');
    try {
      const b = readBackup(await f.text());
      if (b.businessId !== actor.businessId) throw new Error(t('This backup is of another store ({name})', { name: b.storeName }));
      const plan = await restorePlan(b);
      const count = plan.reduce((a, p) => a + p.rows.length, 0);
      if (!count) {
        void toast({ message: t('Nothing to restore: everything in the file is already here'), duration: 2500 });
        return;
      }
      void alert({
        header: t('Restore {n} records?', { n: count }),
        message: t('From the backup of {date}. Missing, deleted and older records come back; nothing newer here is changed.', { date: dateIN(b.at.slice(0, 10)) }),
        buttons: [
          { text: t('Cancel'), role: 'cancel' },
          {
            text: t('Restore'),
            handler: () =>
              void restoreBackup(actor, b)
                .then((n) => toast({ message: t('{n} records restored', { n }), duration: 2500, position: 'top', color: 'success' }))
                .catch(fail),
          },
        ],
      });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell title={t('Backup and restore')} backHref="/tabs/more">
      <FormSection title={t('Back up now')} note={t('One file with everything in this store: bills, customers, items, stock, money and settings. Share it to Google Drive or WhatsApp yourself, or save it on the phone. Your data is also kept safe on the ApnaGalla server.')}>
        <IonButton expand="block" disabled={!!busy} onClick={() => void backUp()}>
          {busy === 'make' ? <IonSpinner name="dots" /> : <IonIcon icon={cloudDownloadOutline} slot="start" />} {t('Back up now')}
        </IonButton>
      </FormSection>
      <FormSection title={t('Restore')} note={t('Choose a backup file of this store. Anything missing or deleted here comes back; newer work is kept.')}>
        <IonButton expand="block" fill="outline" disabled={!!busy} onClick={() => file.current?.click()}>
          {busy === 'read' ? <IonSpinner name="dots" /> : <IonIcon icon={refreshOutline} slot="start" />} {t('Restore from a backup file')}
        </IonButton>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void restore(f);
          }}
        />
      </FormSection>
    </PageShell>
  );
}
