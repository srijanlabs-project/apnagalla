import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonChip,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  useIonAlert,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import { formatPaise } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline, checkmarkCircle, logoWhatsapp, personCircleOutline, removeOutline, shareSocialOutline } from 'ionicons/icons';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import PaySheet from '../../components/PaySheet';
import { useBusiness } from '../../lib/business';
import { db, type DocLine, type Invoice, type Item } from '../../lib/db';
import { rupees } from '../../lib/format';
import { pdfFileName, pdfInputFor, renderPdf, sharePdf } from '../../lib/pdf';
import { CAN_CREATE_INVOICES, WEB_INVOICE_NOTE } from '../../lib/platform';
import { computeTotals, deleteDraft, effectiveGstType, newId, newInvoiceDraft, recordPayments, saveInvoice, type NewPayment } from '../../lib/repo';
import { sync } from '../../lib/sync';
import CustomerPicker, { WALK_IN } from '../docs/CustomerPicker';
import LineEditor, { lineFromItem } from '../docs/LineEditor';

/** What the counter shows after a sale is saved. */
interface Done {
  invoice: Invoice;
  paid: number;
  change: number;
}

/**
 * Counter billing: tap or search items, adjust quantities, take the money, done. The customer is
 * "Walk-in" unless one is picked; a walk-in customer pays in full, a named one may owe a balance.
 * A bill can be held (kept as a draft) to serve the next customer and resumed later.
 */
export default function SaleScreen() {
  const { actor, profile, settings, upiIds } = useBusiness();
  const location = useLocation();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const [bill, setBill] = useState<Invoice | null>(null);
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<{ line: DocLine; isNew: boolean } | null>(null);
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const regular = effectiveGstType(profile) === 'regular';

  const heldId = new URLSearchParams(location.search).get('held');

  // Start a fresh bill, or resume a held one.
  useEffect(() => {
    void (async () => {
      const held = heldId ? await db.invoices.get(heldId) : undefined;
      if (held && held.status === 'draft') return setBill(held);
      const d = await newInvoiceDraft(actor);
      setBill({ ...d, billTo: WALK_IN, notes: '' });
    })();
    // Only a new store or a different held bill starts over; never a sync or a payment elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldId, actor.businessId]);

  const items = useLiveQuery(
    () =>
      db.items
        .where('[businessId+name]')
        .between([actor.businessId, ''], [actor.businessId, '￿'])
        .filter((i) => !i.deleted)
        .toArray(),
    [actor.businessId],
  );
  const heldBills = useLiveQuery(
    () =>
      db.invoices
        .where('businessId')
        .equals(actor.businessId)
        .filter((i) => i.status === 'draft' && !!i.held && !i.deleted)
        .toArray(),
    [actor.businessId],
  );
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return (items ?? []).filter((i) => i.name.toLowerCase().includes(s) || i.barcode === q.trim()).slice(0, 30);
  }, [items, q]);

  const totals = useMemo(() => (bill ? computeTotals(bill) : null), [bill]);

  if (!CAN_CREATE_INVOICES) {
    return (
      <IonPage>
        <IonHeader>
          <IonToolbar>
            <IonButtons slot="start">
              <IonBackButton defaultHref="/tabs/home" />
            </IonButtons>
            <IonTitle>Sale</IonTitle>
          </IonToolbar>
        </IonHeader>
        <IonContent className="ion-padding">
          <p>{WEB_INVOICE_NOTE}</p>
        </IonContent>
      </IonPage>
    );
  }

  if (!bill || !totals) {
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

  const walkIn = !bill.billTo?.customerId;
  const patch = (p: Partial<Invoice> | ((cur: Invoice) => Partial<Invoice>)) => setBill((cur) => (cur ? { ...cur, ...(typeof p === 'function' ? p(cur) : p) } : cur));
  const fail = (e: unknown) => void toast({ message: e instanceof Error ? e.message : 'Something went wrong', duration: 2500, color: 'danger' });

  function addItem(it: Item) {
    patch((cur) => {
      const same = cur.lines.find((l) => l.itemId === it.id && !l.dims);
      if (same) return { lines: cur.lines.map((l) => (l === same ? { ...l, qty: l.qty + 1 } : l)) };
      return { lines: [...cur.lines, lineFromItem(it)] };
    });
    setQ('');
  }

  function step(lineId: string, by: number) {
    patch((cur) => ({ lines: cur.lines.map((l) => (l.id === lineId ? { ...l, qty: Math.max(0, Math.round((l.qty + by) * 1000) / 1000) } : l)).filter((l) => l.qty > 0) }));
  }

  function startNew() {
    setDone(null);
    setQ('');
    if (heldId) router.push('/tabs/sale', 'none', 'replace');
    void newInvoiceDraft(actor).then((d) => setBill({ ...d, billTo: WALK_IN, notes: '' }));
  }

  async function hold() {
    if (!bill || !bill.lines.length) return;
    try {
      await saveInvoice(actor, { ...bill, held: true }, { finalize: false });
      void toast({ message: 'Bill held. Tap it at the top to resume.', duration: 1500 });
      startNew();
    } catch (e) {
      fail(e);
    }
  }

  /** Saves the bill, then the money received (if any). */
  async function finish(parts: NewPayment[], date: string, change: number) {
    if (!bill) return;
    setBusy(true);
    try {
      const saved = await saveInvoice(actor, { ...bill, held: false }, { finalize: true });
      const paid = parts.reduce((a, p) => a + p.amount, 0);
      if (paid > 0) await recordPayments(actor, saved.id, parts, { date });
      setPaying(false);
      setDone({ invoice: saved, paid, change });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function shareBill(inv: Invoice) {
    try {
      const pdf = await renderPdf(await pdfInputFor('invoice', inv, settings));
      await sharePdf(pdfFileName('invoice', inv), pdf, `${profile.name}: bill ${inv.number} for ${rupees(inv.totals.grandTotal)}`);
    } catch (e) {
      fail(e);
    }
  }

  /** Short text bill on WhatsApp: no PDF, good for small counter sales. */
  function whatsappText(inv: Invoice, paid: number) {
    const lines = inv.lines.map((l, i) => `${l.name} ${l.qty} × ${formatPaise(l.rate)} = ${formatPaise(inv.totals.lines[i]?.amount ?? 0)}`);
    const text = [
      `*${profile.name}*`,
      `Bill ${inv.number} · ${inv.date.split('-').reverse().join('-')}`,
      ...lines,
      `*Total ₹${formatPaise(inv.totals.grandTotal)}*`,
      paid >= inv.totals.grandTotal ? 'Paid. Thank you!' : `Paid ₹${formatPaise(paid)} · Balance ₹${formatPaise(inv.totals.grandTotal - paid)}`,
    ].join('\n');
    const phone = inv.billTo?.phone?.replace('+', '') ?? '';
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  }

  const upi = upiIds.find((u) => u.id === bill.upiIdId) ?? upiIds.find((u) => u.isDefault) ?? upiIds[0] ?? null;
  const count = bill.lines.reduce((a, l) => a + l.qty, 0);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref="/tabs/home" />
          </IonButtons>
          <IonTitle>{done ? 'Sale saved' : 'New sale'}</IonTitle>
        </IonToolbar>
        {!done && heldBills && heldBills.length > 0 && (
          <IonToolbar className="held-bar">
            <div className="filter-chips">
              <span className="held-label">Held:</span>
              {heldBills.map((h) => (
                <IonChip key={h.id} outline={h.id !== bill.id} color={h.id === bill.id ? 'primary' : undefined} onClick={() => router.push(`/tabs/sale?held=${h.id}`, 'none', 'replace')}>
                  {h.billTo?.customerId ? h.billTo.name : 'Walk-in'} · {rupees(computeTotals(h).grandTotal)}
                </IonChip>
              ))}
            </div>
          </IonToolbar>
        )}
      </IonHeader>

      {done ? (
        <IonContent className="ion-padding">
          <div className="sale-done">
            <IonIcon icon={checkmarkCircle} color="success" />
            <h2>
              {done.invoice.number} · {rupees(done.invoice.totals.grandTotal)}
            </h2>
            <p>{done.paid >= done.invoice.totals.grandTotal ? 'Paid in full' : done.paid > 0 ? `Paid ${rupees(done.paid)}, balance ${rupees(done.invoice.totals.grandTotal - done.paid)}` : 'Saved unpaid'}</p>
            {done.change > 0 && (
              <p className="sale-change">
                Give back <strong>{rupees(done.change)}</strong>
              </p>
            )}
          </div>
          <div className="detail-actions">
            <IonButton color="success" onClick={() => whatsappText(done.invoice, done.paid)}>
              <IonIcon icon={logoWhatsapp} slot="start" /> WhatsApp bill
            </IonButton>
            <IonButton fill="outline" onClick={() => void shareBill(done.invoice)}>
              <IonIcon icon={shareSocialOutline} slot="start" /> Share PDF
            </IonButton>
            <IonButton fill="clear" routerLink={`/tabs/invoices/${done.invoice.id}`}>
              Open bill
            </IonButton>
          </div>
          <IonButton expand="block" size="large" onClick={startNew}>
            <IonIcon icon={addOutline} slot="start" /> Next sale
          </IonButton>
        </IonContent>
      ) : (
        <IonContent className="sale-content">
          <div className="sale-top">
            <IonChip onClick={() => setPicker(true)}>
              <IonIcon icon={personCircleOutline} />
              <IonLabel>{bill.billTo?.name ?? WALK_IN.name}</IonLabel>
            </IonChip>
            {regular && (
              <IonSegment value={bill.taxMode ?? 'gst'} onIonChange={sync((e) => patch({ taxMode: e.detail.value as 'gst' | 'none' }))} className="sale-tax">
                <IonSegmentButton value="gst">
                  <IonLabel>GST</IonLabel>
                </IonSegmentButton>
                <IonSegmentButton value="none">
                  <IonLabel>No GST</IonLabel>
                </IonSegmentButton>
              </IonSegment>
            )}
          </div>
          <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder="Search item or type barcode" debounce={0} />

          {q.trim() ? (
            <IonList>
              {matches.map((it) => (
                <IonItem key={it.id} button detail={false} onClick={() => addItem(it)}>
                  <IonLabel>
                    <h2>{it.name}</h2>
                    <p>per {it.unit}</p>
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
                <IonLabel color="primary">+ Sell "{q.trim()}" (not in the catalogue)</IonLabel>
              </IonItem>
            </IonList>
          ) : bill.lines.length === 0 ? (
            <div className="sale-empty">
              <p>Search an item above to start the bill.</p>
              {(items ?? []).length > 0 && (
                <div className="sale-quick">
                  {(items ?? []).slice(0, 12).map((it) => (
                    <IonButton key={it.id} fill="outline" size="small" onClick={() => addItem(it)}>
                      {it.name}
                    </IonButton>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <IonList className="cart">
              {bill.lines.map((l, i) => (
                <IonItem key={l.id} lines="full">
                  <IonLabel onClick={() => setEditing({ line: l, isNew: false })}>
                    <h2>{l.name}</h2>
                    <p>
                      {rupees(l.rate)} / {l.unit}
                    </p>
                  </IonLabel>
                  <div slot="end" className="qty-stepper">
                    <IonButton fill="outline" size="small" onClick={() => step(l.id, -1)} aria-label="One less">
                      <IonIcon icon={removeOutline} />
                    </IonButton>
                    <span>{l.qty}</span>
                    <IonButton fill="outline" size="small" onClick={() => step(l.id, 1)} aria-label="One more">
                      <IonIcon icon={addOutline} />
                    </IonButton>
                    <strong>{rupees(totals.lines[i]?.amount ?? 0)}</strong>
                  </div>
                </IonItem>
              ))}
            </IonList>
          )}
        </IonContent>
      )}

      {!done && (
        <IonFooter className="save-bar">
          <IonToolbar>
            <div className="save-bar-row">
              <div className="save-bar-total">
                <span>
                  {count} item{count === 1 ? '' : 's'}
                </span>
                <strong>{rupees(totals.grandTotal)}</strong>
              </div>
              {bill.lines.length > 0 && (
                <IonButton fill="outline" onClick={() => void hold()}>
                  Hold
                </IonButton>
              )}
              {bill.lines.length > 0 && heldId && (
                <IonButton
                  fill="clear"
                  color="medium"
                  onClick={() =>
                    void alert({
                      header: 'Discard this held bill?',
                      buttons: [
                        { text: 'Keep', role: 'cancel' },
                        { text: 'Discard', role: 'destructive', handler: () => void deleteDraft(actor, 'invoice', bill.id).then(startNew).catch(fail) },
                      ],
                    })
                  }
                >
                  Discard
                </IonButton>
              )}
              <IonButton disabled={!bill.lines.length || busy} onClick={() => setPaying(true)}>
                {busy ? <IonSpinner name="dots" /> : 'Pay'}
              </IonButton>
            </div>
          </IonToolbar>
        </IonFooter>
      )}

      <PaySheet
        isOpen={paying}
        amount={totals.grandTotal}
        upi={upi}
        qrNote={profile.name}
        requireFull={walkIn}
        allowPayLater={!walkIn}
        onClose={() => setPaying(false)}
        onConfirm={finish}
      />
      <CustomerPicker isOpen={picker} onClose={() => setPicker(false)} onPick={(party) => patch({ billTo: party, shipTo: null })} />
      <LineEditor
        line={editing?.line ?? null}
        isNew={editing?.isNew ?? false}
        noTax={bill.taxMode === 'none'}
        onClose={() => setEditing(null)}
        onSave={(line) => {
          patch((cur) => ({ lines: cur.lines.some((l) => l.id === line.id) ? cur.lines.map((l) => (l.id === line.id ? line : l)) : [...cur.lines, line] }));
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
