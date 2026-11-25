import { IonButton, IonCheckbox, IonItem, IonLabel, IonList, IonSearchbar, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { FormSection, NumberField, ToggleRow } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { shareFile } from '../../lib/exportTable';
import { t } from '../../lib/i18n';
import { ensureBarcodes, labelsCanvas, labelsPdf } from '../../lib/labels';
import { canPrint, loadPrinter, sendToPrinter } from '../../lib/printer';
import { sellable } from '../../lib/pricing';
import { canvasToJob, PAPER_DOTS } from '../../lib/receipt/escpos';

/** Barcode labels / price stickers for chosen items. Items without a barcode get a shop code. */
export default function LabelsScreen() {
  const { actor, profile } = useBusiness();
  const [toast] = useIonToast();
  const [q, setQ] = useState('');
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [showPrice, setShowPrice] = useState(true);
  const [showMrp, setShowMrp] = useState(true);
  const [busy, setBusy] = useState(false);
  const items = useLiveQuery(() => db.items.where('businessId').equals(actor.businessId).filter(sellable).toArray(), [actor.businessId]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items ?? []).filter((i) => !s || i.name.toLowerCase().includes(s) || i.barcode === s).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200);
  }, [items, q]);
  const chosen = (items ?? []).filter((i) => (copies[i.id] ?? 0) > 0);
  const total = chosen.reduce((a, i) => a + (copies[i.id] ?? 0), 0);

  async function make(as: 'pdf' | 'printer') {
    setBusy(true);
    try {
      const withCodes = await ensureBarcodes(actor, chosen);
      const job = withCodes.map((item) => ({ item, copies: copies[item.id] ?? 1 }));
      const o = { shop: profile.name, showPrice, showMrp };
      if (as === 'pdf') await shareFile('Labels.pdf', await labelsPdf(job, o));
      else {
        const p = await loadPrinter();
        if (!p) throw new Error(t('Set up a printer first (More → Printer).'));
        await sendToPrinter(p, canvasToJob(labelsCanvas(job, o, PAPER_DOTS[p.paper])));
      }
    } catch (e) {
      void toast({ message: (e as Error).message, duration: 2500, position: 'top', color: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title={t('Barcode labels')} backHref="/tabs/items" padded={false}>
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search name or barcode')} />
      <IonList>
        {list.map((i) => (
          <IonItem key={i.id}>
            <IonCheckbox slot="start" checked={(copies[i.id] ?? 0) > 0} onIonChange={(e) => setCopies((c) => ({ ...c, [i.id]: e.detail.checked ? 1 : 0 }))} aria-label={i.name} />
            <IonLabel>
              <h3>{i.name}</h3>
              <p>{i.barcode ?? t('No barcode: a shop code will be made')}</p>
            </IonLabel>
            {(copies[i.id] ?? 0) > 0 && (
              <div slot="end" style={{ width: 90 }}>
                <NumberField label={t('Copies')} value={copies[i.id] ?? 1} onChange={(n) => setCopies((c) => ({ ...c, [i.id]: Math.max(0, Math.round(n ?? 0)) }))} min={0} max={500} />
              </div>
            )}
          </IonItem>
        ))}
      </IonList>
      <div className="ion-padding">
        <FormSection>
          <ToggleRow label={t('Show selling price')} checked={showPrice} onChange={setShowPrice} />
          <ToggleRow label={t('Show MRP')} checked={showMrp} onChange={setShowMrp} />
        </FormSection>
        <IonButton expand="block" disabled={!total || busy} onClick={() => void make('pdf')}>
          {t('A4 sheet PDF ({count} labels)', { count: total })}
        </IonButton>
        {canPrint() && (
          <IonButton expand="block" fill="outline" disabled={!total || busy} onClick={() => void make('printer')}>
            {t('Print on receipt printer')}
          </IonButton>
        )}
      </div>
    </PageShell>
  );
}
