import { IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonActionSheet, useIonAlert, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, trendingUpOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import { SelectField, TextField } from '../../components/Fields';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { INCOME_CATEGORIES, db, type Income } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { modeLabel } from '../../lib/ledger';
import { incomeLabel, saveIncome } from '../../lib/money';
import { deleteRecord, newId, putRecord } from '../../lib/repo';
import { monthTitle, useSeesMoney } from './BankScreens';

const NEW = '__new';

/** Money that isn't from selling: interest, rent received, commission, scrap… (owner). */
export default function IncomeScreen() {
  const { actor, isOwner, settings } = useBusiness();
  const seesMoney = useSeesMoney();
  const [toast] = useIonToast();
  const [sheet] = useIonActionSheet();
  const [alert] = useIonAlert();
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState<Income['category']>('interest');
  const [from, setFrom] = useState('');
  const categories = [...INCOME_CATEGORIES, ...(settings.incomeCategories ?? [])] as Income['category'][];
  const list = useLiveQuery(
    () => db.incomes.where('[businessId+date]').between([actor.businessId, ''], [actor.businessId, '￿']).reverse().filter((e) => !e.deleted).toArray(),
    [actor.businessId],
  );
  const months = useMemo(() => {
    const m = new Map<string, Income[]>();
    for (const e of list ?? []) m.set(e.date.slice(0, 7), [...(m.get(e.date.slice(0, 7)) ?? []), e]);
    return [...m.entries()];
  }, [list]);
  if (!seesMoney) return <PageShell title={t('Other income')} backHref="/tabs/more">{t('Only the owner can see this.')}</PageShell>;

  const newCategory = () =>
    void alert({
      header: t('New category'),
      inputs: [{ name: 'name', placeholder: t('e.g. Delivery charges') }],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Add'),
          handler: (v: { name?: string }) => {
            const name = v.name?.trim();
            if (!name) return;
            if (!categories.some((c) => incomeLabel(c).toLowerCase() === name.toLowerCase())) void putRecord('settings', actor, { ...settings, incomeCategories: [...(settings.incomeCategories ?? []), name] });
            setCategory(name);
          },
        },
      ],
    });

  return (
    <PageShell title={t('Other income')} backHref="/tabs/more" padded={false}>
      {list && list.length === 0 ? (
        <EmptyState icon={trendingUpOutline} title={t('No other income yet')} text={t('Bank interest, rent you receive, commission, scrap sold: note it here so profit and the cash book are right.')} />
      ) : (
        <IonList>
          {months.map(([ym, items]) => (
            <div key={ym}>
              <IonListHeader>
                <IonLabel>{monthTitle(ym)}</IonLabel>
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
                      header: `${incomeLabel(e.category)} · ${rupees(e.amount)}`,
                      buttons: [
                        { text: t('Delete'), role: 'destructive', handler: () => void deleteRecord('incomes', actor, e.id) },
                        { text: t('Cancel'), role: 'cancel' },
                      ],
                    })
                  }
                >
                  <IonLabel>
                    <h3>
                      {incomeLabel(e.category)}
                      {e.from ? ` · ${e.from}` : ''}
                    </h3>
                    <p>
                      {dateIN(e.date)} · {modeLabel(e.mode)}
                      {e.note ? ` · ${e.note}` : ''}
                    </p>
                  </IonLabel>
                  <IonNote slot="end" className="amount-note text-success">
                    {rupees(e.amount)}
                  </IonNote>
                </IonItem>
              ))}
            </div>
          ))}
        </IonList>
      )}
      {isOwner && (
        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton
            onClick={() => {
              setFrom('');
              setAdding(true);
            }}
            aria-label={t('Add income')}
          >
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
      )}
      <MoneyEntrySheet
        isOpen={adding}
        onClose={() => setAdding(false)}
        title={t('Add income')}
        onSave={async (m) => {
          await saveIncome(actor, { id: newId(), category, from, ...m });
          void toast({ message: t('Saved'), duration: 1500, position: 'top', color: 'success' });
        }}
      >
        <SelectField
          label={t('Kind')}
          value={category}
          options={[...categories.map((c) => ({ value: c as string, label: incomeLabel(c) })), { value: NEW, label: t('+ New category') }]}
          onChange={(c) => (c === NEW ? newCategory() : setCategory(c))}
        />
        <TextField label={t('From (optional)')} value={from} onChange={setFrom} autocapitalize="words" />
      </MoneyEntrySheet>
    </PageShell>
  );
}
