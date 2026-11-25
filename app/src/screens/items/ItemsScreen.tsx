import { IonButton, IonChip, IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSearchbar } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, alertCircleOutline, chevronBackOutline, cloudUploadOutline, cubeOutline, folderOpenOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { flattenCategories, useCategories, withDescendants } from '../../lib/categories';
import { isLow, qtyText, stockLevels, tracksStock } from '../../lib/stock';

export default function ItemsScreen() {
  const { actor, isOwner } = useBusiness();
  const [q, setQ] = useState('');
  const [catId, setCatId] = useState<string | null>(null);
  const cats = useCategories(actor.businessId);
  const paths = useMemo(() => new Map(flattenCategories(cats).map((n) => [n.cat.id, n.path])), [cats]);
  const current = cats.find((c) => c.id === catId);
  const children = cats.filter((c) => (c.parentId ?? null) === (catId ?? null)).sort((a, b) => a.name.localeCompare(b.name));
  const items = useLiveQuery(
    () =>
      db.items
        .where('[businessId+name]')
        .between([actor.businessId, ''], [actor.businessId, '￿'])
        .filter((i) => !i.deleted)
        .toArray(),
    [actor.businessId],
  );
  const stock = useLiveQuery(() => stockLevels(actor.businessId), [actor.businessId]);
  const lowCount = useMemo(() => (items ?? []).filter((i) => isLow(i, stock?.get(i.id) ?? 0)).length, [items, stock]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const inCat = catId ? withDescendants(catId, cats) : null;
    // Variants show under their group, unless searched for.
    return (items ?? []).filter(
      (i) =>
        (!inCat || (i.categoryId && inCat.has(i.categoryId))) &&
        (s ? i.name.toLowerCase().includes(s) || i.code?.toLowerCase() === s || i.barcode === s : !i.variantOf),
    );
  }, [items, q, catId, cats]);

  return (
    <PageShell title={t('Items')} padded={false}>
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search name, code or barcode')} />
      {lowCount > 0 && (
        <IonItem routerLink="/tabs/items/low-stock" detail lines="full" color="warning">
          <IonIcon icon={alertCircleOutline} slot="start" />
          <IonLabel>{t('{count} items low on stock', { count: lowCount })}</IonLabel>
        </IonItem>
      )}
      {(cats.length > 0 || isOwner) && (
        <div className="filter-chips">
          {current && (
            <IonChip onClick={() => setCatId(current.parentId ?? null)}>
              <IonIcon icon={chevronBackOutline} />
              <IonLabel>{paths.get(current.id)}</IonLabel>
            </IonChip>
          )}
          {children.map((c) => (
            <IonChip key={c.id} outline onClick={() => setCatId(c.id)}>
              {c.name}
            </IonChip>
          ))}
          {isOwner && (
            <>
              <IonButton size="small" fill="clear" routerLink="/tabs/items/categories">
                <IonIcon icon={folderOpenOutline} slot="start" /> {t('Categories')}
              </IonButton>
              <IonButton size="small" fill="clear" routerLink="/tabs/items/import">
                <IonIcon icon={cloudUploadOutline} slot="start" /> {t('Import')}
              </IonButton>
            </>
          )}
        </div>
      )}
      {items && items.length === 0 ? (
        <EmptyState icon={cubeOutline} title={t('No items yet')} text={t('Save your products and services with their price and tax, then pick them while billing.')} />
      ) : (
        <IonList>
          {filtered.map((i) => (
            <IonItem key={i.id} routerLink={`/tabs/items/${i.id}`} detail={false}>
              <IonLabel>
                <h2>{i.name}</h2>
                <p>
                  {i.code ? `${i.code} · ` : ''}
                  {i.rateIncludesTax ? t('per {unit} · tax {taxPct}% incl.', { unit: i.unit, taxPct: i.taxPct }) : t('per {unit} · tax {taxPct}%', { unit: i.unit, taxPct: i.taxPct })}
                  {i.categoryId && !catId && paths.get(i.categoryId) ? ` · ${paths.get(i.categoryId)}` : ''}
                </p>
              </IonLabel>
              <IonNote slot="end" className="amount-note">
                {rupees(i.rate)}
                {i.hasVariants && stock && (
                  <span className="stock-qty">
                    {t('{count} variants · stock {qty}', {
                      count: (items ?? []).filter((v) => v.variantOf === i.id).length,
                      qty: qtyText((items ?? []).filter((v) => v.variantOf === i.id).reduce((a, v) => a + (stock.get(v.id) ?? 0), 0)),
                    })}
                  </span>
                )}
                {tracksStock(i) && stock && (
                  <span className={`stock-qty${(stock.get(i.id) ?? 0) < 0 || isLow(i, stock.get(i.id) ?? 0) ? ' text-danger' : ''}`}>
                    {t('Stock {qty}', { qty: qtyText(stock.get(i.id) ?? 0) })}
                  </span>
                )}
              </IonNote>
            </IonItem>
          ))}
        </IonList>
      )}
      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton routerLink="/tabs/items/new" aria-label={t('Add item')}>
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>
    </PageShell>
  );
}
