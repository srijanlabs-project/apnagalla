import { IonButton, IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonActionSheet, useIonAlert, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, cameraOutline, walletOutline } from 'ionicons/icons';
import { useMemo, useRef, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import { SelectField, TextField, ToggleRow } from '../../components/Fields';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { EXPENSE_CATEGORIES, db, type Expense } from '../../lib/db';
import { dateIN, fileToResizedDataUrl, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { modeLabel } from '../../lib/ledger';
import { expenseLabel, saveExpense } from '../../lib/purchases';
import { dueExpenses, payRecurring, saveRecurring, type DueExpense } from '../../lib/recurring';
import { deleteRecord, newId, putRecord } from '../../lib/repo';

const monthName = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const NEW = '__new';

/** Built-in categories plus the store's own. */
export function useExpenseCategories() {
  const { settings } = useBusiness();
  return [...EXPENSE_CATEGORIES, ...(settings.expenseCategories ?? [])] as Expense['category'][];
}

/**
 * Shop expenses: rent, salary, electricity… Anyone adds (petty cash); only the owner removes.
 * The owner also keeps repeating expenses (rent each month) that show here when due.
 */
export default function ExpensesScreen() {
  const { actor, isOwner, settings, perms } = useBusiness();
  const seesMoney = isOwner || perms.access === 'readonly';
  const [toast] = useIonToast();
  const [sheet] = useIonActionSheet();
  const [alert] = useIonAlert();
  const categories = useExpenseCategories();
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<Expense['category']>('tea');
  const [paidTo, setPaidTo] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [paying, setPaying] = useState<{ d: DueExpense; date: string } | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const list = useLiveQuery(
    () => db.expenses.where('[businessId+date]').between([actor.businessId, ''], [actor.businessId, '￿']).reverse().filter((e) => !e.deleted).toArray(),
    [actor.businessId],
  );
  const due = useLiveQuery(() => (seesMoney ? dueExpenses(actor.businessId) : Promise.resolve([])), [actor.businessId, seesMoney]);
  const months = useMemo(() => {
    const m = new Map<string, Expense[]>();
    for (const e of list ?? []) {
      const k = e.date.slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [list]);

  const newCategory = () =>
    void alert({
      header: t('New category'),
      inputs: [{ name: 'name', placeholder: t('e.g. Packing material') }],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Add'),
          handler: (v: { name?: string }) => {
            const name = v.name?.trim();
            if (!name) return;
            if (!categories.some((c) => expenseLabel(c).toLowerCase() === name.toLowerCase())) void putRecord('settings', actor, { ...settings, expenseCategories: [...(settings.expenseCategories ?? []), name] });
            setCategory(name);
          },
        },
      ],
    });

  const open = () => {
    setPaidTo('');
    setPhoto(null);
    setRepeat(false);
    setAdding(true);
  };

  const dueNow = (due ?? []).filter((d) => d.due.length > 0);
  const repeating = (due ?? []).filter((d) => !d.recurring.stopped);

  return (
    <PageShell title={t('Expenses')} backHref="/tabs/more" padded={false}>
      {dueNow.length > 0 && (
        <IonList inset className="flush-list">
          <IonListHeader>
            <IonLabel>{t('Due now')}</IonLabel>
          </IonListHeader>
          {dueNow.map((d) => (
            <IonItem key={d.recurring.id} lines="full">
              <IonLabel className="ion-text-wrap">
                <h3>
                  {expenseLabel(d.recurring.category)}
                  {d.recurring.paidTo ? ` · ${d.recurring.paidTo}` : ''}
                </h3>
                <p>
                  {t('Due {date}', { date: dateIN(d.due[0]!) })}
                  {d.due.length > 1 ? ` · ${t('{count} unpaid', { count: d.due.length })}` : ''}
                </p>
              </IonLabel>
              {isOwner && (
                <IonButton slot="end" size="small" onClick={() => setPaying({ d, date: d.due[0]! })}>
                  {t('Pay {amount}', { amount: rupees(d.recurring.amount) })}
                </IonButton>
              )}
            </IonItem>
          ))}
        </IonList>
      )}

      {list && list.length === 0 && dueNow.length === 0 ? (
        <EmptyState icon={walletOutline} title={t('No expenses yet')} text={t('Note rent, salary, electricity and small cash spends, so profit and the cash book are right.')} />
      ) : (
        <IonList>
          {months.map(([ym, items]) => (
            <div key={ym}>
              <IonListHeader>
                <IonLabel>{monthName(ym)}</IonLabel>
                <IonNote className="ion-padding-end">{rupees(items.reduce((a, e) => a + e.amount, 0))}</IonNote>
              </IonListHeader>
              {items.map((e) => (
                <IonItem
                  key={e.id}
                  button={isOwner || !!e.photo}
                  detail={false}
                  onClick={() =>
                    (isOwner || e.photo) &&
                    void sheet({
                      header: `${expenseLabel(e.category)} · ${rupees(e.amount)}`,
                      buttons: [
                        ...(e.photo ? [{ text: t('See the bill photo'), handler: () => void window.open(e.photo!, '_blank') }] : []),
                        ...(isOwner ? [{ text: t('Delete'), role: 'destructive', handler: () => void deleteRecord('expenses', actor, e.id) }] : []),
                        { text: t('Cancel'), role: 'cancel' },
                      ],
                    })
                  }
                >
                  {e.photo && <img slot="start" src={e.photo} alt="" className="thumb" />}
                  <IonLabel>
                    <h3>
                      {expenseLabel(e.category)}
                      {e.paidTo ? ` · ${e.paidTo}` : ''}
                    </h3>
                    <p>
                      {dateIN(e.date)} · {modeLabel(e.mode)}
                      {e.note ? ` · ${e.note}` : ''}
                      {e.paidByName ? ` · ${e.paidByName}` : ''}
                    </p>
                  </IonLabel>
                  <IonNote slot="end" className="amount-note">
                    {rupees(e.amount)}
                  </IonNote>
                </IonItem>
              ))}
            </div>
          ))}
        </IonList>
      )}

      {seesMoney && repeating.length > 0 && (
        <IonList inset className="flush-list">
          <IonListHeader>
            <IonLabel>{t('Repeating expenses')}</IonLabel>
          </IonListHeader>
          {repeating.map((d) => (
            <IonItem
              key={d.recurring.id}
              button={isOwner}
              detail={false}
              onClick={() =>
                isOwner &&
                void sheet({
                  header: expenseLabel(d.recurring.category),
                  buttons: [
                    { text: t('Stop repeating'), role: 'destructive', handler: () => void saveRecurring(actor, { ...d.recurring, stopped: true }) },
                    { text: t('Cancel'), role: 'cancel' },
                  ],
                })
              }
            >
              <IonLabel>
                <h3>
                  {expenseLabel(d.recurring.category)}
                  {d.recurring.paidTo ? ` · ${d.recurring.paidTo}` : ''}
                </h3>
                <p>
                  {d.recurring.every === 'month' ? t('Every month on the {day}', { day: d.recurring.day }) : t('Every week')}
                  {d.next ? ` · ${t('next {date}', { date: dateIN(d.next) })}` : ''}
                </p>
              </IonLabel>
              <IonNote slot="end">{rupees(d.recurring.amount)}</IonNote>
            </IonItem>
          ))}
        </IonList>
      )}

      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton onClick={open} aria-label={t('Add expense')}>
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>
      <MoneyEntrySheet
        isOpen={adding}
        onClose={() => setAdding(false)}
        title={t('Add expense')}
        onSave={async (m) => {
          let recurringId: string | undefined;
          if (repeat && isOwner) {
            const day = Number(m.date.slice(8, 10));
            const r = await saveRecurring(actor, { id: newId(), category, amount: m.amount, mode: m.mode, accountId: m.accountId ?? null, paidTo, note: m.note, every: 'month', day: Math.min(day, 28), startDate: m.date });
            recurringId = r.id;
          }
          await saveExpense(actor, {
            id: newId(),
            businessId: actor.businessId,
            createdAt: '',
            updatedAt: '',
            updatedBy: '',
            category,
            ...m,
            paidTo: paidTo.trim() || undefined,
            photo,
            ...(recurringId ? { recurringId, recurringFor: `${m.date.slice(0, 8)}${String(Math.min(Number(m.date.slice(8, 10)), 28)).padStart(2, '0')}` } : {}),
          });
          void toast({ message: t('Expense saved'), duration: 1500, position: 'top', color: 'success' });
        }}
      >
        <SelectField
          label={t('For')}
          value={category}
          options={[...categories.map((c) => ({ value: c as string, label: expenseLabel(c) })), ...(isOwner ? [{ value: NEW, label: t('+ New category') }] : [])]}
          onChange={(c) => (c === NEW ? newCategory() : setCategory(c))}
        />
        <TextField label={t('Paid to (optional)')} value={paidTo} onChange={setPaidTo} autocapitalize="words" />
        <div className="detail-actions">
          <IonButton fill="outline" size="small" onClick={() => camera.current?.click()}>
            <IonIcon icon={cameraOutline} slot="start" /> {photo ? t('Change bill photo') : t('Bill photo')}
          </IonButton>
          {photo && <img src={photo} alt="" className="thumb" />}
        </div>
        {isOwner && <ToggleRow label={t('Repeats every month (rent, salary…)')} checked={repeat} onChange={setRepeat} note={repeat ? t('It will show under Due now each month, on this day.') : undefined} />}
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setPhoto(await fileToResizedDataUrl(f, 1000, true));
          }}
        />
      </MoneyEntrySheet>
      <MoneyEntrySheet
        isOpen={!!paying}
        onClose={() => setPaying(null)}
        title={paying ? `${expenseLabel(paying.d.recurring.category)} · ${t('Due {date}', { date: dateIN(paying.date) })}` : ''}
        amount={paying?.d.recurring.amount}
        saveLabel={t('Paid')}
        onSave={async (m) => {
          await payRecurring(actor, paying!.d.recurring, paying!.date, { ...m, date: m.date || todayISO() });
          void toast({ message: t('Expense saved'), duration: 1500, position: 'top', color: 'success' });
        }}
      />
    </PageShell>
  );
}
