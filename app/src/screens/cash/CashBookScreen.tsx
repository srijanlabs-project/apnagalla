import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, MoneyField, TextField } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { cashDay, closeDay, type CashLine } from '../../lib/cashbook';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { modeLabel } from '../../lib/ledger';

const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function Lines({ title, lines, sign }: { title: string; lines: CashLine[]; sign: '+' | '−' }) {
  return (
    <IonList inset className="flush-list">
      <IonListHeader>
        <IonLabel>{title}</IonLabel>
        <IonNote className="ion-padding-end">{rupees(lines.reduce((a, l) => a + l.amount, 0))}</IonNote>
      </IonListHeader>
      {lines.length === 0 && (
        <IonItem lines="none">
          <IonNote>{t('None')}</IonNote>
        </IonItem>
      )}
      {lines.map((l, i) => (
        <IonItem key={i} routerLink={l.href} detail={false}>
          <IonLabel>{l.label}</IonLabel>
          <IonNote slot="end" className={sign === '−' ? 'text-danger' : 'text-success'}>
            {sign}
            {rupees(l.amount)}
          </IonNote>
        </IonItem>
      ))}
    </IonList>
  );
}

/** Daily cash book and the day-end cash count. */
export default function CashBookScreen() {
  const { actor, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const [date, setDate] = useState(todayISO());
  const day = useLiveQuery(() => cashDay(actor.businessId, date), [actor.businessId, date]);
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  if (!day) return null;
  const canClose = !day.close || isOwner;
  const others = Object.entries(day.otherModes).filter(([, v]) => v !== 0);

  return (
    <PageShell title={t('Cash book')} backHref="/tabs/more">
      <div className="period-row">
        <IonButton fill="clear" onClick={() => setDate(shift(date, -1))} aria-label={t('Previous day')}>
          <IonIcon icon={chevronBackOutline} slot="icon-only" />
        </IonButton>
        <strong>{date === todayISO() ? t('Today') : dateIN(date)}</strong>
        <IonButton fill="clear" disabled={date >= todayISO()} onClick={() => setDate(shift(date, 1))} aria-label={t('Next day')}>
          <IonIcon icon={chevronForwardOutline} slot="icon-only" />
        </IonButton>
      </div>

      <div className="dash-grid">
        <div className="dash-card">
          <span>{t('Opening cash')}</span>
          <strong>{rupees(day.opening)}</strong>
        </div>
        <div className="dash-card">
          <span>{t('Cash in drawer (expected)')}</span>
          <strong>{rupees(day.expected)}</strong>
        </div>
      </div>

      <Lines title={t('Cash in')} lines={day.cashIn} sign="+" />
      <Lines title={t('Cash out')} lines={day.cashOut} sign="−" />

      {others.length > 0 && (
        <IonList inset className="flush-list">
          <IonListHeader>
            <IonLabel>{t('Not in the drawer')}</IonLabel>
          </IonListHeader>
          {others.map(([mode, amount]) => (
            <IonItem key={mode}>
              <IonLabel>{modeLabel(mode as never)}</IonLabel>
              <IonNote slot="end">{rupees(amount)}</IonNote>
            </IonItem>
          ))}
        </IonList>
      )}

      <FormSection title={t('Day-end count')}>
        {day.close && (
          <p>
            {t('Counted {counted} by {name}', { counted: rupees(day.close.counted), name: day.close.closedByName ?? '' })} ·{' '}
            <strong className={day.close.difference < 0 ? 'text-danger' : day.close.difference > 0 ? 'text-success' : ''}>
              {day.close.difference === 0 ? t('Matches') : day.close.difference < 0 ? t('Short {amount}', { amount: rupees(-day.close.difference) }) : t('Extra {amount}', { amount: rupees(day.close.difference) })}
            </strong>
            {day.close.note ? ` · ${day.close.note}` : ''}
          </p>
        )}
        {canClose && (
          <>
            <MoneyField label={t('Cash counted in the drawer')} value={counted} onChange={setCounted} />
            {counted != null && counted !== day.expected && (
              <p className={counted < day.expected ? 'text-danger' : 'text-success'}>
                {counted < day.expected ? t('Short {amount}', { amount: rupees(day.expected - counted) }) : t('Extra {amount}', { amount: rupees(counted - day.expected) })}
              </p>
            )}
            <TextField label={t('Note (optional)')} value={note} onChange={setNote} />
            <IonButton
              expand="block"
              disabled={counted == null}
              onClick={() =>
                void closeDay(actor, day, counted!, note).then(() => {
                  setCounted(null);
                  setNote('');
                  void toast({ message: t('Day closed'), duration: 1500, position: 'top', color: 'success' });
                })
              }
            >
              {day.close ? t('Count again') : t('Close the day')}
            </IonButton>
          </>
        )}
        <p className="section-note">{t('Tomorrow starts with the counted cash.')}</p>
      </FormSection>
    </PageShell>
  );
}
