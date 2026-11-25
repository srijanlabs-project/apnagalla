import { IonButton, IonSpinner, useIonToast } from '@ionic/react';
import { useCallback, useEffect, useState } from 'react';
import { FormSection, SelectField, TextField, ToggleRow } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { ApiError, NetworkError, api, type ExportSettingsDto } from '../../lib/api';
import { useBusiness } from '../../lib/business';
import { dateIN } from '../../lib/format';
import { t } from '../../lib/i18n';

const PROVIDERS = [
  { id: 'google', label: 'Google Drive' },
  { id: 'onedrive', label: 'OneDrive' },
  { id: 'dropbox', label: 'Dropbox' },
] as const;

const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? 'AM' : 'PM'}`;

/** Owner: the day's sales Excel sent every night by email and/or to a cloud folder. */
export default function BackupScreen() {
  const { actor, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const [s, setS] = useState<ExportSettingsDto | null>(null);
  const [email, setEmail] = useState('');
  const [hour, setHour] = useState(21);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const show = useCallback((x: ExportSettingsDto) => {
    setS(x);
    setEmail(x.email ?? '');
    setHour(x.hour);
    setEnabled(x.enabled || (!x.email && !x.provider));
  }, []);
  const fail = (e: unknown) => {
    const message = e instanceof NetworkError ? t('This needs the internet.') : e instanceof ApiError ? e.message : t('Something went wrong');
    void toast({ message, duration: 2500, position: 'top', color: 'danger' });
  };

  useEffect(() => {
    if (!isOwner) return;
    api
      .exportSettings(actor.businessId)
      .then(show)
      .catch((e) => setFailed(e instanceof NetworkError ? t('This needs the internet.') : t('Something went wrong')));
  }, [actor.businessId, isOwner, show]);

  if (!isOwner) {
    return (
      <PageShell title={t('Daily Excel backup')} backHref="/tabs/more">
        <p>{t('Only the owner can change this')}</p>
      </PageShell>
    );
  }
  if (!s)
    return (
      <PageShell title={t('Daily Excel backup')} backHref="/tabs/more">
        {failed ? <p>{failed}</p> : <IonSpinner />}
      </PageShell>
    );

  const anyAvailable = s.available.email || s.available.google || s.available.onedrive || s.available.dropbox;
  const run = async (key: string, fn: () => Promise<ExportSettingsDto | void>, done?: string) => {
    setBusy(key);
    try {
      const x = await fn();
      if (x) show(x);
      if (done) void toast({ message: done, duration: 2000, position: 'top', color: 'success' });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageShell title={t('Daily Excel backup')} backHref="/tabs/more">
      <p className="section-note">{t('Every night ApnaGalla makes an Excel of the day’s bills, payments, purchases and expenses, and sends it where you choose.')}</p>
      {!anyAvailable && <p className="text-danger">{t('This is not switched on yet. Please ask ApnaGalla support.')}</p>}
      <FormSection>
        <ToggleRow label={t('Send every night')} checked={enabled} onChange={setEnabled} />
        <SelectField label={t('Time')} value={hour} options={Array.from({ length: 18 }, (_, i) => i + 6).map((h) => ({ value: h, label: hourLabel(h) }))} onChange={setHour} />
        {s.available.email && <TextField label={t('Email')} type="email" inputmode="email" value={email} onChange={setEmail} autocapitalize="off" />}
        <IonButton expand="block" disabled={!!busy} onClick={() => void run('save', () => api.saveExportSettings(actor.businessId, { enabled, email: email.trim() || null, hour }), t('Saved'))}>
          {busy === 'save' ? <IonSpinner name="dots" /> : t('Save')}
        </IonButton>
      </FormSection>

      {(s.available.google || s.available.onedrive || s.available.dropbox) && (
        <FormSection title={t('Cloud folder')} note={t('The file goes into an “ApnaGalla” folder in your own account.')}>
          {s.provider ? (
            <>
              <p>{t('Connected: {name}', { name: s.accountLabel ?? s.provider })}</p>
              <IonButton fill="clear" color="danger" disabled={!!busy} onClick={() => void run('disconnect', () => api.disconnectExport(actor.businessId))}>
                {t('Disconnect')}
              </IonButton>
            </>
          ) : (
            PROVIDERS.filter((p) => s.available[p.id]).map((p) => (
              <IonButton
                key={p.id}
                expand="block"
                fill="outline"
                disabled={!!busy}
                onClick={() =>
                  void run(p.id, async () => {
                    const { url } = await api.connectExport(actor.businessId, p.id);
                    window.open(url, '_blank');
                  })
                }
              >
                {t('Connect {name}', { name: p.label })}
              </IonButton>
            ))
          )}
          {!s.provider && (
            <IonButton fill="clear" size="small" onClick={() => void run('refresh', () => api.exportSettings(actor.businessId))}>
              {t('I have connected it')}
            </IonButton>
          )}
        </FormSection>
      )}

      <FormSection title={t('Last sent')}>
        <p>{s.lastSentDate ? dateIN(s.lastSentDate) : t('Not sent yet')}</p>
        {s.lastError && <p className="text-danger">{s.lastError}</p>}
        <IonButton expand="block" fill="outline" disabled={!!busy || (!s.email && !s.provider)} onClick={() => void run('send', () => api.sendExportNow(actor.businessId), t('Sent'))}>
          {busy === 'send' ? <IonSpinner name="dots" /> : t('Send today’s file now')}
        </IonButton>
      </FormSection>
    </PageShell>
  );
}
