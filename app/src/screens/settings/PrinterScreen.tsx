import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSpinner, useIonToast } from '@ionic/react';
import { bluetoothOutline, printOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { FormSection, SelectField, ToggleRow } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { t } from '../../lib/i18n';
import { canPrint, loadPrinter, pairedClassicPrinters, pickBlePrinter, savePrinter, testPrint, type PrinterConfig } from '../../lib/printer';

/** This phone's receipt printer: pick it, paper width, logo, auto-print, test print. */
export default function PrinterScreen() {
  const { profile, settings } = useBusiness();
  const [toast] = useIonToast();
  const [printer, setPrinter] = useState<PrinterConfig | null>(null);
  const [paired, setPaired] = useState<{ name: string; address: string }[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fail = (e: unknown) => void toast({ message: e instanceof Error ? e.message : String(e), duration: 3500, color: 'danger' });

  useEffect(() => {
    void loadPrinter().then(setPrinter);
  }, []);

  async function update(p: PrinterConfig | null) {
    setPrinter(p);
    await savePrinter(p);
  }

  const base = (kind: PrinterConfig['kind'], id: string, name: string): PrinterConfig => ({
    kind,
    id,
    name,
    paper: printer?.paper ?? 58,
    logo: printer?.logo ?? false,
    autoPrint: printer?.autoPrint ?? false,
  });

  if (!canPrint()) {
    return (
      <PageShell title={t('Printer')} backHref="/tabs/more">
        <p>{t('Bluetooth receipt printers work in the ApnaGalla Android app. On the web, share the PDF instead.')}</p>
      </PageShell>
    );
  }

  return (
    <PageShell title={t('Printer')} backHref="/tabs/more">
      <FormSection title={t('This phone’s printer')}>
        {printer ? (
          <IonItem lines="none">
            <IonIcon icon={printOutline} slot="start" />
            <IonLabel>
              <h2>{printer.name}</h2>
              <p>{printer.kind === 'classic' ? t('Bluetooth (paired)') : t('Bluetooth Low Energy')}</p>
            </IonLabel>
            <IonButton slot="end" fill="clear" color="medium" onClick={() => void update(null)}>
              {t('Forget')}
            </IonButton>
          </IonItem>
        ) : (
          <p className="section-note">{t('No printer chosen yet.')}</p>
        )}
        <div className="detail-actions">
          <IonButton
            fill="outline"
            disabled={!!busy}
            onClick={() => {
              setBusy('list');
              pairedClassicPrinters()
                .then(setPaired)
                .catch(fail)
                .finally(() => setBusy(null));
            }}
          >
            {busy === 'list' ? <IonSpinner name="dots" /> : <IonIcon icon={bluetoothOutline} slot="start" />} {t('Paired printers')}
          </IonButton>
          <IonButton
            fill="outline"
            disabled={!!busy}
            onClick={() => {
              setBusy('ble');
              pickBlePrinter()
                .then((d) => update(base('ble', d.id, d.name)))
                .catch((e) => !/cancel/i.test(String(e)) && fail(e))
                .finally(() => setBusy(null));
            }}
          >
            {busy === 'ble' ? <IonSpinner name="dots" /> : null} {t('Find BLE printer')}
          </IonButton>
        </div>
        <p className="section-note">{t('Most printers: pair them first in the phone’s Bluetooth settings, then tap “Paired printers”.')}</p>
        {paired && (
          <IonList>
            <IonListHeader>
              <IonLabel>{t('Paired Bluetooth devices')}</IonLabel>
            </IonListHeader>
            {paired.length === 0 && <IonNote className="ion-padding">{t('Nothing paired yet.')}</IonNote>}
            {paired.map((d) => (
              <IonItem
                key={d.address}
                button
                detail={false}
                onClick={() => {
                  void update(base('classic', d.address, d.name));
                  setPaired(null);
                }}
              >
                <IonLabel>
                  <h3>{d.name}</h3>
                  <p>{d.address}</p>
                </IonLabel>
              </IonItem>
            ))}
          </IonList>
        )}
      </FormSection>

      {printer && (
        <FormSection title={t('Receipt')}>
          <SelectField
            label={t('Paper width')}
            value={printer.paper}
            options={[
              { value: 58 as const, label: t('58 mm (2 inch)') },
              { value: 80 as const, label: t('80 mm (3 inch)') },
            ]}
            onChange={(paper) => void update({ ...printer, paper })}
          />
          <ToggleRow label={t('Print the store logo')} checked={printer.logo} onChange={(logo) => void update({ ...printer, logo })} />
          <ToggleRow
            label={t('Print automatically after each counter sale')}
            checked={printer.autoPrint}
            onChange={(autoPrint) => void update({ ...printer, autoPrint })}
          />
          <IonButton
            expand="block"
            disabled={!!busy}
            onClick={() => {
              setBusy('test');
              testPrint(printer, profile.name, settings.billLanguage)
                .then(() => void toast({ message: t('Test page sent'), duration: 1500, color: 'success' }))
                .catch(fail)
                .finally(() => setBusy(null));
            }}
          >
            {busy === 'test' ? <IonSpinner name="dots" /> : <IonIcon icon={printOutline} slot="start" />} {t('Test print')}
          </IonButton>
        </FormSection>
      )}
    </PageShell>
  );
}
