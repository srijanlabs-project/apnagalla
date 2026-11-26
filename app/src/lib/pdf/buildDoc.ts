import { amountInWords, formatDateIN, formatPaise, roundHalfUp, stateCode, type InvoiceTotals } from '@invoice/shared';
import { serialText } from '../serials';
import type { Content, ContentTable, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import { batchText } from '../batches';
import type { BankAccount, BusinessProfile, DesignSettings, DocBase, SyncedRecord, UpiId } from '../db';
import { addressLines, lineSize } from '../format';
import { gstViewOf, taxRows } from '../gstView';
import type { DocKind } from '../repo';

export type BusinessInfo = Omit<BusinessProfile, keyof SyncedRecord>;

export interface PdfInput {
  kind: DocKind;
  doc: DocBase & { status: string; invoiceNumber?: string; invoiceDate?: string };
  /** Saved invoices: money from its payment entries and credit notes. */
  money?: { paid: number; credited: number; pending: number } | null;
  business: BusinessInfo;
  design: DesignSettings;
  bank?: BankAccount | null;
  upi?: UpiId | null;
  otherPaymentInstructions?: string;
}

const money = (p: number) => formatPaise(p);
const FONT_SIZES = { S: 8, M: 9, L: 10.5 } as const;

/** UPI deep link; amount is pre-filled so the customer pays exactly the pending amount. */
export function upiLink(upi: UpiId, amountPaise: number, note: string): string {
  const params = new URLSearchParams({ pa: upi.upiId, pn: upi.payeeName, am: (amountPaise / 100).toFixed(2), cu: 'INR', tn: note.slice(0, 50) });
  return `upi://pay?${params.toString()}`;
}

function pendingFor(input: PdfInput, totals: InvoiceTotals): number {
  if (input.kind !== 'invoice' || input.doc.status === 'cancelled') return 0;
  return input.money ? input.money.pending : totals.grandTotal;
}

interface Theme {
  accent: string;
  headerFill: string | null;
  headerText: string;
  tableHeaderFill: string | null;
  tableHeaderText: string;
  tableLayout: 'grid' | 'lines' | 'minimal';
  titleColor: string;
}

function themeFor(design: DesignSettings): Theme {
  const c = design.color || '#3b5bdb';
  switch (design.template) {
    case 'modern':
      return { accent: c, headerFill: c, headerText: '#ffffff', tableHeaderFill: c, tableHeaderText: '#ffffff', tableLayout: 'lines', titleColor: '#ffffff' };
    case 'minimal':
      return { accent: '#000000', headerFill: null, headerText: '#000000', tableHeaderFill: null, tableHeaderText: '#000000', tableLayout: 'minimal', titleColor: '#000000' };
    case 'classic':
    default:
      return { accent: c, headerFill: null, headerText: '#111111', tableHeaderFill: '#eef1f8', tableHeaderText: '#111111', tableLayout: 'grid', titleColor: c };
  }
}

function tableLayout(theme: Theme) {
  if (theme.tableLayout === 'grid') {
    return {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#b8bfcc',
      vLineColor: () => '#b8bfcc',
      paddingTop: () => 4,
      paddingBottom: () => 4,
    };
  }
  if (theme.tableLayout === 'lines') {
    return {
      hLineWidth: (i: number) => (i === 0 ? 0 : 0.5),
      vLineWidth: () => 0,
      hLineColor: () => '#dde1ea',
      paddingTop: () => 5,
      paddingBottom: () => 5,
    };
  }
  return {
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 1 || i === node.table.body.length ? 0.8 : 0),
    vLineWidth: () => 0,
    hLineColor: () => '#000000',
    paddingTop: () => 3,
    paddingBottom: () => 3,
  };
}

export function buildDocDefinition(input: PdfInput, totals: InvoiceTotals): TDocumentDefinitions {
  const { doc, business: b, design, kind } = input;
  const show = design.show;
  const theme = themeFor(design);
  const base = FONT_SIZES[design.fontSize];
  const banner = design.banner?.trim().slice(0, 200) || '';
  const a5 = design.paper === 'A5';
  const view = gstViewOf(kind, doc, b, totals);
  const title = view.title.toUpperCase();
  const gst = view.mode === 'gst';
  const registered = view.gstType !== 'unregistered';
  const pending = pendingFor(input, totals);
  const withCode = (state: string | undefined) => (gst && state && stateCode(state) ? `State: ${state} (${stateCode(state)})` : null);
  const statusStamp = doc.status === 'cancelled' ? 'CANCELLED' : doc.status === 'draft' ? 'DRAFT' : null;

  /* ---------- header ---------- */
  const bizLines: Content[] = [
    { text: b.name || 'Your business', style: 'bizName', color: theme.headerText },
    ...(b.legalName && b.legalName !== b.name ? [{ text: b.legalName, color: theme.headerText }] : []),
    ...addressLines(b.address).map((l) => ({ text: l, color: theme.headerText })),
    ...(b.phone || b.email ? [{ text: [b.phone, b.email].filter(Boolean).join(' · '), color: theme.headerText }] : []),
    ...(b.website ? [{ text: b.website, color: theme.headerText }] : []),
    ...(registered && b.taxIdValue
      ? [{ text: `GSTIN: ${b.taxIdValue}`, bold: true, color: theme.headerText }]
      : show.taxId && b.taxIdValue && b.taxIdLabel !== 'GSTIN'
        ? [{ text: `${b.taxIdLabel || 'Tax ID'}: ${b.taxIdValue}`, bold: true, color: theme.headerText }]
        : []),
    ...(withCode(b.address?.state) ? [{ text: withCode(b.address?.state)!, color: theme.headerText }] : []),
  ];

  const metaRows: [string, string][] = [
    [kind === 'credit' ? 'Credit Note No.' : kind === 'estimate' ? `${title === 'DELIVERY CHALLAN' ? 'Challan' : title === 'SALES ORDER' ? 'Order' : title === 'PROFORMA INVOICE' ? 'Proforma' : 'Estimate'} No.` : 'Invoice No.', doc.number || '—'],
    ['Date', formatDateIN(doc.date)],
    ...(kind === 'credit' && doc.invoiceNumber ? ([['Against invoice', doc.invoiceNumber]] as [string, string][]) : []),
    ...(kind === 'credit' && doc.invoiceDate ? ([['Invoice date', formatDateIN(doc.invoiceDate)]] as [string, string][]) : []),
    ...(gst && view.posLabel ? ([['Place of supply', view.posLabel]] as [string, string][]) : []),
    ...(kind === 'invoice' && doc.dueDate ? ([['Due date', formatDateIN(doc.dueDate)]] as [string, string][]) : []),
    ...(doc.deliveryDate && kind !== 'credit' ? ([['Delivery date', formatDateIN(doc.deliveryDate)]] as [string, string][]) : []),
    ...(doc.reference ? ([['Reference', doc.reference]] as [string, string][]) : []),
    ...doc.customFields.filter((f) => f.value.trim()).map((f) => [f.label, f.value] as [string, string]),
  ];

  const headerColumns: Content = {
    columns: [
      ...(show.logo && b.logo ? [{ image: b.logo, fit: [a5 ? 50 : 70, a5 ? 50 : 70] as [number, number], width: a5 ? 56 : 78 }] : []),
      { stack: bizLines, width: '*' },
      {
        width: 'auto',
        stack: [
          { text: title, style: 'title', color: theme.titleColor, alignment: 'right' },
          ...(view.declaration ? [{ text: view.declaration, fontSize: base - 2, color: theme.headerText, alignment: 'right' as const, margin: [0, 1, 0, 0] as [number, number, number, number] }] : []),
          ...(statusStamp ? [{ text: statusStamp, color: '#d9480f', bold: true, alignment: 'right' as const, margin: [0, 2, 0, 4] as [number, number, number, number] }] : []),
          {
            table: { body: metaRows.map(([k, v]) => [{ text: k, color: theme.headerText, opacity: 0.8 }, { text: v, bold: true, color: theme.headerText, alignment: 'right' }]) },
            layout: 'noBorders',
            margin: [0, 4, 0, 0],
          },
        ],
      },
    ],
    columnGap: 10,
  };

  const header: Content = theme.headerFill
    ? {
        table: { widths: ['*'], body: [[{ ...headerColumns, fillColor: theme.headerFill, margin: [10, 10, 10, 10] } as TableCell]] },
        layout: 'noBorders',
        margin: [0, 0, 0, 12],
      }
    : { stack: [headerColumns, { canvas: [{ type: 'line', x1: 0, y1: 4, x2: a5 ? 380 : 515, y2: 4, lineWidth: 1, lineColor: theme.accent }] }], margin: [0, 0, 0, 10] };

  /* ---------- parties ---------- */
  const party = doc.billTo;
  const billTo: Content = {
    stack: [
      { text: 'BILL TO', style: 'label', color: theme.accent },
      { text: party?.name ?? '—', bold: true },
      ...addressLines(party?.address).map((l) => ({ text: l })),
      ...(party?.phone ? [{ text: party.phone }] : []),
      ...(party?.email ? [{ text: party.email }] : []),
      ...(party?.taxId ? [{ text: `GSTIN: ${party.taxId}`, bold: gst }] : []),
      ...(withCode(party?.address?.state) && !doc.shipTo ? [{ text: withCode(party?.address?.state)! }] : []),
    ],
  };
  const shipTo: Content | null =
    show.shipTo && doc.shipTo
      ? {
          stack: [
            { text: 'SHIP TO', style: 'label', color: theme.accent },
            { text: party?.name ?? '', bold: true },
            ...addressLines(doc.shipTo).map((l) => ({ text: l })),
            ...(withCode(doc.shipTo.state) ? [{ text: withCode(doc.shipTo.state)! }] : []),
          ],
        }
      : null;

  /* ---------- items table ---------- */
  const hasDiscount = show.discountColumn && totals.lines.some((l) => l.lineDiscount > 0);
  const hasHsn = gst && doc.lines.some((l) => l.hsn);
  const showTax = view.mode !== 'none' && (show.taxColumn || gst);
  const cols: { key: string; header: string; width: string | number; align: 'left' | 'right' | 'center' }[] = [
    { key: 'sn', header: '#', width: 16, align: 'center' },
    { key: 'item', header: 'Item', width: '*', align: 'left' },
    ...(hasHsn ? [{ key: 'hsn', header: 'HSN/SAC', width: 'auto' as const, align: 'left' as const }] : []),
    { key: 'qty', header: 'Qty', width: 'auto', align: 'right' },
    ...(show.unitColumn ? [{ key: 'unit', header: 'Unit', width: 'auto' as const, align: 'left' as const }] : []),
    ...(show.mrpColumn && doc.lines.some((l) => l.mrp) ? [{ key: 'mrp', header: 'MRP', width: 'auto' as const, align: 'right' as const }] : []),
    { key: 'rate', header: 'Rate', width: 'auto', align: 'right' },
    ...(hasDiscount ? [{ key: 'disc', header: 'Disc.', width: 'auto' as const, align: 'right' as const }] : []),
    ...(showTax ? [{ key: 'tax', header: gst ? 'GST' : 'Tax', width: 'auto' as const, align: 'right' as const }] : []),
    { key: 'amt', header: 'Amount', width: 'auto', align: 'right' },
  ];

  const headRow: TableCell[] = cols.map((c) => ({ text: c.header, bold: true, alignment: c.align, color: theme.tableHeaderText, fillColor: theme.tableHeaderFill ?? undefined }));
  const bodyRows: TableCell[][] = doc.lines.map((l, i) => {
    const r = totals.lines[i]!;
    const cells: Record<string, TableCell> = {
      sn: { text: String(i + 1), alignment: 'center' },
      item: {
        stack: [
          { text: l.name, bold: true },
          ...(lineSize(l) ? [{ text: lineSize(l), color: '#333333', fontSize: base - 1 }] : []),
          ...(show.itemDescription && l.description ? [{ text: l.description, color: '#555555', fontSize: base - 1 }] : []),
          ...(serialText(l, doc.date) ? [{ text: serialText(l, doc.date), color: '#333333', fontSize: base - 1 }] : []),
          ...(batchText(l) ? [{ text: batchText(l), color: '#333333', fontSize: base - 1 }] : []),
          ...(l.nonReturnable ? [{ text: 'Non-returnable', color: '#b00020', fontSize: base - 1, bold: true }] : []),
        ],
      },
      qty: { text: show.unitColumn ? String(l.qty) : `${l.qty} ${l.unit}`, alignment: 'right' },
      unit: { text: l.unit },
      hsn: { text: l.hsn ?? '' },
      mrp: { text: l.mrp ? money(l.mrp) : '', alignment: 'right' },
      rate: { text: money(roundHalfUp(r.baseRate)), alignment: 'right' },
      disc: { text: r.lineDiscount ? money(r.lineDiscount) : '', alignment: 'right' },
      tax: { text: `${l.taxPct}%`, alignment: 'right' },
      amt: { text: money(r.net), alignment: 'right' },
    };
    return cols.map((c) => cells[c.key]!);
  });

  const itemsTable: ContentTable = {
    table: { headerRows: 1, widths: cols.map((c) => c.width), body: [headRow, ...bodyRows], dontBreakRows: true },
    layout: tableLayout(theme),
    margin: [0, 10, 0, 6],
  };

  /* ---------- summary ---------- */
  const sumRows: [string, number, boolean?][] = [['Subtotal', totals.subtotal]];
  if (totals.itemDiscount) sumRows.push(['Item discounts', -totals.itemDiscount]);
  if (totals.overallDiscount) sumRows.push(['Discount', -totals.overallDiscount]);
  if (view.mode !== 'none' && (gst || totals.itemDiscount || totals.overallDiscount || totals.chargesTotal)) sumRows.push(['Taxable amount', totals.taxableAmount]);
  for (const c of doc.charges.filter((c) => c.amount)) sumRows.push([c.label || 'Charges', c.amount]);
  for (const t of taxRows(view, totals)) sumRows.push([t.label, t.amount]);
  if (totals.roundOff) sumRows.push(['Round off', totals.roundOff]);
  sumRows.push(['Total', totals.grandTotal, true]);
  const credited = kind === 'invoice' ? (input.money?.credited ?? 0) : 0;
  const paidSoFar = kind === 'invoice' ? (input.money?.paid ?? 0) : 0;
  if (kind === 'invoice' && doc.status === 'saved' && (paidSoFar > 0 || credited > 0)) {
    if (credited) sumRows.push(['Credit notes', -credited]);
    if (paidSoFar) sumRows.push(['Paid', -paidSoFar]);
    sumRows.push(['Balance due', pending, true]);
  }

  const summaryTable: Content = {
    table: {
      widths: ['*', 'auto'],
      body: sumRows.map(([k, v, strong]) => [
        { text: k, bold: !!strong, fontSize: strong ? base + 1.5 : base, fillColor: strong && theme.tableHeaderFill ? theme.tableHeaderFill : undefined, color: strong && theme.tableHeaderFill ? theme.tableHeaderText : undefined },
        {
          text: `${strong ? '₹ ' : ''}${money(v)}`,
          alignment: 'right',
          bold: !!strong,
          fontSize: strong ? base + 1.5 : base,
          fillColor: strong && theme.tableHeaderFill ? theme.tableHeaderFill : undefined,
          color: strong && theme.tableHeaderFill ? theme.tableHeaderText : undefined,
        },
      ]),
    },
    layout: 'noBorders',
  };

  /* ---------- payment block (left of summary) ---------- */
  const payBlock: Content[] = [];
  if (show.amountInWords) payBlock.push({ text: [{ text: 'Amount in words: ', bold: true }, amountInWords(totals.grandTotal)], margin: [0, 0, 0, 6] });
  if (doc.pointsEarned && kind === 'invoice') payBlock.push({ text: [{ text: 'Loyalty points earned: ', bold: true }, String(doc.pointsEarned)], margin: [0, 0, 0, 6] });
  if (show.bankDetails && input.bank) {
    const bk = input.bank;
    payBlock.push({
      stack: [
        { text: 'BANK DETAILS', style: 'label', color: theme.accent },
        { text: `${bk.holderName}` },
        { text: `${bk.bankName}${bk.branch ? `, ${bk.branch}` : ''}` },
        { text: `A/c No: ${bk.accountNumber}` },
        { text: `IFSC: ${bk.ifsc}` },
      ],
      margin: [0, 0, 0, 6],
    });
  }
  if (input.otherPaymentInstructions?.trim()) payBlock.push({ text: input.otherPaymentInstructions.trim(), margin: [0, 0, 0, 6], color: '#444444' });

  const qrAmount = pending;
  const qr: Content | null =
    show.upiQr && input.upi && kind === 'invoice' && qrAmount > 0
      ? ({
          stack: [
            { qr: upiLink(input.upi, qrAmount, `${title} ${doc.number}`.trim()), fit: a5 ? 70 : 90, alignment: 'center' as const },
            { text: `Scan to pay ₹${money(qrAmount)}`, alignment: 'center' as const, fontSize: base - 1, margin: [0, 3, 0, 0] as [number, number, number, number] },
            { text: input.upi.upiId, alignment: 'center' as const, fontSize: base - 1, color: '#555555' },
          ],
          width: a5 ? 90 : 110,
        } as unknown as Content)
      : null;

  const leftColumn: Content = qr ? ({ columns: [{ stack: payBlock, width: '*' }, qr], columnGap: 8 } as unknown as Content) : { stack: payBlock };

  /* ---------- notes, terms, signature ---------- */
  const footerBlocks: Content[] = [];
  if (doc.notes?.trim()) footerBlocks.push({ stack: [{ text: 'NOTES', style: 'label', color: theme.accent }, { text: doc.notes.trim() }], margin: [0, 8, 0, 0] });
  if (show.terms && doc.terms?.trim()) footerBlocks.push({ stack: [{ text: 'TERMS & CONDITIONS', style: 'label', color: theme.accent }, { text: doc.terms.trim(), fontSize: base - 1 }], margin: [0, 8, 0, 0] });

  const signature: Content = {
    stack: [
      { text: `For ${b.name}`, bold: true, alignment: 'right' },
      show.signature && b.signature ? { image: b.signature, fit: [120, 45], alignment: 'right' as const, margin: [0, 4, 0, 2] as [number, number, number, number] } : { text: ' ', margin: [0, 24, 0, 0] as [number, number, number, number] },
      { text: 'Authorised signatory', alignment: 'right', color: '#555555' },
    ],
    margin: [0, 14, 0, 0],
    unbreakable: true,
  };

  return {
    pageSize: design.paper,
    pageMargins: a5 ? [24, 24, 24, banner ? 58 : 36] : [40, 36, 40, banner ? 70 : 44],
    info: { title: `${title} ${doc.number}`.trim(), author: b.name },
    defaultStyle: { fontSize: base, lineHeight: 1.2, color: '#111111' },
    styles: {
      bizName: { fontSize: base + 6, bold: true },
      title: { fontSize: base + 8, bold: true, characterSpacing: 1 },
      label: { fontSize: base - 1.5, bold: true, characterSpacing: 0.6, margin: [0, 0, 0, 2] },
    },
    watermark: doc.status === 'cancelled' ? { text: 'CANCELLED', color: '#d9480f', opacity: 0.12, bold: true } : undefined,
    footer: (current: number, count: number) => {
      const pageNo: Content = count > 1 ? { text: `Page ${current} of ${count}`, alignment: 'center', fontSize: 7, color: '#888888', margin: [0, banner ? 3 : 10, 0, 0] } : { text: '' };
      if (!banner) return pageNo;
      const side = a5 ? 24 : 40;
      return {
        stack: [
          {
            table: { widths: ['*'], body: [[{ text: banner, alignment: 'center', color: '#ffffff', bold: true, fontSize: base - 0.5, margin: [6, 4, 6, 4] }]] },
            layout: { fillColor: theme.accent, hLineWidth: () => 0, vLineWidth: () => 0 },
          },
          pageNo,
        ],
        margin: [side, 8, side, 0],
      } as Content;
    },
    content: [
      header,
      { columns: shipTo ? [billTo, shipTo] : [billTo], columnGap: 20 },
      itemsTable,
      { columns: [{ ...(leftColumn as object), width: '*' } as unknown as Content, { ...(summaryTable as object), width: a5 ? 170 : 220 } as unknown as Content], columnGap: 16, margin: [0, 4, 0, 0] },
      ...footerBlocks,
      signature,
      ...photoPages(doc.photos, show.photos !== false, a5),
    ],
  };
}

/** Photos attached to the bill, two to a page after it, each fitted to half the page. */
function photoPages(photos: string[] | undefined, show: boolean, a5: boolean): Content[] {
  if (!show || !photos?.length) return [];
  const fit: [number, number] = a5 ? [370, 260] : [515, 360];
  return photos.flatMap((p, i) => [
    ...(i % 2 === 0 ? [{ text: i === 0 ? 'Photos' : '', pageBreak: 'before', bold: true, margin: [0, 0, 0, 6] } as Content] : []),
    { image: p, fit, alignment: 'center', margin: [0, 4, 0, 10] } as Content,
  ]);
}
