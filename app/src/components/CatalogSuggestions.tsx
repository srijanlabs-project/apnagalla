import { IonButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonList, IonListHeader, IonModal, IonNote, IonTitle, IonToolbar, useIonToast } from '@ionic/react';
import type { CatalogItemDto } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useBusiness } from '../lib/business';
import { addItemFromCatalog, catalogIndex, searchCatalog, VERSION_KEY, type CatalogIndexEntry } from '../lib/catalog';
import { db, type Item } from '../lib/db';
import { t } from '../lib/i18n';
import { FormSection, MoneyField, ToggleRow } from './Fields';

/** Products from the shared list matching `query` (for the store's sections; [] when off). */
export function useCatalogMatches(query: string, limit = 8): CatalogIndexEntry[] {
  const { settings } = useBusiness();
  const sections = settings.catalogSuggest === false ? [] : (settings.catalogSections ?? []);
  const version = useLiveQuery(async () => (await db.meta.get(VERSION_KEY))?.value ?? 0, []);
  const [out, setOut] = useState<CatalogIndexEntry[]>([]);
  const key = sections.join(',');
  useEffect(() => {
    let live = true;
    const q = query.trim();
    if (q.length < 2 || !sections.length) {
      setOut([]);
      return;
    }
    void catalogIndex(sections).then((index) => live && setOut(index ? searchCatalog(index, q, limit) : []));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, key, version, limit]);
  return out;
}

/** "From the product list" rows; `exclude` hides names the shop already has. */
export default function CatalogSuggestions({ query, onPick, exclude = [], limit }: { query: string; onPick: (row: CatalogItemDto) => void; exclude?: string[]; limit?: number }) {
  const matches = useCatalogMatches(query, limit);
  const have = new Set(exclude.map((n) => n.trim().toLowerCase()));
  const list = matches.filter((m) => !have.has(m.name.toLowerCase()));
  if (!list.length) return null;
  return (
    <IonList>
      <IonListHeader>
        <IonLabel>{t('From the product list')}</IonLabel>
      </IonListHeader>
      {list.map((m) => (
        <IonItem key={m.row.id} button detail={false} onClick={() => onPick(m.row)}>
          <IonLabel>
            <h3>{m.name}</h3>
            <p>
              {m.row.category}
              {m.row.hsn ? ` · HSN ${m.row.hsn}` : ''}
              {m.row.gstPct != null ? ` · GST ${m.row.gstPct}%` : ''}
            </p>
          </IonLabel>
          <IonNote slot="end">{t('Add')}</IonNote>
        </IonItem>
      ))}
    </IonList>
  );
}

/** Asks the price for a product and adds it to the shop's items (billing, purchases). */
export function AddFromCatalogSheet({ row, onClose, onAdded, askCost }: { row: CatalogItemDto | null; onClose: () => void; onAdded: (item: Item) => void; askCost?: boolean }) {
  const { actor, settings, perms } = useBusiness();
  const [toast] = useIonToast();
  const [rate, setRate] = useState<number | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [incl, setIncl] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (row) {
      setRate(null);
      setCost(null);
      setIncl(true);
    }
  }, [row]);
  const canAdd = perms.access === 'full';

  return (
    <IonModal isOpen={!!row} onDidDismiss={onClose} initialBreakpoint={0.75} breakpoints={[0, 0.75, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('Add to my items')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>{t('Cancel')}</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {row && (
          <>
            <h3>{row.brand ? `${row.brand} ` : ''}{row.item}{row.size ? ` ${row.size} ${row.sizeUnit ?? ''}` : ''}</h3>
            <p className="section-note">
              {row.category} · {t('per {unit}', { unit: row.sellUnit })}
              {row.hsn ? ` · HSN ${row.hsn}` : ''}
              {row.gstPct != null ? ` · GST ${row.gstPct}%` : ''}
            </p>
            <FormSection>
              <MoneyField label={t('Selling price')} value={rate} onChange={setRate} />
              <ToggleRow label={t('Price includes GST')} checked={incl} onChange={setIncl} />
              {askCost && perms.seeCost && <MoneyField label={t('Purchase price')} value={cost} onChange={setCost} />}
            </FormSection>
            <IonButton
              expand="block"
              disabled={busy || !canAdd}
              onClick={async () => {
                setBusy(true);
                try {
                  const item = await addItemFromCatalog(actor, row, { rate: rate ?? 0, purchasePrice: cost, rateIncludesTax: incl, defaultTaxPct: settings.defaultTaxPct, units: settings.units });
                  onAdded(item);
                  onClose();
                } catch (e) {
                  void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('Add and use')}
            </IonButton>
            <p className="section-note">{t('It is saved in your items with your price; you can change it any time.')}</p>
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
