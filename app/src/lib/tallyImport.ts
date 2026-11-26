import type { Cell, ImportKind } from './importer';

/**
 * R10 Tally import. In Tally: Gateway → Display → List of Accounts (or Export → Masters) as XML.
 * The file has LEDGER masters (customers under "Sundry Debtors", suppliers under "Sundry
 * Creditors") and STOCKITEM masters. They are turned into the same rows the Excel import reads, so
 * the import screen shows its usual preview and "update or skip" for names already here.
 * Tally writes debit balances as negative numbers: a customer who owes ₹1,000 is -1000.00.
 */

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();

/** Each <TAG NAME="…">…</TAG> block. */
function blocks(xml: string, tag: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'g');
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    const attr = /NAME="([^"]*)"/.exec(m[1]!)?.[1];
    const inner = /<NAME>([^<]*)<\/NAME>/.exec(m[2]!)?.[1];
    out.push({ name: decode(attr ?? inner ?? ''), body: m[2]! });
  }
  return out;
}
const tag = (body: string, name: string) => {
  const m = new RegExp(`<${name}\\b[^>]*>([^<]*)</${name}>`).exec(body);
  return m ? decode(m[1]!) : '';
};
const all = (body: string, name: string) => [...body.matchAll(new RegExp(`<${name}\\b[^>]*>([^<]*)</${name}>`, 'g'))].map((m) => decode(m[1]!));
/** "-1,500.00" → -1500; "10 Nos" → 10; "120.00/Nos" → 120. */
const numberIn = (s: string) => {
  const m = /-?[\d,]*\.?\d+/.exec(s.replace(/\s/g, ''));
  return m ? Number(m[0].replace(/,/g, '')) : 0;
};

const DEBTORS = /sundry debtors|debtors|customers/i;
const CREDITORS = /sundry creditors|creditors|suppliers/i;

export function tallyRows(xml: string, kind: ImportKind): Cell[][] {
  if (kind === 'items') {
    const rows: Cell[][] = [['Name', 'Unit', 'Price', 'GST %', 'HSN', 'Category', 'Stock', 'Purchase price', 'MRP']];
    for (const s of blocks(xml, 'STOCKITEM')) {
      if (!s.name) continue;
      const unit = tag(s.body, 'BASEUNITS') || 'pcs';
      const stock = numberIn(tag(s.body, 'OPENINGBALANCE'));
      const cost = numberIn(tag(s.body, 'OPENINGRATE'));
      const price = numberIn(all(s.body, 'RATE').find((r) => r.includes('/')) ?? '') || cost;
      const gst = all(s.body, 'GSTRATE').map(Number).find((n) => n > 0) ?? numberIn(tag(s.body, 'IGSTRATE'));
      const hsn = tag(s.body, 'HSNCODE');
      const mrp = numberIn(tag(s.body, 'MRPRATE'));
      rows.push([s.name, unit, price || 0, gst || 0, hsn, tag(s.body, 'PARENT'), Math.abs(stock) || '', cost || '', mrp || '']);
    }
    return rows;
  }
  const wanted = kind === 'customers' ? DEBTORS : CREDITORS;
  const rows: Cell[][] = [['Name', 'Mobile', 'GSTIN', 'Email', 'Address line 1', 'Address line 2', 'City', 'State', 'PIN', kind === 'customers' ? 'Opening balance' : 'Opening balance (you owe)']];
  for (const l of blocks(xml, 'LEDGER')) {
    if (!l.name || !wanted.test(tag(l.body, 'PARENT'))) continue;
    const address = all(l.body, 'ADDRESS');
    const opening = numberIn(tag(l.body, 'OPENINGBALANCE'));
    // Tally: debit = negative. A debtor owes us −(opening); we owe a creditor +(opening).
    const balance = kind === 'customers' ? -opening : opening;
    const phone = (tag(l.body, 'LEDGERMOBILE') || tag(l.body, 'LEDGERPHONE')).replace(/[^\d+]/g, '');
    rows.push([
      l.name,
      phone,
      tag(l.body, 'PARTYGSTIN') || tag(l.body, 'GSTIN'),
      tag(l.body, 'EMAIL'),
      address[0] ?? '',
      address.slice(1).join(', '),
      '',
      tag(l.body, 'LEDSTATENAME') || tag(l.body, 'STATENAME'),
      tag(l.body, 'PINCODE'),
      balance || 0,
    ]);
  }
  return rows;
}

export const isTallyXml = (name: string, head: string) => /\.xml$/i.test(name) || /<ENVELOPE>|<TALLYMESSAGE/i.test(head);
