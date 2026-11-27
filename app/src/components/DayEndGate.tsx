import { IonButton, IonIcon, IonSpinner } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { lockClosedOutline, syncOutline } from 'ionicons/icons';
import { useState, type ReactNode } from 'react';
import { useBusiness } from '../lib/business';
import { billingBlocked } from '../lib/dayEnd';
import { dateIN } from '../lib/format';
import { t } from '../lib/i18n';
import { syncAgain } from '../lib/syncEngine';
import PageShell from './PageShell';

/**
 * Billing waits until the last business day is closed (day-end cash count). Shown in place of the
 * counter and new-bill screens. The warehouse and accountant logins never bill, so never see it.
 */
export default function DayEndGate({ children, backHref = '/tabs/home' }: { children: ReactNode; backHref?: string }) {
  const { actor, settings } = useBusiness();
  const [syncing, setSyncing] = useState(false);
  const blocked = useLiveQuery(async () => (await billingBlocked(actor.businessId, settings)) ?? false, [actor.businessId, settings]);
  if (blocked === undefined) return null;
  if (!blocked) return <>{children}</>;
  const pending = blocked.date;
  return (
    <PageShell title={t('Close the day first')} backHref={backHref}>
      <div className="day-end-gate">
        <IonIcon icon={lockClosedOutline} />
        <h2>{blocked.count > 1 ? t('{n} days are not closed yet', { n: blocked.count }) : t('{date} is not closed yet', { date: dateIN(pending) })}</h2>
        <p>{t('Count the cash and close that day before starting a new one. It takes a minute.')}</p>
        <IonButton expand="block" routerLink={`/tabs/cash-book?date=${pending}`}>
          {t('Close {date}', { date: dateIN(pending) })}
        </IonButton>
        <IonButton
          expand="block"
          fill="clear"
          disabled={syncing}
          onClick={() => {
            setSyncing(true);
            void syncAgain().finally(() => setSyncing(false));
          }}
        >
          {syncing ? <IonSpinner name="dots" /> : <IonIcon icon={syncOutline} slot="start" />} {t('Closed on another phone? Sync now')}
        </IonButton>
      </div>
    </PageShell>
  );
}
