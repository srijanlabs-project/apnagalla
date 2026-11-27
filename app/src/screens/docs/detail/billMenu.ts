import type { MenuGroup, MenuItem } from '../../../components/ActionMenu';
import type { CreditNote, Estimate, Invoice } from '../../../lib/db';
import { rupees } from '../../../lib/format';
import { t } from '../../../lib/i18n';
import { CAN_CREATE_INVOICES } from '../../../lib/platform';

/** Everything the More menu can do, worked out by the screen. */
export interface BillMenuCtx {
  doc: Invoice | Estimate | CreditNote;
  inv: Invoice | null;
  est: Estimate | null;
  note: CreditNote | null;
  isOwner: boolean;
  canEdit: boolean;
  canCancelBills: boolean;
  isWarehouse: boolean;
  /** Payment can still be taken on this bill (saved, pending, phone app). */
  canTakePayment: boolean;
  pending: number;
  due: number;
  advance: number;
  pointsLine: string | null;
  vouchersOn: boolean;
  emailOn: boolean;
  estAdvance: number;
  printerLabel: string;
  /** The bar already shows WhatsApp (so Share PDF goes in the menu). */
  hasPhone: boolean;
  act: {
    whatsappToNumber(): void;
    share(): void;
    email(): void;
    printA4(): void;
    receipt(): void;
    preview(): void;
    useAdvance(): void;
    usePoints(): void;
    payWithCredit(): void;
    payWithVoucher(): void;
    oldItem(): void;
    deliveredWithPhoto(): void;
    returnAdvance(): void;
    moveAdvance(): void;
    accept(): void;
    decline(): void;
    edit(): void;
    returnItems(): void;
    duplicate(): void;
    cancelNote(): void;
    cancelInvoice(): void;
    deleteDraft(): void;
  };
}

const when = (cond: unknown, item: MenuItem): MenuItem[] => (cond ? [item] : []);

/** The bill's More menu, in four groups so it reads at a glance. */
export function billMenu(c: BillMenuCtx): MenuGroup[] {
  const { doc, inv, est, note, act } = c;
  const estOpen = !!est && est.status !== 'draft' && est.status !== 'converted';
  return [
    {
      title: t('Share and print'),
      items: [
        ...when(c.hasPhone, { text: t('Share PDF'), handler: act.share }),
        { text: t('WhatsApp to a number'), handler: act.whatsappToNumber },
        ...when(c.emailOn && doc.status !== 'draft', { text: t('Email'), handler: act.email }),
        { text: t('Print A4'), handler: act.printA4 },
        ...when(doc.status !== 'draft' && !est, { text: c.printerLabel, handler: act.receipt }),
        { text: t('Preview'), handler: act.preview },
      ],
    },
    {
      title: t('Other ways to pay'),
      items: [
        ...when(c.canTakePayment && c.advance > 0, { text: t('Use advance {amount}', { amount: rupees(Math.min(c.pending, c.advance)) }), handler: act.useAdvance }),
        ...when(c.canTakePayment && c.pointsLine, { text: c.pointsLine ?? '', handler: act.usePoints }),
        ...when(c.canTakePayment, { text: t('Pay with credit note'), handler: act.payWithCredit }),
        ...when(c.canTakePayment && c.vouchersOn, { text: t('Pay with gift voucher'), handler: act.payWithVoucher }),
        ...when(c.canTakePayment, { text: t('Old item taken back'), handler: act.oldItem }),
      ],
    },
    {
      title: t('Delivery and advance'),
      items: [
        ...when(!doc.deliveredAt && !c.isWarehouse && (doc.deliveryDate || est?.challan) && (inv?.status === 'saved' || estOpen), { text: t('Delivered, with photo'), handler: act.deliveredWithPhoto }),
        ...when(estOpen, { text: t('Mark accepted'), handler: act.accept }),
        ...when(estOpen, { text: t('Mark declined'), handler: act.decline }),
        ...when(est && c.estAdvance > 0 && est.status !== 'converted', { text: t('Return advance'), handler: act.returnAdvance }),
        ...when(est && c.estAdvance > 0 && est.status !== 'converted' && c.isOwner && est.billTo?.customerId, { text: t("Move to customer's advance"), handler: act.moveAdvance }),
      ],
    },
    {
      title: t('Change this bill'),
      items: [
        ...when(c.canEdit, { text: t('Edit'), handler: act.edit }),
        ...when(inv && inv.status === 'saved' && CAN_CREATE_INVOICES && c.due > 0, { text: c.isOwner ? t('Return items / credit note') : t('Return items'), handler: act.returnItems }),
        ...when(inv && CAN_CREATE_INVOICES, { text: t('Duplicate'), handler: act.duplicate }),
        ...when(note && note.status === 'saved' && c.isOwner, { text: t('Cancel credit note'), handler: act.cancelNote, danger: true }),
        ...when(inv && inv.status === 'saved' && (c.isOwner || c.canCancelBills), { text: t('Cancel invoice'), handler: act.cancelInvoice, danger: true }),
        ...when(doc.status === 'draft', { text: t('Delete draft'), handler: act.deleteDraft, danger: true }),
      ],
    },
  ];
}
