import { remindersDue } from '../../lib/reminders';
import { customerFromContact, pickPhoneContact } from '../../lib/phoneContacts';
import { IonBadge, IonButton, IonChip, IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSearchbar, useIonRouter, useIonToast, useIonActionSheet } from '@ionic/react';
import { groupsIn } from '../../components/GroupField';
import { formatIndianMobile } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, notificationsOutline, peopleOutline, ellipsisHorizontal } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { receivables } from '../../lib/khata';

export default function CustomersScreen() {
  const [moreSheet] = useIonActionSheet();
  const { actor, ledger, isOwner } = useBusiness();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const router = useIonRouter();
  const [toastC] = useIonToast();
  /** One contact from the phone's picker becomes a customer; without a picker, the .vcf import screen. */
  async function fromContacts() {
    try {
      const c = await pickPhoneContact();
      if (!c) return;
      const { customer, existed } = await customerFromContact(actor, c);
      void toastC({ message: existed ? t('{name} is already a customer', { name: customer.name }) : t('{name} added as a customer', { name: customer.name }), duration: 2000, position: 'top', color: existed ? 'medium' : 'success' });
      router.push(`/tabs/customers/${customer.id}`);
    } catch (e) {
      if ((e as Error).message === 'no-picker') router.push('/tabs/customers/import-contacts');
      else void toastC({ message: (e as Error).message, duration: 3000, color: 'danger' });
    }
  }
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
        <IonButton size="small" fill="clear" onClick={() => void fromContacts()}>
          <IonIcon icon={peopleOutline} slot="start" /> {t('From phone contacts')}
        </IonButton>
        <IonButton size="small" fill="clear" routerLink="/tabs/customers/reminders">
          <IonIcon icon={notificationsOutline} slot="start" /> {t('Reminders')}
          {(dueCount ?? 0) > 0 && <IonBadge color="danger">{dueCount}</IonBadge>}
        </IonButton>
        <IonButton
          size="small"
          fill="clear"
          onClick={() =>
            void moreSheet({
              buttons: [
                { text: t('Field visits'), handler: () => router.push('/tabs/customers/visits') },
                ...(isOwner ? [{ text: t('Import from Excel'), handler: () => router.push('/tabs/items/import?kind=customers') }] : []),
                { text: t('Cancel'), role: 'cancel' },
              ],
            })
          }
        >
          <IonIcon icon={ellipsisHorizontal} slot="icon-only" aria-label={t('More')} />
        </IonButton>
      </div>
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
