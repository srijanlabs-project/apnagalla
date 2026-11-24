import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  useIonAlert,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import { GST_STATES, addDaysISO, amountInWords, discountForTarget, parseRupees, type ChargeInput } from '@invoice/shared';
import { addOutline, closeCircle, personCircleOutline } from 'ionicons/icons';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { AddressFields, FormSection, MoneyField, NumberField, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import { useBusiness } from '../../lib/business';
import { api } from '../../lib/api';
import { db, type CreditNote, type DocBase, type DocLine, type Estimate, type Invoice } from '../../lib/db';
import { gstViewOf, taxRows } from '../../lib/gstView';
import { t } from '../../lib/i18n';
import { addressLines, lineSize, rupees } from '../../lib/format';
import {
  computeTotals,
  creditableAmount,
  effectiveGstType,
  isNumberTaken,
  newEstimateDraft,
  newId,
  newInvoiceDraft,
  previewNextNumber,
  saveCreditNote,
  saveEstimate,
  saveInvoice,
  seriesOf,
  PermissionError,
  type DocKind,
} from '../../lib/repo';
import { PAYMENT_TERMS } from '../settings/InvoiceSettingsScreen';
import CustomerPicker, { snapshotOf } from './CustomerPicker';
import LineEditor from './LineEditor';
import { sync } from '../../lib/sync';
import { CAN_CREATE_INVOICES, webInvoiceNote } from '../../lib/platform';

type Doc = Invoice | Estimate | CreditNote;

export const DOC_BASE: Record<DocKind, string> = { invoice: '/tabs/invoices', estimate: '/tabs/estimates', credit: '/tabs/credit-notes' };
export const DOC_LABEL: Record<DocKind, string> = { invoice: 'Invoice', estimate: 'Estimate', credit: 'Credit note' };

const CREDIT_REASONS = [
  { value: 'return' as const, label: 'Goods returned' },
  { value: 'price' as const, label: 'Price reduced / discount after sale' },
  { value: 'other' as const, label: 'Other correction' },
];
// i18n: labels above are translated where rendered

export default function DocEditorScreen({ kind }: { kind: DocKind }) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { actor, settings, profile, bankAccounts, upiIds, isOwner } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const base = DOC_BASE[kind];
  /** Picks the phrase for this kind of document (whole phrases, so each language can word them its own way). */
  const byKind = (invoice: string, estimate: string, creditNote: string) => (kind === 'invoice' ? invoice : kind === 'estimate' ? estimate : creditNote);
  const gstType = effectiveGstType(profile);

  const [doc, setDoc] = useState<Doc | null>(null);
  const [room, setRoom] = useState<number | null>(null);
  // People who can be given a delivery: the team (owner only can list it; works when online), else just me.
  const [team, setTeam] = useState<{ userId: string; name: string }[]>([{ userId: actor.userId, name: actor.userName || 'Me' }]);
  useEffect(() => {
    if (!isOwner) return;
    void api
      .team(actor.businessId)
      .then((t) => setTeam(t.members.filter((m) => m.active).map((m) => ({ userId: m.userId, name: m.name ?? m.phone }))))
      .catch(() => undefined);
  }, [actor.businessId, isOwner]);
  const [wasDraft, setWasDraft] = useState(true);
  const [nextNumber, setNextNumber] = useState('');
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<{ line: DocLine; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  // Load existing document or create a new draft (optionally for ?customer=<id>).
  useEffect(() => {
    let alive = true;
    void (async () => {
      let d: Doc | undefined;
      if (id && id !== 'new') d = kind === 'invoice' ? await db.invoices.get(id) : kind === 'estimate' ? await db.estimates.get(id) : await db.creditNotes.get(id);
      if (!d && kind === 'credit') return; // credit notes start from an invoice
      if (!d) {
        d = kind === 'invoice' ? await newInvoiceDraft(actor) : await newEstimateDraft(actor);
        d.dueDate = addDaysISO(d.date, d.paymentTermsDays ?? 0);
        const customerId = new URLSearchParams(location.search).get('customer');
        const c = customerId ? await db.customers.get(customerId) : undefined;
        if (c) d.billTo = snapshotOf(c);
      }
      if (alive) {
        setDoc(d);
        setWasDraft(d.status === 'draft');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);

  useEffect(() => {
    if (doc && doc.status === 'draft') void previewNextNumber(seriesOf(kind, doc.taxMode, gstType), actor, doc.date).then(setNextNumber);
  }, [doc?.date, doc?.status, doc?.taxMode, kind, gstType, actor.businessId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A credit note can be at most what is left of its invoice.
  const invoiceId = kind === 'credit' ? (doc as CreditNote | null)?.invoiceId : undefined;
  useEffect(() => {
    if (invoiceId && doc) void creditableAmount(invoiceId, doc.id).then(setRoom);
  }, [invoiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => (doc ? computeTotals(doc) : null), [doc]);

  if (kind !== 'estimate' && !CAN_CREATE_INVOICES) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonBackButton defaultHref={base} />
            </IonButtons>
            <IonTitle>{byKind(t('Invoice'), t('Estimate'), t('Credit note'))}</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <p>{webInvoiceNote()}</p>
        </IonContent>
      </IonPage>
    );
  }

  if (!doc || !totals) {
    return (
      <IonPage>
        <IonContent>
          <div className="center-fill">
            <IonSpinner />
          </div>
        </IonContent>
      </IonPage>
    );
  }

  // Always merge into the latest state: building from the rendered `doc` can drop a keystroke
  // in another field that React hasn't re-rendered yet.
  const patch = (p: Partial<DocBase> | ((cur: Doc) => Partial<DocBase>)) =>
    setDoc((cur) => (cur ? ({ ...cur, ...(typeof p === 'function' ? p(cur) : p) } as Doc) : cur));
  const locked = !wasDraft && kind !== 'estimate' && !isOwner;
  const view = gstViewOf(kind, doc, profile, totals);
  const noTax = view.mode === 'none';
  const credit = kind === 'credit' ? (doc as CreditNote) : null;
  const overCredit = credit && room != null && totals.grandTotal > room;
  // Bold parts are placed wherever the language puts them in the sentence.
  const [againstBefore, againstAfter = ''] = t('Against invoice {number} · up to {amount}', { amount: room != null ? rupees(room) : '…' }).split('{number}');
  const [targetBefore, targetAfter = ''] = t('Final amount set to {amount} → discount {discount}', { discount: rupees(totals.overallDiscount) }).split('{amount}');

  function setTerms(days: number) {
    patch({ paymentTermsDays: days, dueDate: addDaysISO(doc!.date, days) });
  }

  function askTargetTotal() {
    void alert({
      header: t('Set final amount'),
      message: t('Enter the total the customer will pay (including tax). The discount is worked out automatically.'),
      inputs: [{ name: 'amount', type: 'number', placeholder: t('e.g. 1800'), attributes: { inputmode: 'decimal' } }],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Apply'),
          handler: (v: { amount: string }) => {
            const target = parseRupees(v.amount ?? '');
            if (target == null) return false;
            const r = discountForTarget({ lines: doc!.lines, charges: doc!.charges, roundOff: doc!.roundOff }, target);
            if ('error' in r) {
              const msg =
                r.error === 'target_above_total'
                  ? t('Final amount cannot be more than the current total. Change the rates instead.')
                  : r.error === 'no_lines'
                    ? t('Add items first.')
                    : t('Final amount must be more than the extra charges.');
              void toast({ message: msg, duration: 3000, color: 'danger' });
              return false;
            }
            patch({ targetTotal: target, overallDiscount: null });
            return true;
          },
        },
      ],
    });
  }

  async function persist(finalize: boolean) {
    if (!doc) return;
    if (finalize && doc.lines.length === 0) return void toast({ message: t('Add at least one item'), duration: 2000, color: 'danger' });
    if (finalize && !doc.billTo) return void toast({ message: t('Select a customer'), duration: 2000, color: 'danger' });
    if (overCredit) return void toast({ message: t('A credit note can be at most {amount} for this invoice', { amount: rupees(room!) }), duration: 2500, color: 'danger' });
    if (doc.number && (await isNumberTaken(kind, actor.businessId, doc.number, doc.id))) {
      const message = byKind(
        t('Invoice number {number} is already used', { number: doc.number }),
        t('Estimate number {number} is already used', { number: doc.number }),
        t('Credit note number {number} is already used', { number: doc.number }),
      );
      return void toast({ message, duration: 2500, color: 'danger' });
    }
    setSaving(true);
    try {
      const saved =
        kind === 'invoice'
          ? await saveInvoice(actor, doc as Invoice, { finalize })
          : kind === 'estimate'
            ? await saveEstimate(actor, doc as Estimate, { finalize })
            : await saveCreditNote(actor, doc as CreditNote, { finalize });
      const message =
        finalize || !wasDraft
          ? byKind(t('Invoice {number} saved', { number: saved.number }), t('Estimate {number} saved', { number: saved.number }), t('Credit note {number} saved', { number: saved.number }))
          : t('Draft saved');
      void toast({ message, duration: 1500, position: 'top', color: 'success' });
      router.push(`${base}/${saved.id}`, 'forward', 'replace');
    } catch (e) {
      void toast({ message: e instanceof PermissionError || e instanceof Error ? e.message : t('Could not save'), duration: 2500, color: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  const bankOptions = [{ value: '', label: t("Don't show") }, ...bankAccounts.map((b) => ({ value: b.id, label: `${b.bankName} ••••${b.accountNumber.slice(-4)}` }))];
  const upiOptions = [{ value: '', label: t("Don't show") }, ...upiIds.map((u) => ({ value: u.id, label: u.upiId }))];

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref={base} />
          </IonButtons>
          <IonTitle>{wasDraft ? byKind(t('New invoice'), t('New estimate'), t('New credit note')) : t('Edit {number}', { number: doc.number })}</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding form-content doc-editor">
        {locked && (
          <p className="section-note">
            {byKind(t('Only the owner can edit a saved invoice.'), t('Only the owner can edit a saved estimate.'), t('Only the owner can edit a saved credit note.'))}
          </p>
        )}

        {/* ---------- GST kind ---------- */}
        {credit ? (
          <div className="target-chip">
            <span>
              {againstBefore}
              <strong>{credit.invoiceNumber}</strong>
              {againstAfter}
            </span>
          </div>
        ) : gstType === 'regular' && wasDraft ? (
          <IonSegment value={doc.taxMode ?? 'gst'} disabled={locked} onIonChange={sync((e) => patch({ taxMode: e.detail.value as 'gst' | 'none' }))}>
            <IonSegmentButton value="gst">
              <IonLabel>{kind === 'estimate' ? t('With GST') : t('Tax invoice (GST)')}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="none">
              <IonLabel>{t('Without GST')}</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        ) : gstType !== 'regular' && wasDraft ? (
          <p className="section-note">
            {gstType === 'composition'
              ? t('Composition scheme: bills of supply without GST. Change this in More → Business profile.')
              : t('Your store is not GST-registered, so bills have no GST. Change this in More → Business profile.')}
          </p>
        ) : null}

        {/* ---------- customer ---------- */}
        <div className="party-card" onClick={() => !locked && !credit && setPicker(true)}>
          <IonIcon icon={personCircleOutline} />
          {doc.billTo ? (
            <div>
              <strong>{doc.billTo.name}</strong>
              <p>{[doc.billTo.phone, ...addressLines(doc.billTo.address)].filter(Boolean).join(' · ')}</p>
            </div>
          ) : (
            <div>
              <strong className="text-primary">{t('Select customer')}</strong>
              <p>{t('Bill to')}</p>
            </div>
          )}
        </div>
        {doc.billTo?.customerId && !credit && (
          <ToggleRow
            label={t('Ship to a different address')}
            checked={!!doc.shipTo}
            onChange={async (on) => {
              const c = on && doc.billTo?.customerId ? await db.customers.get(doc.billTo.customerId) : null;
              patch({ shipTo: on ? { ...(c?.shippingAddress ?? doc.billTo!.address) } : null });
            }}
            disabled={locked}
          />
        )}
        {doc.shipTo && !credit && (
          <FormSection title={t('Ship to')}>
            <AddressFields value={doc.shipTo} onChange={(a) => patch((cur) => ({ shipTo: { ...cur.shipTo, ...a } }))} disabled={locked} />
          </FormSection>
        )}
        {view.mode === 'gst' && (
          <SelectField
            label={t('Place of supply')}
            value={view.pos ?? ''}
            options={[...(view.pos ? [] : [{ value: '', label: t('Choose the state') }]), ...GST_STATES.map((st) => ({ value: st.code, label: `${st.name} (${st.code})` }))]}
            onChange={(code) => patch({ placeOfSupply: code || null })}
            disabled={locked || !!credit}
          />
        )}

        {/* ---------- header ---------- */}
        <FormSection title={byKind(t('Invoice details'), t('Estimate details'), t('Credit note details'))}>
          <div className="field-row">
            <TextField
              label={byKind(t('Invoice no.'), t('Estimate no.'), t('Credit note no.'))}
              value={doc.number}
              placeholder={nextNumber}
              helper={!doc.number && wasDraft ? (nextNumber ? t('Auto: {number}', { number: nextNumber }) : t('Auto: given when you save')) : undefined}
              onChange={(number) => patch({ number: number.trim() })}
              disabled={locked || (!isOwner && !wasDraft)}
            />
            <label className="date-field">
              <span>{t('Date')}</span>
              <input
                type="date"
                value={doc.date}
                disabled={locked}
                onChange={(e) =>
                  e.target.value && patch({ date: e.target.value, dueDate: doc.paymentTermsDays != null ? addDaysISO(e.target.value, doc.paymentTermsDays) : doc.dueDate })
                }
              />
            </label>
          </div>
          {credit && (
            <SelectField label={t('Reason')} value={credit.reason} options={CREDIT_REASONS.map((x) => ({ ...x, label: t(x.label) }))} onChange={(reason) => patch({ reason } as Partial<CreditNote>)} disabled={locked || !isOwner} />
          )}
          {kind === 'invoice' && (
            <div className="field-row">
              {/* i18n: PAYMENT_TERMS labels (from InvoiceSettingsScreen) are translated where rendered */}
              <SelectField
                label={t('Payment terms')}
                value={PAYMENT_TERMS.some((p) => p.value === doc.paymentTermsDays) ? doc.paymentTermsDays : -1}
                options={[...PAYMENT_TERMS.map((x) => ({ ...x, label: t(x.label) })), { value: -1, label: t('Custom date') }]}
                onChange={(v) => (v === -1 ? patch({ paymentTermsDays: undefined }) : setTerms(v))}
                disabled={locked}
              />
              <label className="date-field">
                <span>{t('Due date')}</span>
                <input type="date" value={doc.dueDate ?? ''} min={doc.date} disabled={locked} onChange={(e) => patch({ dueDate: e.target.value || undefined, paymentTermsDays: undefined })} />
              </label>
            </div>
          )}
          {!credit && <TextField label={t('Reference / PO no.')} value={doc.reference} onChange={(reference) => patch({ reference })} disabled={locked} />}
          {doc.customFields.map((f, i) => (
            <TextField
              key={f.label}
              label={f.label}
              value={f.value}
              onChange={(value) => patch((cur) => ({ customFields: cur.customFields.map((x, j) => (j === i ? { ...x, value } : x)) }))}
              disabled={locked}
            />
          ))}
        </FormSection>

        {/* ---------- lines ---------- */}
        <FormSection title={t('Items')}>
          <IonList className="line-list">
            {doc.lines.map((l, i) => {
              const r = totals.lines[i]!;
              return (
                <IonItem key={l.id} button={!locked} detail={false} onClick={() => !locked && setEditing({ line: l, isNew: false })}>
                  <IonLabel>
                    <h2>{l.name}</h2>
                    {lineSize(l) && <p>{lineSize(l)}</p>}
                    <p>
                      {l.qty} {l.unit} × {rupees(l.rate)}
                      {l.rateIncludesTax ? ` ${t('incl.')}` : ''}
                      {r.lineDiscount ? ` − ${rupees(r.lineDiscount)}` : ''}
                      {noTax ? '' : ` · ${t('tax {pct}%', { pct: l.taxPct })}`}
                      {l.hsn && !noTax ? ` · ${t('HSN {code}', { code: l.hsn })}` : ''}
                    </p>
                  </IonLabel>
                  <IonNote slot="end" className="amount-note">
                    {rupees(r.net)}
                  </IonNote>
                </IonItem>
              );
            })}
          </IonList>
          {!locked && !credit && (
            <IonButton
              expand="block"
              fill="outline"
              onClick={() => setEditing({ line: { id: newId(), name: '', qty: 1, unit: settings.units[0] ?? 'pcs', rate: 0, rateIncludesTax: false, taxPct: settings.defaultTaxPct }, isNew: true })}
            >
              <IonIcon icon={addOutline} slot="start" /> {t('Add item')}
            </IonButton>
          )}
        </FormSection>

        {/* ---------- discount & charges ---------- */}
        {!credit && (
        <>
        <FormSection title={noTax ? t('Discount on total') : t('Discount on total (before tax)')}>
          {doc.targetTotal != null ? (
            <div className="target-chip">
              <span>
                {targetBefore}
                <strong>{rupees(doc.targetTotal)}</strong>
                {targetAfter}
              </span>
              {!locked && <IonIcon icon={closeCircle} onClick={() => patch({ targetTotal: null })} aria-label={t('Remove final amount')} />}
            </div>
          ) : (
            <>
              <IonSegment value={doc.overallDiscount?.type ?? 'pct'} disabled={locked} onIonChange={sync((e) => patch({ overallDiscount: { type: e.detail.value as 'pct' | 'amount', value: 0 } }))}>
                <IonSegmentButton value="pct">
                  <IonLabel>%</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="amount">
                  <IonLabel>₹</IonLabel>
                </IonSegmentButton>
              </IonSegment>
              {(doc.overallDiscount?.type ?? 'pct') === 'pct' ? (
                <NumberField label={t('Discount %')} value={doc.overallDiscount?.value || null} onChange={(v) => patch({ overallDiscount: v ? { type: 'pct', value: v } : null })} min={0} max={100} suffix="%" disabled={locked} />
              ) : (
                <MoneyField label={t('Discount ₹')} value={doc.overallDiscount?.value || null} onChange={(v) => patch({ overallDiscount: v ? { type: 'amount', value: v } : null })} disabled={locked} />
              )}
            </>
          )}
          {!locked && doc.lines.length > 0 && (
            <IonButton size="small" fill="clear" onClick={askTargetTotal}>
              {t('Set final amount…')}
            </IonButton>
          )}
        </FormSection>

        <FormSection title={t('Additional charges')}>
          {doc.charges.map((c, i) => (
            <div key={i} className="charge-row">
              <TextField label={t('Charge')} value={c.label} onChange={(label) => patch((cur) => ({ charges: cur.charges.map((x, j) => (j === i ? { ...x, label } : x)) }))} disabled={locked} />
              <MoneyField label={t('Amount')} value={c.amount} onChange={(amount) => patch((cur) => ({ charges: cur.charges.map((x, j) => (j === i ? { ...x, amount: amount ?? 0 } : x)) }))} disabled={locked} />
              {!noTax && (
                <SelectField
                  label={t('Tax %')}
                  value={c.taxPct}
                  options={settings.taxRates.map((r) => ({ value: r, label: `${r}%` }))}
                  onChange={(taxPct) => patch((cur) => ({ charges: cur.charges.map((x, j) => (j === i ? { ...x, taxPct } : x)) }))}
                  disabled={locked}
                />
              )}
              {!locked && <IonIcon icon={closeCircle} className="charge-remove" onClick={() => patch((cur) => ({ charges: cur.charges.filter((_, j) => j !== i) }))} />}
            </div>
          ))}
          {!locked && (
            <IonButton size="small" fill="clear" onClick={() => patch({ charges: [...doc.charges, { label: 'Delivery', amount: 0, taxPct: 0 } as ChargeInput] })}>
              <IonIcon icon={addOutline} slot="start" /> {t('Add charge (delivery, packing…)')}
            </IonButton>
          )}
        </FormSection>
        </>
        )}

        {/* ---------- summary ---------- */}
        <div className="summary">
          <Row label={t('Subtotal')} value={totals.subtotal} />
          {totals.itemDiscount > 0 && <Row label={t('Item discounts')} value={-totals.itemDiscount} />}
          {totals.overallDiscount > 0 && <Row label={t('Discount on total')} value={-totals.overallDiscount} />}
          {!noTax && <Row label={t('Taxable amount')} value={totals.taxableAmount + totals.chargesTotal} />}
          {noTax && totals.chargesTotal > 0 && <Row label={t('Charges')} value={totals.chargesTotal} />}
          {taxRows(view, totals).map((t) => (
            <Row key={t.label} label={t.label} value={t.amount} />
          ))}
          {totals.roundOff !== 0 && <Row label={t('Round off')} value={totals.roundOff} />}
          <Row label={t('Total')} value={totals.grandTotal} strong />
          {view.mode === 'gst' && view.pos && <p className="in-words">
              {view.interState ? t('Other state: place of supply {place}', { place: view.posLabel }) : t('Same state: place of supply {place}', { place: view.posLabel })}
            </p>}
          {overCredit && <p className="in-words text-danger">{t('More than the {amount} left on invoice {number}', { amount: rupees(room!), number: credit!.invoiceNumber })}</p>}
          <p className="in-words">{amountInWords(totals.grandTotal)}</p>
        </div>
        <ToggleRow label={t('Round off to nearest ₹1')} checked={doc.roundOff} onChange={(roundOff) => patch({ roundOff })} disabled={locked || doc.targetTotal != null} />

        {/* ---------- footer ---------- */}
        {!credit && (
        <FormSection title={t('Payment details on the PDF')}>
          <SelectField label={t('Bank account')} value={doc.bankAccountId ?? ''} options={bankOptions} onChange={(v) => patch({ bankAccountId: v || null })} disabled={locked} />
          <SelectField label={t('UPI QR code')} value={doc.upiIdId ?? ''} options={upiOptions} onChange={(v) => patch({ upiIdId: v || null })} disabled={locked} />
          {bankAccounts.length === 0 && upiIds.length === 0 && <p className="section-note">{t('Add bank / UPI details in More → Payment details.')}</p>}
        </FormSection>
        )}
        {!credit && (
          <FormSection title={t('Delivery')} note={t('Optional. The day before, the person delivering gets a phone alert.')}>
            <div className="field-row">
              <label className="date-field">
                <span>{t('Delivery date')}</span>
                <input type="date" value={doc.deliveryDate ?? ''} min={doc.date} disabled={locked} onChange={(e) => patch({ deliveryDate: e.target.value || null })} />
              </label>
              {doc.deliveryDate && (
                <SelectField
                  label={t('Delivered by')}
                  value={doc.deliveryAssignee?.userId ?? ''}
                  options={[{ value: '', label: t('Not assigned') }, ...team.map((m) => ({ value: m.userId, label: m.userId === actor.userId ? t('Me ({name})', { name: m.name }) : m.name }))]}
                  onChange={(userId) => patch({ deliveryAssignee: userId ? { userId, name: team.find((t) => t.userId === userId)?.name ?? '' } : null })}
                  disabled={locked}
                />
              )}
            </div>
          </FormSection>
        )}

        <FormSection title={t('Notes & terms')}>
          <TextArea label={t('Notes')} value={doc.notes} onChange={(notes) => patch({ notes })} disabled={locked} />
          <TextArea label={t('Terms & conditions')} value={doc.terms} onChange={(terms) => patch({ terms })} disabled={locked} rows={3} />
        </FormSection>
      </IonContent>

      {!locked && (
        <IonFooter className="save-bar">
          <IonToolbar>
            <div className="save-bar-row">
              <div className="save-bar-total">
                <span>{t('Total')}</span>
                <strong>{rupees(totals.grandTotal)}</strong>
              </div>
              {wasDraft && (
                <IonButton fill="outline" disabled={saving} onClick={() => void persist(false)}>
                  {t('Save draft')}
                </IonButton>
              )}
              <IonButton disabled={saving} onClick={() => void persist(true)}>
                {saving ? <IonSpinner name="dots" /> : wasDraft ? byKind(t('Save invoice'), t('Save estimate'), t('Save credit note')) : t('Save changes')}
              </IonButton>
            </div>
          </IonToolbar>
        </IonFooter>
      )}

      <CustomerPicker isOpen={picker} onClose={() => setPicker(false)} onPick={(party) => patch({ billTo: party, shipTo: null })} />
      <LineEditor
        line={editing?.line ?? null}
        isNew={editing?.isNew ?? false}
        noTax={noTax}
        onClose={() => setEditing(null)}
        onSave={(line) => {
          const exists = doc.lines.some((l) => l.id === line.id);
          patch({ lines: exists ? doc.lines.map((l) => (l.id === line.id ? line : l)) : [...doc.lines, line] });
          setEditing(null);
        }}
        onDelete={(lineId) => {
          patch((cur) => ({ lines: cur.lines.filter((l) => l.id !== lineId) }));
          setEditing(null);
        }}
      />
    </IonPage>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={strong ? 'summary-row strong' : 'summary-row'}>
      <span>{label}</span>
      <span>{rupees(value)}</span>
    </div>
  );
}
