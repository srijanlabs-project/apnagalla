import { IonItem, IonLabel, IonList, IonNote } from '@ionic/react';
import { itemFieldsFrom } from '../../lib/catalog';
import CatalogSuggestions from '../../components/CatalogSuggestions';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { newId } from '../../lib/repo';
import { qtyForAmount } from '../../lib/fresh';
import { lineFromItem } from '../docs/LineEditor';
import type { SaleCtx } from './saleTypes';

/** What matches the search: items, "₹20 of …", sell something not in the catalogue, catalogue suggestions. */
export default function SearchResults({ c }: { c: SaleCtx }) {
  const { q, setQ, matches, byAmount, addItem, addForAmount, setEditing, settings, perms, level, custom } = c;
  return (
    <>
            <IonList>
              {byAmount?.found.map((it) => {
                const line = lineFromItem(it, level, custom);
                const qty = qtyForAmount(byAmount.amount, line.rate, line.taxPct, line.rateIncludesTax);
                return (
                  <IonItem key={`amt-${it.id}`} button detail={false} onClick={() => addForAmount(it, byAmount.amount)}>
                    <IonLabel>
                      <h2>{t('{amount} of {item}', { amount: rupees(byAmount.amount), item: it.name })}</h2>
                      <p>{t('{qty} {unit} at {rate} per {unit}', { qty, unit: it.unit, rate: rupees(line.rate) })}</p>
                    </IonLabel>
                  </IonItem>
                );
              })}
              {matches.map((it) => (
                <IonItem key={it.id} button detail={false} onClick={() => addItem(it)}>
                  <IonLabel>
                    <h2>{it.name}</h2>
                    <p>{t('per {unit}', { unit: it.unit })}</p>
                  </IonLabel>
                  <IonNote slot="end">{rupees(it.rate)}</IonNote>
                </IonItem>
              ))}
              <IonItem
                button
                detail={false}
                onClick={() => {
                  setEditing({
                    line: { id: newId(), name: q.trim(), qty: 1, unit: settings.units[0] ?? 'pcs', rate: 0, rateIncludesTax: true, taxPct: settings.defaultTaxPct },
                    isNew: true,
                  });
                  setQ('');
                }}
              >
                <IonLabel color="primary">{t('+ Sell "{name}" (not in the catalogue)', { name: q.trim() })}</IonLabel>
              </IonItem>
              {matches.length < 5 && (
                <CatalogSuggestions
                  query={q}
                  limit={5}
                  exclude={matches.map((m) => m.name)}
                  onPick={(row) => {
                    const f = itemFieldsFrom(row, settings.defaultTaxPct, settings.units);
                    setEditing({
                      line: { id: newId(), name: f.name!, qty: 1, unit: f.unit!, rate: 0, rateIncludesTax: true, taxPct: f.taxPct!, hsn: f.hsn },
                      isNew: true,
                      saveNew: perms.access === 'full',
                    });
                    setQ('');
                  }}
                />
              )}
            </IonList>

    </>
  );
}
