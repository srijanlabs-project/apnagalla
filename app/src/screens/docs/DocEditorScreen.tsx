import { useLiveQuery } from 'dexie-react-hooks';

import { isAreaPricing } from '@invoice/shared';
import { IonBackButton, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonPage, IonSpinner, IonTitle, IonToolbar, useIonAlert, useIonRouter, useIonToast } from '@ionic/react';
import { addDaysISO, discountForTarget, parseRupees } from '@invoice/shared';

import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';

import { useBusiness } from '../../lib/business';
import { api } from '../../lib/api';
import { db, type CreditNote, type DocBase, type DocLine, type Estimate, type Invoice } from '../../lib/db';
import { gstViewOf } from '../../lib/gstView';
import { t } from '../../lib/i18n';
import { rupees } from '../../lib/format';
import { computeTotals, creditableAmount, effectiveGstType, isNumberTaken, newEstimateDraft, newInvoiceDraft, previewNextNumber, saveCreditNote, saveEstimate, saveInvoice, seriesOf, PermissionError, putRecord, type DocKind } from '../../lib/repo';

import CustomerPicker, { snapshotOf } from './CustomerPicker';

import { blankJob, settleJobAdvance } from '../../lib/jobs';
import { creditOverLimit } from '../../lib/khata';
import { repriceLines } from '../../lib/pricing';
import { useOffers } from '../../lib/useOffers';
import LineEditor, { lineFromItem } from './LineEditor';

import { scaleOf } from '../../lib/scale';
import { needsPrescription } from '../../lib/modules';
import { addOrMerge } from '../../lib/mergeLines';

import { useScanToBill } from '../../lib/useScanToBill';

import { CAN_CREATE_INVOICES, webInvoiceNote } from '../../lib/platform';
import PartySection from './editor/PartySection';
import LinesSection from './editor/LinesSection';
import AdjustSection from './editor/AdjustSection';
import TotalsSection from './editor/TotalsSection';
import HeaderSection from './editor/HeaderSection';
import ExtrasSection from './editor/ExtrasSection';
import type { EditorCtx } from './editor/types';

type Doc = Invoice | Estimate | CreditNote;

export const DOC_BASE: Record<DocKind, string> = { invoice: '/tabs/invoices', estimate: '/tabs/estimates', credit: '/tabs/credit-notes' };
export const DOC_LABEL: Record<DocKind, string> = { invoice: 'Invoice', estimate: 'Estimate', credit: 'Credit note' };


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
        if (kind === 'estimate' && new URLSearchParams(location.search).get('challan')) (d as Estimate).challan = true;
        if (kind === 'estimate' && new URLSearchParams(location.search).get('order')) (d as Estimate).order = true;
        const visitId = new URLSearchParams(location.search).get('visit');
        if (visitId) {
          const v = await db.visits.get(visitId);
          if (v) void putRecord('visits', actor, { ...v, orderId: d.id });
        }
        if (kind === 'estimate' && new URLSearchParams(location.search).get('consign')) Object.assign(d, { challan: true, consignment: true });
        if (kind === 'estimate' && new URLSearchParams(location.search).get('proforma')) (d as Estimate).proforma = true;
        if (kind === 'estimate' && new URLSearchParams(location.search).get('work')) (d as Estimate).job = blankJob('work', actor.userName);
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
  const rxNeeded = useLiveQuery(async () => (doc ? needsPrescription(doc.lines) : false), [doc?.lines]);
  const docCustomerId = doc?.billTo?.customerId;
  const [scanning, setScanning] = useState(false);
  const scanToBill = useScanToBill({
    businessId: actor.businessId,
    lines: () => doc?.lines ?? [],
    confirmRepeat: settings.confirmRepeatScan !== false,
    addNew: (it) => {
      const line = lineFromItem(it, level, custom);
      if (isAreaPricing(it.pricing) || it.trackSerial) {
        setScanning(false);
        setEditing({ line, isNew: true });
      } else setDoc((cur) => (cur ? { ...cur, lines: addOrMerge(cur.lines, line) } : cur));
    },
    addOne: (lineId) => setDoc((cur) => (cur ? { ...cur, lines: cur.lines.map((l) => (l.id === lineId ? { ...l, qty: l.qty + 1 } : l)) } : cur)),
    scale: scaleOf(settings),
    addWeighed: (it, qty) => setDoc((cur) => (cur ? { ...cur, lines: [...cur.lines, { ...lineFromItem(it, level, custom), qty }] } : cur)),
    unknown: (code) => {
      setScanning(false);
      void alert({
        header: t('Not in your items'),
        message: t('No item has barcode {code}. Add it to your items?', { code }),
        buttons: [
          { text: t('Cancel'), role: 'cancel' },
          { text: t('Add item'), handler: () => router.push(`/tabs/items/new?barcode=${encodeURIComponent(code)}`) },
        ],
      });
    },
  });
  useOffers(actor.businessId, doc?.lines, doc?.date, kind !== 'credit' && doc?.status === 'draft', (lines) => setDoc((cur) => (cur ? { ...cur, lines } : cur)), doc?.coupon, doc?.taxMode === 'none');
  const level = useLiveQuery(async () => (docCustomerId ? ((await db.customers.get(docCustomerId))?.priceLevel ?? 'retail') : 'retail'), [docCustomerId]) ?? 'retail';
  const custom = useLiveQuery(async () => (docCustomerId ? (await db.customers.get(docCustomerId))?.itemPrices : undefined), [docCustomerId]);

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
    if (finalize && kind === 'invoice' && actor.role === 'staff' && settings.creditLimitBlocks && totals) {
      const over = await creditOverLimit(actor.businessId, doc.billTo?.customerId, totals.grandTotal);
      if (over) return void toast({ message: t('Above the credit limit of {limit}: ask the owner.', { limit: rupees(over.limit) }), duration: 3000, color: 'danger' });
    }
    setSaving(true);
    try {
      const saved =
        kind === 'invoice'
          ? await saveInvoice(actor, doc as Invoice, { finalize })
          : kind === 'estimate'
            ? await saveEstimate(actor, doc as Estimate, { finalize })
            : await saveCreditNote(actor, doc as CreditNote, { finalize });
      // A job's bill: its advance pays it.
      if (kind === 'invoice' && finalize) await settleJobAdvance(actor, saved as Invoice).catch(() => 0);
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

  const c: EditorCtx = { doc, setDoc, patch, locked, view, noTax, credit, totals, settings, actor, byKind, wasDraft, nextNumber, isOwner, gstType, setPicker, setEditing, scanning, setScanning, scanToBill, askTargetTotal, targetBefore, targetAfter, overCredit, room, setTerms, bankOptions, upiOptions, bankAccounts, upiIds, team, rxNeeded, againstBefore, againstAfter, kind };

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

        <PartySection c={c} />
        <LinesSection c={c} />
        <TotalsSection c={c} />
        <AdjustSection c={c} />
        <HeaderSection c={c} />
        <ExtrasSection c={c} />
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

      <CustomerPicker
        isOpen={picker}
        onClose={() => setPicker(false)}
        onPick={(party, customer) => {
          patch({ billTo: party, shipTo: null });
          void repriceLines(doc.lines, customer?.priceLevel ?? 'retail', customer?.itemPrices).then((lines) => patch({ lines }));
        }}
      />
      <LineEditor
        level={level}
        custom={custom}
        line={editing?.line ?? null}
        isNew={editing?.isNew ?? false}
        noTax={noTax}
        onClose={() => setEditing(null)}
        onSave={(line) => {
          const exists = doc.lines.some((l) => l.id === line.id);
          // The same item again (same price, unit, tax, discount) adds to its line instead of a new one.
          patch({ lines: exists ? doc.lines.map((l) => (l.id === line.id ? line : l)) : addOrMerge(doc.lines, line) });
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
