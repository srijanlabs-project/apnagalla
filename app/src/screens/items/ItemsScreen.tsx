import { IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSearchbar } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, cubeOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { rupees } from '../../lib/format';

export default function ItemsScreen() {
  const { actor } = useBusiness();
  const [q, setQ] = useState('');
  const items = useLiveQuery(
    () =>
      db.items
        .where('[businessId+name]')
        .between([actor.businessId, ''], [actor.businessId, '￿'])
        .filter((i) => !i.deleted)
        .toArray(),
    [actor.businessId],
  );
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? (items ?? []).filter((i) => i.name.toLowerCase().includes(s)) : items ?? [];
  }, [items, q]);

  return (
    <PageShell title="Items" padded={false}>
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder="Search items" />
      {items && items.length === 0 ? (
        <EmptyState icon={cubeOutline} title="No items yet" text="Save your products and services with their price and tax, then pick them while billing." />
      ) : (
        <IonList>
          {filtered.map((i) => (
            <IonItem key={i.id} routerLink={`/tabs/items/${i.id}`} detail={false}>
              <IonLabel>
                <h2>{i.name}</h2>
                <p>
                  per {i.unit} · tax {i.taxPct}%{i.rateIncludesTax ? ' incl.' : ''}
                </p>
              </IonLabel>
              <IonNote slot="end" className="amount-note">
                {rupees(i.rate)}
              </IonNote>
            </IonItem>
          ))}
        </IonList>
      )}
      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton routerLink="/tabs/items/new" aria-label="Add item">
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>
    </PageShell>
  );
}
