import { checkGstin, todayISO } from '@invoice/shared';
import type { ScannedBillDto } from './api';
import { db, type DocLine, type Invoice } from './db';
import { t } from './i18n';
import { newId, newInvoiceDraft, saveInvoice, type Actor } from './repo';

/**
 * A page of the shop's paper bill book, read from a photo, becomes a draft bill to check: the
 * customer (by GSTIN or name, if already saved), items by name, the paper's number as the
 * reference and the photo attached. Saved, it gets a normal number like any bill.
 */
export async function draftFromPaperBill(actor: Actor, bill: ScannedBillDto, photo: string): Promise<Invoice> {
  const d = await newInvoiceDraft(actor);
  const customers = await db.customers.where('businessId').equals(actor.businessId).filter((c) => !c.deleted).toArray();
  const g = checkGstin(bill.supplierGstin ?? '');
  const name = bill.supplierName.trim();
  const c = (g.ok ? customers.find((x) => x.taxId === g.gstin) : undefined) ?? (name ? customers.find((x) => x.name.trim().toLowerCase() === name.toLowerCase()) : undefined);
  const items = await db.items.where('businessId').equals(actor.businessId).filter((i) => !i.deleted && !i.hasVariants).toArray();
  const byName = new Map(items.map((i) => [i.name.trim().toLowerCase(), i]));
  const paise = (r: number) => (Number.isFinite(r) && r > 0 ? Math.round(r * 100) : 0);
  const lines: DocLine[] = bill.lines
    .filter((l) => l.name.trim() && l.qty > 0)
    .map((l) => {
      const it = byName.get(l.name.trim().toLowerCase());
      return {
        id: newId(),
        itemId: it?.id ?? null,
        name: it?.name ?? l.name.trim(),
        qty: l.qty,
        unit: it?.unit ?? (l.unit.trim().slice(0, 10) || 'pcs'),
        rate: paise(l.rate),
        rateIncludesTax: false,
        taxPct: bill.hasGst ? l.taxPct : 0,
        hsn: l.hsn.replace(/\D/g, '') || it?.hsn,
        discount: null,
      };
    });
  const date = /^\d{4}-\d{2}-\d{2}$/.test(bill.date) && bill.date <= todayISO() ? bill.date : d.date;
  const draft: Invoice = {
    ...d,
    date,
    taxMode: bill.hasGst ? d.taxMode : 'none',
    billTo: c
      ? { customerId: c.id, name: c.name, phone: c.phone, email: c.email, address: c.billingAddress, taxId: c.taxId }
      : name
        ? { customerId: null, name, address: {}, taxId: g.ok ? g.gstin : undefined }
        : d.billTo,
    lines,
    reference: bill.billNo ? t('Paper bill {number}', { number: bill.billNo }) : t('Paper bill'),
    photos: [photo],
  };
  return saveInvoice(actor, draft, { finalize: false });
}
