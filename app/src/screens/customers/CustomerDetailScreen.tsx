import { IonButton, IonIcon, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonModal, IonNote, IonSegment, IonSegmentButton, IonContent, IonHeader, IonToolbar, IonTitle, IonButtons, useIonToast, IonRouterLink, useIonRouter, IonChip } from '@ionic/react';
import { addDaysISO, formatIndianMobile, todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { loyaltyOf, pointsOf, tierFor, yearSpend } from '../../lib/loyalty';
import { billChallans, crateBalances, siteTable, sitesOf, unbilledChallans } from '../../lib/shopKinds';
import { callOutline, cashOutline, createOutline, documentTextOutline, logoWhatsapp, notificationsOutline, addOutline, clipboardOutline } from 'ionicons/icons';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import PageShell from '../../components/PageShell';
import StatusBadge from '../../components/StatusBadge';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { shareTable } from '../../lib/exportTable';
import { addressLines, dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { receiptFor, shareReceipt } from '../../lib/pdf/receipt';
import { khataOf, receiveKhataPayment, reminderText, statementTable } from '../../lib/khata';
import { upiLink } from '../../lib/pdf/buildDoc';
import { CAN_CREATE_INVOICES } from '../../lib/platform';
import { sync } from '../../lib/sync';

const monthStart = () => `${todayISO().slice(0, 8)}01`;

export default function CustomerDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, profile, upiIds } = useBusiness();
  const [toast] = useIonToast();
  const router = useIonRouter();
  const [tab, setTab] = useState<'khata' | 'bills'>('khata');
  const [receiving, setReceiving] = useState(false);
  const [statement, setStatement] = useState(false);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const c = useLiveQuery(() => db.customers.get(id!), [id]);
  const khata = useLiveQuery(async () => (c ? khataOf(actor.businessId, c) : undefined), [c, actor.businessId]);
  const sites = useLiveQuery(() => (id ? sitesOf(actor.businessId, id) : []), [actor.businessId, id]);
  const challans = useLiveQuery(() => (id ? unbilledChallans(actor.businessId, id) : []), [actor.businessId, id]);
  const crates = useLiveQuery(async () => (await crateBalances(actor.businessId)).filter((b) => b.partyId === id && b.out > 0), [actor.businessId, id]);
  const { settings } = useBusiness();
  const loyalty = useLiveQuery(async () => {
    const l = loyaltyOf(settings);
    if (!l.enabled || !c) return null;
    const [{ balance, rows }, spend] = await Promise.all([pointsOf(actor.businessId, c.id), yearSpend(actor.businessId, c.id, addDaysISO(todayISO(), 1))]);
    return { balance, rows, tier: tierFor(spend, l), worth: balance * l.pointValue };
  }, [c, actor.businessId, settings]);
  const invoices = useLiveQuery(
    () =>
      db.invoices
        .where('billTo.customerId')
        .equals(id!)
        .filter((i) => !i.deleted && i.businessId === actor.businessId)
        .reverse()
        .sortBy('date'),
    [id, actor.businessId],
  );
  if (!c || !khata) return null;

  const upi = upiIds.find((u) => u.isDefault) ?? upiIds[0];
  const overLimit = c.creditLimit != null && c.creditLimit > 0 && khata.balance > c.creditLimit;
  const remind = () => {
    const text = reminderText(profile.name, c, khata.balance, upi ? upiLink(upi, khata.balance, profile.name) : undefined);
    window.open(`https://wa.me/${(c.phone ?? '').replace('+', '')}?text=${encodeURIComponent(text)}`, '_blank');
  };

  return (
    <PageShell
      title={c.name}
      backHref="/tabs/customers"
      padded={false}
      headerEnd={
        <IonButton routerLink={`/tabs/customers/${c.id}/edit`}>
          <IonIcon icon={createOutline} slot="start" /> {t('Edit')}
        </IonButton>
      }
    >
      {/* One summary: what they owe first, how to reach them under it. */}
      <section className="bill-card party-card-big">
        <span className="section-note">{khata.balance >= 0 ? t('To collect') : t('We owe them')}</span>
        <strong className={khata.balance > 0 ? 'party-due text-danger' : 'party-due'}>{rupees(Math.abs(khata.balance))}</strong>
        <p className="section-note">
          {[c.phone ? formatIndianMobile(c.phone) : null, c.email || null, ...addressLines(c.billingAddress)].filter(Boolean).join(' · ')}
        </p>
        {overLimit && <p className="text-danger">{t('Above the credit limit')}</p>}
        {c.phone && (
          <div className="party-contact">
            <IonButton fill="outline" href={`tel:${c.phone}`}>
              <IonIcon icon={callOutline} slot="start" /> {t('Call')}
            </IonButton>
            <IonButton fill="outline" href={`https://wa.me/${c.phone.replace('+', '')}`} target="_blank">
              <IonIcon icon={logoWhatsapp} slot="start" /> WhatsApp
            </IonButton>
            {khata.balance > 0 && (
              <IonButton fill="outline" onClick={remind}>
                <IonIcon icon={notificationsOutline} slot="start" /> {t('Remind')}
              </IonButton>
            )}
          </div>
        )}
      </section>

      {(loyalty || khata.advance > 0 || khata.held > 0 || c.creditLimit) && (
        <div className="stat-grid party-stats">
          {loyalty && (
            <div className="mini-stat">
              <span>{loyalty.tier ? t('{tier} member · points', { tier: loyalty.tier.name }) : t('Points')}</span>
              <strong className="text-success">
                {loyalty.balance} <small>({rupees(loyalty.worth)})</small>
              </strong>
            </div>
          )}
          {khata.advance > 0 && (
            <div className="mini-stat">
              <span>{t('Advance')}</span>
              <strong className="text-success">{rupees(khata.advance)}</strong>
            </div>
          )}
          {khata.held > 0 && (
            <div className="mini-stat">
              <span>{t('Held for estimates')}</span>
              <strong className="text-success">{rupees(khata.held)}</strong>
            </div>
          )}
          {c.creditLimit ? (
            <div className="mini-stat">
              <span>{t('Credit limit')}</span>
              <strong className={overLimit ? 'text-danger' : ''}>{rupees(c.creditLimit)}</strong>
            </div>
          ) : null}
        </div>
      )}

      {/* The two main jobs, then the rest as plain links. */}
      <div className="party-main">
        <IonButton onClick={() => setReceiving(true)}>
          <IonIcon icon={cashOutline} slot="start" /> {t('Receive payment')}
        </IonButton>
        {CAN_CREATE_INVOICES ? (
          <IonButton fill="outline" routerLink={`/tabs/invoices/new?customer=${c.id}`}>
            <IonIcon icon={addOutline} slot="start" /> {t('New bill')}
          </IonButton>
        ) : (
          <IonButton fill="outline" routerLink={`/tabs/estimates/new?customer=${c.id}`}>
            <IonIcon icon={clipboardOutline} slot="start" /> {t('New estimate')}
          </IonButton>
        )}
      </div>
      <div className="party-links">
        <a onClick={() => setStatement(true)}>{t('Statement')}</a>
        {CAN_CREATE_INVOICES && <a onClick={() => router.push(`/tabs/estimates/new?customer=${c.id}`)}>{t('New estimate')}</a>}
        <a onClick={() => router.push('/tabs/customers/visits')}>{t('Visits')}</a>
      </div>

      {(challans ?? []).length > 0 && CAN_CREATE_INVOICES && (
        <div className="day-end-banner">
          {t('{n} challans not billed ({amount})', { n: challans!.length, amount: rupees(challans!.reduce((a, c) => a + c.totals.grandTotal, 0)) })}{' '}
          <IonButton
            size="small"
            onClick={() =>
              void billChallans(actor, challans!.map((c) => c.id))
                .then((inv) => router.push(`/tabs/invoices/${inv.id}/edit`))
                .catch((e: Error) => toast({ message: e.message, duration: 2500, color: 'danger' }))
            }
          >
            {t('Make one bill')}
          </IonButton>
        </div>
      )}
      {(sites ?? []).length > 0 && (
        <div className="filter-chips wrap">
          {sites!.map((st) => (
            <IonChip key={st.site} outline onClick={() => void siteTable(actor.businessId, c.name, st).then((tbl) => shareTable(actor.businessId, tbl, 'pdf'))}>
              {st.site} · {rupees(st.pending)}
            </IonChip>
          ))}
        </div>
      )}
      {(crates ?? []).length > 0 && (
        <IonRouterLink routerLink="/tabs/assets/crates">
          <p className="section-note">{crates!.map((b) => t('{n} {kind} with them', { n: b.out, kind: b.kind })).join(' · ')}</p>
        </IonRouterLink>
      )}
      <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value as 'khata' | 'bills')}>
        <IonSegmentButton value="khata">
          <IonLabel>{t('Khata')}</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="bills">
          <IonLabel>{t('Invoices')}</IonLabel>
        </IonSegmentButton>
      </IonSegment>

      {tab === 'khata' ? (
        <IonList inset>
          {khata.rows.length === 0 && (
            <IonItem lines="none">
              <IonNote>{t('Nothing recorded yet.')}</IonNote>
            </IonItem>
          )}
          {[...khata.rows].reverse().map((r, i) => (
            <IonItem key={i} routerLink={r.href} detail={false}>
              <IonLabel>
                <h3>{r.label}</h3>
                <p>
                  {dateIN(r.date)}
                  {r.entry?.receivedByName ? ` · ${r.entry.receivedByName}` : ''}
                </p>
              </IonLabel>
              <div slot="end" className="list-end">
                <strong className={r.amount > 0 ? 'text-danger' : 'text-success'}>{rupees(Math.abs(r.amount))}</strong>
                <IonNote className="ledger-balance">{t('Balance {amount}', { amount: rupees(r.balance) })}</IonNote>
                {r.entry && r.entry.kind === 'payment' && !r.entry.voidedAt && (
                  <IonButton
                    size="small"
                    fill="clear"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void receiptFor(r.entry!.id).then((d) => d && shareReceipt(d));
                    }}
                  >
                    {t('Receipt')}
                  </IonButton>
                )}
              </div>
            </IonItem>
          ))}
        </IonList>
      ) : (
        <IonList inset>
          <IonListHeader>
            <IonLabel>{t('Invoices')}</IonLabel>
            {CAN_CREATE_INVOICES && <IonButton routerLink={`/tabs/invoices/new?customer=${c.id}`}>{t('New invoice')}</IonButton>}
          </IonListHeader>
          {(invoices ?? []).length === 0 && (
            <IonItem lines="none">
              <IonIcon icon={documentTextOutline} slot="start" color="medium" />
              <IonNote>{t('No invoices yet')}</IonNote>
            </IonItem>
          )}
          {(invoices ?? []).map((inv) => (
            <IonItem key={inv.id} routerLink={`/tabs/invoices/${inv.id}`} detail={false}>
              <IonLabel>
                <h2>{inv.number || t('Draft')}</h2>
                <p>{dateIN(inv.date)}</p>
              </IonLabel>
              <div slot="end" className="list-end">
                <strong>{rupees(inv.totals.grandTotal)}</strong>
                <StatusBadge invoice={inv} />
              </div>
            </IonItem>
          ))}
        </IonList>
      )}

      <MoneyEntrySheet
        isOpen={receiving}
        onClose={() => setReceiving(false)}
        title={t('Receive from {name}', { name: c.name })}
        amount={Math.max(0, khata.balance)}
        onSave={async (e) => {
          await receiveKhataPayment(actor, c, e);
          void toast({ message: t('Payment saved: oldest bills settled first'), duration: 2000, position: 'top', color: 'success' });
        }}
      />

      <IonModal isOpen={statement} onDidDismiss={() => setStatement(false)} initialBreakpoint={0.6} breakpoints={[0, 0.6, 1]}>
        <IonHeader>
          <IonToolbar>
            <IonTitle>{t('Statement')}</IonTitle>
            <IonButtons slot="end">
              <IonButton onClick={() => setStatement(false)}>{t('Close')}</IonButton>
            </IonButtons>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <div className="field-row">
            <IonInput className="field" fill="outline" labelPlacement="floating" label={t('From')} type="date" value={from} onIonInput={sync((e) => setFrom(String(e.detail.value ?? from)))} />
            <IonInput className="field" fill="outline" labelPlacement="floating" label={t('To')} type="date" value={to} onIonInput={sync((e) => setTo(String(e.detail.value ?? to)))} />
          </div>
          <IonButton expand="block" onClick={() => void statementTable(actor.businessId, c, from, to).then((tbl) => shareTable(actor.businessId, tbl, 'pdf', t('Statement of account')))}>
            {t('Share PDF')}
          </IonButton>
          <IonButton expand="block" fill="outline" onClick={() => void statementTable(actor.businessId, c, from, to).then((tbl) => shareTable(actor.businessId, tbl, 'excel'))}>
            {t('Share Excel')}
          </IonButton>
        </IonContent>
      </IonModal>
    </PageShell>
  );
}
