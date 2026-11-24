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
import { AREA_UNIT, areaQty, calculateInvoice, checkHsn, type AreaPricing } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { FormSection, MoneyField, NumberField, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import { useBusiness } from '../../lib/business';
import { db, type DocLine, type Item } from '../../lib/db';
import { isAreaLine, lineSize, rupees } from '../../lib/format';
import { newId, putRecord } from '../../lib/repo';
import { sync } from '../../lib/sync';

export function lineFromItem(it: Item): DocLine {
  const area = it.pricing === 'sqft' || it.pricing === 'rft';
  return {
    id: newId(),
    itemId: it.id,
    name: it.name,
    description: it.description,
    // Area-priced: the size is entered next, which gives the quantity.
    qty: area ? 0 : 1,
    unit: area ? AREA_UNIT[it.pricing as AreaPricing] : it.unit,
    rate: it.rate,
    rateIncludesTax: it.rateIncludesTax,
    taxPct: it.taxPct,
    hsn: it.hsn,
    discount: null,
    pricing: it.pricing,
    dims: area ? { length: 0, width: 0, pieces: 1, in: 'ft' } : null,
  };
}



interface Props {
  /** null = closed; a line with empty name = new line (start with item search). */
  line: DocLine | null;
  isNew: boolean;
  /** Bill without GST: hide tax and HSN, since no tax is charged. */
  noTax?: boolean;
  onClose: () => void;
  onSave: (line: DocLine) => void;
  onDelete: (id: string) => void;
}

export default function LineEditor({ line, isNew, noTax, onClose, onSave, onDelete }: Props) {
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
  const set = (p: Partial<DocLine>) => setL((cur) => (cur ? { ...cur, ...p } : cur));
  const area = isAreaLine(l);
  const pricing = (l.pricing ?? 'unit') as 'unit' | AreaPricing;
  /** Changing the size recomputes the quantity. */
  const setDims = (p: Partial<NonNullable<DocLine['dims']>>) =>
    setL((cur) => {
      if (!cur?.dims) return cur;
      const dims = { ...cur.dims, ...p };
      return { ...cur, dims, qty: areaQty(dims, cur.pricing as AreaPricing) };
    });
  const setPricing = (next: 'unit' | AreaPricing) =>
    setL((cur) =>
      cur
        ? next === 'unit'
          ? { ...cur, pricing: 'unit', dims: null, qty: cur.qty || 1 }
          : { ...cur, pricing: next, unit: AREA_UNIT[next], dims: cur.dims ?? { length: 0, width: 0, pieces: 1, in: 'ft' }, qty: areaQty(cur.dims ?? { length: 0, width: 0, pieces: 1, in: 'ft' }, next) }
        : cur,
    );
  const calc = calculateInvoice({ lines: [noTax ? { ...l, taxPct: 0, rateIncludesTax: false } : l], roundOff: false });
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
        hsn: line.hsn,
        pricing: line.pricing,
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
              {(settings.areaBilling || area) && (
                <SelectField
                  label="Charge by"
                  value={pricing}
                  options={[
                    { value: 'unit', label: 'Quantity' },
                    { value: 'sqft', label: 'Area (sq ft)' },
                    { value: 'rft', label: 'Length (running ft)' },
                  ]}
                  onChange={setPricing}
                />
              )}
              {area ? (
                <>
                  <div className="field-row">
                    <NumberField label={`Length (${l.dims!.in})`} value={l.dims!.length || null} onChange={(length) => setDims({ length: length ?? 0 })} min={0} />
                    {pricing === 'sqft' && <NumberField label={`Width (${l.dims!.in})`} value={l.dims!.width || null} onChange={(width) => setDims({ width: width ?? 0 })} min={0} />}
                  </div>
                  <div className="field-row">
                    <NumberField label="Pieces" value={l.dims!.pieces} onChange={(pieces) => setDims({ pieces: pieces ?? 1 })} min={1} />
                    <SelectField
                      label="Measured in"
                      value={l.dims!.in}
                      options={[
                        { value: 'ft' as const, label: 'Feet' },
                        { value: 'in' as const, label: 'Inches' },
                      ]}
                      onChange={(unitIn) => setDims({ in: unitIn })}
                    />
                  </div>
                  <p className="section-note">{lineSize(l)}</p>
                </>
              ) : (
                <div className="field-row">
                  <NumberField label="Quantity" value={l.qty} onChange={(qty) => set({ qty: qty ?? 0 })} min={0} />
                  <SelectField label="Unit" value={l.unit} options={units.map((u) => ({ value: u, label: u }))} onChange={(unit) => set({ unit })} />
                </div>
              )}
              {noTax ? (
                <MoneyField label={area ? `Rate per ${l.unit}` : 'Rate'} value={l.rate} onChange={(rate) => set({ rate: rate ?? 0 })} />
              ) : (
                <>
                  <div className="field-row">
                    <MoneyField label={`${area ? `Rate per ${l.unit}` : 'Rate'}${l.rateIncludesTax ? ' (incl. tax)' : ''}`} value={l.rate} onChange={(rate) => set({ rate: rate ?? 0 })} />
                    <SelectField label="Tax %" value={l.taxPct} options={rates.map((r) => ({ value: r, label: `${r}%` }))} onChange={(taxPct) => set({ taxPct })} />
                  </div>
                  <div className="field-row">
                    <TextField
                      label="HSN / SAC"
                      value={l.hsn}
                      onChange={(hsn) => set({ hsn: hsn.replace(/\D/g, '') || undefined })}
                      inputmode="numeric"
                      maxlength={8}
                      error={l.hsn && !checkHsn(l.hsn) ? '4, 6 or 8 digits' : null}
                    />
                    <ToggleRow label="Rate includes tax" checked={l.rateIncludesTax} onChange={(rateIncludesTax) => set({ rateIncludesTax })} />
                  </div>
                </>
              )}
            </FormSection>

            <FormSection title="Discount on this item">
              <IonSegment
                value={l.discount?.type ?? 'pct'}
                onIonChange={sync((e) => set({ discount: { type: e.detail.value as 'pct' | 'amount', value: 0 } }))}
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
              {!noTax && (
                <>
                  <div>
                    <span>Before tax</span>
                    <strong>{rupees(calc.taxableAmount)}</strong>
                  </div>
                  <div>
                    <span>Tax</span>
                    <strong>{rupees(calc.taxTotal)}</strong>
                  </div>
                </>
              )}
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
