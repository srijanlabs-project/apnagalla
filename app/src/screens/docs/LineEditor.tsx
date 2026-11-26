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
import { itemFieldsFrom } from '../../lib/catalog';
import CatalogSuggestions from '../../components/CatalogSuggestions';
import { AREA_UNIT, areaQty, calculateInvoice, checkHsn, defaultSizeUnit, isAreaOf, isAreaPricing, type AreaPricing, type SizeUnit } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { FormSection, MoneyField, NumberField, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import { useBusiness } from '../../lib/business';
import { db, type DocLine, type Item, type PriceLevel } from '../../lib/db';
import { customerPrice, sellable, unitOptions, type CustomPrices } from '../../lib/pricing';
import { serialsInStock } from '../../lib/serials';
import { batchStock, isExpired, pickBatch } from '../../lib/batches';
import { qtyForAmount } from '../../lib/fresh';
import { unitsForArea } from '../../lib/retailExtras';
import { jewelPrice } from '../../lib/modules';
import { bookedQty } from '../../lib/orders';
import { stockLevels } from '../../lib/stock';
import { OFF } from '../../lib/offers';
import { t } from '../../lib/i18n';
import { isAreaLine, lineSize, rupees } from '../../lib/format';
import { newId, putRecord } from '../../lib/repo';
import { sync } from '../../lib/sync';

export function lineFromItem(it: Item, level: PriceLevel = 'retail', custom?: CustomPrices): DocLine {
  const area = isAreaPricing(it.pricing);
  return {
    id: newId(),
    itemId: it.id,
    name: it.name,
    description: it.description,
    // Area-priced: the size is entered next, which gives the quantity.
    qty: area ? 0 : 1,
    unit: area ? AREA_UNIT[it.pricing as AreaPricing] : it.unit,
    rate: customerPrice(it, level, custom),
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
  /** R9: the customer's own prices. */
  custom?: CustomPrices;
  /** Start with "Save this item to my catalogue" on (a product picked from the shared list). */
  saveNew?: boolean;
}

export default function LineEditor({ line, isNew, noTax, onClose, onSave, onDelete, level = 'retail', custom, saveNew = false }: Props) {
  const { actor, settings, perms } = useBusiness();
  const [l, setL] = useState<DocLine | null>(line);
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [saveToCatalogue, setSaveToCatalogue] = useState(false);

  useEffect(() => {
    setL(line);
    setPicking(!!line && isNew && !line.name);
    setQ('');
    setSaveToCatalogue(saveNew);
  }, [line, isNew, saveNew]);

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
  const [coverArea, setCoverArea] = useState<number | null>(null);
  const [coats, setCoats] = useState(1);
  const free = useLiveQuery(async () => {
    if (!lineItem) return null;
    const [levels, booked] = await Promise.all([stockLevels(actor.businessId), bookedQty(actor.businessId)]);
    const b = booked.get(lineItem.id) ?? 0;
    return b ? { free: (levels.get(lineItem.id) ?? 0) - b, booked: b } : null;
  }, [lineItem?.id, actor.businessId]);
  const batches = useLiveQuery(async () => (lineItem?.trackBatch ? batchStock(actor.businessId, lineItem.id) : []), [lineItem?.id, lineItem?.trackBatch, actor.businessId]);
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
            {matches.length < 8 && q.trim().length >= 2 && (
              <CatalogSuggestions
                query={q}
                exclude={matches.map((m) => m.name)}
                onPick={(row) => {
                  const f = itemFieldsFrom(row, settings.defaultTaxPct, settings.units);
                  set({ name: f.name!, unit: f.unit!, hsn: f.hsn, taxPct: f.taxPct!, rate: 0, rateIncludesTax: true });
                  setSaveToCatalogue(perms.access === 'full');
                  setPicking(false);
                }}
              />
            )}
            {matches.map((it) => (
              <IonItem
                key={it.id}
                button
                detail={false}
                onClick={() => {
                  setL({ ...lineFromItem(it, level, custom), id: l.id });
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
            {lineItem?.metal && settings.jewellery && (
              <FormSection title={t('Jewellery price')} note={t('{metal} rate today {rate}/g (24K / 999)', { metal: lineItem.metal === 'gold' ? t('Gold') : t('Silver'), rate: rupees(lineItem.metal === 'gold' ? settings.jewellery.gold24 : settings.jewellery.silver999) })}>
                {(() => {
                  const j = l.jewel ?? { metal: lineItem.metal!, weight: 0, purity: lineItem.purity ?? (lineItem.metal === 'gold' ? 22 : 92.5), making: 12, makingType: 'pct' as const, wastagePct: 0, stones: 0 };
                  const put = (p: Partial<typeof j>) => {
                    const next = { ...j, ...p };
                    const price = jewelPrice(next, settings.jewellery!);
                    // The piece's price before GST; the bill adds GST from the item's rate.
                    set({ jewel: next, qty: 1, rate: l.rateIncludesTax ? Math.round(price.total * (1 + l.taxPct / 100)) : price.total });
                  };
                  return (
                    <>
                      <div className="field-row">
                        <NumberField label={t('Weight (g)')} value={j.weight || null} onChange={(weight) => put({ weight: weight ?? 0 })} min={0} />
                        <NumberField label={j.metal === 'gold' ? t('Karat') : t('Purity %')} value={j.purity} onChange={(purity) => put({ purity: purity ?? 0 })} min={0} />
                      </div>
                      <div className="field-row">
                        <NumberField label={j.makingType === 'pct' ? t('Making %') : t('Making ₹ per g')} value={j.makingType === 'pct' ? j.making : j.making / 100} onChange={(v) => put({ making: j.makingType === 'pct' ? (v ?? 0) : Math.round((v ?? 0) * 100) })} min={0} />
                        <SelectField label={t('Making as')} value={j.makingType} options={[{ value: 'pct', label: '%' }, { value: 'perGram', label: t('₹ per g') }]} onChange={(makingType) => put({ makingType, making: 0 })} />
                      </div>
                      <div className="field-row">
                        <NumberField label={t('Wastage %')} value={j.wastagePct} onChange={(wastagePct) => put({ wastagePct: wastagePct ?? 0 })} min={0} />
                        <MoneyField label={t('Stones / other')} value={j.stones || null} onChange={(stones) => put({ stones: stones ?? 0 })} />
                      </div>
                    </>
                  );
                })()}
              </FormSection>
            )}
            {!!lineItem?.coverage && (
              <FormSection title={t('From the area')} note={t('{cov} sq ft per {unit}', { cov: lineItem.coverage, unit: lineItem.unit })}>
                <div className="field-row">
                  <NumberField label={t('Area (sq ft)')} value={coverArea} onChange={(a) => (setCoverArea(a), set({ qty: unitsForArea(a ?? 0, lineItem.coverage!, coats, (lineItem.unit ?? '').toLowerCase().includes('box') ? 5 : 0) }))} min={0} />
                  <NumberField label={t('Coats')} value={coats} onChange={(c) => (setCoats(c ?? 1), set({ qty: unitsForArea(coverArea ?? 0, lineItem.coverage!, c ?? 1, (lineItem.unit ?? '').toLowerCase().includes('box') ? 5 : 0) }))} min={1} />
                </div>
              </FormSection>
            )}
            {free && l.qty * (l.unitFactor ?? 1) > free.free && (
              <p className="section-note text-danger">{t('Only {free} free: {booked} are booked for sales orders.', { free: Math.max(0, free.free), booked: free.booked })}</p>
            )}
            {lineItem?.trackBatch && (
              <FormSection title={t('Batch')} note={t('The batch expiring first is picked when the bill is saved, unless you choose one.')}>
                <div className="filter-chips wrap">
                  {(batches ?? []).filter((b) => b.batch).map((b) => {
                    const on = l.batch === b.batch;
                    const old = isExpired(b.expiry);
                    const first = pickBatch(batches ?? [])?.batch === b.batch;
                    return (
                      <IonButton key={b.batch} size="small" color={old ? 'danger' : undefined} fill={on ? 'solid' : 'outline'} onClick={() => set(on ? { batch: undefined, expiry: undefined } : { batch: b.batch, expiry: b.expiry })}>
                        {b.batch}
                        {b.expiry ? ` · ${b.expiry.slice(5, 7)}/${b.expiry.slice(2, 4)}` : ''} · {b.qty}
                        {first && !on ? ' ★' : ''}
                      </IonButton>
                    );
                  })}
                </div>
                {l.batch && isExpired(l.expiry) && <p className="text-danger">{t('This batch has expired.')}</p>}
                {(batches ?? []).filter((b) => b.batch).length === 0 && <p className="section-note">{t('No batches in stock. Add them on a purchase bill.')}</p>}
              </FormSection>
            )}
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
                  {l.rate > 0 && <MoneyField label={t('Or sell for ₹')} value={null} onChange={(v) => v && set({ qty: qtyForAmount(v, l.rate, l.taxPct, l.rateIncludesTax) })} />}
                  {lineItem?.altUnits?.length ? (
                    <SelectField
                      label={t('Unit')}
                      value={`${l.unit}|${l.unitFactor ?? 1}`}
                      options={unitOptions(lineItem, level, custom).map((u) => ({ value: `${u.unit}|${u.factor}`, label: u.factor === 1 ? u.unit : `${u.unit} (${u.factor} ${lineItem.unit})` }))}
                      onChange={(v) => {
                        const u = unitOptions(lineItem, level, custom).find((x) => `${x.unit}|${x.factor}` === v);
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
