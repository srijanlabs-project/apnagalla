import {
  IonButton,
  IonCard,
  IonCardContent,
  IonFab,
  IonFabButton,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSegment,
  IonSegmentButton,
  useIonAlert,
  useIonRouter,
  IonSpinner,
  useIonToast,
} from '@ionic/react';
import { addOrMerge } from '../../lib/mergeLines';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, addOutline, cartOutline, cashOutline, clipboardOutline, closeCircleOutline, createOutline, returnDownBackOutline, scanOutline, shareSocialOutline, trashOutline } from 'ionicons/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { FormSection, MoneyField, NumberField, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import ImagePicker from '../../components/ImagePicker';
import ItemPicker from '../../components/ItemPicker';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import PageShell from '../../components/PageShell';
import { NetworkError, api } from '../../lib/api';
import { useBusiness } from '../../lib/business';
import { db, type Purchase, type PurchaseLine, type PurchaseOrder, type Supplier } from '../../lib/db';
import { shareTable, type ExportTable } from '../../lib/exportTable';
import { dateIN, fileToResizedDataUrl, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import {
  applyScan,
  cancelPurchase,
  isInterState,
  newPurchaseDraft,
  newPurchaseOrder,
  paidOnPurchase,
  parseItemList,
  poTable,
  purchaseLineFromItem,
  purchaseTotals,
  recordSupplierPayment,
  savePurchase,
  supplierSnapshot,
  taxLines,
} from '../../lib/purchases';
import { deleteRecord, newId, putRecord } from '../../lib/repo';
import { qtyText } from '../../lib/stock';
import { NoAccess, useCanBuy } from '../suppliers/SupplierScreens';

/* ---------- lists ---------- */

export function PurchasesScreen() {
  const { actor } = useBusiness();
  const canBuy = useCanBuy();
  const [tab, setTab] = useState<'bills' | 'orders'>('bills');
  const purchases = useLiveQuery(
    () => db.purchases.where('[businessId+date]').between([actor.businessId, ''], [actor.businessId, '￿']).reverse().filter((p) => !p.deleted).toArray(),
    [actor.businessId],
  );
  const orders = useLiveQuery(
    () => db.purchaseOrders.where('[businessId+date]').between([actor.businessId, ''], [actor.businessId, '￿']).reverse().filter((p) => !p.deleted).toArray(),
    [actor.businessId],
  );
  if (!canBuy) return <NoAccess />;

  return (
    <PageShell title={t('Purchases')} backHref="/tabs/more" padded={false}>
      <IonSegment value={tab} onIonChange={(e) => setTab(e.detail.value as 'bills' | 'orders')}>
        <IonSegmentButton value="bills">
          <IonLabel>{t('Purchase bills')}</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="orders">
          <IonLabel>{t('Purchase orders')}</IonLabel>
        </IonSegmentButton>
      </IonSegment>
      <div className="filter-chips">
        <IonButton size="small" fill="clear" routerLink="/tabs/suppliers">
          {t('Suppliers')}
        </IonButton>
        <IonButton size="small" fill="clear" routerLink="/tabs/items/low-stock">
          {t('Low stock')}
        </IonButton>
      </div>
      {tab === 'bills' ? (
        purchases && purchases.length === 0 ? (
          <EmptyState icon={cartOutline} title={t('No purchase bills yet')} text={t('Enter the bills from your suppliers: stock goes up and you see what you owe.')} />
        ) : (
          <IonList>
            {(purchases ?? []).map((p) => (
              <IonItem key={p.id} routerLink={p.status === 'draft' ? `/tabs/purchases/${p.id}/edit` : `/tabs/purchases/${p.id}`} detail={false}>
                <IonLabel>
                  <h2>{p.supplier?.name ?? t('No supplier')}</h2>
                  <p>
                    {dateIN(p.date)}
                    {p.supplierBillNo ? ` · ${p.supplierBillNo}` : ''}
                    {p.kind === 'return' ? ` · ${t('Return')}` : ''}
                    {p.status !== 'saved' ? ` · ${p.status === 'draft' ? t('Draft') : t('Cancelled')}` : ''}
                  </p>
                </IonLabel>
                <IonNote slot="end" className={`amount-note${p.status === 'cancelled' ? ' strike' : ''}`}>
                  {p.kind === 'return' ? '−' : ''}
                  {rupees(p.totals.grandTotal)}
                </IonNote>
              </IonItem>
            ))}
          </IonList>
        )
      ) : orders && orders.length === 0 ? (
        <EmptyState icon={clipboardOutline} title={t('No purchase orders yet')} text={t('Make a list of what to buy and send it to the supplier on WhatsApp.')} />
      ) : (
        <IonList>
          {(orders ?? []).map((o) => (
            <IonItem key={o.id} routerLink={`/tabs/purchase-orders/${o.id}`} detail={false}>
              <IonLabel>
                <h2>{o.supplier?.name ?? t('No supplier')}</h2>
                <p>
                  {o.number} · {dateIN(o.date)} · {t('{count} items', { count: o.lines.length })}
                </p>
              </IonLabel>
              <IonNote slot="end">{o.status === 'open' ? t('Open') : o.status === 'received' ? t('Received') : t('Cancelled')}</IonNote>
            </IonItem>
          ))}
        </IonList>
      )}
      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton routerLink={tab === 'bills' ? '/tabs/purchases/new' : '/tabs/purchase-orders/new'} aria-label={tab === 'bills' ? t('New purchase bill') : t('New purchase order')}>
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>
    </PageShell>
  );
}

/* ---------- supplier choice ---------- */

function SupplierSelect({ businessId, value, onChange, disabled }: { businessId: string; value: string | undefined; onChange: (s: Supplier | null) => void; disabled?: boolean }) {
  const suppliers = useLiveQuery(() => db.suppliers.where('businessId').equals(businessId).filter((s) => !s.deleted).sortBy('name'), [businessId]);
  return (
    <div className="search-row">
      <SelectField
        label={t('Supplier')}
        value={value ?? ''}
        options={[{ value: '', label: t('None') }, ...(suppliers ?? []).map((s) => ({ value: s.id, label: s.name }))]}
        onChange={(id) => onChange((suppliers ?? []).find((s) => s.id === id) ?? null)}
        disabled={disabled}
      />
      <IonButton fill="clear" routerLink="/tabs/suppliers/new" aria-label={t('Add supplier')} disabled={disabled}>
        <IonIcon icon={addOutline} slot="icon-only" />
      </IonButton>
    </div>
  );
}

/* ---------- purchase bill editor ---------- */

export function PurchaseEditScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner } = useBusiness();
  const canBuy = useCanBuy();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const params = new URLSearchParams(useLocation().search);
  const isNew = !id || id === 'new';
  const [p, setP] = useState<Purchase | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!isNew) {
        const existing = await db.purchases.get(id!);
        if (existing) setP(existing);
        return;
      }
      const supplierId = params.get('supplier');
      const orderId = params.get('order');
      const returnOf = params.get('returnOf');
      setP(
        await newPurchaseDraft(actor, {
          supplier: supplierId ? await db.suppliers.get(supplierId) : null,
          order: orderId ? await db.purchaseOrders.get(orderId) : null,
          returnOf: returnOf ? await db.purchases.get(returnOf) : null,
        }),
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew, actor]);

  const totals = useMemo(() => (p ? purchaseTotals(p) : null), [p]);
  const scanInput = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [scanOn, setScanOn] = useState(false);
  useEffect(() => {
    void api
      .features()
      .then((f) => setScanOn(f.scanBill))
      .catch(() => setScanOn(false));
  }, []);

  // Catalogue items on the bill, for their other units (bought by the box…).
  const itemKey = p?.lines.map((l) => l.itemId ?? '').join(',') ?? '';
  const lineItems = useLiveQuery(async () => new Map((await db.items.bulkGet(itemKey.split(','))).filter((i): i is NonNullable<typeof i> => !!i).map((i) => [i.id, i])), [itemKey]);

  async function scan(file: File) {
    if (!p) return;
    setScanning(true);
    try {
      const photo = await fileToResizedDataUrl(file, 1600, true);
      const { bill } = await api.scanBill(actor.businessId, photo.split(',')[1]!, 'image/jpeg');
      setP(await applyScan(actor, p, bill, photo));
      void toast({ message: t('Bill read. Check every line before saving.'), duration: 3000, position: 'top', color: 'warning' });
    } catch (e) {
      void toast({ message: e instanceof NetworkError ? t('Scanning needs the internet.') : (e as Error).message, duration: 3000, position: 'top', color: 'danger' });
    } finally {
      setScanning(false);
    }
  }
  if (!canBuy) return <NoAccess />;
  if (!p || !totals) return null;
  const locked = p.status !== 'draft' && !isOwner;
  const patch = (x: Partial<Purchase>) => setP((cur) => cur && { ...cur, ...x });
  const patchLine = (lineId: string, x: Partial<PurchaseLine>) => setP((cur) => cur && { ...cur, lines: cur.lines.map((l) => (l.id === lineId ? { ...l, ...x } : l)) });
  const gst = { rows: taxLines({ ...p, totals }) };
  const isReturn = p.kind === 'return';

  async function save(finalize: boolean) {
    if (!p) return;
    setSaving(true);
    try {
      const saved = await savePurchase(actor, p, { finalize });
      void toast({ message: finalize ? t('Purchase saved') : t('Draft saved'), duration: 1500, position: 'top', color: 'success' });
      router.push(finalize ? `/tabs/purchases/${saved.id}` : '/tabs/purchases', 'back', 'replace');
    } catch (e) {
      void toast({ message: (e as Error).message, duration: 2500, position: 'top', color: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormPage
      title={isReturn ? t('Return to supplier') : isNew ? t('New purchase bill') : t('Edit purchase')}
      backHref="/tabs/purchases"
      onSave={() => save(true)}
      saveLabel={p.status === 'draft' ? t('Save bill') : t('Save changes')}
      saving={saving}
      canSave={!locked && p.lines.some((l) => l.name.trim() && l.qty > 0)}
      headerEnd={
        p.status === 'draft' ? (
          <IonButton onClick={() => void save(false)} disabled={saving}>
            {t('Draft')}
          </IonButton>
        ) : undefined
      }
    >
      {locked && <p className="section-note">{t('Only the owner can change a saved purchase')}</p>}
      {p.status === 'draft' && !isReturn && scanOn && (
        <>
          <input
            ref={scanInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void scan(file);
            }}
          />
          <IonButton expand="block" fill="outline" disabled={scanning} onClick={() => scanInput.current?.click()}>
            {scanning ? <IonSpinner name="dots" /> : <IonIcon icon={scanOutline} slot="start" />} {scanning ? t('Reading the bill…') : t('Scan supplier bill')}
          </IonButton>
        </>
      )}
      <FormSection>
        <SupplierSelect
          businessId={actor.businessId}
          value={p.supplier?.supplierId}
          disabled={locked || isReturn}
          onChange={(s) =>
            void (async () => {
              patch({ supplier: s ? supplierSnapshot(s) : null, interState: await isInterState(actor.businessId, s?.taxId), taxMode: s?.taxId ? 'gst' : p.taxMode });
            })()
          }
        />
        <div className="field-row">
          <TextField label={isReturn ? t('Debit note no.') : t('Supplier bill no.')} value={p.supplierBillNo} onChange={(supplierBillNo) => patch({ supplierBillNo })} disabled={locked} />
          <IonInput
            className="field"
            fill="outline"
            labelPlacement="floating"
            label={t('Date')}
            type="date"
            value={p.date}
            max={todayISO()}
            disabled={locked}
            onIonInput={(e) => patch({ date: String(e.detail.value ?? todayISO()) })}
          />
        </div>
        {!isReturn && (
          <IonInput
            className="field"
            fill="outline"
            labelPlacement="floating"
            label={t('Pay by (optional)')}
            type="date"
            value={p.dueDate ?? ''}
            disabled={locked}
            onIonInput={(e) => patch({ dueDate: String(e.detail.value ?? '') || null })}
          />
        )}
        <ToggleRow label={t('Bill has GST')} checked={p.taxMode === 'gst'} onChange={(on) => patch({ taxMode: on ? 'gst' : 'none' })} disabled={locked} />
        {p.taxMode === 'gst' && <ToggleRow label={t('Supplier in another state (IGST)')} checked={p.interState} onChange={(interState) => patch({ interState })} disabled={locked} />}
      </FormSection>

      <FormSection title={t('Items')}>
        {p.lines.map((l) => (
          <IonCard key={l.id} className="line-card">
            <IonCardContent>
              <div className="search-row">
                <TextField label={t('Item')} value={l.name} onChange={(name) => patchLine(l.id, { name })} disabled={locked || !!l.itemId} />
                {!locked && (
                  <IonButton fill="clear" color="danger" onClick={() => patch({ lines: p.lines.filter((x) => x.id !== l.id) })} aria-label={t('Remove')}>
                    <IonIcon icon={trashOutline} slot="icon-only" />
                  </IonButton>
                )}
              </div>
              {(() => {
                const it = l.itemId ? lineItems?.get(l.itemId) : undefined;
                if (!it?.altUnits?.length) return null;
                const opts = [{ unit: it.unit, factor: 1 }, ...it.altUnits.filter((u) => u.unit && u.factor > 0)];
                return (
                  <SelectField
                    label={t('Bought in')}
                    value={`${l.unit}|${l.unitFactor ?? 1}`}
                    options={opts.map((u) => ({ value: `${u.unit}|${u.factor}`, label: u.factor === 1 ? u.unit : `${u.unit} (${u.factor} ${it.unit})` }))}
                    onChange={(v) => {
                      const u = opts.find((x) => `${x.unit}|${x.factor}` === v);
                      if (u) patchLine(l.id, { unit: u.unit, unitFactor: u.factor === 1 ? undefined : u.factor, rate: Math.round((it.purchasePrice ?? 0) * u.factor) });
                    }}
                    disabled={locked}
                  />
                );
              })()}
              {l.itemId && lineItems?.get(l.itemId)?.trackSerial && (
                <TextArea
                  label={t('Serial / IMEI numbers (one per line)')}
                  value={(l.serials ?? []).join('\n')}
                  rows={3}
                  disabled={locked}
                  onChange={(v) => {
                    const serials = [...new Set(v.split(/[\n,]/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
                    patchLine(l.id, { serials, ...(serials.length ? { qty: serials.length } : {}) });
                  }}
                />
              )}
              <div className="field-row">
                <NumberField label={t('Quantity')} value={l.qty} onChange={(qty) => patchLine(l.id, { qty: qty ?? 0 })} suffix={l.unit} min={0} disabled={locked} />
                <MoneyField label={l.rateIncludesTax ? t('Cost (incl. tax)') : t('Cost (before tax)')} value={l.rate} onChange={(rate) => patchLine(l.id, { rate: rate ?? 0 })} disabled={locked} />
              </div>
              {p.taxMode === 'gst' && (
                <div className="field-row">
                  <NumberField label={t('GST %')} value={l.taxPct} onChange={(taxPct) => patchLine(l.id, { taxPct: taxPct ?? 0 })} min={0} max={100} disabled={locked} />
                  <TextField label={t('HSN / SAC')} value={l.hsn} onChange={(hsn) => patchLine(l.id, { hsn: hsn.replace(/\D/g, '') || undefined })} inputmode="numeric" maxlength={8} disabled={locked} />
                </div>
              )}
              {!isReturn && (
                <div className="field-row">
                  <MoneyField label={t('MRP')} value={l.mrp ?? null} onChange={(mrp) => patchLine(l.id, { mrp: mrp || undefined })} disabled={locked} />
                  <MoneyField label={t('New selling price')} value={l.salePrice ?? null} onChange={(salePrice) => patchLine(l.id, { salePrice })} disabled={locked} />
                </div>
              )}
              <p className="section-note">
                {qtyText(l.qty)} × {rupees(l.rate)} = <strong>{rupees(Math.round(l.qty * l.rate))}</strong>
                {l.itemId ? '' : ` · ${t('new item')}`}
              </p>
            </IonCardContent>
          </IonCard>
        ))}
        {!locked && (
          <IonButton expand="block" fill="outline" onClick={() => setPicking(true)}>
            <IonIcon icon={addOutline} slot="start" /> {t('Add item')}
          </IonButton>
        )}
        <ItemPicker
          isOpen={picking}
          onClose={() => setPicking(false)}
          businessId={actor.businessId}
          showCost
          onPick={(item) => patch({ lines: addOrMerge(p.lines, purchaseLineFromItem(item)) })}
          onNew={
            isReturn
              ? undefined
              : (name) => patch({ lines: [...p.lines, { id: newId(), name, qty: 1, unit: 'pcs', rate: 0, rateIncludesTax: false, taxPct: 0, itemId: null }] })
          }
        />
      </FormSection>

      <FormSection title={t('Total')}>
        <p>
          {t('Before tax')}: {rupees(totals.taxableAmount)}
        </p>
        {gst?.rows.map((r) => (
          <p key={r.label}>
            {r.label}: {rupees(r.amount)}
          </p>
        ))}
        <h2>{rupees(totals.grandTotal)}</h2>
        {!isReturn && (
          <ToggleRow
            label={t('Update item cost and prices from this bill')}
            checked={p.updatePrices}
            onChange={(updatePrices) => patch({ updatePrices })}
            disabled={locked || p.status !== 'draft'}
          />
        )}
        <TextArea label={t('Notes')} value={p.notes} onChange={(notes) => patch({ notes })} disabled={locked} />
        <ImagePicker label={t('Photo of the bill')} value={p.photo ?? undefined} onChange={(photo) => patch({ photo: photo ?? null })} maxPx={1400} photo />
      </FormSection>
      {p.status === 'draft' && !isNew && (
        <IonButton
          color="danger"
          fill="clear"
          expand="block"
          onClick={() =>
            void (async () => {
              await deleteRecord('purchases', actor, p.id);
              router.push('/tabs/purchases', 'back', 'replace');
            })()
          }
        >
          {t('Delete draft')}
        </IonButton>
      )}
    </FormPage>
  );
}

/* ---------- purchase bill view ---------- */

export function purchaseTable(p: Purchase): ExportTable {
  const gst = { rows: taxLines(p) };
  return {
    title: p.kind === 'return' ? t('Debit note {ref}', { ref: p.supplierBillNo }) : t('Purchase bill {ref}', { ref: p.supplierBillNo || '' }),
    subtitle: [t('Date: {date}', { date: dateIN(p.date) })],
    party: p.supplier ? { heading: p.kind === 'return' ? t('To') : t('From'), lines: [p.supplier.name, p.supplier.taxId ? `GSTIN: ${p.supplier.taxId}` : ''].filter(Boolean) } : undefined,
    columns: [{ label: t('Item') }, { label: t('HSN'), width: 'auto' }, { label: t('Quantity'), kind: 'qty' }, { label: t('Rate'), kind: 'money' }, { label: t('GST %'), kind: 'qty' }, { label: t('Amount'), kind: 'money' }],
    rows: p.lines.map((l, i) => [l.name, l.hsn ?? '', l.qty, l.rate, p.taxMode === 'gst' ? l.taxPct : 0, p.totals.lines[i]?.amount ?? Math.round(l.qty * l.rate)]),
    foot: [
      ['', '', '', '', t('Before tax'), p.totals.taxableAmount],
      ...(gst?.rows.map((r) => ['', '', '', '', r.label, r.amount]) ?? []),
      ['', '', '', '', t('Total'), p.totals.grandTotal],
    ],
    after: p.notes ? [p.notes] : [],
    fileBase: `Purchase-${p.supplier?.name ?? ''}-${p.supplierBillNo || p.date}`,
  };
}

export function PurchaseDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner } = useBusiness();
  const canBuy = useCanBuy();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const [paying, setPaying] = useState(false);
  const p = useLiveQuery(() => db.purchases.get(id!), [id]);
  const paid = useLiveQuery(() => paidOnPurchase(id!), [id]);
  if (!canBuy) return <NoAccess />;
  if (!p) return null;
  const gst = { rows: taxLines(p) };
  const pending = Math.max(0, p.totals.grandTotal - (paid ?? 0));

  return (
    <PageShell title={p.kind === 'return' ? t('Return to supplier') : t('Purchase bill')} backHref="/tabs/purchases">
      <h2>{p.supplier?.name ?? t('No supplier')}</h2>
      <p className="section-note">
        {dateIN(p.date)}
        {p.supplierBillNo ? ` · ${p.supplierBillNo}` : ''}
        {p.status === 'cancelled' ? ` · ${t('Cancelled')}` : ''}
        {p.dueDate ? ` · ${t('Pay by {date}', { date: dateIN(p.dueDate) })}` : ''}
      </p>
      <IonList inset className="flush-list">
        {p.lines.map((l) => (
          <IonItem key={l.id} routerLink={l.itemId ? `/tabs/items/${l.itemId}/stock` : undefined} detail={false}>
            <IonLabel>
              <h3>{l.name}</h3>
              <p>
                {qtyText(l.qty)} {l.unit} × {rupees(l.rate)}
                {p.taxMode === 'gst' ? ` · GST ${l.taxPct}%` : ''}
              </p>
            </IonLabel>
            <IonNote slot="end">{rupees(Math.round(l.qty * l.rate))}</IonNote>
          </IonItem>
        ))}
      </IonList>
      <div className="totals-box">
        <p>
          {t('Before tax')}: {rupees(p.totals.taxableAmount)}
        </p>
        {gst?.rows.map((r) => (
          <p key={r.label}>
            {r.label}: {rupees(r.amount)}
          </p>
        ))}
        <h2>
          {t('Total')}: {rupees(p.totals.grandTotal)}
        </h2>
        {p.kind === 'bill' && p.status === 'saved' && (
          <p>
            {t('Paid')}: {rupees(paid ?? 0)} · <span className={pending > 0 ? 'text-danger' : ''}>{t('Pending {amount}', { amount: rupees(pending) })}</span>
          </p>
        )}
      </div>
      {p.photo && <img src={p.photo} alt={t('Photo of the bill')} className="bill-photo" />}
      <div className="detail-actions">
        {p.kind === 'bill' && p.status === 'saved' && p.supplier && pending > 0 && (
          <IonButton onClick={() => setPaying(true)}>
            <IonIcon icon={cashOutline} slot="start" /> {t('Pay')}
          </IonButton>
        )}
        <IonButton fill="outline" onClick={() => void shareTable(actor.businessId, purchaseTable(p), 'pdf')}>
          <IonIcon icon={shareSocialOutline} slot="start" /> {t('Share')}
        </IonButton>
        {p.kind === 'bill' && p.status === 'saved' && (
          <IonButton fill="outline" routerLink={`/tabs/purchases/new?returnOf=${p.id}`}>
            <IonIcon icon={returnDownBackOutline} slot="start" /> {t('Return goods')}
          </IonButton>
        )}
        {isOwner && p.status === 'saved' && (
          <>
            <IonButton fill="outline" routerLink={`/tabs/purchases/${p.id}/edit`}>
              <IonIcon icon={createOutline} slot="start" /> {t('Edit')}
            </IonButton>
            <IonButton
              fill="clear"
              color="danger"
              onClick={() =>
                void alert({
                  header: t('Cancel this purchase?'),
                  message: t('Its stock and amount are taken back out.'),
                  inputs: [{ name: 'reason', placeholder: t('Reason') }],
                  buttons: [
                    { text: t('Keep'), role: 'cancel' },
                    { text: t('Cancel purchase'), role: 'destructive', handler: (v: { reason?: string }) => void cancelPurchase(actor, p.id, v.reason) },
                  ],
                })
              }
            >
              <IonIcon icon={closeCircleOutline} slot="start" /> {t('Cancel')}
            </IonButton>
          </>
        )}
      </div>
      {p.supplier && (
        <MoneyEntrySheet
          isOpen={paying}
          onClose={() => setPaying(false)}
          title={t('Pay {name}', { name: p.supplier.name })}
          amount={pending}
          onSave={async (e) => {
            await recordSupplierPayment(actor, { supplierId: p.supplier!.supplierId, purchaseId: p.id, ...e });
            void toast({ message: t('Payment saved'), duration: 1500, position: 'top', color: 'success' });
          }}
        />
      )}
    </PageShell>
  );
}

/* ---------- purchase orders ---------- */

export function PurchaseOrderScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor } = useBusiness();
  const canBuy = useCanBuy();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const params = new URLSearchParams(useLocation().search);
  const isNew = !id || id === 'new';
  const [o, setO] = useState<PurchaseOrder | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!isNew) {
        const existing = await db.purchaseOrders.get(id!);
        if (existing) setO(existing);
        return;
      }
      const picked = parseItemList(params.get('items'));
      const items = await db.items.bulkGet(picked.map((x) => x.itemId));
      const lines = picked.flatMap((x, i) => {
        const it = items[i];
        return it ? [{ id: newId(), itemId: it.id, name: it.name, qty: x.qty, unit: it.unit, rate: it.purchasePrice ?? null }] : [];
      });
      const supplierId = params.get('supplier') ?? items.find((it) => it?.supplierId)?.supplierId ?? null;
      setO(await newPurchaseOrder(actor, supplierId ? ((await db.suppliers.get(supplierId)) ?? null) : null, lines));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew, actor]);

  if (!canBuy) return <NoAccess />;
  if (!o) return null;
  const editable = o.status === 'open';
  const patch = (x: Partial<PurchaseOrder>) => setO((cur) => cur && { ...cur, ...x });

  async function save(): Promise<PurchaseOrder | null> {
    if (!o) return null;
    const saved = await putRecord('purchaseOrders', actor, { ...o, lines: o.lines.filter((l) => l.qty > 0 && l.name.trim()) });
    setO(saved);
    if (isNew) router.push(`/tabs/purchase-orders/${saved.id}`, 'none', 'replace');
    return saved;
  }

  return (
    <FormPage title={o.number} backHref="/tabs/purchases" onSave={editable ? () => void save().then(() => toast({ message: t('Order saved'), duration: 1500, position: 'top', color: 'success' })) : undefined}>
      <FormSection>
        <SupplierSelect businessId={actor.businessId} value={o.supplier?.supplierId} disabled={!editable} onChange={(s) => patch({ supplier: s ? supplierSnapshot(s) : null })} />
        <p className="section-note">
          {dateIN(o.date)} · {o.status === 'open' ? t('Open') : o.status === 'received' ? t('Received') : t('Cancelled')}
        </p>
      </FormSection>
      <FormSection title={t('Items')}>
        {o.lines.map((l) => (
          <div key={l.id} className="po-line">
            <p className="po-line-name">{l.name}</p>
            <div className="search-row">
              <NumberField
                label={t('Quantity')}
                value={l.qty}
                suffix={l.unit}
                min={0}
                disabled={!editable}
                onChange={(qty) => patch({ lines: o.lines.map((x) => (x.id === l.id ? { ...x, qty: qty ?? 0 } : x)) })}
              />
              {editable && (
                <IonButton fill="clear" color="danger" onClick={() => patch({ lines: o.lines.filter((x) => x.id !== l.id) })} aria-label={t('Remove')}>
                  <IonIcon icon={trashOutline} slot="icon-only" />
                </IonButton>
              )}
            </div>
          </div>
        ))}
        {editable && (
          <IonButton expand="block" fill="outline" onClick={() => setPicking(true)}>
            <IonIcon icon={addOutline} slot="start" /> {t('Add item')}
          </IonButton>
        )}
        <ItemPicker
          isOpen={picking}
          onClose={() => setPicking(false)}
          businessId={actor.businessId}
          showCost
          onPick={(it) => patch({ lines: [...o.lines, { id: newId(), itemId: it.id, name: it.name, qty: it.reorderQty || 1, unit: it.unit, rate: it.purchasePrice ?? null }] })}
          onNew={(name) => patch({ lines: [...o.lines, { id: newId(), itemId: null, name, qty: 1, unit: 'pcs' }] })}
        />
        <TextArea label={t('Note for the supplier')} value={o.notes} onChange={(notes) => patch({ notes })} disabled={!editable} />
      </FormSection>
      <div className="detail-actions">
        <IonButton
          fill="outline"
          disabled={!o.lines.length}
          onClick={() =>
            void (async () => {
              const saved = editable ? await save() : o;
              if (saved) await shareTable(actor.businessId, await poTable(saved), 'pdf', t('Purchase order {number}', { number: saved.number }));
            })()
          }
        >
          <IonIcon icon={shareSocialOutline} slot="start" /> {t('Send PDF')}
        </IonButton>
        {o.status === 'open' && !isNew && (
          <>
            <IonButton routerLink={`/tabs/purchases/new?order=${o.id}`}>
              <IonIcon icon={cartOutline} slot="start" /> {t('Goods arrived')}
            </IonButton>
            <IonButton fill="clear" color="danger" onClick={() => void putRecord('purchaseOrders', actor, { ...o, status: 'cancelled' as const }).then((x) => setO(x as PurchaseOrder))}>
              {t('Cancel order')}
            </IonButton>
          </>
        )}
        {o.purchaseId && (
          <IonButton fill="clear" routerLink={`/tabs/purchases/${o.purchaseId}`}>
            {t('See purchase bill')}
          </IonButton>
        )}
      </div>
      <IonListHeader />
    </FormPage>
  );
}
