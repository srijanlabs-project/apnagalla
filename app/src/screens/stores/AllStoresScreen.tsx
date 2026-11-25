import { IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonSpinner } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import PageShell from '../../components/PageShell';
import { db } from '../../lib/db';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { todaySummary, type Today } from '../../lib/reports';
import { useSession } from '../../lib/session';

interface StoreRow {
  businessId: string;
  name: string;
  today: Today;
  month: number;
  monthBills: number;
}

async function monthSales(businessId: string) {
  const today = todayISO();
  const list = await db.invoices
    .where('[businessId+date]')
    .between([businessId, `${today.slice(0, 7)}-01`], [businessId, today], true, true)
    .filter((i) => i.status === 'saved' && !i.deleted)
    .toArray();
  return { total: list.reduce((a, i) => a + i.totals.grandTotal, 0), bills: list.length };
}

/** Owner: every store at a glance (from the data on this phone, works offline). */
export default function AllStoresScreen() {
  const { me } = useSession();
  const owned = (me?.memberships ?? []).filter((m) => m.role === 'owner' && m.active && !m.suspended);
  const key = owned.map((m) => m.businessId).join(',');
  const rows = useLiveQuery(
    async (): Promise<StoreRow[]> =>
      Promise.all(
        owned.map(async (m) => {
          const [today, month] = await Promise.all([todaySummary(m.businessId, true), monthSales(m.businessId)]);
          return { businessId: m.businessId, name: m.businessName, today, month: month.total, monthBills: month.bills };
        }),
      ),
    [key],
  );
  const sum = (f: (r: StoreRow) => number) => (rows ?? []).reduce((a, r) => a + f(r), 0);

  return (
    <PageShell title={t('All stores')} backHref="/tabs/more">
      {!rows ? (
        <IonSpinner />
      ) : (
        <>
          <IonCard>
            <IonCardHeader>
              <IonCardSubtitle>{t('All {count} stores', { count: rows.length })}</IonCardSubtitle>
              <IonCardTitle>{t('Today {amount}', { amount: rupees(sum((r) => r.today.sales)) })}</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <p>{t('This month {amount}', { amount: rupees(sum((r) => r.month)) })}</p>
              <p>{t('Cash in drawers {amount}', { amount: rupees(sum((r) => r.today.cashInDrawer)) })}</p>
              <p>{t('To collect {amount} · to pay {pay}', { amount: rupees(sum((r) => r.today.receivable)), pay: rupees(sum((r) => r.today.payable)) })}</p>
            </IonCardContent>
          </IonCard>
          {rows.map((r) => (
            <IonCard key={r.businessId}>
              <IonCardHeader>
                <IonCardSubtitle>{r.name}</IonCardSubtitle>
                <IonCardTitle>
                  {t('Today {amount}', { amount: rupees(r.today.sales) })} <small>· {t('{count} bills', { count: r.today.bills })}</small>
                </IonCardTitle>
              </IonCardHeader>
              <IonCardContent>
                <p>{t('This month {amount} · {count} bills', { amount: rupees(r.month), count: r.monthBills })}</p>
                <p>{t('Cash {cash} · UPI {upi} · on credit {credit}', { cash: rupees(r.today.cash), upi: rupees(r.today.upi), credit: rupees(r.today.credit) })}</p>
                <p>{t('Cash in drawer {amount}', { amount: rupees(r.today.cashInDrawer) })}</p>
                <p>{t('To collect {amount} · to pay {pay}', { amount: rupees(r.today.receivable), pay: rupees(r.today.payable) })}</p>
                {r.today.lowStock > 0 && <p className="text-danger">{t('{count} items low on stock', { count: r.today.lowStock })}</p>}
              </IonCardContent>
            </IonCard>
          ))}
          <p className="section-note">{t('From what has synced to this phone. Pull down on Home in each store to refresh.')}</p>
        </>
      )}
    </PageShell>
  );
}
