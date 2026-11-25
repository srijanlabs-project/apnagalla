import { db, type CreditNote, type Invoice, type Purchase } from './db';
import { gstViewOf } from './gstView';

/**
 * Sales, returns (credit notes) and purchase bills for a period as a Tally import file
 * (Gateway of Tally → Import → Vouchers). Each voucher balances: the party gets the bill total,
 * tax goes to CGST / SGST / IGST ledgers, round-off to "Round Off" and the rest to Sales /
 * Purchase. Ledgers missing in Tally are created by Tally on import if "create masters" is on;
 * the CA can rename them.
 */

export const TALLY_LEDGERS = { sales: 'Sales', purchase: 'Purchase', cgst: 'CGST', sgst: 'SGST', igst: 'IGST', inCgst: 'Input CGST', inSgst: 'Input SGST', inIgst: 'Input IGST', roundOff: 'Round Off', cash: 'Cash' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const amt = (paise: number) => (paise / 100).toFixed(2);
const ymd = (iso: string) => iso.replace(/-/g, '');

interface Entry {
  ledger: string;
  /** Paise; positive = debit. */
  debit: number;
}

function voucher(type: 'Sales' | 'Credit Note' | 'Purchase', date: string, number: string, party: string, entries: Entry[], narration: string): string {
  const lines = entries
    .filter((e) => e.debit !== 0)
    .map((e) => {
      // Tally: debits are "deemed positive" with a negative amount.
      const isDebit = e.debit > 0;
      return `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(e.ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${isDebit ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><ISPARTYLEDGER>${e.ledger === party ? 'Yes' : 'No'}</ISPARTYLEDGER><AMOUNT>${isDebit ? '-' : ''}${amt(Math.abs(e.debit))}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
    })
    .join('');
  return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${ymd(date)}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(number)}</VOUCHERNUMBER><PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME><NARRATION>${esc(narration)}</NARRATION><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>${lines}</VOUCHER></TALLYMESSAGE>`;
}

type Store = Parameters<typeof gstViewOf>[2];

/** Tax split of a bill: CGST, SGST, IGST in paise. */
function taxOf(doc: Invoice | CreditNote, store: Store) {
  const v = gstViewOf('invoice', doc, doc.businessSnapshot ?? store, doc.totals);
  const rows = v.split?.rows ?? [];
  return { cgst: rows.reduce((a, r) => a + r.cgst, 0), sgst: rows.reduce((a, r) => a + r.sgst, 0), igst: rows.reduce((a, r) => a + r.igst, 0) };
}

/** Sale side: the party is debited, sales and tax credited (a credit note is the mirror). */
function saleEntries(doc: Invoice | CreditNote, store: Store, sign: 1 | -1): { party: string; entries: Entry[] } {
  const party = doc.billTo?.name?.trim() || TALLY_LEDGERS.cash;
  const total = doc.totals.grandTotal;
  const tax = taxOf(doc, store);
  const round = doc.totals.roundOff;
  const sales = total - tax.cgst - tax.sgst - tax.igst - round;
  return {
    party,
    entries: [
      { ledger: party, debit: sign * total },
      { ledger: TALLY_LEDGERS.sales, debit: -sign * sales },
      { ledger: TALLY_LEDGERS.cgst, debit: -sign * tax.cgst },
      { ledger: TALLY_LEDGERS.sgst, debit: -sign * tax.sgst },
      { ledger: TALLY_LEDGERS.igst, debit: -sign * tax.igst },
      { ledger: TALLY_LEDGERS.roundOff, debit: -sign * round },
    ],
  };
}

function purchaseEntries(p: Purchase): { party: string; entries: Entry[] } {
  const party = p.supplier?.name?.trim() || TALLY_LEDGERS.cash;
  const total = p.totals.grandTotal;
  const taxTotal = p.totals.taxTotal;
  const inter = p.interState;
  const half = Math.round(taxTotal / 2);
  const tax = inter ? { cgst: 0, sgst: 0, igst: taxTotal } : { cgst: half, sgst: taxTotal - half, igst: 0 };
  const round = p.totals.roundOff;
  const goods = total - taxTotal - round;
  // A purchase return is the mirror of a bill.
  const sign = p.kind === 'return' ? -1 : 1;
  return {
    party,
    entries: [
      { ledger: party, debit: -sign * total },
      { ledger: TALLY_LEDGERS.purchase, debit: sign * goods },
      { ledger: TALLY_LEDGERS.inCgst, debit: sign * tax.cgst },
      { ledger: TALLY_LEDGERS.inSgst, debit: sign * tax.sgst },
      { ledger: TALLY_LEDGERS.inIgst, debit: sign * tax.igst },
      { ledger: TALLY_LEDGERS.roundOff, debit: sign * round },
    ],
  };
}

export interface TallyExport {
  xml: string;
  counts: { sales: number; returns: number; purchases: number };
}

/** The Tally XML for saved bills dated from–to (inclusive). Purchases only when `withPurchases`. */
export async function buildTallyXml(businessId: string, from: string, to: string, withPurchases: boolean): Promise<TallyExport> {
  const inRange = (d: { date: string; status: string; deleted?: boolean }) => !d.deleted && d.status === 'saved' && d.date >= from && d.date <= to;
  const store = await db.profiles.get(businessId);
  const [invoices, notes, purchases] = await Promise.all([
    db.invoices.where('businessId').equals(businessId).filter(inRange).toArray(),
    db.creditNotes.where('businessId').equals(businessId).filter(inRange).toArray(),
    withPurchases ? db.purchases.where('businessId').equals(businessId).filter((p) => inRange(p) && (p.kind === 'bill' || p.kind === 'return')).toArray() : Promise.resolve([] as Purchase[]),
  ]);
  const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date);
  const parts: string[] = [];
  for (const inv of invoices.sort(byDate)) {
    const { party, entries } = saleEntries(inv, store, 1);
    parts.push(voucher('Sales', inv.date, inv.number, party, entries, `Bill ${inv.number}`));
  }
  for (const n of notes.sort(byDate)) {
    const { party, entries } = saleEntries(n, store, -1);
    parts.push(voucher('Credit Note', n.date, n.number, party, entries, `Credit note ${n.number}${n.invoiceNumber ? ` against ${n.invoiceNumber}` : ''}`));
  }
  for (const p of purchases.sort(byDate)) {
    const { party, entries } = purchaseEntries(p);
    parts.push(voucher('Purchase', p.date, p.supplierBillNo || p.id.slice(0, 8), party, entries, `${p.kind === 'return' ? 'Purchase return' : 'Purchase bill'} ${p.supplierBillNo ?? ''}`.trim()));
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC><REQUESTDATA>${parts.join('\n')}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n`;
  return { xml, counts: { sales: invoices.length, returns: notes.length, purchases: purchases.length } };
}
