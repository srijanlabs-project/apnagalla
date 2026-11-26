import { batchText } from '../batches';
import { jewelText } from '../modules';
import { amountInWordsIn, formatDateIN, formatPaise, type InvoiceTotals, type Lang } from '@invoice/shared';
import { serialText } from '../serials';
import QRCode from 'qrcode';
import type { BusinessProfile, DocBase, SyncedRecord, UpiId } from '../db';
import { addressLines, lineSize } from '../format';
import { gstViewOf, taxRows, titleIn } from '../gstView';
import { translate } from '../i18n';
import { upiLink } from '../pdf/buildDoc';
import type { DocKind } from '../repo';
import { PAPER_DOTS, type PaperWidth } from './escpos';

export interface ReceiptInput {
  kind: DocKind;
  doc: DocBase & { status: string; invoiceNumber?: string };
  business: Omit<BusinessProfile, keyof SyncedRecord>;
  /** Saved invoices: what was paid / is pending (from the ledger). */
  money?: { paid: number; pending: number; credited: number } | null;
  /** Cash change given at the counter, if known. */
  change?: number;
  upi?: UpiId | null;
  lang: Lang;
  paper: PaperWidth;
  showLogo?: boolean;
}

/** Fonts Android ships for every script we print (the browser picks the right one per letter). */
const FONT = '"Roboto", "Noto Sans", "Noto Sans Devanagari", "Noto Sans Gujarati", "Noto Sans Gurmukhi", sans-serif';
const money = (p: number) => formatPaise(p);

/**
 * Draws a receipt for a thermal printer: black on white, sized to the paper (384 or 576 dots).
 * Labels and the amount in words are in the store's receipt language; item and customer names
 * print as typed.
 */
export async function renderReceipt(input: ReceiptInput): Promise<HTMLCanvasElement> {
  const W = PAPER_DOTS[input.paper];
  const base = input.paper === 58 ? 21 : 25;
  const pad = 4;
  const L = (s: string, vars?: Record<string, string | number>) => translate(input.lang, s, vars);
  const { doc, business: b, kind } = input;
  const totals: InvoiceTotals = doc.totals;
  const view = gstViewOf(kind, doc, b, totals);

  // Draw on a tall scratch canvas, then copy the used part.
  const scratch = document.createElement('canvas');
  scratch.width = W;
  scratch.height = 8000;
  const ctx = scratch.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, scratch.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  let y = 6;

  const font = (size = base, bold = false) => (ctx.font = `${bold ? '700 ' : ''}${size}px ${FONT}`);
  const wrap = (text: string, max: number): string[] => {
    const out: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width <= max) line = next;
        else if (!line) {
          // A single word wider than the paper: break it.
          let part = '';
          for (const ch of word) {
            if (ctx.measureText(part + ch).width > max) {
              out.push(part);
              part = '';
            }
            part += ch;
          }
          line = part;
        } else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  };
  const text = (s: string, o: { size?: number; bold?: boolean; align?: 'left' | 'center' | 'right' } = {}) => {
    const size = o.size ?? base;
    font(size, o.bold);
    for (const line of wrap(s, W - pad * 2)) {
      const w = ctx.measureText(line).width;
      const x = o.align === 'center' ? (W - w) / 2 : o.align === 'right' ? W - pad - w : pad;
      ctx.fillText(line, x, y);
      y += Math.round(size * 1.3);
    }
  };
  /** Label on the left, amount on the right (the label wraps if it is long). */
  const row = (label: string, value: string, o: { size?: number; bold?: boolean } = {}) => {
    const size = o.size ?? base;
    font(size, o.bold);
    const vw = ctx.measureText(value).width;
    const lines = wrap(label, W - pad * 3 - vw);
    lines.forEach((line, i) => {
      ctx.fillText(line, pad, y);
      if (i === lines.length - 1) ctx.fillText(value, W - pad - vw, y);
      y += Math.round(size * 1.3);
    });
  };
  const rule = (dashed = true) => {
    y += 4;
    if (dashed) for (let x = pad; x < W - pad; x += 12) ctx.fillRect(x, y, 6, 2);
    else ctx.fillRect(pad, y, W - pad * 2, 2);
    y += 8;
  };
  const gap = (h = 6) => (y += h);

  /* ---------- shop ---------- */
  if (input.showLogo && b.logo) {
    const img = await loadImage(b.logo).catch(() => null);
    if (img) {
      const h = Math.min(90, img.height * (W * 0.5 / img.width));
      const w = (img.width / img.height) * h;
      ctx.drawImage(img, (W - w) / 2, y, w, h);
      y += h + 6;
    }
  }
  text(b.name || '', { size: base + 7, bold: true, align: 'center' });
  for (const l of addressLines(b.address)) text(l, { size: base - 2, align: 'center' });
  if (b.phone) text(b.phone, { size: base - 2, align: 'center' });
  if (view.gstType !== 'unregistered' && b.taxIdValue) text(`GSTIN: ${b.taxIdValue}`, { size: base - 2, bold: true, align: 'center' });
  if (view.declaration) text(titleIn(view.declaration, input.lang), { size: base - 4, align: 'center' });
  gap(4);
  text(input.lang === 'en' ? view.title.toUpperCase() : titleIn(view.title, input.lang), { size: base + 3, bold: true, align: 'center' });
  rule(false);

  /* ---------- bill details ---------- */
  row(L('No.'), doc.number || L('Draft'), { bold: true });
  row(L('Date'), formatDateIN(doc.date));
  if (kind === 'credit' && doc.invoiceNumber) row(L('Against bill'), doc.invoiceNumber);
  if (view.mode === 'gst' && view.posLabel) row(L('Place of supply'), view.posLabel);
  if (doc.billTo?.customerId) {
    text(`${L('Customer')}: ${doc.billTo.name}`);
    if (doc.billTo.taxId) text(`GSTIN: ${doc.billTo.taxId}`, { size: base - 2 });
  }
  rule();

  /* ---------- items ---------- */
  doc.lines.forEach((l, i) => {
    const r = totals.lines[i];
    if (!r) return;
    text(l.name, { bold: true });
    const size = lineSize(l);
    if (size) text(size, { size: base - 3 });
    if (l.serials?.length || l.warrantyMonths) text(serialText(l, doc.date), { size: base - 3 });
    if (l.batch || l.expiry) text(batchText(l), { size: base - 3 });
    if (l.jewel) text(jewelText(l), { size: base - 3 });
    if (l.nonReturnable) text(L('Non-returnable'), { size: base - 3 });
    row(`${l.qty} ${l.unit} × ${money(Math.round(r.baseRate))}${view.mode !== 'none' && l.taxPct ? `  (${l.taxPct}%)` : ''}`, money(r.net));
    if (r.lineDiscount) row(`  ${L('Discount')}`, `−${money(r.lineDiscount)}`, { size: base - 3 });
  });
  rule();

  /* ---------- totals ---------- */
  row(L('Subtotal'), money(totals.subtotal));
  if (totals.itemDiscount) row(L('Item discounts'), `−${money(totals.itemDiscount)}`);
  if (totals.overallDiscount) row(L('Discount'), `−${money(totals.overallDiscount)}`);
  for (const c of doc.charges.filter((c) => c.amount)) row(c.label || L('Charges'), money(c.amount));
  if (view.mode !== 'none' && totals.taxTotal) row(L('Taxable amount'), money(totals.taxableAmount + totals.chargesTotal));
  for (const t of taxRows(view, totals)) row(t.label, money(t.amount));
  if (totals.roundOff) row(L('Round off'), money(totals.roundOff));
  rule(false);
  row(L('Total'), `₹${money(totals.grandTotal)}`, { size: base + 6, bold: true });
  const m = input.money;
  if (kind === 'invoice' && m && (m.paid > 0 || m.credited > 0)) {
    if (m.credited) row(L('Credit notes'), `−${money(m.credited)}`);
    row(L('Paid'), money(m.paid));
    row(L('Balance due'), money(m.pending), { bold: true });
  }
  if (input.change && input.change > 0) row(L('Change returned'), money(input.change));
  gap(4);
  text(amountInWordsIn(totals.grandTotal, input.lang), { size: base - 3 });

  /* ---------- UPI QR for what is still due ---------- */
  const due = kind === 'invoice' ? (m ? m.pending : totals.grandTotal) : 0;
  if (input.upi && due > 0 && doc.status !== 'cancelled') {
    gap(6);
    const qr = document.createElement('canvas');
    await QRCode.toCanvas(qr, upiLink(input.upi, due, `${view.title} ${doc.number}`.trim()), { margin: 1, width: Math.round(W * 0.55), color: { dark: '#000', light: '#fff' } });
    ctx.drawImage(qr, (W - qr.width) / 2, y);
    y += qr.height + 4;
    text(L('Scan to pay {amount}', { amount: `₹${money(due)}` }), { size: base - 2, align: 'center', bold: true });
    text(input.upi.upiId, { size: base - 4, align: 'center' });
  }

  /* ---------- footer ---------- */
  if (doc.notes?.trim()) {
    gap(4);
    text(doc.notes.trim(), { size: base - 3, align: 'center' });
  }
  gap(4);
  text(L('Thank you! Visit again.'), { size: base - 2, align: 'center' });
  y += 10;

  const out = document.createElement('canvas');
  out.width = W;
  out.height = Math.ceil(y);
  out.getContext('2d')!.drawImage(scratch, 0, 0);
  return out;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
