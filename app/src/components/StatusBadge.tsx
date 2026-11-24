import { IonBadge } from '@ionic/react';
import type { Estimate, Invoice } from '../lib/db';
import { isOverdue } from '../lib/repo';

export function invoiceStatus(inv: Invoice): { label: string; color: string } {
  if (inv.status === 'draft') return { label: 'Draft', color: 'medium' };
  if (inv.status === 'cancelled') return { label: 'Cancelled', color: 'dark' };
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

export default function StatusBadge({ invoice, estimate }: { invoice?: Invoice; estimate?: Estimate }) {
  const s = invoice ? invoiceStatus(invoice) : estimateStatus(estimate!);
  return (
    <IonBadge color={s.color} className="status-badge">
      {s.label}
    </IonBadge>
  );
}
