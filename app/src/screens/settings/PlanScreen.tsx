import { IonButton, IonCard, IonCardContent, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSegment, IonSegmentButton, IonSpinner, useIonToast } from '@ionic/react';
import type { BillingStatusDto, PlanDto, PlatformInvoiceDto } from '@invoice/shared';
import { logoWhatsapp } from 'ionicons/icons';
import { IonIcon } from '@ionic/react';
import { useCallback, useEffect, useState } from 'react';
import { TextField } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { ApiError, NetworkError, api } from '../../lib/api';
import { useBusiness } from '../../lib/business';
import { shareTable, type ExportTable } from '../../lib/exportTable';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';

export const STATE_TEXT: Record<BillingStatusDto['state'], () => string> = {
  trial: () => t('Free trial'),
  active: () => t('Active'),
  grace: () => t('Ended: renew now'),
  expired: () => t('Ended'),
  free: () => t('Free plan'),
};

const limitsText = (p: PlanDto) =>
  [
    p.limits.stores ? t('{n} stores', { n: p.limits.stores }) : '',
    p.limits.staff != null ? t('{n} staff', { n: p.limits.staff }) : '',
    p.limits.billsPerMonth ? t('{n} bills a month', { n: p.limits.billsPerMonth }) : t('Unlimited bills'),
    p.limits.scansPerDay ? t('{n} bill scans a day', { n: p.limits.scansPerDay }) : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** ApnaGalla's GST invoice to the shop for a plan payment. */
function invoiceTable(inv: PlatformInvoiceDto): ExportTable {
  return {
    title: t('Tax invoice {number}', { number: inv.invoiceNo }),
    subtitle: [`${inv.seller.name}${inv.seller.gstin ? ` · GSTIN ${inv.seller.gstin}` : ''}`, inv.seller.address, t('Date: {date}', { date: dateIN(inv.date) })].filter(Boolean),
    party: { heading: t('Billed to'), lines: [inv.buyer.name, inv.buyer.place].filter(Boolean) },
    columns: [{ label: t('Description') }, { label: 'SAC', width: 'auto' }, { label: t('Amount'), kind: 'money' }],
    rows: [[`ApnaGalla ${inv.planId} — ${inv.period === 'year' ? t('1 year') : t('1 month')}`, inv.seller.sac, inv.amount]],
    foot: [
      [`GST ${inv.gstPct}%`, '', inv.gst],
      [t('Total'), '', inv.total],
    ],
    fileBase: `ApnaGalla-invoice-${inv.invoiceNo}`,
  };
}

/** The store's ApnaGalla plan: status, plans and prices, pay by link, referral code, invoices. */
export default function PlanScreen() {
  const { actor, isOwner, profile } = useBusiness();
  const [toast] = useIonToast();
  const [data, setData] = useState<{ status: BillingStatusDto; plans: PlanDto[] } | null>(null);
  const [invoices, setInvoices] = useState<PlatformInvoiceDto[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [period, setPeriod] = useState<'month' | 'year'>('year');
  const [code, setCode] = useState('');
  const [quote, setQuote] = useState<{ planId: string; total: number; note: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const say = (e: unknown) => void toast({ message: e instanceof NetworkError ? t('This needs the internet.') : e instanceof ApiError ? e.message : t('Something went wrong'), duration: 2500, position: 'top', color: 'danger' });
  const load = useCallback(() => {
    api
      .billing(actor.businessId)
      .then(setData)
      .catch((e) => setFailed(e instanceof NetworkError ? t('This needs the internet.') : t('Something went wrong')));
    if (isOwner) void api.billingInvoices(actor.businessId).then((r) => setInvoices(r.invoices)).catch(() => undefined);
  }, [actor.businessId, isOwner]);
  useEffect(load, [load]);

  if (!data) return <PageShell title={t('Plan and billing')} backHref="/tabs/more">{failed ? <p>{failed}</p> : <IonSpinner />}</PageShell>;
  const { status, plans } = data;
  const paid = plans.filter((p) => p.priceMonthly > 0);

  async function check(planId: string) {
    setBusy(`q:${planId}`);
    try {
      const q = await api.billingQuote(actor.businessId, { planId, period, code: code.trim() || null });
      setQuote({ planId, total: q.total, note: q.note });
    } catch (e) {
      say(e);
    } finally {
      setBusy(null);
    }
  }
  async function pay(planId: string) {
    setBusy(`p:${planId}`);
    try {
      const { url } = await api.billingPay(actor.businessId, { planId, period, code: code.trim() || null });
      window.open(url, '_blank');
    } catch (e) {
      say(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <PageShell title={t('Plan and billing')} backHref="/tabs/more">
      <IonCard>
        <IonCardContent>
          <h2>{status.planName}</h2>
          <p className={status.state === 'grace' || status.state === 'expired' ? 'text-danger' : undefined}>
            {STATE_TEXT[status.state]()}
            {status.until ? ` · ${t('till {date}', { date: dateIN(status.until.slice(0, 10)) })}` : ''}
            {status.daysLeft != null ? ` · ${t('{n} days left', { n: status.daysLeft })}` : ''}
          </p>
          <p className="section-note">{limitsText({ ...plans[0]!, limits: status.limits })}</p>
          {!status.enforced && <p className="section-note">{t('Limits are not applied yet.')}</p>}
        </IonCardContent>
      </IonCard>

      {isOwner && paid.length > 0 && (
        <>
          <IonSegment value={period} onIonChange={(e) => (setPeriod(e.detail.value as 'month' | 'year'), setQuote(null))}>
            <IonSegmentButton value="month">
              <IonLabel>{t('Monthly')}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="year">
              <IonLabel>{t('Yearly')}</IonLabel>
            </IonSegmentButton>
          </IonSegment>
          <TextField label={t('Coupon, referral or partner code')} value={code} onChange={(v) => (setCode(v.toUpperCase()), setQuote(null))} autocapitalize="characters" />
          {paid.map((p) => (
            <IonCard key={p.id}>
              <IonCardContent>
                <h2>
                  {p.name} · {rupees(period === 'year' ? p.priceYearly || p.priceMonthly * 12 : p.priceMonthly)} {period === 'year' ? t('a year') : t('a month')} + GST
                </h2>
                <p className="section-note">{limitsText(p)}</p>
                {quote?.planId === p.id && (
                  <p>
                    <strong>{t('To pay {amount} with GST', { amount: rupees(quote.total) })}</strong>
                    {quote.note ? ` · ${quote.note}` : ''}
                  </p>
                )}
                <div className="detail-actions">
                  <IonButton size="small" fill="outline" disabled={!!busy} onClick={() => void check(p.id)}>
                    {t('See price')}
                  </IonButton>
                  <IonButton size="small" disabled={!!busy || !status.canPay} onClick={() => void pay(p.id)}>
                    {busy === `p:${p.id}` ? <IonSpinner name="dots" /> : t('Pay')}
                  </IonButton>
                </div>
              </IonCardContent>
            </IonCard>
          ))}
          {!status.canPay && <p className="section-note">{t('Online payment is not set up yet. Please contact ApnaGalla to renew.')}</p>}
          <p className="section-note">{t('After paying, come back here; the plan updates within a minute.')}</p>
          <IonButton size="small" fill="clear" onClick={load}>
            {t('Check again')}
          </IonButton>
        </>
      )}

      <IonList inset>
        <IonListHeader>
          <IonLabel>{t('Your referral code')}</IonLabel>
        </IonListHeader>
        <IonItem lines="none">
          <IonLabel>
            <h2>{status.referralCode}</h2>
            <p>{t('Other shops get a discount with it.')}</p>
          </IonLabel>
          <IonButton
            slot="end"
            fill="clear"
            href={`https://wa.me/?text=${encodeURIComponent(t('Try ApnaGalla for billing. Use my code {code} for a discount.', { code: status.referralCode }) + ` — ${profile.name}`)}`}
            target="_blank"
          >
            <IonIcon icon={logoWhatsapp} slot="icon-only" />
          </IonButton>
        </IonItem>
      </IonList>

      {isOwner && invoices.length > 0 && (
        <IonList inset>
          <IonListHeader>
            <IonLabel>{t('Invoices from ApnaGalla')}</IonLabel>
          </IonListHeader>
          {invoices.map((inv) => (
            <IonItem key={inv.id} button detail={false} onClick={() => void shareTable(actor.businessId, invoiceTable(inv), 'pdf').catch(say)}>
              <IonLabel>
                <h3>{inv.invoiceNo}</h3>
                <p>{dateIN(inv.date)}</p>
              </IonLabel>
              <IonNote slot="end">{rupees(inv.total)}</IonNote>
            </IonItem>
          ))}
        </IonList>
      )}
    </PageShell>
  );
}
