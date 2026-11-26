import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonNote } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { logoWhatsapp, notificationsOutline } from 'ionicons/icons';
import EmptyState from '../../components/EmptyState';
import { FormSection, MoneyField, NumberField, ToggleRow } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { reminderText } from '../../lib/khata';
import { markReminded, remindersDue, remindersOf, type ReminderRules } from '../../lib/reminders';
import { putRecord } from '../../lib/repo';
import { upiLink } from '../../lib/pdf/buildDoc';

/** Today's payment reminders: one tap each opens the customer's WhatsApp with the message. */
export default function RemindersScreen() {
  const { actor, settings, profile, upiIds, isOwner, ledger } = useBusiness();
  const due = useLiveQuery(() => remindersDue(actor.businessId, settings), [actor.businessId, settings, ledger]);
  const rules = remindersOf(settings);
  const upi = upiIds.find((u) => u.isDefault) ?? upiIds[0];
  const set = (p: Partial<ReminderRules>) => void putRecord('settings', actor, { ...settings, reminders: { ...rules, ...p } });

  return (
    <PageShell title={t('Payment reminders')} backHref="/tabs/customers" padded={false}>
      {due && due.length === 0 ? (
        <EmptyState icon={notificationsOutline} title={t('No reminders today')} text={t('Customers with money overdue appear here on their reminder days.')} />
      ) : (
        <IonList>
          {(due ?? []).map((d) => (
            <IonItem key={d.customer.id} lines="full">
              <IonLabel className="ion-text-wrap">
                <h2>{d.customer.name}</h2>
                <p>
                  {t('{amount} overdue · {n} days late', { amount: rupees(d.overdue), n: d.daysLate })}
                  {d.times ? ` · ${t('reminded {n} times', { n: d.times })}` : ''}
                </p>
              </IonLabel>
              <IonButton
                slot="end"
                color="success"
                onClick={() => {
                  const text = reminderText(profile.name, d.customer, d.balance, upi ? upiLink(upi, d.balance, profile.name) : undefined);
                  window.open(`https://wa.me/${(d.customer.phone ?? '').replace('+', '')}?text=${encodeURIComponent(text)}`, '_blank');
                  void markReminded(actor, d.customer, d.times);
                }}
              >
                <IonIcon icon={logoWhatsapp} slot="start" /> {t('Send')}
              </IonButton>
            </IonItem>
          ))}
        </IonList>
      )}
      {isOwner && (
        <div className="ion-padding">
          <FormSection title={t('Schedule')}>
            <ToggleRow label={t('Remind customers about overdue money')} checked={rules.enabled} onChange={(enabled) => set({ enabled })} />
            <div className="field-row">
              <NumberField label={t('First, days after due')} value={rules.afterDays} onChange={(n) => set({ afterDays: Math.max(0, Math.round(n ?? 1)) })} min={0} />
              <NumberField label={t('Then every (days)')} value={rules.everyDays} onChange={(n) => set({ everyDays: Math.max(1, Math.round(n ?? 7)) })} min={1} />
            </div>
            <div className="field-row">
              <NumberField label={t('At most (times)')} value={rules.maxTimes} onChange={(n) => set({ maxTimes: Math.max(1, Math.round(n ?? 4)) })} min={1} />
              <MoneyField label={t('Only above')} value={rules.minAmount} onChange={(v) => set({ minAmount: v ?? 0 })} />
            </div>
            <IonNote>{t('WhatsApp needs one tap per message. Automatic SMS starts once the store’s SMS templates are approved (DLT).')}</IonNote>
          </FormSection>
        </div>
      )}
    </PageShell>
  );
}
