import { remindersDue } from '../../lib/reminders';
import { IonBadge, IonButton, IonChip, IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSearchbar } from '@ionic/react';
import { groupsIn } from '../../components/GroupField';
import { formatIndianMobile } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, cloudUploadOutline, locationOutline, notificationsOutline, peopleOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { receivables } from '../../lib/khata';

export default function CustomersScreen() {
  const { actor, ledger, isOwner } = useBusiness();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const { settings } = useBusiness();
  const dueCount = useLiveQuery(async () => (await remindersDue(actor.businessId, settings)).length, [actor.businessId, settings, ledger]);
  const customers = useLiveQuery(
    () =>
      db.customers
        .where('[businessId+name]')
        .between([actor.businessId, ''], [actor.businessId, '￿'])
        .filter((c) => !c.deleted)
        .toArray(),
    [actor.businessId],
  );
  // Khata balance: bills, returns, payments on bills and on account, opening balance.
  const owed = useLiveQuery(async () => new Map((await receivables(actor.businessId)).map((r) => [r.customer.id, r.balance])), [actor.businessId, ledger]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = customers ?? [];
    return list.filter((c) => (!group || c.group === group) && (!s || c.name.toLowerCase().includes(s) || (c.phone ?? '').includes(s)));
  }, [customers, q, group]);
  const groups = groupsIn(customers);

  return (
    <PageShell title={t('Customers')} padded={false}>
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search name or phone')} />
      {groups.length > 0 && (
        <div className="filter-chips">
          <IonChip outline={!!group} color={!group ? 'primary' : undefined} onClick={() => setGroup(null)}>
            {t('All')}
          </IonChip>
          {groups.map((g) => (
            <IonChip key={g} outline={group !== g} color={group === g ? 'primary' : undefined} onClick={() => setGroup(group === g ? null : g)}>
              {g}
            </IonChip>
          ))}
        </div>
      )}
      <div className="filter-chips">
        <IonButton size="small" fill="clear" routerLink="/tabs/customers/visits">
          <IonIcon icon={locationOutline} slot="start" /> {t('Field visits')}
        </IonButton>
        <IonButton size="small" fill="clear" routerLink="/tabs/customers/reminders">
          <IonIcon icon={notificationsOutline} slot="start" /> {t('Payment reminders')}
          {(dueCount ?? 0) > 0 && <IonBadge color="danger">{dueCount}</IonBadge>}
        </IonButton>
      </div>
      {isOwner && (
        <div className="filter-chips">
          <IonButton size="small" fill="clear" routerLink="/tabs/customers/import-contacts">
            <IonIcon icon={peopleOutline} slot="start" /> {t('From phone contacts')}
          </IonButton>
          <IonButton size="small" fill="clear" routerLink="/tabs/items/import?kind=customers">
            <IonIcon icon={cloudUploadOutline} slot="start" /> {t('Import from Excel')}
          </IonButton>
        </div>
      )}
      {customers && customers.length === 0 ? (
        <EmptyState icon={peopleOutline} title={t('No customers yet')} text={t('Add customers here, or directly while creating an invoice.')} />
      ) : (
        <IonList>
          {filtered.map((c) => {
            const pending = owed?.get(c.id) ?? 0;
            return (
              <IonItem key={c.id} routerLink={`/tabs/customers/${c.id}`} detail={false}>
                <div className="avatar" slot="start">
                  {c.name.slice(0, 1).toUpperCase()}
                </div>
                <IonLabel>
                  <h2>{c.name}</h2>
                  <p>{c.phone ? formatIndianMobile(c.phone) : c.billingAddress.city ?? ''}</p>
                </IonLabel>
                {pending > 0 && (
                  <IonNote slot="end" color="danger" className="amount-note">
                    {rupees(pending)}
                    <br />
                    <small>{t('pending')}</small>
                  </IonNote>
                )}
              </IonItem>
            );
          })}
        </IonList>
      )}
      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton routerLink="/tabs/customers/new" aria-label={t('Add customer')}>
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>
    </PageShell>
  );
}
