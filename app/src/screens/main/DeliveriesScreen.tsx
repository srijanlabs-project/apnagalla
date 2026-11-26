import { IonButton, IonItem, IonLabel, IonList, IonNote, IonSegment, IonSegmentButton, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ToggleRow } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { markDelivered, warehouseList, type WarehouseRow } from '../../lib/deliveries';
import { dateIN, fileToResizedDataUrl } from '../../lib/format';
import { t } from '../../lib/i18n';
import { sync } from '../../lib/sync';
import { HomeScreen } from './Placeholders';

const linkOf = (r: WarehouseRow) => `/tabs/${r.kind === 'invoice' ? 'invoices' : 'estimates'}/${r.doc.id}`;

/** The warehouse lands on its deliveries; everybody else on Home. */
export function HomeOrDeliveries() {
  const { perms } = useBusiness();
  return perms.access === 'warehouse' ? <Navigate to="/tabs/deliveries" replace /> : <HomeScreen />;
}

/** Goods to send out (bills, challans, job orders) and what went out, with the delivery photo. */
export default function DeliveriesScreen() {
  const { actor } = useBusiness();
  const [toast] = useIonToast();
  const [tab, setTab] = useState<'todo' | 'done'>('todo');
  const [recent, setRecent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const target = useRef<WarehouseRow | null>(null);
  // The last answer stays while a new tab loads: use it only when it is for this tab (a "To deliver"
  // row has no delivery time, which the Delivered tab shows).
  const result = useLiveQuery(
    async () => ({ tab, rows: await warehouseList(actor.businessId, { delivered: tab === 'done', recentDays: recent ? 7 : 0 }) }),
    [actor.businessId, tab, recent],
  );
  const rows = result?.tab === tab ? result.rows : undefined;
  const fail = (e: unknown) => void toast({ message: e instanceof Error ? e.message : String(e), duration: 3000, color: 'danger' });

  return (
    <PageShell title={t('Deliveries')} backHref="/tabs/more">
      <IonSegment value={tab} onIonChange={sync((e) => setTab(e.detail.value as 'todo' | 'done'))}>
        <IonSegmentButton value="todo">
          <IonLabel>{t('To deliver')}</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="done">
          <IonLabel>{t('Delivered')}</IonLabel>
        </IonSegmentButton>
      </IonSegment>
      {tab === 'todo' && <ToggleRow label={t('Show every bill of the last 7 days')} checked={recent} onChange={setRecent} />}
      <IonList>
        {(rows ?? []).map((r) => (
          <IonItem key={r.doc.id} routerLink={linkOf(r)} detail={tab === 'done'}>
            {tab === 'done' && r.doc.deliveryPhoto && <img slot="start" src={r.doc.deliveryPhoto} alt="" className="thumb" />}
            <IonLabel>
              <h3>
                {r.doc.number} · {r.doc.billTo?.name ?? t('Walk-in')}
              </h3>
              <p>
                {r.doc.lines
                  .slice(0, 3)
                  .map((l) => `${l.name} × ${l.qty}`)
                  .join(', ')}
                {r.doc.lines.length > 3 ? ` +${r.doc.lines.length - 3}` : ''}
              </p>
              <p>
                {tab === 'done'
                  ? (r.doc.deliveredAt ? t('Delivered {date}', { date: dateIN(r.doc.deliveredAt.slice(0, 10)) }) : t('Delivered')) + (r.doc.deliveredByName ? ` · ${r.doc.deliveredByName}` : '')
                  : r.doc.deliveryDate
                    ? t('Delivery {date}', { date: dateIN(r.doc.deliveryDate) })
                    : dateIN(r.doc.date)}
                {r.doc.deliveryAssignee ? ` · ${r.doc.deliveryAssignee.name}` : ''}
              </p>
            </IonLabel>
            {tab === 'todo' && (
              <IonButton
                slot="end"
                color="success"
                disabled={!!busy}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  target.current = r;
                  camera.current?.click();
                }}
              >
                {busy === r.doc.id ? '…' : t('Delivered')}
              </IonButton>
            )}
          </IonItem>
        ))}
      </IonList>
      {rows && rows.length === 0 && <IonNote className="ion-padding">{tab === 'todo' ? t('Nothing waiting to go out.') : t('Nothing delivered in the last 30 days.')}</IonNote>}
      <p className="section-note">{t('Tap Delivered and take a photo of the goods being handed over; the photo is kept on the bill.')}</p>
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          const r = target.current;
          if (!f || !r) return;
          setBusy(r.doc.id);
          try {
            await markDelivered(actor, r.kind, r.doc.id, await fileToResizedDataUrl(f, 1000, true));
            void toast({ message: t('Marked delivered'), duration: 1500, color: 'success' });
          } catch (err) {
            fail(err);
          } finally {
            setBusy(null);
          }
        }}
      />
    </PageShell>
  );
}
