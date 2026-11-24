import { halfRate, splitGst, stateLabel, type GstSplit, type GstType, type InvoiceTotals } from '@invoice/shared';
import type { BusinessProfile, DocBase } from './db';
import { effectiveGstType, placeOfSupplyOf, storeStateCode, type DocKind } from './repo';
import { translate } from './i18n';
import type { Lang } from '@invoice/shared';

/** Chandigarh, Andaman and Nicobar, Lakshadweep, Dadra and Nagar Haveli and Daman and Diu, Ladakh. */
const UTGST_TERRITORIES = ['04', '35', '31', '26', '38'];

type Store = Pick<BusinessProfile, 'gstType' | 'taxIdValue' | 'address'>;

/** How a document is taxed and titled, for the editor, the detail screen and the PDF. */
export interface GstView {
  /** gst: CGST/SGST or IGST; none: no tax; legacy: saved before R1.3, taxed as entered. */
  mode: 'gst' | 'none' | 'legacy';
  gstType: GstType;
  /** Place of supply (state code) and its label "Gujarat (24)". */
  pos?: string;
  posLabel: string;
  interState: boolean;
  /** "SGST", or "UTGST" for a store in a union territory without its own legislature. */
  sgstName: 'SGST' | 'UTGST';
  split: GstSplit | null;
  /** "Tax Invoice", "Bill of Supply", "Credit Note"… */
  title: string;
  /** Printed under the title, e.g. the composition-scheme declaration. */
  declaration?: string;
}

export function gstViewOf(kind: DocKind, doc: Pick<DocBase, 'taxMode' | 'placeOfSupply' | 'shipTo' | 'billTo'>, store: Store | null | undefined, totals: InvoiceTotals): GstView {
  const gstType = effectiveGstType(store);
  const mode = doc.taxMode ?? 'legacy';
  const pos = mode === 'gst' ? placeOfSupplyOf(doc, store) : undefined;
  const home = storeStateCode(store);
  const interState = !!pos && !!home && pos !== home;
  const split = mode === 'gst' ? splitGst(totals, interState) : null;

  let title: string;
  if (kind === 'estimate') title = 'Estimate';
  else if (kind === 'credit') title = 'Credit Note';
  else if (mode === 'gst') title = 'Tax Invoice';
  else if (mode === 'none' && gstType !== 'unregistered') title = 'Bill of Supply';
  else title = 'Invoice';

  const declaration = gstType === 'composition' && kind !== 'estimate' ? 'Composition taxable person, not eligible to collect tax on supplies' : undefined;
  const sgstName = home && UTGST_TERRITORIES.includes(home) ? 'UTGST' : 'SGST';
  return { mode, gstType, pos, posLabel: stateLabel(pos), interState, sgstName, split, title, declaration };
}

/** Summary rows for the tax: "CGST @9%", "SGST @9%" or "IGST @18%"; old documents keep "Tax @18%". */
export function taxRows(view: GstView, totals: InvoiceTotals): { label: string; amount: number }[] {
  if (view.mode === 'none') return [];
  if (!view.split) return totals.taxBreakdown.filter((t) => t.tax).map((t) => ({ label: `Tax @${t.taxPct}%`, amount: t.tax }));
  return view.split.rows
    .filter((r) => r.cgst || r.sgst || r.igst)
    .flatMap((r) =>
      view.interState
        ? [{ label: `IGST @${r.taxPct}%`, amount: r.igst }]
        : [
            { label: `CGST @${halfRate(r.taxPct)}%`, amount: r.cgst },
            { label: `${view.sgstName} @${halfRate(r.taxPct)}%`, amount: r.sgst },
          ],
    );
}

/**
 * A bill title or the composition declaration in a language (PDFs stay English: they use
 * view.title directly). Literal phrases so the translation tooling finds them.
 */
export function titleIn(text: string, lang: Lang): string {
  switch (text) {
    case 'Tax Invoice':
      return translate(lang, 'Tax Invoice');
    case 'Bill of Supply':
      return translate(lang, 'Bill of Supply');
    case 'Credit Note':
      return translate(lang, 'Credit Note');
    case 'Estimate':
      return translate(lang, 'Estimate');
    case 'Invoice':
      return translate(lang, 'Invoice');
    case 'Composition taxable person, not eligible to collect tax on supplies':
      return translate(lang, 'Composition taxable person, not eligible to collect tax on supplies');
    default:
      return text;
  }
}
