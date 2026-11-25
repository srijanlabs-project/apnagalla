import { IonButton, useIonToast } from '@ionic/react';
import { useEffect, useState } from 'react';
import { FormSection, TextField, ToggleRow } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { DEFAULT_ALERTS, loadAlertSettings, saveAlertSettings, scheduleShopAlerts, type AlertSettings } from '../../lib/alerts';
import { useBusiness } from '../../lib/business';
import { t } from '../../lib/i18n';
import { canPrint } from '../../lib/printer';

/** This phone's shop alerts: low stock, money overdue, the day's summary. */
export default function AlertsScreen() {
  const { actor, isOwner, perms, profile } = useBusiness();
  const [toast] = useIonToast();
  const [s, setS] = useState<AlertSettings>(DEFAULT_ALERTS);
  useEffect(() => {
    void loadAlertSettings().then(setS);
  }, []);
  const money = (isOwner || perms.viewReports) && perms.access !== 'warehouse';
  const set = (x: Partial<AlertSettings>) => setS({ ...s, ...x });

  return (
    <PageShell title={t('Phone alerts')} backHref="/tabs/more">
      {!canPrint() && <p className="section-note">{t('Alerts work in the ApnaGalla Android app.')}</p>}
      <FormSection title={t('Every morning')}>
        <ToggleRow label={t('Items low on stock')} checked={s.lowStock} onChange={(lowStock) => set({ lowStock })} />
        {money && <ToggleRow label={t('Money overdue from customers')} checked={s.overdue} onChange={(overdue) => set({ overdue })} />}
        <TextField label={t('Morning alert at')} type="time" value={s.morning} onChange={(morning) => set({ morning: morning || DEFAULT_ALERTS.morning })} />
      </FormSection>
      {money && (
        <FormSection title={t('At closing time')}>
          <ToggleRow label={t('Today’s sales summary')} checked={s.summary} onChange={(summary) => set({ summary })} />
          <TextField label={t('Closing time')} type="time" value={s.closing} onChange={(closing) => set({ closing: closing || DEFAULT_ALERTS.closing })} />
        </FormSection>
      )}
      <IonButton
        expand="block"
        onClick={async () => {
          await saveAlertSettings(s);
          await scheduleShopAlerts(actor, { canSeeMoney: money, storeName: profile.name });
          void toast({ message: t('Saved'), duration: 1200, color: 'success' });
        }}
      >
        {t('Save')}
      </IonButton>
      <p className="section-note">{t('Made on this phone: no internet or Google services needed. Delivery reminders are set in Invoice settings.')}</p>
    </PageShell>
  );
}
