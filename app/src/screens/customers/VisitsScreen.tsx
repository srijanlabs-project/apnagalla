import { IonButton, IonChip, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSpinner, useIonActionSheet, useIonRouter, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { chevronBackOutline, chevronForwardOutline, locationOutline, mapOutline } from 'ionicons/icons';
import { useState } from 'react';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { dateIN } from '../../lib/format';
import { t } from '../../lib/i18n';
import { checkIn, checkInPlanned, currentPlace, mapLink, outcomeLabel, planSummary, plannedFor, removePlan, setOutcome, visitsIn } from '../../lib/visits';
import PlanVisits from './PlanVisits';
import CustomerPicker from '../docs/CustomerPicker';
import type { Visit } from '../../lib/db';

const shift = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00`);
  x.setDate(x.getDate() + n);
  return todayISO(x);
};

/** Field sales: check in at a customer, then order / collect / note; the owner sees everyone's day. */
export default function VisitsScreen() {
  const { actor, isOwner } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const [sheet] = useIonActionSheet();
  const [date, setDate] = useState(todayISO());
  const [person, setPerson] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  // Planned visits for the day: a salesperson sees their own list; the owner sees everyone's.
  const plans = useLiveQuery(() => plannedFor(actor.businessId, date, isOwner ? null : actor.userId), [actor.businessId, date, isOwner, actor.userId]);
  const week = useLiveQuery(() => (isOwner ? planSummary(actor.businessId, shift(date, -6), date) : Promise.resolve([])), [actor.businessId, date, isOwner]);
  const visits = useLiveQuery(() => visitsIn(actor.businessId, date, date, isOwner ? null : actor.userId), [actor.businessId, date, isOwner, actor.userId]);
  const people = [...new Map((visits ?? []).map((v) => [v.byUserId, v.byName])).entries()];
  const shown = (visits ?? []).filter((v) => !person || v.byUserId === person);

  const next = (v: Visit) =>
    void sheet({
      header: v.customerName,
      buttons: [
        { text: t('Take an order'), handler: () => void setOutcome(actor, v, 'order').then(() => router.push(`/tabs/estimates/new?order=1&customer=${v.customerId}&visit=${v.id}`)) },
        { text: t('Collect money'), handler: () => void setOutcome(actor, v, 'payment').then(() => router.push(`/tabs/customers/${v.customerId}`)) },
        { text: t('No order'), handler: () => void setOutcome(actor, v, 'no_order') },
        { text: t('Shop closed'), handler: () => void setOutcome(actor, v, 'closed') },
        { text: t('Cancel'), role: 'cancel' },
      ],
    });

  return (
    <PageShell title={t('Field visits')} backHref="/tabs/customers" padded={false}>
      <div className="ion-padding-horizontal">
        <IonButton
          expand="block"
          disabled={busy}
          onClick={() => setPicking(true)}
        >
          {busy ? <IonSpinner name="dots" /> : <IonIcon icon={locationOutline} slot="start" />} {t('Check in at a customer')}
        </IonButton>
        <p className="section-note">{t('The phone notes where you are when you check in (allow location when asked). Nothing is tracked after that.')}</p>
        {isOwner && (
          <IonButton expand="block" fill="outline" onClick={() => setPlanning(true)}>
            {t('Plan visits')}
          </IonButton>
        )}
      </div>
      <div className="period-row">
        <IonButton fill="clear" onClick={() => setDate(shift(date, -1))} aria-label={t('Previous day')}>
          <IonIcon icon={chevronBackOutline} slot="icon-only" />
        </IonButton>
        <strong>{date === todayISO() ? t('Today') : dateIN(date)}</strong>
        <IonButton fill="clear" disabled={!isOwner && date >= todayISO()} onClick={() => setDate(shift(date, 1))} aria-label={t('Next day')}>
          <IonIcon icon={chevronForwardOutline} slot="icon-only" />
        </IonButton>
      </div>
      {isOwner && (week ?? []).length > 0 && (
        <div className="filter-chips wrap ion-padding-horizontal">
          {week!.map((w) => (
            <IonChip key={w.userId} outline>
              {t('{name}: {done} of {planned} done', { name: w.name, done: w.done, planned: w.planned })}
              {w.missed ? ` · ${t('{n} missed', { n: w.missed })}` : ''}
            </IonChip>
          ))}
        </div>
      )}
      {(plans ?? []).length > 0 && (
        <IonList inset>
          <IonItem lines="none">
            <IonLabel>
              <strong>{t('Planned for this day')}</strong>
            </IonLabel>
          </IonItem>
          {plans!.map((p) => (
            <IonItem key={p.id} detail={false}>
              <IonLabel className="ion-text-wrap">
                <h3>{p.customerName}</h3>
                <p>
                  {isOwner ? `${p.byName} · ` : ''}
                  {p.at
                    ? `${t('Visited {time}', { time: new Date(p.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) })} · ${outcomeLabel(p.outcome)}`
                    : p.date < todayISO()
                      ? t('Missed')
                      : t('To visit')}
                </p>
              </IonLabel>
              {!p.at && p.byUserId === actor.userId && p.date === todayISO() && (
                <IonButton
                  slot="end"
                  size="small"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const place = await currentPlace();
                      const v = await checkInPlanned(actor, p, place);
                      if (!place) void toast({ message: t('Checked in without location (not allowed or not found)'), duration: 2500, color: 'warning' });
                      next(v);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t('Check in')}
                </IonButton>
              )}
              {!p.at && isOwner && (
                <IonButton slot="end" size="small" fill="clear" color="medium" onClick={() => void removePlan(actor, p)}>
                  {t('Remove')}
                </IonButton>
              )}
            </IonItem>
          ))}
        </IonList>
      )}
      {isOwner && people.length > 1 && (
        <div className="filter-chips">
          <IonChip outline={!!person} color={!person ? 'primary' : undefined} onClick={() => setPerson(null)}>
            {t('Everyone')} · {(visits ?? []).length}
          </IonChip>
          {people.map(([id, name]) => (
            <IonChip key={id} outline={person !== id} color={person === id ? 'primary' : undefined} onClick={() => setPerson(person === id ? null : id)}>
              {name} · {(visits ?? []).filter((v) => v.byUserId === id).length}
            </IonChip>
          ))}
        </div>
      )}
      <IonList>
        {shown.map((v) => (
          <IonItem key={v.id} button={v.byUserId === actor.userId && !v.outcome} detail={false} onClick={() => v.byUserId === actor.userId && !v.outcome && next(v)}>
            <IonLabel className="ion-text-wrap">
              <h3>{v.customerName}</h3>
              <p>
                {new Date(v.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {v.byName} · {outcomeLabel(v.outcome)}
                {v.lat == null ? ` · ${t('no location')}` : ''}
              </p>
            </IonLabel>
            {mapLink(v) && (
              <IonButton slot="end" fill="clear" href={mapLink(v)!} target="_blank" aria-label={t('Map')}>
                <IonIcon icon={mapOutline} slot="icon-only" />
              </IonButton>
            )}
            {!v.outcome && v.byUserId === actor.userId && <IonNote slot="end">{t('Tap: what happened?')}</IonNote>}
          </IonItem>
        ))}
      </IonList>
      <PlanVisits isOpen={planning} onClose={() => setPlanning(false)} date={date} />
      <CustomerPicker
        isOpen={picking}
        onClose={() => setPicking(false)}
        onPick={async (_p, c) => {
          setPicking(false);
          if (!c) {
            void toast({ message: t('Pick a saved customer to check in'), duration: 2000, color: 'warning' });
            return;
          }
          setBusy(true);
          try {
            const place = await currentPlace();
            const v = await checkIn(actor, c, place);
            if (!place) void toast({ message: t('Checked in without location (not allowed or not found)'), duration: 2500, color: 'warning' });
            next(v);
          } finally {
            setBusy(false);
          }
        }}
      />
    </PageShell>
  );
}
