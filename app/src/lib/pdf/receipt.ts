import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { db, type PaymentEntry, type SupplierPayment } from '../db';
import { addressLines, dateIN, rupees } from '../format';
import { t } from '../i18n';
import { khataOf } from '../khata';
import { modeLabel } from '../ledger';
import { pdfmake, sharePdf } from './index';

/**
 * R6: a payment receipt (money received from a customer) or a payment voucher (money paid to a
 * supplier), as a one-page PDF to share on WhatsApp or print. Not a legal series: the number is
 * made from the date and the entry.
 */

export interface ReceiptData {
  kind: 'receipt' | 'voucher';
  number: string;
  date: string;
  business: { name: string; address: string[]; phone?: string; taxId?: string; logo?: string };
  party: string;
  partyPhone?: string;
  lines: { mode: string; reference?: string; amount: number }[];
  /** Bills this money went to (number and amount). */
  against: { label: string; amount: number }[];
  total: number;
  /** Customer's khata balance after this payment (receipts). */
  balanceAfter?: number;
  note?: string;
  byName?: string;
}

export const receiptNumber = (date: string, id: string) => `RC-${date.replace(/-/g, '').slice(2)}-${id.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()}`;

/** The entries recorded together with this one (one khata payment, or one split payment on a bill). */
async function groupOf(p: PaymentEntry): Promise<PaymentEntry[]> {
  const all = (await db.payments.where('businessId').equals(p.businessId).filter((x) => !x.deleted && !x.voidedAt && x.kind === p.kind).toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (p.receiptId) return all.filter((x) => x.receiptId === p.receiptId);
  const second = (s: string) => s.slice(0, 19);
  return all.filter((x) => x.invoiceId === p.invoiceId && x.date === p.date && second(x.createdAt) === second(p.createdAt) && !x.receiptId);
}

async function businessOf(businessId: string): Promise<ReceiptData['business']> {
  const p = await db.profiles.get(businessId);
  return { name: p?.name ?? '', address: addressLines(p?.address), phone: p?.phone, taxId: p?.taxIdValue ? `${p.taxIdLabel ?? 'GSTIN'}: ${p.taxIdValue}` : undefined, logo: p?.logo };
}

export async function receiptFor(paymentId: string): Promise<ReceiptData | null> {
  const p = await db.payments.get(paymentId);
  if (!p || p.voidedAt || p.mode === 'advance' || p.mode === 'creditnote') return null;
  const group = await groupOf(p);
  const invoices = await Promise.all(group.map((g) => (g.invoiceId ? db.invoices.get(g.invoiceId) : undefined)));
  const first = invoices.find(Boolean);
  const customerId = p.customerId ?? first?.billTo?.customerId ?? null;
  const customer = customerId ? await db.customers.get(customerId) : undefined;
  const against = new Map<string, number>();
  group.forEach((g, i) => {
    const label = invoices[i]?.number ? t('Bill {number}', { number: invoices[i]!.number }) : t('On account (advance)');
    against.set(label, (against.get(label) ?? 0) + g.amount);
  });
  const byMode = new Map<string, { mode: string; reference?: string; amount: number }>();
  for (const g of group) {
    const k = `${g.mode}|${g.reference ?? ''}`;
    const cur = byMode.get(k) ?? { mode: modeLabel(g.mode), reference: g.reference, amount: 0 };
    cur.amount += g.amount;
    byMode.set(k, cur);
  }
  return {
    kind: 'receipt',
    number: receiptNumber(p.date, p.receiptId ?? p.id),
    date: p.date,
    business: await businessOf(p.businessId),
    party: customer?.name ?? first?.billTo?.name ?? t('Walk-in customer'),
    partyPhone: customer?.phone,
    lines: [...byMode.values()],
    against: [...against.entries()].map(([label, amount]) => ({ label, amount })),
    total: group.reduce((a, g) => a + g.amount, 0),
    balanceAfter: customer ? (await khataOf(p.businessId, customer)).balance : undefined,
    note: p.note,
    byName: p.receivedByName,
  };
}

export async function voucherFor(supplierPaymentId: string): Promise<ReceiptData | null> {
  const p: SupplierPayment | undefined = await db.supplierPayments.get(supplierPaymentId);
  if (!p || p.voidedAt) return null;
  const [supplier, purchase] = await Promise.all([db.suppliers.get(p.supplierId), p.purchaseId ? db.purchases.get(p.purchaseId) : undefined]);
  return {
    kind: 'voucher',
    number: receiptNumber(p.date, p.id).replace(/^RC/, 'PV'),
    date: p.date,
    business: await businessOf(p.businessId),
    party: supplier?.name ?? '',
    partyPhone: supplier?.phone,
    lines: [{ mode: modeLabel(p.mode), reference: p.reference, amount: p.amount }],
    against: purchase ? [{ label: t('Bill {number}', { number: purchase.supplierBillNo || dateIN(purchase.date) }), amount: p.amount }] : [{ label: t('On account'), amount: p.amount }],
    total: p.amount,
    note: p.note,
    byName: p.paidByName,
  };
}

export function buildReceiptDefinition(r: ReceiptData): TDocumentDefinitions {
  const title = r.kind === 'receipt' ? t('Payment receipt') : t('Payment voucher');
  const words = r.kind === 'receipt' ? t('Received with thanks from') : t('Paid to');
  return {
    pageSize: 'A5',
    pageMargins: [28, 28, 28, 28],
    defaultStyle: { fontSize: 10 },
    content: [
      {
        columns: [
          ...(r.business.logo ? [{ image: r.business.logo, width: 48 }] : []),
          {
            stack: [{ text: r.business.name, bold: true, fontSize: 14 }, ...r.business.address.map((l) => ({ text: l, fontSize: 9 })), ...(r.business.phone ? [{ text: r.business.phone, fontSize: 9 }] : []), ...(r.business.taxId ? [{ text: r.business.taxId, fontSize: 9 }] : [])],
            margin: [r.business.logo ? 8 : 0, 0, 0, 0],
          },
          { stack: [{ text: title, bold: true, fontSize: 13, alignment: 'right' }, { text: r.number, alignment: 'right' }, { text: dateIN(r.date), alignment: 'right' }], width: 'auto' },
        ],
      },
      { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 364, y2: 6, lineWidth: 0.5 }], margin: [0, 4, 0, 10] },
      { text: words, color: '#555' },
      { text: r.party, bold: true, fontSize: 12, margin: [0, 2, 0, 0] },
      ...(r.partyPhone ? [{ text: r.partyPhone, fontSize: 9 }] : []),
      { text: rupees(r.total), bold: true, fontSize: 20, margin: [0, 12, 0, 8] },
      {
        table: {
          widths: ['*', 'auto'],
          body: [
            [{ text: t('Mode'), bold: true }, { text: t('Amount'), bold: true, alignment: 'right' }],
            ...r.lines.map((l) => [l.reference ? `${l.mode} · ${l.reference}` : l.mode, { text: rupees(l.amount), alignment: 'right' }]),
          ],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 8],
      },
      {
        table: {
          widths: ['*', 'auto'],
          body: [[{ text: t('Against'), bold: true }, { text: '', bold: true }], ...r.against.map((a) => [a.label, { text: rupees(a.amount), alignment: 'right' }])],
        },
        layout: 'lightHorizontalLines',
      },
      ...(r.balanceAfter != null ? [{ text: r.balanceAfter > 0 ? t('Balance still due: {amount}', { amount: rupees(r.balanceAfter) }) : r.balanceAfter < 0 ? t('Advance with us: {amount}', { amount: rupees(-r.balanceAfter) }) : t('Nothing due now. Thank you!'), margin: [0, 10, 0, 0], bold: true }] : []),
      ...(r.note ? [{ text: r.note, margin: [0, 6, 0, 0], color: '#555' }] : []),
      { text: r.byName ? t('Recorded by {name}', { name: r.byName }) : '', fontSize: 8, color: '#777', margin: [0, 24, 0, 0] },
    ],
  } as TDocumentDefinitions;
}

/** Builds the PDF and opens the share sheet (WhatsApp, print…). */
export async function shareReceipt(r: ReceiptData): Promise<void> {
  const pm = await pdfmake();
  const pdf = pm.createPdf(buildReceiptDefinition(r));
  const base64 = await (pdf.getBase64 as unknown as () => Promise<string>)();
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const text = r.kind === 'receipt' ? t('{business}: received {amount} from {party}. Receipt {number}.', { business: r.business.name, amount: rupees(r.total), party: r.party, number: r.number }) : undefined;
  await sharePdf(`${r.number}.pdf`, { base64, blob: new Blob([bytes], { type: 'application/pdf' }) }, text);
}
