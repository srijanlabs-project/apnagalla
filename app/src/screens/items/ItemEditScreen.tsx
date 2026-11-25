import { IonButton, IonIcon, IonItem, IonLabel, IonNote, useIonAlert, useIonRouter } from '@ionic/react';
import { barcodeOutline, layersOutline } from 'ionicons/icons';
import { AREA_UNIT, calculateInvoice, checkHsn } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import BarcodeScanner from '../../components/BarcodeScanner';
import { FormSection, MoneyField, NumberField, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import ImagePicker from '../../components/ImagePicker';
import { useBusiness } from '../../lib/business';
import { db, type BusinessSettings, type Item } from '../../lib/db';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { flattenCategories, useCategories } from '../../lib/categories';
import { deleteRecord, newId, putRecord, type Actor } from '../../lib/repo';
import { useForm } from '../../lib/useForm';
import { isLow, qtyText, setOpeningStock, stockLevels, tracksStock } from '../../lib/stock';
import { PriceLevelsSection, ReturnSection, SerialSection, UnitsSection, VariantsSection } from './ItemExtras';
import { withPriceHistory } from '../../lib/pricing';

export function blankItem(actor: Actor, settings: BusinessSettings, name = '', barcode?: string): Item {
  return {
    id: newId(),
    businessId: actor.businessId,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
    name,
    unit: settings.units[0] ?? 'pcs',
    rate: 0,
    rateIncludesTax: false,
    taxPct: settings.defaultTaxPct,
    barcode: barcode || undefined,
  };
}

export function ItemForm({
  value: it,
  onChange: patch,
  settings,
  priceLocked,
  showCost,
}: {
  value: Item;
  onChange: (p: Partial<Item>) => void;
  settings: BusinessSettings;
  priceLocked?: boolean;
  /** Owner, or staff when the store lets them see cost. */
  showCost?: boolean;
}) {
  const cats = flattenCategories(useCategories(it.businessId));
  // Selling price per unit as the customer pays it, to compare with MRP.
  const finalPrice = it.rateIncludesTax ? it.rate : Math.round(it.rate * (1 + it.taxPct / 100));
  const aboveMrp = !!it.mrp && finalPrice > it.mrp;
  const margin = showCost && it.purchasePrice && it.rate ? (it.rateIncludesTax ? it.rate / (1 + it.taxPct / 100) : it.rate) - it.purchasePrice : null;
  const [scanning, setScanning] = useState(false);
  // Another item with the same barcode would make scanning ambiguous.
  const clash = useLiveQuery(
    async () => (it.barcode ? (await db.items.where('[businessId+barcode]').equals([it.businessId, it.barcode]).toArray()).find((x) => x.id !== it.id && !x.deleted) : undefined),
    [it.barcode, it.id, it.businessId],
  );
  const preview = calculateInvoice({ lines: [{ qty: 1, rate: it.rate, rateIncludesTax: it.rateIncludesTax, taxPct: it.taxPct }], roundOff: false });
  const units = settings.units.includes(it.unit) ? settings.units : [...settings.units, it.unit];
  const rates = settings.taxRates.includes(it.taxPct) ? settings.taxRates : [...settings.taxRates, it.taxPct].sort((a, b) => a - b);
  return (
    <>
      <FormSection>
        <TextField label={t('Item / service name')} required value={it.name} onChange={(name) => patch({ name })} />
        <TextArea label={t('Description (optional)')} value={it.description} onChange={(description) => patch({ description })} />
        <ImagePicker label={t('Photo (optional)')} value={it.photo ?? undefined} onChange={(photo) => patch({ photo: photo ?? null })} maxPx={400} photo disabled={priceLocked} />
        <div className="field-row">
          {cats.length > 0 && (
            <SelectField
              label={t('Category')}
              value={it.categoryId ?? ''}
              options={[{ value: '', label: t('None') }, ...cats.map((n) => ({ value: n.cat.id, label: n.path }))]}
              onChange={(categoryId) => patch({ categoryId: categoryId || null })}
            />
          )}
          <TextField label={t('Item code')} value={it.code} onChange={(code) => patch({ code: code.trim() || undefined })} disabled={priceLocked} maxlength={30} autocapitalize="characters" />
        </div>
        {(settings.areaBilling || (it.pricing && it.pricing !== 'unit')) && (
          <SelectField
            label={t('Priced')}
            value={it.pricing ?? 'unit'}
            options={[
              { value: 'unit' as const, label: t('Per unit (piece, kg, box…)') },
              { value: 'sqft' as const, label: t('Per sq ft (length × width)') },
              { value: 'sqm' as const, label: t('Per sq m (length × width)') },
              { value: 'rft' as const, label: t('Per running foot (length)') },
              { value: 'rmt' as const, label: t('Per running metre (length)') },
            ]}
            onChange={(pricing) => patch({ pricing, ...(pricing !== 'unit' ? { unit: AREA_UNIT[pricing] } : {}) })}
            disabled={priceLocked}
          />
        )}
        {(it.pricing ?? 'unit') === 'unit' && (
          <SelectField label={t('Unit')} value={it.unit} options={units.map((u) => ({ value: u, label: u }))} onChange={(unit) => patch({ unit })} />
        )}
        <div className="search-row">
          <TextField
            label={t('Barcode')}
            value={it.barcode}
            onChange={(barcode) => patch({ barcode: barcode.trim() || undefined })}
            disabled={priceLocked}
            error={clash ? t('Already on {item}', { item: clash.name }) : null}
          />
          {!priceLocked && (
            <IonButton fill="clear" onClick={() => setScanning(true)} aria-label={t('Scan barcode')}>
              <IonIcon icon={barcodeOutline} slot="icon-only" />
            </IonButton>
          )}
        </div>
        <BarcodeScanner isOpen={scanning} onClose={() => setScanning(false)} onScan={(barcode) => patch({ barcode })} />
      </FormSection>
      <FormSection title={t('Price & tax')} note={priceLocked ? t('Only the owner can change prices.') : undefined}>
        <MoneyField label={it.rateIncludesTax ? t('Price (incl. tax)') : t('Price (before tax)')} value={it.rate} onChange={(v) => patch({ rate: v ?? 0 })} disabled={priceLocked} />
        <div className="field-row">
          <SelectField label={t('Tax %')} value={it.taxPct} options={rates.map((r) => ({ value: r, label: `${r}%` }))} onChange={(taxPct) => patch({ taxPct })} disabled={priceLocked} />
          <TextField
            label={t('HSN / SAC')}
            value={it.hsn}
            onChange={(hsn) => patch({ hsn: hsn.replace(/\D/g, '') || undefined })}
            disabled={priceLocked}
            inputmode="numeric"
            maxlength={8}
            error={it.hsn && !checkHsn(it.hsn) ? t('4, 6 or 8 digits') : null}
          />
        </div>
        <div className="field-row">
          <MoneyField label={t('MRP (incl. tax)')} value={it.mrp ?? null} onChange={(mrp) => patch({ mrp: mrp || undefined })} disabled={priceLocked} />
          {showCost && <MoneyField label={t('Purchase price (cost)')} value={it.purchasePrice ?? null} onChange={(purchasePrice) => patch({ purchasePrice: purchasePrice || undefined })} disabled={priceLocked} />}
        </div>
        {aboveMrp && <p className="section-note text-danger">{t('Selling price {price} is above the MRP {mrp}. Selling above MRP is not allowed.', { price: rupees(finalPrice), mrp: rupees(it.mrp!) })}</p>}
        {margin != null && <p className="section-note">{t('Margin before tax: {margin} per {unit}', { margin: rupees(Math.round(margin)), unit: it.unit })}</p>}
        <ToggleRow
          label={t('Price includes tax')}
          note={t('Turn on for MRP-style prices where the price already contains tax.')}
          checked={it.rateIncludesTax}
          onChange={(rateIncludesTax) => patch({ rateIncludesTax })}
          disabled={priceLocked}
        />
        {it.rate > 0 && (
          <p className="section-note">
            {/* One phrase; {total} is left unfilled so it can be shown in bold where the language puts it. */}
            {t('Before tax {taxable} + tax {tax} = {total} per {unit}', { taxable: rupees(preview.taxableAmount), tax: rupees(preview.taxTotal), unit: it.unit })
              .split('{total}')
              .map((part, i) => (i === 0 ? part : [<strong key={i}>{rupees(preview.taxableAmount + preview.taxTotal)}</strong>, part]))}
          </p>
        )}
      </FormSection>
      {(it.pricing ?? 'unit') === 'unit' && (
        <FormSection title={t('Stock')}>
          <ToggleRow
            label={t('Keep count of stock')}
            note={t('Turn off for services and things you don’t count.')}
            checked={it.trackStock !== false}
            onChange={(on) => patch({ trackStock: on })}
            disabled={priceLocked}
          />
          {it.trackStock !== false && (
            <div className="field-row">
              <NumberField label={t('Low stock at')} value={it.lowStock ?? null} onChange={(lowStock) => patch({ lowStock })} suffix={it.unit} min={0} disabled={priceLocked} />
              <NumberField label={t('Usual order quantity')} value={it.reorderQty ?? null} onChange={(reorderQty) => patch({ reorderQty })} suffix={it.unit} min={0} disabled={priceLocked} />
            </div>
          )}
        </FormSection>
      )}
    </>
  );
}

export default function ItemEditScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, settings, isOwner, perms } = useBusiness();
  const isNew = !id || id === 'new';
  const existing = useLiveQuery(() => (isNew ? undefined : db.items.get(id!)), [id]);
  const prefill = new URLSearchParams(useLocation().search);
  const initial = useMemo(
    () => (isNew ? blankItem(actor, settings, prefill.get('name') ?? '', prefill.get('barcode') ?? undefined) : existing),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isNew, existing, actor, settings],
  );
  const { value: it, patch, save, saving } = useForm<Item>(initial);
  const [opening, setOpening] = useState<number | null>(null);
  const stock = useLiveQuery(async () => (isNew ? undefined : ((await stockLevels(actor.businessId)).get(id!) ?? 0)), [isNew, id, actor.businessId]);
  const [alert] = useIonAlert();
  const router = useIonRouter();
  if (!it) return null;
  const priceLocked = !isNew && !perms.editItems;

  return (
    <FormPage
      title={isNew ? t('New item') : t('Edit item')}
      backHref="/tabs/items"
      onSave={
        isNew || perms.editItems
          ? () =>
              save(
                async () => {
                  const saved = await putRecord('items', actor, withPriceHistory(existing, { ...it, name: it.name.trim() }, actor.userName));
                  if (isNew && opening && tracksStock(saved)) await setOpeningStock(actor, saved, opening);
                  return saved;
                },
                { message: t('Item saved'), back: true },
              )
          : undefined
      }
      saving={saving}
      canSave={!!it.name.trim()}
    >
      {!isNew && !perms.editItems && <p className="section-note">{t('Only the owner can edit catalogue items.')}</p>}
      {!isNew && tracksStock(it) && stock !== undefined && (
        <IonItem routerLink={`/tabs/items/${it.id}/stock`} detail lines="full" className="stock-link">
          <IonIcon icon={layersOutline} slot="start" />
          <IonLabel>{t('Stock')}</IonLabel>
          <IonNote slot="end" className={stock < 0 || isLow(it, stock) ? 'text-danger' : undefined}>
            {qtyText(stock)} {it.unit}
          </IonNote>
        </IonItem>
      )}
      <ItemForm value={it} onChange={patch} settings={settings} priceLocked={priceLocked} showCost={perms.seeCost} />
      {!it.hasVariants && <PriceLevelsSection it={it} patch={patch} disabled={priceLocked} />}
      {!it.hasVariants && <UnitsSection it={it} patch={patch} disabled={priceLocked} />}
      <SerialSection it={it} patch={patch} disabled={priceLocked} />
      {!it.hasVariants && <ReturnSection it={it} patch={patch} disabled={priceLocked} />}
      <VariantsSection it={it} saved={!isNew} />
      {isNew && tracksStock(it) && (
        <FormSection>
          <NumberField label={t('Opening stock')} value={opening} onChange={setOpening} suffix={it.unit} min={0} helper={t('How many you have now.')} />
        </FormSection>
      )}
      {!isNew && isOwner && (
        <IonButton
          color="danger"
          fill="clear"
          expand="block"
          onClick={() =>
            void alert({
              message: t('Delete {item}? Existing invoices keep their lines.', { item: it.name }),
              buttons: [
                { text: t('Cancel'), role: 'cancel' },
                {
                  text: t('Delete'),
                  role: 'destructive',
                  handler: async () => {
                    await deleteRecord('items', actor, it.id);
                    router.push('/tabs/items', 'back', 'replace');
                  },
                },
              ],
            })
          }
        >
          {t('Delete item')}
        </IonButton>
      )}
    </FormPage>
  );
}
