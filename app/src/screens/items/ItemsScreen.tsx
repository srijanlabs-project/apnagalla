import { IonButton, IonChip, IonFab, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSearchbar, IonThumbnail, useIonActionSheet, useIonRouter } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, chevronBackOutline, cubeOutline, chevronDownOutline } from 'ionicons/icons';
import { useMemo, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { priceListTable } from '../../lib/catalogShare';
import { shareTable } from '../../lib/exportTable';
import { levelLabel } from '../../lib/pricing';
import { db } from '../../lib/db';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { flattenCategories, useCategories, withDescendants } from '../../lib/categories';
import { isLow, qtyText, stockLevels, tracksStock } from '../../lib/stock';

export default function ItemsScreen() {
  const router = useIonRouter();
  const { actor, isOwner, profile } = useBusiness();
  const [sheet] = useIonActionSheet();
  const sharePriceList = () =>
    void sheet({
      header: t('Share price list'),
      buttons: [
        ...(['retail', 'wholesale', 'special'] as const).flatMap((level) =>
          (['pdf', 'excel'] as const).map((as) => ({
            text: `${levelLabel(level)} · ${as === 'pdf' ? 'PDF' : 'Excel'}`,
            handler: () => void priceListTable(actor.businessId, { level, storeName: profile.name }).then((tbl) => shareTable(actor.businessId, tbl, as)),
          })),
        ),
        { text: t('Cancel'), role: 'cancel' },
      ],
    });
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
  const hasSerials = (items ?? []).some((i) => i.trackSerial);
  const lowCount = useMemo(() => (items ?? []).filter((i) => isLow(i, stock?.get(i.id) ?? 0)).length, [items, stock]);
  const [negOnly, setNegOnly] = useState(false);
  const negCount = useMemo(() => (items ?? []).filter((i) => tracksStock(i) && (stock?.get(i.id) ?? 0) < 0).length, [items, stock]);
  // Less-used item pages in one sheet, so the row above the list never runs off the screen.
  const openTools = () =>
    void sheet({
      header: t('Tools'),
      buttons: [
        { text: t('Labels'), handler: () => router.push('/tabs/items/labels') },
        ...(hasSerials ? [{ text: t('Find serial / IMEI'), handler: () => router.push('/tabs/items/serials') }] : []),
        ...(isOwner
          ? [
              { text: t('Categories'), handler: () => router.push('/tabs/items/categories') },
              { text: t('Import'), handler: () => router.push('/tabs/items/import') },
              { text: t('Change prices'), handler: () => router.push('/tabs/items/bulk-price') },
              { text: t('Price list'), handler: () => sharePriceList() },
              { text: t('Offers'), handler: () => router.push('/tabs/items/offers') },
              { text: t('Today’s rates'), handler: () => router.push('/tabs/items/rates') },
              { text: t('Wastage'), handler: () => router.push('/tabs/items/wastage') },
              { text: t('Recipes'), handler: () => router.push('/tabs/items/recipes') },
            ]
          : []),
        { text: t('Cancel'), role: 'cancel' },
      ],
    });
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const inCat = catId ? withDescendants(catId, cats) : null;
    // Variants show under their group, unless searched for.
    return (items ?? []).filter(
      (i) =>
        (!negOnly || (tracksStock(i) && (stock?.get(i.id) ?? 0) < 0)) &&
        (!inCat || (i.categoryId && inCat.has(i.categoryId))) &&
        (s ? i.name.toLowerCase().includes(s) || i.code?.toLowerCase() === s || i.barcode === s : !i.variantOf),
    );
  }, [items, q, catId, cats, negOnly, stock]);

  return (
    <PageShell
      title={t('Items')}
      padded={false}
      headerEnd={
        <IonButton onClick={openTools}>
          {t('Tools')} <IonIcon icon={chevronDownOutline} slot="end" />
        </IonButton>
      }
    >
      <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search name, code or barcode')} />
      {/* One row of filters that wraps: category, then the problems (negative, low) as filters too. */}
      <div className="filter-chips wrap item-filters">
        <IonChip outline={!!catId || negOnly} color={!catId && !negOnly ? 'primary' : undefined} onClick={() => (setCatId(null), setNegOnly(false))}>
          {t('All')}
        </IonChip>
        {current && (
          <IonChip color="primary" onClick={() => setCatId(current.parentId ?? null)}>
            <IonIcon icon={chevronBackOutline} />
            <IonLabel>{paths.get(current.id)}</IonLabel>
          </IonChip>
        )}
        {children.map((c) => (
          <IonChip key={c.id} outline onClick={() => setCatId(c.id)}>
            {c.name}
          </IonChip>
        ))}
        {(negCount > 0 || negOnly) && (
          <IonChip outline={!negOnly} color="danger" onClick={() => setNegOnly(!negOnly)}>
            {t('Negative stock ({n})', { n: negCount })}
          </IonChip>
        )}
        {lowCount > 0 && (
          <IonChip outline color="warning" className="chip-warn" onClick={() => router.push("/tabs/items/low-stock")}>
            {t('Low on stock ({n})', { n: lowCount })}
          </IonChip>
        )}
      </div>
      {items && items.length === 0 ? (
        <EmptyState icon={cubeOutline} title={t('No items yet')} text={t('Save your products and services with their price and tax, then pick them while billing.')} />
      ) : (
        <IonList>
          {filtered.map((i) => (
            <IonItem key={i.id} routerLink={`/tabs/items/${i.id}`} detail={false}>
              {i.photo && (
                <IonThumbnail slot="start">
                  <img src={i.photo} alt="" />
                </IonThumbnail>
              )}
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
        <IonButton routerLink="/tabs/items/new" className="fab-new">
          <IonIcon icon={add} slot="start" /> {t('New item')}
        </IonButton>
      </IonFab>
    </PageShell>
  );
}
