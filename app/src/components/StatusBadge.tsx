import { IonBadge } from '@ionic/react';
import { useBusiness } from '../lib/business';
import type { CreditNote, Estimate, Invoice } from '../lib/db';
import { t } from '../lib/i18n';
import { isOverdue, moneyOf, type Ledger } from '../lib/ledger';

export function invoiceStatus(inv: Invoice, ledger: Ledger): { label: string; color: string } {
  if (inv.status === 'draft') return { label: 'Draft', color: 'medium' };
  if (inv.status === 'cancelled') return { label: 'Cancelled', color: 'dark' };
  const money = moneyOf(inv, ledger);
  if (money.status === 'credited') return { label: 'Credited', color: 'tertiary' };
  if (money.refundDue > 0) return { label: 'Refund due', color: 'danger' };
  if (money.status === 'paid') return { label: 'Paid', color: 'success' };
  if (isOverdue(inv, money)) return { label: 'Overdue', color: 'danger' };
  if (money.status === 'partial') return { label: 'Partly paid', color: 'warning' };
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
  const { ledger } = useBusiness();
  const s = invoice ? invoiceStatus(invoice, ledger) : estimate ? estimateStatus(estimate) : creditNoteStatus(creditNote!);
  return (
    <IonBadge color={s.color} className="status-badge">
      {/* i18n: labels above are translated where rendered */}
      {t(s.label)}
    </IonBadge>
  );
}
