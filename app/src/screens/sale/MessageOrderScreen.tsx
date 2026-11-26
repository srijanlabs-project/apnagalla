import { IonButton, IonSegment, IonSegmentButton, IonLabel, IonSpinner, useIonRouter, useIonToast } from '@ionic/react';
import { useEffect, useState } from 'react';
import { FormSection, TextArea } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { api, NetworkError } from '../../lib/api';
import { useBusiness } from '../../lib/business';
import { db, type DocLine } from '../../lib/db';
import { t } from '../../lib/i18n';
import { matchOrderLines } from '../../lib/messageOrder';
import { newEstimateDraft, newId, newInvoiceDraft, saveEstimate, saveInvoice } from '../../lib/repo';
import { lineFromItem } from '../docs/LineEditor';
import { CAN_CREATE_INVOICES } from '../../lib/platform';

/** Paste a customer's WhatsApp order (or speak it with the keyboard's mic); it becomes a draft bill or order. */
export default function MessageOrderScreen() {
  const { actor } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const [text, setText] = useState('');
  const [as, setAs] = useState<'order' | 'invoice'>('order');
  const [busy, setBusy] = useState(false);
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => void api.features().then((f) => setOn(!!f.readOrder)).catch(() => setOn(false)), []);

  async function read() {
    setBusy(true);
    try {
      const r = await api.readOrder(actor.businessId, text);
      const items = await db.items.where('businessId').equals(actor.businessId).filter((i) => !i.deleted && !i.hasVariants).toArray();
      const matched = matchOrderLines(r.lines, items);
      const lines: DocLine[] = matched.map((m) => (m.item ? { ...lineFromItem(m.item), qty: m.qty } : { id: newId(), name: m.name, qty: m.qty, unit: m.unit || 'pcs', rate: 0, rateIncludesTax: true, taxPct: 0 }));
      const party = r.customerName ? { customerId: null, name: r.customerName, address: {} } : null;
      const notes = t('From a WhatsApp message. Check every line.');
      const doc =
        as === 'order'
          ? await saveEstimate(actor, { ...(await newEstimateDraft(actor)), order: true, billTo: party, lines, notes }, { finalize: false })
          : await saveInvoice(actor, { ...(await newInvoiceDraft(actor)), billTo: party, lines, notes }, { finalize: false });
      const unknown = matched.filter((m) => !m.item).length;
      void toast({ message: unknown ? t('{n} items not in your list: price them on the draft', { n: unknown }) : t('All items found. Check and save.'), duration: 3000, position: 'top', color: unknown ? 'warning' : 'success' });
      router.push(as === 'order' ? `/tabs/estimates/${doc.id}/edit` : `/tabs/invoices/${doc.id}/edit`);
    } catch (e) {
      void toast({ message: e instanceof NetworkError ? t('Reading needs the internet.') : (e as Error).message, duration: 3000, color: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title={t('Order from a message')} backHref="/tabs/estimates">
      {on === false && <p className="text-danger">{t('Reading messages switches on with the AI key on the server (same as bill scanning).')}</p>}
      <FormSection note={t('Long-press the WhatsApp message → Copy, then paste it here. For a voice order, tap the mic on your keyboard and speak.')}>
        <TextArea label={t('The message')} value={text} onChange={setText} rows={8} />
      </FormSection>
      {CAN_CREATE_INVOICES && (
        <IonSegment value={as} onIonChange={(e) => setAs(e.detail.value as typeof as)}>
          <IonSegmentButton value="order">
            <IonLabel>{t('Sales order')}</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="invoice">
            <IonLabel>{t('Bill')}</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      )}
      <IonButton expand="block" disabled={busy || text.trim().length < 2 || on === false} onClick={() => void read()}>
        {busy ? <IonSpinner name="dots" /> : t('Read the order')}
      </IonButton>
    </PageShell>
  );
}
