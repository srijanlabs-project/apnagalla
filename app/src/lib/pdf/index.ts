import { Capacitor } from '@capacitor/core';
import type { InvoiceTotals } from '@invoice/shared';
import { db, type BusinessSettings, type CreditNote, type Estimate, type Invoice } from '../db';
import { billMoney, computeTotals, type DocKind } from '../repo';
import { buildDocDefinition, type BusinessInfo, type PdfInput } from './buildDoc';

/** pdfmake is ~1 MB with fonts, so it loads only when a PDF is first needed. */
export async function pdfmake() {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
  const pm = pdfMake as unknown as { addVirtualFileSystem?: (v: unknown) => void; vfs?: unknown; createPdf: typeof pdfMake.createPdf };
  if (pm.addVirtualFileSystem) pm.addVirtualFileSystem(vfs);
  else pm.vfs = vfs;
  return pm;
}

export async function renderPdf(input: PdfInput, totals?: InvoiceTotals): Promise<{ base64: string; blob: Blob }> {
  const pm = await pdfmake();
  const def = buildDocDefinition(input, totals ?? computeTotals(input.doc));
  const pdf = pm.createPdf(def);
  const base64 = await (pdf.getBase64 as unknown as () => Promise<string>)();
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return { base64, blob: new Blob([bytes], { type: 'application/pdf' }) };
}

/** Gathers business, design and payment details for a saved or draft document. */
export async function pdfInputFor(kind: DocKind, doc: Invoice | Estimate | CreditNote, settings: BusinessSettings): Promise<PdfInput> {
  const profile = await db.profiles.get(doc.businessId);
  const { id: _i, businessId: _b, createdAt: _c, updatedAt: _u, updatedBy: _ub, deleted: _d, ...live } = profile ?? ({ name: '', address: {} } as never);
  // SPEC §1: saved documents print the business details as they were when saved.
  const business: BusinessInfo = (doc.businessSnapshot ?? live) as BusinessInfo;
  const bank = doc.bankAccountId ? await db.bankAccounts.get(doc.bankAccountId) : null;
  const upi = doc.upiIdId ? await db.upiIds.get(doc.upiIdId) : null;
  return {
    kind,
    doc,
    business,
    design: settings.design,
    bank: bank && !bank.deleted ? bank : null,
    upi: upi && !upi.deleted ? upi : null,
    otherPaymentInstructions: settings.otherPaymentInstructions,
    money: kind === 'invoice' && doc.status === 'saved' ? await billMoney(doc.id) : null,
  };
}

export function pdfFileName(kind: DocKind, doc: Invoice | Estimate | CreditNote): string {
  const num = (doc.number || 'draft').replace(/[^A-Za-z0-9-]+/g, '-');
  const who = (doc.billTo?.name ?? '').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 30);
  const what = { invoice: 'Invoice', estimate: 'Estimate', credit: 'Credit-note' }[kind];
  return `${what}-${num}${who ? `-${who}` : ''}.pdf`;
}

/**
 * Opens the system share sheet with the PDF attached (WhatsApp, email, Drive…).
 * Android: writes to the app cache and shares the file. Web: Web Share API, else download.
 */
export async function sharePdf(fileName: string, pdf: { base64: string; blob: Blob }, text?: string): Promise<'shared' | 'downloaded'> {
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
    const written = await Filesystem.writeFile({ path: fileName, data: pdf.base64, directory: Directory.Cache });
    await Share.share({ title: fileName, text, files: [written.uri], dialogTitle: 'Share invoice' });
    return 'shared';
  }
  const file = new File([pdf.blob], fileName, { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName, text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  downloadBlob(fileName, pdf.blob);
  return 'downloaded';
}

export function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
