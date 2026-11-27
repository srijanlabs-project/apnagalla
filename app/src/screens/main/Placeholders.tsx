import { addDaysISO, todayISO } from '@invoice/shared';
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonRouterLink, useIonRouter } from '@ionic/react';
import { ChooseProductListCard } from '../settings/ProductListScreen';
import type { BillingStatusDto } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useLiveQuery } from 'dexie-react-hooks';
import { billingBlocked, closingDue, dayToClose, openingDue } from '../../lib/dayEnd';
import { addOutline, cartOutline, clipboardOutline, walletOutline } from 'ionicons/icons';
import { useHomeCards, type HomeCard } from '../../lib/homeCards';
import PageShell from '../../components/PageShell';
import StatusBadge from '../../components/StatusBadge';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { dateIN, rupees, rupeesShort } from '../../lib/format';
import { todaySummary } from '../../lib/reports';
import { deliveriesFor, markDelivered } from '../../lib/deliveries';
import { t } from '../../lib/i18n';
import { CAN_CREATE_INVOICES, webInvoiceNote } from '../../lib/platform';
import { useSession } from '../../lib/session';

/** Home: quick actions, today at a glance, deliveries and recent invoices. */
export function HomeScreen() {
  const { me } = useSession();
  const { profile, actor } = useBusiness();
  const first = me?.user.name?.split(' ')[0];
  const router = useIonRouter();
  // Overdue, today and tomorrow (later ones only get the phone alert).
  const allDeliveries = useLiveQuery(() => deliveriesFor(actor), [actor]);
  const deliveries = allDeliveries?.filter((d) => d.when !== 'later');
  const urgent = allDeliveries?.filter((d) => d.doc.deliveryDate! <= addDaysISO(todayISO(), 2)).length ?? 0;
  const cards = useHomeCards();
  const on = (k: HomeCard) => !!cards?.has(k);
  const { perms, ledger, isOwner } = useBusiness();
  const canBuy = perms.seeCost;
  const [renew, setRenew] = useState<BillingStatusDto | null>(null);
  useEffect(() => {
    if (!isOwner) return;
    void api
      .billing(actor.businessId)
      .then(({ status }) => setRenew((status.state === 'trial' || status.state === 'active' || status.state === 'grace') && (status.daysLeft ?? 99) <= 7 ? status : null))
      .catch(() => setRenew(null));
  }, [actor.businessId, isOwner]);
  const seesMoney = isOwner || perms.access === 'readonly';
  const { settings } = useBusiness();
  const billsHere = CAN_CREATE_INVOICES && perms.access !== 'readonly' && perms.access !== 'warehouse';
  const onlineOrders = useLiveQuery(() => db.estimates.where('businessId').equals(actor.businessId).filter((e) => !!e.online && e.status === 'draft' && !e.deleted).count(), [actor.businessId]);
  // Day-end: a past day still open blocks billing; after closing time, a reminder for today.
  const dayEnd = useLiveQuery(async () => {
    if (!billsHere) return null;
    const blocked = await billingBlocked(actor.businessId, settings);
    if (blocked) return { date: blocked.date, block: true };
    const pending = await dayToClose(actor.businessId, settings);
    if (pending) return { date: pending, block: false, remind: true };
    if (await closingDue(actor.businessId, settings)) return { date: todayISO(), block: false };
    return (await openingDue(actor.businessId, settings)) ? { date: todayISO(), block: false, open: true } : null;
  }, [actor.businessId, settings, ledger, billsHere]);
  const today = useLiveQuery(() => todaySummary(actor.businessId, canBuy, seesMoney && canBuy), [actor.businessId, canBuy, seesMoney, ledger]);
  const recent = useLiveQuery(
    () =>
      db.invoices
        .where('[businessId+date]')
        .between([actor.businessId, ''], [actor.businessId, '￿'])
        .reverse()
        .filter((i) => !i.deleted)
        .limit(5)
        .toArray(),
    [actor.businessId],
  );

  const [step1Before, step1After] = t('Add your logo, address and tax ID in {link}.').split('{link}');
  const [step2Before, step2After] = t('Add bank / UPI details in {link} to get paid faster.').split('{link}');

  return (
    <PageShell title={profile.name} titleLink="/tabs/more/stores">
      <h2 className="greeting">{first ? t('Hi, {name}', { name: first }) : t('Hi')} 👋</h2>
      <div className="quick-actions">
        {CAN_CREATE_INVOICES && (
          <IonButton expand="block" routerLink="/tabs/sale">
            <IonIcon icon={cartOutline} slot="start" /> {t('New sale')}
          </IonButton>
        )}
        {CAN_CREATE_INVOICES && (
          <IonButton expand="block" fill="outline" routerLink="/tabs/invoices/new">
            <IonIcon icon={addOutline} slot="start" /> {t('New invoice')}
          </IonButton>
        )}
        <IonButton expand="block" fill="outline" routerLink="/tabs/estimates/new">
          <IonIcon icon={clipboardOutline} slot="start" /> {t('New estimate')}
        </IonButton>
        <IonButton expand="block" fill="outline" routerLink="/tabs/expenses?add=1">
          <IonIcon icon={walletOutline} slot="start" /> {t('New expense')}
        </IonButton>
      </div>
      {!CAN_CREATE_INVOICES && <p className="section-note">{webInvoiceNote()}</p>}

      <ChooseProductListCard />
      {(onlineOrders ?? 0) > 0 && (
        <IonRouterLink routerLink="/tabs/estimates">
          <p className="day-end-banner">{t('{n} new online orders: open Estimates → New online orders', { n: onlineOrders ?? 0 })}</p>
        </IonRouterLink>
      )}
      {dayEnd && (
        <IonRouterLink routerLink={`/tabs/cash-book?date=${dayEnd.date}`}>
          <p className={dayEnd.block ? 'renew-banner' : 'day-end-banner'}>
            {dayEnd.block
              ? t('{date} is not closed. Close it to start billing today.', { date: dateIN(dayEnd.date) })
              : 'remind' in dayEnd
                ? t('{date} is not closed: count the cash and close it.', { date: dateIN(dayEnd.date) })
                : 'open' in dayEnd
                ? t('Open the store: count the cash in the counter.')
                : t('Closing time: count the cash and close today.')}
          </p>
        </IonRouterLink>
      )}
      {renew && (
        <IonRouterLink routerLink="/tabs/more/plan">
          <p className="renew-banner">
            {renew.state === 'grace' ? t('Your ApnaGalla plan has ended. Renew in {n} days to keep it.', { n: renew.daysLeft ?? 0 }) : t('Your ApnaGalla plan ends in {n} days. Renew now.', { n: renew.daysLeft ?? 0 })}
          </p>
        </IonRouterLink>
      )}
      {today && (
        <div className="dash-grid">
          {on('sales') && (
            <IonRouterLink routerLink="/tabs/reports/sales" className="dash-card">
              <span>{t('Today’s sales ({count} bills)', { count: today.bills })}</span>
              <strong>{rupeesShort(today.sales)}</strong>
            </IonRouterLink>
          )}
          {on('cash') && (
            <IonRouterLink routerLink="/tabs/cash-book" className="dash-card">
              <span>{t('Cash in drawer')}</span>
              <strong>{rupeesShort(today.cashInDrawer)}</strong>
            </IonRouterLink>
          )}
          {on('received') && (
            <IonRouterLink routerLink="/tabs/reports/collections" className="dash-card">
              <span>{t('Received today: cash / UPI')}</span>
              <strong>
                {rupeesShort(today.cash)} / {rupeesShort(today.upi)}
              </strong>
            </IonRouterLink>
          )}
          {on('credit') && (
            <IonRouterLink routerLink="/tabs/reports/sales" className="dash-card">
              <span>{t('Given on credit today')}</span>
              <strong>{rupeesShort(today.credit)}</strong>
            </IonRouterLink>
          )}
          {on('collect') && (
            <IonRouterLink routerLink="/tabs/to-collect" className="dash-card">
              <span>{t('To collect (all customers)')}</span>
              <strong className={today.receivable > 0 ? 'text-danger' : undefined}>{rupeesShort(today.receivable)}</strong>
            </IonRouterLink>
          )}
          {on('deliveries') && (
            <IonRouterLink routerLink="/tabs/deliveries/urgent" className="dash-card">
              <span>{t('Urgent deliveries (next 48 hours)')}</span>
              <strong className={urgent > 0 ? 'text-danger' : undefined}>{urgent}</strong>
            </IonRouterLink>
          )}
          {canBuy && on('payable') ? (
            <IonRouterLink routerLink="/tabs/reports/payables" className="dash-card">
              <span>{t('To pay suppliers')}</span>
              <strong>{rupeesShort(today.payable)}</strong>
            </IonRouterLink>
          ) : null}
          {on('bank') && today.bank != null && (
            <IonRouterLink routerLink="/tabs/bank" className="dash-card">
              <span>{t('In bank accounts')}</span>
              <strong className={today.bank < 0 ? 'text-danger' : undefined}>{rupeesShort(today.bank)}</strong>
            </IonRouterLink>
          )}
          {on('purchases') && today.monthPurchases != null && (
            <IonRouterLink routerLink="/tabs/purchases" className="dash-card">
              <span>{t('Purchases this month')}</span>
              <strong>{rupeesShort(today.monthPurchases)}</strong>
            </IonRouterLink>
          )}
          {on('stock') && today.stockValue != null && (
            <IonRouterLink routerLink="/tabs/reports/stock" className="dash-card">
              <span>{t('Stock value (at cost)')}</span>
              <strong>{rupeesShort(today.stockValue)}</strong>
            </IonRouterLink>
          )}
          {on('income') && !!today.monthOtherIncome && (
            <IonRouterLink routerLink="/tabs/income" className="dash-card">
              <span>{t('Other income this month')}</span>
              <strong>{rupeesShort(today.monthOtherIncome)}</strong>
            </IonRouterLink>
          )}
          {on('expenses') && today.monthExpenses != null && (
            <IonRouterLink routerLink="/tabs/expenses" className="dash-card">
              <span>{t('Expenses this month')}</span>
              <strong>{rupeesShort(today.monthExpenses)}</strong>
            </IonRouterLink>
          )}
          {on('profit') && today.monthProfit != null && (
            <IonRouterLink routerLink="/tabs/reports/pnl" className="dash-card">
              <span>{t('Profit this month')}</span>
              <strong className={today.monthProfit < 0 ? 'text-danger' : 'text-success'}>{rupeesShort(today.monthProfit)}</strong>
            </IonRouterLink>
          )}
          {on('lowStock') && today.lowStock > 0 && (
            <IonRouterLink routerLink="/tabs/items/low-stock" className="dash-card">
              <span>{t('Low on stock')}</span>
              <strong className="text-danger">{t('{count} items', { count: today.lowStock })}</strong>
            </IonRouterLink>
          )}
        </div>
      )}

      {deliveries && deliveries.length > 0 && (
        <IonList inset className="flush-list">
          <IonListHeader>
            <IonLabel>{t('Deliveries')}</IonLabel>
          </IonListHeader>
          {deliveries.map(({ kind, doc, when }) => (
            <IonItem key={doc.id} detail={false}>
              <IonLabel onClick={() => router.push(`/tabs/${kind === 'invoice' ? 'invoices' : 'estimates'}/${doc.id}`)}>
                <h2>{doc.billTo?.name ?? t('No customer')}</h2>
                <p>
                  <span className={when === 'overdue' ? 'text-danger' : undefined}>{when === 'overdue' ? t('Overdue · {date}', { date: dateIN(doc.deliveryDate!) }) : when === 'today' ? t('Today') : t('Tomorrow')}</span>
                  {doc.number ? ` · ${doc.number}` : ''}
                  {doc.deliveryAssignee ? ` · ${doc.deliveryAssignee.name}` : ''}
                </p>
              </IonLabel>
              <IonButton slot="end" size="small" fill="outline" color="success" onClick={() => void markDelivered(actor, kind, doc.id)}>
                {t('Mark delivered')}
              </IonButton>
            </IonItem>
          ))}
        </IonList>
      )}

      {recent && recent.length > 0 ? (
        <IonList inset className="flush-list">
          <IonListHeader>
            <IonLabel>{t('Recent invoices')}</IonLabel>
            <IonButton routerLink="/tabs/invoices">{t('See all')}</IonButton>
          </IonListHeader>
          {recent.map((inv) => (
            <IonItem key={inv.id} routerLink={`/tabs/invoices/${inv.id}`} detail={false}>
              <IonLabel>
                <h2>{inv.billTo?.name ?? t('No customer')}</h2>
                <p>
                  {inv.number || t('Draft')} · {dateIN(inv.date)}
                </p>
              </IonLabel>
              <div slot="end" className="list-end">
                <strong>{rupees(inv.totals.grandTotal)}</strong>
                <StatusBadge invoice={inv} />
              </div>
            </IonItem>
          ))}
        </IonList>
      ) : (
        <IonCard>
          <IonCardHeader>
            <IonCardSubtitle>{t('Get started')}</IonCardSubtitle>
            <IonCardTitle>{t('Set up in 3 steps')}</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <ol className="steps">
              <li>
                {step1Before}
                <IonRouterLink routerLink="/tabs/more/business">{t('Business profile')}</IonRouterLink>
                {step1After}
              </li>
              <li>
                {step2Before}
                <IonRouterLink routerLink="/tabs/more/payment">{t('Payment details')}</IonRouterLink>
                {step2After}
              </li>
              <li>{t('Create your first invoice and share it on WhatsApp.')}</li>
            </ol>
          </IonCardContent>
        </IonCard>
      )}
    </PageShell>
  );
}
