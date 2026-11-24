import { IonBadge } from '@ionic/react';
import type { CreditNote, Estimate, Invoice } from '../lib/db';
import { isOverdue } from '../lib/repo';

export function invoiceStatus(inv: Invoice): { label: string; color: string } {
  if (inv.status === 'draft') return { label: 'Draft', color: 'medium' };
  if (inv.status === 'cancelled') return { label: 'Cancelled', color: 'dark' };
  if ((inv.credited ?? 0) >= inv.totals.grandTotal && inv.totals.grandTotal > 0) return { label: 'Credited', color: 'tertiary' };
  if (inv.payment.status === 'paid') return { label: 'Paid', color: 'success' };
  if (isOverdue(inv)) return { label: 'Overdue', color: 'danger' };
  if (inv.payment.status === 'partial') return { label: 'Partly paid', color: 'warning' };
  return { label: 'Unpaid', color: 'warning' };
}

export function estimateStatus(est: Estimate): { label: string; color: string } {
  const map: Record<Estimate['status'], [string, string]> = {
    draft: ['Draft', 'medium'],
    open: ['Open', 'primary'],
    accepted: ['Accepted', 'success'],
    declined: ['Declined', 'danger'],
    converted: ['Converted', 'tertiary'],
  };
  const [label, color] = map[est.status];
  return { label, color };
}

export function creditNoteStatus(n: CreditNote): { label: string; color: string } {
  if (n.status === 'draft') return { label: 'Draft', color: 'medium' };
  if (n.status === 'cancelled') return { label: 'Cancelled', color: 'dark' };
  return { label: 'Saved', color: 'tertiary' };
}

export default function StatusBadge({ invoice, estimate, creditNote }: { invoice?: Invoice; estimate?: Estimate; creditNote?: CreditNote }) {
  const s = invoice ? invoiceStatus(invoice) : estimate ? estimateStatus(estimate) : creditNoteStatus(creditNote!);
  return (
    <IonBadge color={s.color} className="status-badge">
      {s.label}
    </IonBadge>
  );
}
