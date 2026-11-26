import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonAlert, useIonRouter, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline, arrowDownOutline, arrowUpOutline, chevronBackOutline, chevronForwardOutline, closeCircle, documentTextOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FormSection, MoneyField, SelectField, TextField } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import PageShell from '../../components/PageShell';
import { GROUP_LABEL, LEDGER_GROUPS, ledgerOf, ownerMoney, pickableAccounts, saveJournal, trialBalance, type AccountInfo } from '../../lib/books';
import { useBusiness } from '../../lib/business';
import { db, type Journal, type JournalLine, type LedgerGroup } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { deleteRecord, newId, putRecord } from '../../lib/repo';
import { monthRange, monthTitle, shiftMonth, useSeesMoney } from './BankScreens';

const signed = (v: number) => (v >= 0 ? `${rupees(v)} ${t('Dr')}` : `${rupees(-v)} ${t('Cr')}`);

/** The books: every account's balance, owner's money in / out, journal entries, own ledgers. */
export default function BooksScreen() {
  const { actor, isOwner, ledger } = useBusiness();
  const seesMoney = useSeesMoney();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const router = useIonRouter();
  const [asOf, setAsOf] = useState(todayISO());
  const [owner, setOwner] = useState<'capital' | 'drawings' | null>(null);
  const tb = useLiveQuery(() => trialBalance(actor.businessId, asOf), [actor.businessId, asOf, ledger]);
  const journals = useLiveQuery(() => db.journals.where('businessId').equals(actor.businessId).filter((j) => !j.deleted).reverse().sortBy('date'), [actor.businessId]);
  if (!seesMoney) return <PageShell title={t('Books')} backHref="/tabs/more">{t('Only the owner can see this.')}</PageShell>;

  const groups = new Map<string, NonNullable<typeof tb>>();
  for (const b of tb ?? []) {
    const g = GROUP_LABEL[b.info.group]();
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(b);
  }
  const newLedger = () =>
    void alert({
      header: t('New ledger: which group?'),
      message: t('An account of your own: Furniture, Rent deposit, Partner’s capital…'),
      inputs: LEDGER_GROUPS.map((g, i) => ({ name: 'group', type: 'radio' as const, label: GROUP_LABEL[g](), value: g, checked: i === 3 })),
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Next'),
          handler: (v: string) => {
            // A radio alert returns the picked value; the name is asked next.
            const group = (v || 'current_assets') as LedgerGroup;
            void alert({
              header: GROUP_LABEL[group](),
              inputs: [{ name: 'name', placeholder: t('Name') }],
              buttons: [
                { text: t('Cancel'), role: 'cancel' },
                { text: t('Save'), handler: (x: { name: string }) => (x.name.trim() ? void putRecord('ledgers', actor, { id: newId(), name: x.name.trim(), group }) : false) },
              ],
            });
          },
        },
      ],
    });

  return (
    <PageShell title={t('Books')} backHref="/tabs/more" padded={false}>
      <div className="ion-padding-horizontal">
        <TextField label={t('As on')} type="date" value={asOf} onChange={(v) => setAsOf(v || todayISO())} />
        {isOwner && (
          <div className="detail-actions">
            <IonButton size="small" onClick={() => setOwner('capital')}>
              <IonIcon icon={arrowDownOutline} slot="start" /> {t('Owner put money in')}
            </IonButton>
            <IonButton size="small" fill="outline" onClick={() => setOwner('drawings')}>
              <IonIcon icon={arrowUpOutline} slot="start" /> {t('Owner took money out')}
            </IonButton>
            <IonButton size="small" fill="outline" onClick={() => router.push('/tabs/books/journal/new')}>
              <IonIcon icon={documentTextOutline} slot="start" /> {t('Journal entry')}
            </IonButton>
            <IonButton size="small" fill="clear" onClick={newLedger}>
              <IonIcon icon={addOutline} slot="start" /> {t('New ledger')}
            </IonButton>
          </div>
        )}
        <p className="section-note">{t('Balance sheet and trial balance to share: Reports → Money.')}</p>
      </div>
      {[...groups.entries()].map(([g, list]) => (
        <IonList key={g} inset className="flush-list">
          <IonListHeader>
            <IonLabel>{g}</IonLabel>
          </IonListHeader>
          {list.map((b) => (
            <IonItem key={b.info.key} routerLink={b.info.key === 'closing_stock' || b.info.key === 'stock_change' ? undefined : `/tabs/books/ledger/${encodeURIComponent(b.info.key)}`} detail={false}>
              <IonLabel>{b.info.name}</IonLabel>
              <IonNote slot="end">{signed(b.balance)}</IonNote>
            </IonItem>
          ))}
        </IonList>
      ))}
      {(journals ?? []).length > 0 && (
        <IonList inset className="flush-list">
          <IonListHeader>
            <IonLabel>{t('Journal entries')}</IonLabel>
          </IonListHeader>
          {(journals ?? []).slice(0, 50).map((j) => (
            <IonItem key={j.id} routerLink={`/tabs/books/journal/${j.id}`} detail={false}>
              <IonLabel>
                <h3>{j.note || t('Journal')}</h3>
                <p>{dateIN(j.date)}</p>
              </IonLabel>
              <IonNote slot="end">{rupees(j.lines.reduce((a, l) => a + l.debit, 0))}</IonNote>
            </IonItem>
          ))}
        </IonList>
      )}
      <MoneyEntrySheet
        isOpen={!!owner}
        onClose={() => setOwner(null)}
        title={owner === 'capital' ? t('Owner put money in') : t('Owner took money out')}
        onSave={async (m) => {
          const place = m.mode === 'cash' ? 'cash' : `bank:${m.accountId || (await db.bankAccounts.where('businessId').equals(actor.businessId).filter((b) => !b.deleted).first())?.id || 'none'}`;
          await ownerMoney(actor, owner!, m.amount, place, m.date, m.note);
          void toast({ message: t('Saved'), duration: 1200, position: 'top', color: 'success' });
        }}
      />
    </PageShell>
  );
}

/** One account month by month. */
export function LedgerScreen() {
  const { account = '' } = useParams();
  const key = decodeURIComponent(account);
  const { actor, ledger } = useBusiness();
  const [ym, setYm] = useState(todayISO().slice(0, 7));
  const { from, to } = monthRange(ym);
  const data = useLiveQuery(() => ledgerOf(actor.businessId, key, from, to), [actor.businessId, key, from, to, ledger]);
  return (
    <PageShell title={data?.info.name ?? t('Ledger')} backHref="/tabs/books" padded={false}>
      <div className="period-row">
        <IonButton fill="clear" onClick={() => setYm(shiftMonth(ym, -1))} aria-label={t('Previous month')}>
          <IonIcon icon={chevronBackOutline} slot="icon-only" />
        </IonButton>
        <strong>{monthTitle(ym)}</strong>
        <IonButton fill="clear" disabled={ym >= todayISO().slice(0, 7)} onClick={() => setYm(shiftMonth(ym, 1))} aria-label={t('Next month')}>
          <IonIcon icon={chevronForwardOutline} slot="icon-only" />
        </IonButton>
      </div>
      {data && (
        <IonList>
          <IonItem lines="full">
            <IonLabel>{t('Brought forward')}</IonLabel>
            <IonNote slot="end">{signed(data.opening)}</IonNote>
          </IonItem>
          {data.rows.map((r, i) => (
            <IonItem key={i} routerLink={r.href} detail={false}>
              <IonLabel className="ion-text-wrap">
                <h3>{r.label}</h3>
                <p>
                  {dateIN(r.date)} · {t('Balance {amount}', { amount: signed(r.balance) })}
                </p>
              </IonLabel>
              <IonNote slot="end" className={r.amount >= 0 ? undefined : 'text-success'}>
                {signed(r.amount)}
              </IonNote>
            </IonItem>
          ))}
          <IonItem lines="none">
            <IonLabel>
              <strong>{t('Closing balance')}</strong>
            </IonLabel>
            <IonNote slot="end">
              <strong>{signed(data.closing)}</strong>
            </IonNote>
          </IonItem>
        </IonList>
      )}
    </PageShell>
  );
}

/** Add or change a journal entry (owner). */
export function JournalScreen() {
  const { id = 'new' } = useParams();
  const { actor, isOwner } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const stored = useLiveQuery(() => (id !== 'new' ? db.journals.get(id) : undefined), [id]);
  const [j, setJ] = useState<Journal>({ id: newId(), businessId: actor.businessId, createdAt: '', updatedAt: '', updatedBy: '', date: todayISO(), lines: [{ account: '', debit: 0, credit: 0 }, { account: '', debit: 0, credit: 0 }], kind: 'journal' });
  useEffect(() => {
    if (stored) setJ(stored);
  }, [stored]);
  const accounts = useLiveQuery(() => pickableAccounts(actor.businessId, todayISO()), [actor.businessId]) ?? [];
  const dr = j.lines.reduce((a, l) => a + (l.debit || 0), 0);
  const cr = j.lines.reduce((a, l) => a + (l.credit || 0), 0);
  const setLine = (i: number, p: Partial<JournalLine>) => setJ((x) => ({ ...x, lines: x.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) }));
  const opts = (cur: string) => [{ value: '', label: t('Choose an account') }, ...accounts.map((a: AccountInfo) => ({ value: a.key, label: `${a.name} · ${GROUP_LABEL[a.group]()}` })), ...(cur && !accounts.some((a) => a.key === cur) ? [{ value: cur, label: cur }] : [])];

  return (
    <FormPage
      title={id === 'new' ? t('Journal entry') : t('Journal')}
      backHref="/tabs/books"
      canSave={isOwner && dr > 0 && dr === cr}
      onSave={
        isOwner
          ? async () => {
              try {
                await saveJournal(actor, j);
                router.push('/tabs/books', 'back');
              } catch (e) {
                void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });
              }
            }
          : undefined
      }
    >
      <FormSection>
        <TextField label={t('Date')} type="date" value={j.date} onChange={(date) => setJ({ ...j, date: date || todayISO() })} disabled={!isOwner} />
        <TextField label={t('Narration')} value={j.note} onChange={(note) => setJ({ ...j, note })} disabled={!isOwner} />
      </FormSection>
      <FormSection title={t('Lines')} note={t('Each line is a debit or a credit; the two totals must match.')}>
        {j.lines.map((l, i) => (
          <div key={i} className="po-line">
            <div className="search-row">
              <SelectField label={t('Account')} value={l.account} options={opts(l.account)} onChange={(account) => setLine(i, { account })} disabled={!isOwner} />
              {isOwner && j.lines.length > 2 && (
                <IonButton fill="clear" color="medium" onClick={() => setJ({ ...j, lines: j.lines.filter((_, k) => k !== i) })} aria-label={t('Remove')}>
                  <IonIcon icon={closeCircle} slot="icon-only" />
                </IonButton>
              )}
            </div>
            <div className="field-row">
              <MoneyField label={t('Debit')} value={l.debit || null} onChange={(v) => setLine(i, { debit: v ?? 0, credit: v ? 0 : l.credit })} disabled={!isOwner} />
              <MoneyField label={t('Credit')} value={l.credit || null} onChange={(v) => setLine(i, { credit: v ?? 0, debit: v ? 0 : l.debit })} disabled={!isOwner} />
            </div>
          </div>
        ))}
        {isOwner && (
          <IonButton size="small" fill="outline" onClick={() => setJ({ ...j, lines: [...j.lines, { account: '', debit: 0, credit: 0 }] })}>
            <IonIcon icon={addOutline} slot="start" /> {t('Add line')}
          </IonButton>
        )}
        <p className={dr === cr ? 'text-success' : 'text-danger'}>
          {t('Debit {dr} · Credit {cr}', { dr: rupees(dr), cr: rupees(cr) })}
        </p>
      </FormSection>
      {isOwner && id !== 'new' && (
        <IonButton
          color="danger"
          fill="clear"
          expand="block"
          onClick={() =>
            void deleteRecord('journals', actor, j.id).then(() => {
              router.push('/tabs/books', 'back');
            })
          }
        >
          {t('Delete')}
        </IonButton>
      )}
    </FormPage>
  );
}
