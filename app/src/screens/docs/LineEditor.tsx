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
import { AREA_UNIT, areaQty, calculateInvoice, checkHsn, defaultSizeUnit, isAreaOf, isAreaPricing, type AreaPricing, type SizeUnit } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { FormSection, MoneyField, NumberField, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import { useBusiness } from '../../lib/business';
import { db, type DocLine, type Item, type PriceLevel } from '../../lib/db';
import { priceFor, sellable, unitOptions } from '../../lib/pricing';
import { serialsInStock } from '../../lib/serials';
import { OFF } from '../../lib/offers';
import { t } from '../../lib/i18n';
import { isAreaLine, lineSize, rupees } from '../../lib/format';
import { newId, putRecord } from '../../lib/repo';
import { sync } from '../../lib/sync';

export function lineFromItem(it: Item, level: PriceLevel = 'retail'): DocLine {
  const area = isAreaPricing(it.pricing);
  return {
    id: newId(),
    itemId: it.id,
    name: it.name,
    description: it.description,
    // Area-priced: the size is entered next, which gives the quantity.
    qty: area ? 0 : 1,
    unit: area ? AREA_UNIT[it.pricing as AreaPricing] : it.unit,
    rate: priceFor(it, level),
    rateIncludesTax: it.rateIncludesTax,
    taxPct: it.taxPct,
    hsn: it.hsn,
    discount: null,
    pricing: it.pricing,
    dims: area ? { length: 0, width: 0, pieces: 1, in: defaultSizeUnit(it.pricing as AreaPricing) } : null,
    mrp: it.mrp,
    warrantyMonths: it.warrantyMonths ?? undefined,
    nonReturnable: it.nonReturnable || undefined,
    serials: it.trackSerial ? [] : undefined,
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
  /** The customer's price type (wholesale / special prices). */
  level?: PriceLevel;
}

export default function LineEditor({ line, isNew, noTax, onClose, onSave, onDelete, level = 'retail' }: Props) {
  const { actor, settings, perms } = useBusiness();
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
        .filter(sellable)
        .toArray(),
    [actor.businessId],
  );
  // The catalogue item of this line, for its other units (box, dozen…).
  const lineItem = useLiveQuery(async () => (l?.itemId ? db.items.get(l.itemId) : undefined), [l?.itemId]);
  const inStockSerials = useLiveQuery(async () => (lineItem?.trackSerial ? serialsInStock(actor.businessId, lineItem.id) : []), [lineItem?.id, lineItem?.trackSerial, actor.businessId]);
  const [typedSerial, setTypedSerial] = useState('');
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
          : { ...cur, pricing: next, unit: AREA_UNIT[next], dims: cur.dims ?? { length: 0, width: 0, pieces: 1, in: defaultSizeUnit(next) }, qty: areaQty(cur.dims ?? { length: 0, width: 0, pieces: 1, in: defaultSizeUnit(next) }, next) }
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
            <IonButton onClick={onClose}>{t('Cancel')}</IonButton>
          </IonButtons>
          <IonTitle>{picking ? t('Choose item') : isNew ? t('Add item') : t('Edit item')}</IonTitle>
          {!picking && (
            <IonButtons slot="end">
              <IonButton strong disabled={!valid} onClick={() => void done()}>
                {t('Done')}
              </IonButton>
            </IonButtons>
          )}
        </IonToolbar>
        {picking && (
          <IonToolbar>
            <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search catalogue or type a new item')} />
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
              <IonLabel color="primary">{q.trim() ? t('Use "{name}" (new item)', { name: q.trim() }) : t('Type an item not in the catalogue')}</IonLabel>
            </IonItem>
            {matches.map((it) => (
              <IonItem
                key={it.id}
                button
                detail={false}
                onClick={() => {
                  setL({ ...lineFromItem(it, level), id: l.id });
                  setPicking(false);
                }}
              >
                <IonLabel>
                  <h2>{it.name}</h2>
                  <p>
                    {it.rateIncludesTax ? t('per {unit} · tax {pct}% incl.', { unit: it.unit, pct: it.taxPct }) : t('per {unit} · tax {pct}%', { unit: it.unit, pct: it.taxPct })}
                  </p>
                </IonLabel>
                <IonNote slot="end">{rupees(it.rate)}</IonNote>
              </IonItem>
            ))}
          </IonList>
        ) : (
          <>
            {lineItem?.trackSerial && (
              <FormSection title={t('Serial / IMEI numbers')} note={t('Tap the pieces being sold; the quantity follows.')}>
                <div className="filter-chips">
                  {[...new Set([...(inStockSerials ?? []), ...(l.serials ?? [])])].map((s) => {
                    const on = l.serials?.includes(s);
                    return (
                      <IonButton
                        key={s}
                        size="small"
                        fill={on ? 'solid' : 'outline'}
                        onClick={() => {
                          const serials = on ? (l.serials ?? []).filter((x) => x !== s) : [...(l.serials ?? []), s];
                          set({ serials, qty: Math.max(serials.length, 1) });
                        }}
                      >
                        {s}
                      </IonButton>
                    );
                  })}
                </div>
                {(inStockSerials ?? []).length === 0 && <p className="section-note">{t('No numbers in stock. Type the number of the piece being sold.')}</p>}
                <div className="search-row">
                  <TextField label={t('Type a number')} value={typedSerial} onChange={setTypedSerial} autocapitalize="characters" />
                  <IonButton
                    fill="clear"
                    disabled={!typedSerial.trim()}
                    onClick={() => {
                      const s = typedSerial.trim().toUpperCase();
                      const serials = [...new Set([...(l.serials ?? []), s])];
                      set({ serials, qty: serials.length });
                      setTypedSerial('');
                    }}
                  >
                    {t('Add')}
                  </IonButton>
                </div>
              </FormSection>
            )}
            <FormSection>
              <TextField label={t('Item')} required value={l.name} onChange={(name) => set({ name })} />
              <TextArea label={t('Description')} value={l.description} onChange={(description) => set({ description })} />
              {(settings.areaBilling || area) && (
                <SelectField
                  label={t('Charge by')}
                  value={pricing}
                  options={[
                    { value: 'unit', label: t('Quantity') },
                    { value: 'sqft', label: t('Area (sq ft)') },
                    { value: 'sqm', label: t('Area (sq m)') },
                    { value: 'rft', label: t('Length (running ft)') },
                    { value: 'rmt', label: t('Length (running metre)') },
                  ]}
                  onChange={setPricing}
                />
              )}
              {area ? (
                <>
                  <div className="field-row">
                    <NumberField label={t('Length ({unit})', { unit: l.dims!.in })} value={l.dims!.length || null} onChange={(length) => setDims({ length: length ?? 0 })} min={0} />
                    {isAreaOf(pricing as AreaPricing) && <NumberField label={t('Width ({unit})', { unit: l.dims!.in })} value={l.dims!.width || null} onChange={(width) => setDims({ width: width ?? 0 })} min={0} />}
                  </div>
                  <div className="field-row">
                    <NumberField label={t('Pieces')} value={l.dims!.pieces} onChange={(pieces) => setDims({ pieces: pieces ?? 1 })} min={1} />
                    <SelectField
                      label={t('Measured in')}
                      value={l.dims!.in}
                      options={(['ft', 'in', 'm', 'cm', 'mm'] as SizeUnit[]).map((u) => ({ value: u, label: { ft: t('Feet'), in: t('Inches'), m: t('Metres'), cm: t('Centimetres'), mm: t('Millimetres') }[u] }))}
                      onChange={(unitIn) => setDims({ in: unitIn })}
                    />
                  </div>
                  <p className="section-note">{lineSize(l)}</p>
                  <IonButton size="small" fill="clear" onClick={() => set({ dims: null })}>
                    {t('Type the {unit} instead', { unit: l.unit })}
                  </IonButton>
                </>
              ) : (
                <div className="field-row">
                  <NumberField label={t('Quantity')} value={l.qty} onChange={(qty) => set({ qty: qty ?? 0 })} min={0} />
                  {lineItem?.altUnits?.length ? (
                    <SelectField
                      label={t('Unit')}
                      value={`${l.unit}|${l.unitFactor ?? 1}`}
                      options={unitOptions(lineItem, level).map((u) => ({ value: `${u.unit}|${u.factor}`, label: u.factor === 1 ? u.unit : `${u.unit} (${u.factor} ${lineItem.unit})` }))}
                      onChange={(v) => {
                        const u = unitOptions(lineItem, level).find((x) => `${x.unit}|${x.factor}` === v);
                        if (u) set({ unit: u.unit, unitFactor: u.factor === 1 ? undefined : u.factor, rate: u.rate });
                      }}
                    />
                  ) : (
                    <SelectField label={t('Unit')} value={l.unit} options={units.map((u) => ({ value: u, label: u }))} onChange={(unit) => set({ unit })} />
                  )}
                </div>
              )}
              {noTax ? (
                <MoneyField label={area ? t('Rate per {unit}', { unit: l.unit }) : t('Rate')} value={l.rate} onChange={(rate) => set({ rate: rate ?? 0 })} />
              ) : (
                <>
                  <div className="field-row">
                    <MoneyField label={area ? (l.rateIncludesTax ? t('Rate per {unit} (incl. tax)', { unit: l.unit }) : t('Rate per {unit}', { unit: l.unit })) : l.rateIncludesTax ? t('Rate (incl. tax)') : t('Rate')} value={l.rate} onChange={(rate) => set({ rate: rate ?? 0 })} />
                    <SelectField label={t('Tax %')} value={l.taxPct} options={rates.map((r) => ({ value: r, label: `${r}%` }))} onChange={(taxPct) => set({ taxPct })} />
                  </div>
                  <div className="field-row">
                    <TextField
                      label={t('HSN / SAC')}
                      value={l.hsn}
                      onChange={(hsn) => set({ hsn: hsn.replace(/\D/g, '') || undefined })}
                      inputmode="numeric"
                      maxlength={8}
                      error={l.hsn && !checkHsn(l.hsn) ? t('4, 6 or 8 digits') : null}
                    />
                    <ToggleRow label={t('Rate includes tax')} checked={l.rateIncludesTax} onChange={(rateIncludesTax) => set({ rateIncludesTax })} />
                  </div>
                </>
              )}
            </FormSection>

            <FormSection title={t('Discount on this item')}>
              {l.offer && l.offer !== OFF && (
                <p className="section-note">
                  {t('Offer: {name}', { name: l.offer })}{' '}
                  <IonButton size="small" fill="clear" color="danger" onClick={() => set({ offer: OFF, discount: null })}>
                    {t('Remove offer')}
                  </IonButton>
                </p>
              )}
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
                <NumberField label={t('Discount %')} value={l.discount?.value || null} onChange={(v) => set({ discount: v ? { type: 'pct', value: v } : null, offer: null })} min={0} max={perms.maxDiscountPct} suffix="%" />
              ) : (
                <MoneyField label={t('Discount ₹ (whole line)')} value={l.discount?.value || null} onChange={(v) => set({ discount: v ? { type: 'amount', value: v } : null, offer: null })} />
              )}
            </FormSection>

            <ToggleRow label={t('Non-returnable')} note={t('Printed on the bill; a return needs the owner.')} checked={!!l.nonReturnable} onChange={(nonReturnable) => set({ nonReturnable })} />
            {!l.itemId && <ToggleRow label={t('Save this item to my catalogue')} checked={saveToCatalogue} onChange={setSaveToCatalogue} />}

            <div className="line-preview">
              {!noTax && (
                <>
                  <div>
                    <span>{t('Before tax')}</span>
                    <strong>{rupees(calc.taxableAmount)}</strong>
                  </div>
                  <div>
                    <span>{t('Tax')}</span>
                    <strong>{rupees(calc.taxTotal)}</strong>
                  </div>
                </>
              )}
              <div>
                <span>{t('Amount')}</span>
                <strong>{rupees(calc.taxableAmount + calc.taxTotal)}</strong>
              </div>
            </div>

            {!isNew && (
              <IonButton color="danger" fill="clear" expand="block" onClick={() => onDelete(l.id)}>
                {t('Remove item from invoice')}
              </IonButton>
            )}
          </>
        )}
      </IonContent>
    </IonModal>
  );
}
