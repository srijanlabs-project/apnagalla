

import { useLiveQuery } from 'dexie-react-hooks';

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { api } from '../../lib/api';
import { useBusiness } from '../../lib/business';
import { consignmentProgress } from '../../lib/consignment';
import { settlementOf } from '../../lib/credit';
import { db, type CreditNote, type Estimate, type Invoice } from '../../lib/db';

import { jobAdvance } from '../../lib/jobs';
import { khataOf } from '../../lib/khata';

import { loyaltyOf, pointsOf } from '../../lib/loyalty';
import { orderProgress } from '../../lib/orders';

import { type DocKind } from '../../lib/repo';

import BillView from './detail/BillView';

export { historyLabel } from './detail/LinesAndHistory';

/**
 * A bill, estimate or credit note. This screen loads it; detail/BillView draws it (main actions in a bar
 * at the bottom, the rest under More in groups) and detail/useBillActions holds what the buttons do.
 */
export default function DocDetailScreen({ kind }: { kind: DocKind }) {
  const { id } = useParams<{ id: string }>();
  const { actor, settings, ledger } = useBusiness();
  const doc = useLiveQuery(
    () => (kind === 'invoice' ? db.invoices.get(id!) : kind === 'estimate' ? db.estimates.get(id!) : db.creditNotes.get(id!)) as Promise<Invoice | Estimate | CreditNote | undefined>,
    [id, kind],
  );
  const creditNotes = useLiveQuery(
    () => (kind === 'invoice' && id ? db.creditNotes.where('invoiceId').equals(id).filter((n) => !n.deleted).toArray() : Promise.resolve([] as CreditNote[])),
    [id, kind],
  );
  // A credit note's invoice: its refund is paid from here.
  const noteInvoiceId = kind === 'credit' ? (doc as CreditNote | undefined)?.invoiceId : undefined;
  const linked = useLiveQuery(async (): Promise<Invoice | undefined> => (noteInvoiceId ? db.invoices.get(noteInvoiceId) : undefined), [noteInvoiceId]);
  // A credit note's settlement: refunded, or kept as credit (and what's left).
  const settlement = useLiveQuery(async () => (kind === 'credit' && doc && doc.status === 'saved' ? settlementOf(doc as CreditNote) : undefined), [kind, doc, ledger]);
  const progress = useLiveQuery(async () => (kind === 'estimate' && doc && (doc as Estimate).order && doc.status !== 'draft' ? orderProgress(doc as Estimate) : null), [kind, doc, ledger]);
  const consign = useLiveQuery(async () => (kind === 'estimate' && doc && (doc as Estimate).consignment && doc.status !== 'draft' ? consignmentProgress(doc as Estimate) : null), [kind, doc, ledger]);
  // An estimate's advance (taken, less used or returned).
  const estAdvance = useLiveQuery(async () => (kind === 'estimate' && id ? jobAdvance(actor.businessId, id) : 0), [kind, id, actor.businessId, ledger]) ?? 0;
  // Money the customer left on account, to use on this bill.
  const customerId = kind === 'invoice' ? (doc as Invoice | undefined)?.billTo?.customerId : undefined;
  const points = useLiveQuery(async () => (kind === 'invoice' && customerId && loyaltyOf(settings).enabled ? (await pointsOf(actor.businessId, customerId)).balance : 0), [kind, customerId, settings, ledger]) ?? 0;
  const advance =
    useLiveQuery(async () => {
      const c = customerId ? await db.customers.get(customerId) : undefined;
      return c ? (await khataOf(actor.businessId, c)).advance : 0;
    }, [customerId, actor.businessId, ledger]) ?? 0;
  const [emailOn, setEmailOn] = useState(false);
  useEffect(() => void api.features().then((f) => setEmailOn(!!f.email)).catch(() => setEmailOn(false)), []);
  if (!doc) return null;
  return <BillView kind={kind} doc={doc} creditNotes={creditNotes} linked={linked} settlement={settlement} progress={progress} consign={consign} estAdvance={estAdvance} points={points} advance={advance} emailOn={emailOn} />;
}
