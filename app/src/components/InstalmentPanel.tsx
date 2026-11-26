import { IonButton, useIonAlert } from '@ionic/react';
import { addDaysISO, todayISO } from '@invoice/shared';
import { useBusiness } from '../lib/business';
import type { Invoice } from '../lib/db';
import { dateIN, rupees } from '../lib/format';
import { t } from '../lib/i18n';
import { putRecord } from '../lib/repo';
import { addMonthsISO, instalmentSchedule } from '../lib/shopKinds';
import { FormSection } from './Fields';

/** Instalments run by the shop: set a plan on a saved bill, see each one paid, due or late. */
export default function InstalmentPanel({ inv, paid, pending }: { inv: Invoice; paid: number; pending: number }) {
  const { actor, isOwner } = useBusiness();
  const [alert] = useIonAlert();
  if (inv.status !== 'saved') return null;
  const plan = instalmentSchedule(inv, paid);
  const setPlan = () =>
    void alert({
      header: t('Pay in instalments'),
      message: t('The rest after the down payment is split equally. Payments fill the instalments in order.'),
      inputs: [
        { name: 'count', type: 'number', placeholder: t('How many instalments'), value: inv.instalments?.count ?? 6, min: 1, max: 60 },
        { name: 'first', type: 'date', value: inv.instalments?.first ?? addMonthsISO(todayISO(), 1) },
        { name: 'down', type: 'number', placeholder: t('Down payment ₹'), value: Math.round((inv.instalments?.downPayment ?? paid) / 100) },
        { name: 'weekly', type: 'checkbox', label: t('Weekly (not monthly)'), checked: inv.instalments?.every === 'week' } as never,
      ],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        ...(inv.instalments ? [{ text: t('Remove plan'), role: 'destructive', handler: () => void putRecord('invoices', actor, { ...inv, instalments: null }) }] : []),
        {
          text: t('Save'),
          handler: (v: { count: string; first: string; down: string }) => {
            const count = Math.max(1, Math.min(60, Math.round(Number(v.count) || 1)));
            void putRecord('invoices', actor, { ...inv, instalments: { count, every: 'month', first: v.first || addDaysISO(todayISO(), 30), downPayment: Math.round((Number(v.down) || 0) * 100) } });
          },
        },
      ],
    });
  if (!plan.length) return isOwner && pending > 0 ? <IonButton size="small" fill="clear" onClick={setPlan}>{t('Pay in instalments')}</IonButton> : null;
  return (
    <FormSection title={t('Instalments')}>
      <div className="order-progress">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{t('Due')}</th>
              <th>{t('Amount')}</th>
              <th>{t('Paid')}</th>
            </tr>
          </thead>
          <tbody>
            {plan.map((i) => (
              <tr key={i.n}>
                <td>{i.n}</td>
                <td className={i.state === 'late' ? 'text-danger' : undefined}>{dateIN(i.due)}</td>
                <td>{rupees(i.amount)}</td>
                <td className={i.state === 'paid' ? 'text-success' : i.state === 'late' ? 'text-danger' : undefined}>{i.state === 'paid' ? '✓' : rupees(i.paid)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {isOwner && (
        <IonButton size="small" fill="clear" onClick={setPlan}>
          {t('Change plan')}
        </IonButton>
      )}
    </FormSection>
  );
}
