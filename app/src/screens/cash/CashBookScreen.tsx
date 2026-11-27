import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';
import { useState } from 'react';
import { dayOpened } from '../../lib/dayEnd';
import { useLocation } from 'react-router-dom';
import { FormSection, MoneyField, TextField } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { cashDay, closeDay, type CashLine, openDay } from '../../lib/cashbook';
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
  const asked = new URLSearchParams(useLocation().search).get('date');
  const [date, setDate] = useState(asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : todayISO());
  const day = useLiveQuery(() => cashDay(actor.businessId, date), [actor.businessId, date]);
  const opened = useLiveQuery(async () => (await dayOpened(actor.businessId, date)) ?? false, [actor.businessId, date]);
  const [openCount, setOpenCount] = useState<number | null>(null);
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

      {opened ? (
        <p className="section-note ion-padding-horizontal">
          {t('Opened by {name}: {amount} counted in the counter', { name: opened.closedByName ?? '', amount: rupees(opened.counted) })}
          {opened.counted !== opened.expected ? ` (${opened.counted < opened.expected ? t('short {amount}', { amount: rupees(opened.expected - opened.counted) }) : t('extra {amount}', { amount: rupees(opened.counted - opened.expected) })})` : ''}
        </p>
      ) : (
        opened === false &&
        date === todayISO() && (
          <FormSection title={t('Day start')} note={t('Count the cash in the counter before the first sale.')}>
            <MoneyField label={t('Cash in the counter now')} value={openCount} onChange={setOpenCount} />
            <NoteCounter onTotal={setOpenCount} />
            {openCount != null && openCount !== day.opening && (
              <p className={openCount < day.opening ? 'text-danger' : 'text-success'}>
                {openCount < day.opening ? t('Short {amount}', { amount: rupees(day.opening - openCount) }) : t('Extra {amount}', { amount: rupees(openCount - day.opening) })}
              </p>
            )}
            <IonButton
              expand="block"
              disabled={openCount == null}
              onClick={() =>
                void openDay(actor, date, day.opening, openCount!).then(() => {
                  setOpenCount(null);
                  void toast({ message: t('Store opened'), duration: 1500, position: 'top', color: 'success' });
                })
              }
            >
              {t('Open the day')}
            </IonButton>
          </FormSection>
        )
      )}

      {day.cashIn.length + day.cashOut.length === 0 ? (
        <p className="section-note ion-padding-horizontal">{t('No cash in or out on this day.')}</p>
      ) : (
        <>
          {day.cashIn.length > 0 && <Lines title={t('Cash in')} lines={day.cashIn} sign="+" />}
          {day.cashOut.length > 0 && <Lines title={t('Cash out')} lines={day.cashOut} sign="−" />}
        </>
      )}

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
            <NoteCounter onTotal={setCounted} />
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

const NOTES = [500, 200, 100, 50, 20, 10] as const;

/** Count by notes: type how many of each note, the total goes into "Cash counted". Coins go in "Coins ₹". */
function NoteCounter({ onTotal }: { onTotal: (paise: number) => void }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState<Record<string, number>>({});
  if (!open)
    return (
      <IonButton fill="clear" size="small" onClick={() => setOpen(true)}>
        {t('Count by notes')}
      </IonButton>
    );
  const update = (k: string, v: number) => {
    const next = { ...n, [k]: v };
    setN(next);
    const total = NOTES.reduce((a, note) => a + note * (next[note] ?? 0), 0) + (next.coins ?? 0);
    onTotal(total * 100);
  };
  return (
    <div className="note-counter">
      {NOTES.map((note) => (
        <label key={note}>
          <span>₹{note} ×</span>
          <input type="number" inputMode="numeric" min={0} value={n[note] ?? ''} onChange={(e) => update(String(note), Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
        </label>
      ))}
      <label>
        <span>{t('Coins ₹')}</span>
        <input type="number" inputMode="numeric" min={0} value={n.coins ?? ''} onChange={(e) => update('coins', Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
      </label>
    </div>
  );
}
