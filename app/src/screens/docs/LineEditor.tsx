import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { calculateInvoice } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { FormSection, MoneyField, NumberField, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import { useBusiness } from '../../lib/business';
import { db, type DocLine, type Item } from '../../lib/db';
import { rupees } from '../../lib/format';
import { newId, putRecord } from '../../lib/repo';

export function lineFromItem(it: Item): DocLine {
  return { id: newId(), itemId: it.id, name: it.name, description: it.description, qty: 1, unit: it.unit, rate: it.rate, rateIncludesTax: it.rateIncludesTax, taxPct: it.taxPct, discount: null };
}

interface Props {
  /** null = closed; a line with empty name = new line (start with item search). */
  line: DocLine | null;
  isNew: boolean;
  onClose: () => void;
  onSave: (line: DocLine) => void;
  onDelete: (id: string) => void;
}

export default function LineEditor({ line, isNew, onClose, onSave, onDelete }: Props) {
  const { actor, settings } = useBusiness();
  const [l, setL] = useState<DocLine | null>(line);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [saveToCatalogue, setSaveToCatalogue] = useState(false);

  useEffect(() => {
    setL(line);
    setPicking(!!line && isNew && !line.name);
    setQ('');
    setSaveToCatalogue(false);
  }, [line, isNew]);

  const items = useLiveQuery(
    () =>
      db.items
        .where('[businessId+name]')
        .between([actor.businessId, ''], [actor.businessId, '￿'])
        .filter((i) => !i.deleted)
        .toArray(),
    [actor.businessId],
  );
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? (items ?? []).filter((i) => i.name.toLowerCase().includes(s)) : items ?? [];
  }, [items, q]);

  if (!l) return <IonModal isOpen={false} />;
  const set = (p: Partial<DocLine>) => setL({ ...l, ...p });
  const calc = calculateInvoice({ lines: [l], roundOff: false });
  const units = settings.units.includes(l.unit) ? settings.units : [...settings.units, l.unit];
  const rates = settings.taxRates.includes(l.taxPct) ? settings.taxRates : [...settings.taxRates, l.taxPct].sort((a, b) => a - b);
  const valid = l.name.trim() !== '' && l.qty > 0 && l.rate >= 0;

  async function done() {
    if (!l || !valid) return;
    let line = { ...l, name: l.name.trim() };
    if (saveToCatalogue && !line.itemId) {
      const item = await putRecord('items', actor, {
        id: newId(),
        name: line.name,
        description: line.description,
        unit: line.unit,
        rate: line.rate,
        rateIncludesTax: line.rateIncludesTax,
        taxPct: line.taxPct,
      });
      line = { ...line, itemId: item.id };
    }
    onSave(line);
  }

  return (
    <IonModal isOpen={!!line} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>{picking ? 'Choose item' : isNew ? 'Add item' : 'Edit item'}</IonTitle>
          {!picking && (
            <IonButtons slot="end">
              <IonButton strong disabled={!valid} onClick={() => void done()}>
                Done
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
        {picking && (
          <IonToolbar>
            <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder="Search catalogue or type a new item" />
          </IonToolbar>
        )}
      </IonHeader>
      <IonContent className={picking ? undefined : 'ion-padding'}>
        {picking ? (
          <IonList>
            <IonItem
              button
              detail={false}
              onClick={() => {
                set({ name: q.trim(), unit: settings.units[0] ?? 'pcs', taxPct: settings.defaultTaxPct });
                setSaveToCatalogue(!!q.trim());
                setPicking(false);
              }}
            >
              <IonLabel color="primary">{q.trim() ? `Use "${q.trim()}" (new item)` : 'Type an item not in the catalogue'}</IonLabel>
            </IonItem>
            {matches.map((it) => (
              <IonItem
                key={it.id}
                button
                detail={false}
                onClick={() => {
                  setL({ ...lineFromItem(it), id: l.id });
                  setPicking(false);
                }}
              >
                <IonLabel>
                  <h2>{it.name}</h2>
                  <p>
                    per {it.unit} · tax {it.taxPct}%{it.rateIncludesTax ? ' incl.' : ''}
                  </p>
                </IonLabel>
                <IonNote slot="end">{rupees(it.rate)}</IonNote>
              </IonItem>
            ))}
          </IonList>
        ) : (
          <>
            <FormSection>
              <TextField label="Item" required value={l.name} onChange={(name) => set({ name })} />
              <TextArea label="Description" value={l.description} onChange={(description) => set({ description })} />
              <div className="field-row">
                <NumberField label="Quantity" value={l.qty} onChange={(qty) => set({ qty: qty ?? 0 })} min={0} />
                <SelectField label="Unit" value={l.unit} options={units.map((u) => ({ value: u, label: u }))} onChange={(unit) => set({ unit })} />
              </div>
              <div className="field-row">
                <MoneyField label={l.rateIncludesTax ? 'Rate (incl. tax)' : 'Rate'} value={l.rate} onChange={(rate) => set({ rate: rate ?? 0 })} />
                <SelectField label="Tax %" value={l.taxPct} options={rates.map((r) => ({ value: r, label: `${r}%` }))} onChange={(taxPct) => set({ taxPct })} />
              </div>
              <ToggleRow label="Rate includes tax" checked={l.rateIncludesTax} onChange={(rateIncludesTax) => set({ rateIncludesTax })} />
            </FormSection>

            <FormSection title="Discount on this item">
              <IonSegment
                value={l.discount?.type ?? 'pct'}
                onIonChange={(e) => set({ discount: { type: e.detail.value as 'pct' | 'amount', value: 0 } })}
              >
                <IonSegmentButton value="pct">
                  <IonLabel>%</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="amount">
                  <IonLabel>₹</IonLabel>
                </IonSegmentButton>
              </IonSegment>
              {(l.discount?.type ?? 'pct') === 'pct' ? (
                <NumberField label="Discount %" value={l.discount?.value || null} onChange={(v) => set({ discount: v ? { type: 'pct', value: v } : null })} min={0} max={100} suffix="%" />
              ) : (
                <MoneyField label="Discount ₹ (whole line)" value={l.discount?.value || null} onChange={(v) => set({ discount: v ? { type: 'amount', value: v } : null })} />
              )}
            </FormSection>

            {!l.itemId && <ToggleRow label="Save this item to my catalogue" checked={saveToCatalogue} onChange={setSaveToCatalogue} />}

            <div className="line-preview">
              <div>
                <span>Before tax</span>
                <strong>{rupees(calc.taxableAmount)}</strong>
              </div>
              <div>
                <span>Tax</span>
                <strong>{rupees(calc.taxTotal)}</strong>
              </div>
              <div>
                <span>Amount</span>
                <strong>{rupees(calc.taxableAmount + calc.taxTotal)}</strong>
              </div>
            </div>

            {!isNew && (
              <IonButton color="danger" fill="clear" expand="block" onClick={() => onDelete(l.id)}>
                Remove item from invoice
              </IonButton>
            )}
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
