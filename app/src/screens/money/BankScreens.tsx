import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonModal, IonNote, IonTitle, IonToolbar, useIonActionSheet, useIonAlert, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { arrowDownOutline, arrowUpOutline, chevronBackOutline, chevronForwardOutline, swapHorizontalOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { MoneyField, SelectField, TextField } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { cashDay } from '../../lib/cashbook';
import { db, type MoneyMove } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { accountName, bankAccountsOf, bankBalances, bankBook, correctBalance, moveLabel, saveMoneyMove } from '../../lib/money';
import { deleteRecord } from '../../lib/repo';

/** "2026-11" → first and last day of that month. */
export const monthRange = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const last = new Date(y, m, 0).getDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
};
export const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const monthTitle = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

/** The owner and the accountant login see bank money; other staff don't. */
export function useSeesMoney() {
  const { isOwner, perms } = useBusiness();
  return isOwner || perms.access === 'readonly';
}

/** Cash in hand and money in each bank account; deposits, withdrawals and transfers. */
export default function BankScreen() {
  const { actor, isOwner } = useBusiness();
  const seesMoney = useSeesMoney();
  const [toast] = useIonToast();
  const [sheet] = useIonActionSheet();
  const [moving, setMoving] = useState<MoneyMove['kind'] | null>(null);
  const today = todayISO();
  const data = useLiveQuery(async () => {
    const [balances, cash, moves, accounts] = await Promise.all([
      bankBalances(actor.businessId),
      cashDay(actor.businessId, today),
      db.moneyMoves.where('businessId').equals(actor.businessId).filter((m) => !m.deleted).toArray(),
      bankAccountsOf(actor.businessId),
    ]);
    return { balances, cash: cash.expected, moves: moves.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 30), accounts };
  }, [actor.businessId, today]);
  if (!seesMoney) return <PageShell title={t('Bank and cash')} backHref="/tabs/more">{t('Only the owner can see this.')}</PageShell>;
  if (!data) return null;
  const bank = data.balances.reduce((a, b) => a + b.balance, 0);

  return (
    <PageShell title={t('Bank and cash')} backHref="/tabs/more">
      <div className="dash-grid">
        <div className="dash-card">
          <span>{t('Cash in drawer (expected)')}</span>
          <strong>{rupees(data.cash)}</strong>
        </div>
        <div className="dash-card">
          <span>{t('In bank accounts')}</span>
          <strong className={bank < 0 ? 'text-danger' : undefined}>{rupees(bank)}</strong>
        </div>
      </div>

      <IonList inset className="flush-list">
        <IonListHeader>
          <IonLabel>{t('Bank accounts')}</IonLabel>
        </IonListHeader>
        {data.balances.length === 0 && (
          <IonItem lines="none" routerLink="/tabs/more/payment">
            <IonLabel className="ion-text-wrap">{t('No bank account yet. Add one in Payment details; UPI, card and bank payments then show here.')}</IonLabel>
          </IonItem>
        )}
        {data.balances.map(({ account, balance }) => (
          <IonItem key={account.id} routerLink={`/tabs/bank/${account.id}`} detail>
            <IonLabel>
              <h3>{accountName(account)}</h3>
              <p>{account.isDefault ? t('Default · UPI, card and bank payments come here') : account.holderName}</p>
            </IonLabel>
            <IonNote slot="end" className={balance < 0 ? 'text-danger' : undefined}>
              {rupees(balance)}
            </IonNote>
          </IonItem>
        ))}
        <IonItem routerLink="/tabs/cash-book" detail lines="none">
          <IonLabel>{t('Cash book')}</IonLabel>
        </IonItem>
      </IonList>

      {isOwner && data.accounts.length > 0 && (
        <div className="detail-actions">
          <IonButton fill="outline" onClick={() => setMoving('deposit')}>
            <IonIcon icon={arrowUpOutline} slot="start" /> {t('Deposit cash')}
          </IonButton>
          <IonButton fill="outline" onClick={() => setMoving('withdraw')}>
            <IonIcon icon={arrowDownOutline} slot="start" /> {t('Withdraw cash')}
          </IonButton>
          {data.accounts.length > 1 && (
            <IonButton fill="outline" onClick={() => setMoving('transfer')}>
              <IonIcon icon={swapHorizontalOutline} slot="start" /> {t('Transfer')}
            </IonButton>
          )}
        </div>
      )}

      {data.moves.length > 0 && (
        <IonList inset className="flush-list">
          <IonListHeader>
            <IonLabel>{t('Cash and bank moves')}</IonLabel>
          </IonListHeader>
          {data.moves.map((m) => (
            <IonItem
              key={m.id}
              button={isOwner}
              detail={false}
              onClick={() =>
                isOwner &&
                void sheet({
                  header: moveLabel(m, data.accounts),
                  buttons: [
                    { text: t('Delete'), role: 'destructive', handler: () => void deleteRecord('moneyMoves', actor, m.id) },
                    { text: t('Cancel'), role: 'cancel' },
                  ],
                })
              }
            >
              <IonLabel className="ion-text-wrap">
                <h3>{moveLabel(m, data.accounts)}</h3>
                <p>
                  {dateIN(m.date)}
                  {m.byName ? ` · ${m.byName}` : ''}
                </p>
              </IonLabel>
              <IonNote slot="end">{rupees(m.amount)}</IonNote>
            </IonItem>
          ))}
        </IonList>
      )}

      <MoveSheet
        kind={moving}
        onClose={() => setMoving(null)}
        onSaved={() => void toast({ message: t('Saved'), duration: 1500, position: 'top', color: 'success' })}
      />
    </PageShell>
  );
}

/** Deposit cash in a bank, withdraw cash, or move money between two accounts. */
function MoveSheet({ kind, onClose, onSaved }: { kind: MoneyMove['kind'] | null; onClose: () => void; onSaved: () => void }) {
  const { actor } = useBusiness();
  const [toast] = useIonToast();
  const accounts = useLiveQuery(() => bankAccountsOf(actor.businessId), [actor.businessId]) ?? [];
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const first = accounts[0]?.id ?? '';
  const second = accounts[1]?.id ?? '';
  useEffect(() => {
    if (!kind) return;
    setFrom(kind === 'deposit' ? 'cash' : first);
    setTo(kind === 'withdraw' ? 'cash' : kind === 'transfer' ? second : first);
    setAmount(null);
    setDate(todayISO());
    setNote('');
  }, [kind, first, second]);
  const options = accounts.map((a) => ({ value: a.id, label: accountName(a) }));
  const title = kind === 'deposit' ? t('Deposit cash') : kind === 'withdraw' ? t('Withdraw cash') : t('Transfer');

  return (
    <IonModal isOpen={!!kind} onDidDismiss={onClose} initialBreakpoint={0.85} breakpoints={[0, 0.85, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{title}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>{t('Cancel')}</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {kind !== 'deposit' && <SelectField label={t('From')} value={from} options={options} onChange={setFrom} />}
        {kind !== 'withdraw' && <SelectField label={kind === 'deposit' ? t('Into') : t('To')} value={to} options={options} onChange={setTo} />}
        <MoneyField label={t('Amount')} required value={amount} onChange={setAmount} />
        <TextField label={t('Date')} type="date" value={date} onChange={(d) => setDate(d || todayISO())} />
        <TextField label={t('Note (optional)')} value={note} onChange={setNote} />
        <IonButton
          expand="block"
          disabled={!(amount && amount > 0) || (kind === 'transfer' && from === to)}
          onClick={async () => {
            try {
              await saveMoneyMove(actor, { kind: kind!, from, to, amount: amount!, date, note });
              onSaved();
              onClose();
            } catch (e) {
              void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });
            }
          }}
        >
          {t('Save')}
        </IonButton>
      </IonContent>
    </IonModal>
  );
}

/** One bank account month by month: opening, every payment in and out, running balance. */
export function BankBookScreen() {
  const { id = '' } = useParams();
  const { actor, isOwner } = useBusiness();
  const seesMoney = useSeesMoney();
  const [alert] = useIonAlert();
  const [toast] = useIonToast();
  const [ym, setYm] = useState(todayISO().slice(0, 7));
  const { from, to } = monthRange(ym);
  const book = useLiveQuery(() => bankBook(actor.businessId, id, from, to), [actor.businessId, id, from, to]);
  if (!seesMoney || book === null) return <PageShell title={t('Bank book')} backHref="/tabs/bank">{t('Not found')}</PageShell>;
  if (!book) return null;

  return (
    <PageShell title={accountName(book.account)} backHref="/tabs/bank">
      <div className="period-row">
        <IonButton fill="clear" onClick={() => setYm(shiftMonth(ym, -1))} aria-label={t('Previous month')}>
          <IonIcon icon={chevronBackOutline} slot="icon-only" />
        </IonButton>
        <strong>{monthTitle(ym)}</strong>
        <IonButton fill="clear" disabled={ym >= todayISO().slice(0, 7)} onClick={() => setYm(shiftMonth(ym, 1))} aria-label={t('Next month')}>
          <IonIcon icon={chevronForwardOutline} slot="icon-only" />
        </IonButton>
      </div>
      <div className="dash-grid">
        <div className="dash-card">
          <span>{t('Opening')}</span>
          <strong>{rupees(book.opening)}</strong>
        </div>
        <div className="dash-card">
          <span>{t('Closing')}</span>
          <strong className={book.closing < 0 ? 'text-danger' : undefined}>{rupees(book.closing)}</strong>
        </div>
      </div>
      <IonList inset className="flush-list">
        {book.lines.length === 0 && (
          <IonItem lines="none">
            <IonNote>{t('Nothing this month.')}</IonNote>
          </IonItem>
        )}
        {book.lines.map((l, i) => (
          <IonItem key={i} routerLink={l.href} detail={false}>
            <IonLabel className="ion-text-wrap">
              <h3>{l.label}</h3>
              <p>
                {dateIN(l.date)} · {t('Balance {amount}', { amount: rupees(l.balance) })}
              </p>
            </IonLabel>
            <IonNote slot="end" className={l.amount < 0 ? 'text-danger' : 'text-success'}>
              {l.amount < 0 ? '−' : '+'}
              {rupees(Math.abs(l.amount))}
            </IonNote>
          </IonItem>
        ))}
      </IonList>
      <p className="section-note">{t('UPI, card and bank payments, cleared cheques, and money you moved. Pending cheques come in when marked cleared.')}</p>
      {isOwner && (
        <IonButton
          fill="outline"
          onClick={() =>
            void alert({
              header: t('Correct the balance'),
              message: t('Enter what the bank shows today. The difference is added as a correction.'),
              inputs: [{ name: 'amount', type: 'number', placeholder: '₹' }],
              buttons: [
                { text: t('Cancel'), role: 'cancel' },
                {
                  text: t('Save'),
                  handler: (v: { amount?: string }) => {
                    const rupeesTyped = Number(v.amount);
                    if (!Number.isFinite(rupeesTyped) || v.amount === '') return;
                    void correctBalance(actor, id, Math.round(rupeesTyped * 100)).then((m) => toast({ message: m ? t('Balance corrected') : t('Already matches'), duration: 1500, position: 'top', color: 'success' }));
                  },
                },
              ],
            })
          }
        >
          {t('Correct the balance')}
        </IonButton>
      )}
    </PageShell>
  );
}
