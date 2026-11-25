import { Capacitor } from '@capacitor/core';
import { formatPaise } from '@invoice/shared';
import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { db } from './db';
import { addressLines } from './format';
import { downloadBlob, pdfmake } from './pdf';

/**
 * One simple table (a report, a statement, a purchase order) that can be shared as a PDF or an
 * Excel file. Money is paise; quantities are plain numbers.
 */
export type ColumnKind = 'text' | 'money' | 'qty' | 'date';
export interface TableColumn {
  label: string;
  kind?: ColumnKind;
  /** pdfmake width ('*', 'auto' or points). */
  width?: string | number;
}
export type CellValue = string | number | null | undefined;

export interface ExportTable {
  /** Big heading, e.g. "Sales report" or "Purchase order PO/26-27/3". */
  title: string;
  /** Under the title: period, customer… */
  subtitle?: string[];
  /** A "To" block (supplier or customer). */
  party?: { heading: string; lines: string[] };
  columns: TableColumn[];
  rows: CellValue[][];
  /** Totals row(s) printed bold at the bottom. */
  foot?: CellValue[][];
  /** Extra lines after the table (notes, summary). */
  after?: string[];
  landscape?: boolean;
  /** For the file name. */
  fileBase: string;
}

const cellText = (v: CellValue, kind: ColumnKind = 'text'): string => {
  if (v == null || v === '') return '';
  if (kind === 'money' && typeof v === 'number') return formatPaise(v);
  if (kind === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
  return String(v);
};

const safeName = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'report';

async function storeHeader(businessId: string): Promise<string[]> {
  const p = await db.profiles.get(businessId);
  if (!p) return [];
  return [p.name, ...addressLines(p.address), [p.phone, p.taxIdValue ? `${p.taxIdLabel || 'GSTIN'}: ${p.taxIdValue}` : ''].filter(Boolean).join(' · ')].filter(Boolean);
}

export async function tableToPdf(businessId: string, tbl: ExportTable): Promise<{ base64: string; blob: Blob }> {
  const pm = await pdfmake();
  const head = await storeHeader(businessId);
  const right = (k?: ColumnKind) => k === 'money' || k === 'qty';
  const body: TableCell[][] = [
    tbl.columns.map((c) => ({ text: c.label, bold: true, fillColor: '#eef3ef', alignment: right(c.kind) ? 'right' : 'left' })),
    ...tbl.rows.map((r) => r.map((v, i) => ({ text: cellText(v, tbl.columns[i]?.kind), alignment: right(tbl.columns[i]?.kind) ? 'right' : 'left' }) as TableCell)),
    ...(tbl.foot ?? []).map((r) => r.map((v, i) => ({ text: cellText(v, tbl.columns[i]?.kind), bold: true, alignment: right(tbl.columns[i]?.kind) ? 'right' : 'left' }) as TableCell)),
  ];
  const content: Content[] = [
    ...(head.length ? [{ text: head[0]!, bold: true, fontSize: 13 } as Content, ...head.slice(1).map((l) => ({ text: l, fontSize: 8, color: '#555' }) as Content)] : []),
    { text: tbl.title, bold: true, fontSize: 14, margin: [0, 10, 0, 2] },
    ...(tbl.subtitle ?? []).map((l) => ({ text: l, fontSize: 9, color: '#444' }) as Content),
    ...(tbl.party ? [{ text: tbl.party.heading, bold: true, fontSize: 9, margin: [0, 8, 0, 0] } as Content, ...tbl.party.lines.map((l) => ({ text: l, fontSize: 9 }) as Content)] : []),
    {
      margin: [0, 10, 0, 0],
      table: { headerRows: 1, widths: tbl.columns.map((c) => c.width ?? (right(c.kind) ? 'auto' : '*')), body },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => '#ccc', paddingTop: () => 3, paddingBottom: () => 3 },
      fontSize: 8.5,
    },
    ...(tbl.after ?? []).map((l) => ({ text: l, fontSize: 9, margin: [0, 6, 0, 0] }) as Content),
  ];
  const def: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: tbl.landscape ? 'landscape' : 'portrait',
    pageMargins: [28, 28, 28, 36],
    defaultStyle: { fontSize: 9 },
    footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: 'center', fontSize: 7, color: '#888' }),
    content,
  };
  const pdf = pm.createPdf(def);
  const base64 = await (pdf.getBase64 as unknown as () => Promise<string>)();
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return { base64, blob: new Blob([bytes], { type: 'application/pdf' }) };
}

/** Excel keeps numbers as numbers (rupees with decimals), so the shop or CA can add them up. */
export async function tableToExcel(tbl: ExportTable): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const value = (v: CellValue, kind: ColumnKind = 'text') => {
    if (v == null || v === '') return null;
    if (kind === 'money' && typeof v === 'number') return { value: v / 100, type: Number, format: '#,##0.00' };
    if (kind === 'qty' && typeof v === 'number') return { value: v, type: Number };
    return { value: cellText(v, kind), type: String };
  };
  const data = [
    [{ value: tbl.title, fontWeight: 'bold' as const }],
    ...(tbl.subtitle ?? []).map((l) => [{ value: l }]),
    [],
    tbl.columns.map((c) => ({ value: c.label, fontWeight: 'bold' as const })),
    ...tbl.rows.map((r) => r.map((v, i) => value(v, tbl.columns[i]?.kind))),
    ...(tbl.foot ?? []).map((r) => r.map((v, i) => ({ ...(value(v, tbl.columns[i]?.kind) ?? { value: null }), fontWeight: 'bold' as const }))),
    ...(tbl.after?.length ? [[], ...tbl.after.map((l) => [{ value: l }])] : []),
  ];
  return writeXlsxFile(data as never, { columns: tbl.columns.map((c) => ({ width: c.kind === 'text' ? 28 : 14 })) }).toBlob();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** System share sheet with the file (WhatsApp, email, Drive…); a download on a computer. */
export async function shareFile(fileName: string, blob: Blob, text?: string): Promise<'shared' | 'downloaded'> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const written = await Filesystem.writeFile({ path: fileName, data: await blobToBase64(blob), directory: Directory.Cache });
    await Share.share({ title: fileName, text, files: [written.uri], dialogTitle: fileName });
    return 'shared';
  }
  const file = new File([blob], fileName, { type: blob.type });
  if (navigator.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: fileName, text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  downloadBlob(fileName, blob);
  return 'downloaded';
}

export async function shareTable(businessId: string, tbl: ExportTable, as: 'pdf' | 'excel', text?: string): Promise<'shared' | 'downloaded'> {
  const base = safeName(tbl.fileBase);
  if (as === 'pdf') return shareFile(`${base}.pdf`, (await tableToPdf(businessId, tbl)).blob, text);
  return shareFile(`${base}.xlsx`, await tableToExcel(tbl), text);
}
