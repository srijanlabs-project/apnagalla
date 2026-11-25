import { IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonActionSheet, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, walletOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import { SelectField } from '../../components/Fields';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { EXPENSE_CATEGORIES, db, type Expense, type ExpenseCategory } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { modeLabel } from '../../lib/ledger';
import { expenseLabel, saveExpense } from '../../lib/purchases';
import { deleteRecord, newId } from '../../lib/repo';

const monthName = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

/** Shop expenses: rent, salary, electricity… Anyone adds (petty cash); only the owner removes. */
export default function ExpensesScreen() {
  const { actor, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const [sheet] = useIonActionSheet();
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory>('tea');
  const list = useLiveQuery(
    () => db.expenses.where('[businessId+date]').between([actor.businessId, ''], [actor.businessId, '￿']).reverse().filter((e) => !e.deleted).toArray(),
    [actor.businessId],
  );
  const months = useMemo(() => {
    const m = new Map<string, Expense[]>();
    for (const e of list ?? []) {
      const k = e.date.slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [list]);

  return (
    <PageShell title={t('Expenses')} backHref="/tabs/more" padded={false}>
      {list && list.length === 0 ? (
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
                  button={isOwner}
                  detail={false}
                  onClick={() =>
                    isOwner &&
                    void sheet({
                      header: `${expenseLabel(e.category)} · ${rupees(e.amount)}`,
                      buttons: [
                        { text: t('Delete'), role: 'destructive', handler: () => void deleteRecord('expenses', actor, e.id) },
                        { text: t('Cancel'), role: 'cancel' },
                      ],
                    })
                  }
                >
                  <IonLabel>
                    <h3>{expenseLabel(e.category)}</h3>
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
      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton onClick={() => setAdding(true)} aria-label={t('Add expense')}>
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>
      <MoneyEntrySheet
        isOpen={adding}
        onClose={() => setAdding(false)}
        title={t('Add expense')}
        onSave={async (m) => {
          await saveExpense(actor, { id: newId(), businessId: actor.businessId, createdAt: '', updatedAt: '', updatedBy: '', category, ...m });
          void toast({ message: t('Expense saved'), duration: 1500, position: 'top', color: 'success' });
        }}
      >
        <SelectField label={t('For')} value={category} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: expenseLabel(c) }))} onChange={setCategory} />
      </MoneyEntrySheet>
    </PageShell>
  );
}
