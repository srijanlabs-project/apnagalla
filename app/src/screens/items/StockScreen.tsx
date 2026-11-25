import { IonButton, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSegment, IonSegmentButton, useIonAlert, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { FormSection, NumberField, SelectField, TextField } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type StockReason } from '../../lib/db';
import { dateIN } from '../../lib/format';
import { t } from '../../lib/i18n';
import { STOCK_REASONS, adjustStock, isLow, qtyText, reasonLabel, stockEvents, voidStockMove } from '../../lib/stock';

type Mode = 'remove' | 'add' | 'count';

/** One item's stock: what it is now, how it got there, and manual changes (damage, count…). */
export default function StockScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const item = useLiveQuery(() => db.items.get(id!), [id]);
  const events = useLiveQuery(async () => (await stockEvents(actor.businessId)).get(id!) ?? [], [actor.businessId, id]);
  const [mode, setMode] = useState<Mode>('remove');
  const [qty, setQty] = useState<number | null>(null);
  const [reason, setReason] = useState<StockReason>('damage');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  if (!item || !events) return null;

  const now = events.reduce((a, e) => a + e.qty, 0);
  // Newest first, with the stock after each change.
  let running = 0;
  const rows = events.map((e) => ({ ...e, after: (running += e.qty) })).reverse();

  async function apply() {
    if (qty == null || !item) return;
    setBusy(true);
    try {
      const move =
        mode === 'count'
          ? await adjustStock(actor, item, { kind: 'count', counted: qty, note })
          : await adjustStock(actor, item, { kind: 'adjust', qty: mode === 'add' ? qty : -qty, reason: mode === 'add' ? 'other' : reason, note });
      void toast({ message: move ? t('Stock updated') : t('Stock already matches'), duration: 1500, position: 'top', color: 'success' });
      setQty(null);
      setNote('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell title={item.name} backHref={`/tabs/items/${item.id}`}>
      <div className="stat-grid">
        <div className="mini-stat">
          <span>{t('In stock')}</span>
          <strong className={now < 0 || isLow(item, now) ? 'text-danger' : ''}>
            {qtyText(now)} {item.unit}
          </strong>
        </div>
        {item.lowStock != null && (
          <div className="mini-stat">
            <span>{t('Low stock at')}</span>
            <strong>
              {qtyText(item.lowStock)} {item.unit}
            </strong>
          </div>
        )}
      </div>
      {now < 0 && <p className="section-note text-danger">{t('More was sold than was entered. Add the opening stock or a purchase bill, or count the shelf.')}</p>}

      <FormSection title={t('Change stock')}>
        <IonSegment value={mode} onIonChange={(e) => setMode(e.detail.value as Mode)}>
          <IonSegmentButton value="remove">
            <IonLabel>{t('Remove')}</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="add">
            <IonLabel>{t('Add')}</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="count">
            <IonLabel>{t('Count')}</IonLabel>
          </IonSegmentButton>
        </IonSegment>
        <p className="section-note">
          {mode === 'count'
            ? t('Count what is on the shelf and enter the number; the app records the difference.')
            : mode === 'add'
              ? t('For goods bought, enter a purchase bill instead, so the supplier’s account stays right.')
              : t('Damaged, lost, expired or taken out of stock.')}
        </p>
        <div className="field-row">
          <NumberField label={mode === 'count' ? t('Counted') : t('Quantity')} value={qty} onChange={setQty} suffix={item.unit} min={0} />
          {mode === 'remove' && (
            <SelectField
              label={t('Reason')}
              value={reason}
              options={STOCK_REASONS.filter((r) => r !== 'count').map((r) => ({ value: r, label: reasonLabel(r) }))}
              onChange={setReason}
            />
          )}
        </div>
        <TextField label={t('Note (optional)')} value={note} onChange={setNote} />
        <IonButton expand="block" disabled={qty == null || busy} onClick={() => void apply()}>
          {t('Save')}
        </IonButton>
      </FormSection>

      <IonList inset className="flush-list">
        <IonListHeader>
          <IonLabel>{t('History')}</IonLabel>
        </IonListHeader>
        {rows.length === 0 && (
          <IonItem lines="none">
            <IonNote>{t('Nothing recorded yet.')}</IonNote>
          </IonItem>
        )}
        {rows.map((e, i) => (
          <IonItem key={i} routerLink={e.href} detail={false}>
            <IonLabel>
              <h3>{e.label}</h3>
              <p>
                {dateIN(e.date)}
                {e.move?.byName ? ` · ${e.move.byName}` : ''}
                {e.move?.note ? ` · ${e.move.note}` : ''}
              </p>
            </IonLabel>
            <div slot="end" className="list-end">
              <strong className={e.qty < 0 ? 'text-danger' : 'text-success'}>
                {e.qty > 0 ? '+' : ''}
                {qtyText(e.qty)}
              </strong>
              <IonNote>{t('Left {qty}', { qty: qtyText(e.after) })}</IonNote>
              {isOwner && e.move && (
                <IonButton
                  size="small"
                  fill="clear"
                  color="danger"
                  onClick={() =>
                    void alert({
                      header: t('Void this change?'),
                      inputs: [{ name: 'reason', placeholder: t('Reason') }],
                      buttons: [
                        { text: t('Cancel'), role: 'cancel' },
                        { text: t('Void'), role: 'destructive', handler: (v: { reason?: string }) => void voidStockMove(actor, e.move!.id, v.reason ?? '') },
                      ],
                    })
                  }
                >
                  {t('Void')}
                </IonButton>
              )}
            </div>
          </IonItem>
        ))}
      </IonList>
    </PageShell>
  );
}
