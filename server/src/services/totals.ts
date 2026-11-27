import { calculateInvoice } from '@invoice/shared';

type Data = Record<string, unknown>;

/**
 * Works a saved document's totals out again from its lines, discount, charges and round-off, the same
 * way the app does, and says what is wrong if the stored total differs by more than a paisa.
 */
export function totalsProblem(doc: Data): string | null {
  const totals = doc.totals as { grandTotal?: number } | undefined;
  if (!Array.isArray(doc.lines) || typeof totals?.grandTotal !== 'number') return null;
  const noTax = doc.taxMode === 'none';
  try {
    const lines = (doc.lines as Data[]).map((l) => (noTax ? { ...l, taxPct: 0, rateIncludesTax: false } : l));
    const charges = (Array.isArray(doc.charges) ? (doc.charges as Data[]) : []).map((c) => (noTax ? { ...c, taxPct: 0 } : c));
    const again = calculateInvoice({
      lines: lines as never,
      overallDiscount: (doc.overallDiscount ?? null) as never,
      charges: charges as never,
      roundOff: !!doc.roundOff,
      targetTotal: (doc.targetTotal ?? null) as never,
    });
    if (Math.abs(again.grandTotal - totals.grandTotal) > 1) {
      return `Bill totals don't add up: the items come to ₹${(again.grandTotal / 100).toFixed(2)}, the bill says ₹${(totals.grandTotal / 100).toFixed(2)}`;
    }
    return null;
  } catch {
    return 'This bill could not be checked: its items look damaged';
  }
}
