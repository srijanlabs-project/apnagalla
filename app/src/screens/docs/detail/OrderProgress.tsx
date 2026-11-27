import { IonButton, useIonAlert, useIonToast } from '@ionic/react';
import { useBusiness } from '../../../lib/business';
import { takeBackConsignment, type consignmentProgress } from '../../../lib/consignment';
import { dateIN, rupees } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import { orderStateLabel, type orderProgress } from '../../../lib/orders';
import { CAN_CREATE_INVOICES } from '../../../lib/platform';

type Progress = Awaited<ReturnType<typeof orderProgress>>;
type Consign = Awaited<ReturnType<typeof consignmentProgress>>;

/** Sales orders (ordered / delivered / pending) and sale-or-return challans (sent / sold / back). */
export default function OrderProgress({ docId, progress, consign, fail }: { docId: string; progress?: Progress | null; consign?: Consign | null; fail: (e: unknown) => void }) {
  const { actor } = useBusiness();
  const [alert] = useIonAlert();
  const [toast] = useIonToast();
  if (!progress && !consign) return null;
  return (
    <section className="bill-card">
      {progress && (
        <div className="order-progress">
          <p>
            <strong>{orderStateLabel(progress.state)}</strong>
            {progress.pendingValue > 0 ? ` · ${t('{amount} still to deliver', { amount: rupees(progress.pendingValue) })}` : ''}
          </p>
          <table>
            <thead>
              <tr>
                <th>{t('Item')}</th>
                <th>{t('Ordered')}</th>
                <th>{t('Delivered')}</th>
                <th>{t('Pending')}</th>
              </tr>
            </thead>
            <tbody>
              {progress.lines.map((l) => (
                <tr key={l.lineId}>
                  <td>{l.name}</td>
                  <td>{l.ordered}</td>
                  <td>{l.delivered}</td>
                  <td className={l.pending > 0 ? 'text-danger' : 'text-success'}>{l.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {progress.bills.map((b) => (
            <IonButton key={b.id} size="small" fill="clear" routerLink={`/tabs/invoices/${b.id}`}>
              {b.number || t('Draft')} · {dateIN(b.date)}
            </IonButton>
          ))}
        </div>
      )}
      {consign && (
        <div className="order-progress">
          <p>
            <strong>{consign.settled ? t('Settled') : t('Sale or return')}</strong>
            {consign.outValue > 0 ? ` · ${t('{amount} still with them', { amount: rupees(consign.outValue) })}` : ''}
          </p>
          <table>
            <thead>
              <tr>
                <th>{t('Item')}</th>
                <th>{t('Sent')}</th>
                <th>{t('Sold')}</th>
                <th>{t('Back')}</th>
                <th>{t('With them')}</th>
              </tr>
            </thead>
            <tbody>
              {consign.lines.map((l) => (
                <tr key={l.lineId}>
                  <td>{l.name}</td>
                  <td>{l.sent}</td>
                  <td>{l.sold}</td>
                  <td>{l.returned}</td>
                  <td className={l.out > 0 ? 'text-danger' : 'text-success'}>{l.out}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {consign.bills.map((b) => (
            <IonButton key={b.id} size="small" fill="clear" routerLink={`/tabs/invoices/${b.id}`}>
              {b.number || t('Draft')} · {dateIN(b.date)}
            </IonButton>
          ))}
          {!consign.settled && CAN_CREATE_INVOICES && (
            <IonButton
              size="small"
              fill="outline"
              onClick={() =>
                void alert({
                  header: t('Goods came back'),
                  inputs: consign.lines
                    .filter((l) => l.out > 0)
                    .map((l) => ({ name: l.lineId, type: 'number' as const, placeholder: `${l.name} (${t('max {n}', { n: l.out })})`, min: 0, max: l.out })),
                  buttons: [
                    { text: t('Cancel'), role: 'cancel' },
                    {
                      text: t('Save'),
                      handler: (v: Record<string, string>) =>
                        void takeBackConsignment(actor, docId, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x) || 0])))
                          .then((n) => void (n && toast({ message: t('Stock taken back'), duration: 1500, position: 'top', color: 'success' })))
                          .catch(fail),
                    },
                  ],
                })
              }
            >
              {t('Goods came back')}
            </IonButton>
          )}
        </div>
      )}
    </section>
  );
}
