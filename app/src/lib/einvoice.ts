import { stateCode } from '@invoice/shared';
import type { BusinessProfile, CreditNote, Customer, Invoice } from './db';
import { invoiceGst } from './reports';

/**
 * R10 e-invoice and e-way bill, in the government's own JSON layouts:
 * - e-invoice (IRP schema 1.1): sent to the IRP through the store's GST provider (GSP) to get an
 *   IRN and signed QR; the server does that once the GSP keys are set.
 * - e-way bill (the portal's bulk-upload JSON): the store uploads it on ewaybillgst.gov.in
 *   (Generate bulk), or the GSP generates it. Needed when goods worth over ₹50,000 move.
 * Amounts are rupees with two decimals, dates dd/mm/yyyy, as the schemas want.
 */

const r2 = (paise: number) => Math.round(paise) / 100;
const dmy = (iso: string) => iso.split('-').reverse().join('/');
const pin = (p?: string) => (p && /^\d{6}$/.test(p.trim()) ? Number(p.trim()) : undefined);
const stcd = (gstinOrState: string | undefined, state?: string) => (gstinOrState && /^\d{2}/.test(gstinOrState) ? gstinOrState.slice(0, 2) : stateCode(state) ?? '');

/** Units as GST's UQC codes. */
const UQC: Record<string, string> = {
  pcs: 'NOS', pc: 'NOS', nos: 'NOS', no: 'NOS', piece: 'NOS', pieces: 'NOS', unit: 'UNT', units: 'UNT',
  kg: 'KGS', kgs: 'KGS', g: 'GMS', gm: 'GMS', gms: 'GMS', gram: 'GMS', ton: 'TON', quintal: 'QTL', qtl: 'QTL',
  l: 'LTR', ltr: 'LTR', litre: 'LTR', liter: 'LTR', ml: 'MLT',
  m: 'MTR', mtr: 'MTR', metre: 'MTR', meter: 'MTR', cm: 'CMS', ft: 'FTS', feet: 'FTS',
  'sq ft': 'SQF', sqft: 'SQF', 'sq m': 'SQM', sqm: 'SQM', 'running ft': 'FTS',
  box: 'BOX', bag: 'BAG', bags: 'BAG', bottle: 'BTL', btl: 'BTL', bundle: 'BDL', can: 'CAN', carton: 'CTN', ctn: 'CTN',
  dozen: 'DOZ', doz: 'DOZ', pair: 'PRS', pairs: 'PRS', packet: 'PAC', pkt: 'PAC', pack: 'PAC', roll: 'ROL', set: 'SET', sets: 'SET', strip: 'NOS', tablet: 'TBS', tube: 'TUB',
};
export const uqc = (unit: string) => UQC[unit.trim().toLowerCase()] ?? 'OTH';

export interface EInvoiceProblems {
  problems: string[];
}

/** What stops a bill from being an e-invoice (B2B tax invoice with complete details). */
export function eInvoiceProblems(kind: 'invoice' | 'credit', doc: Invoice | CreditNote, profile: BusinessProfile, buyer?: Customer | null): string[] {
  const out: string[] = [];
  if (doc.status !== 'saved') out.push('Save the bill first');
  if (doc.taxMode === 'none') out.push('Only tax invoices get an e-invoice');
  if (!profile.taxIdValue) out.push('Your store’s GSTIN is missing');
  if (!pin(profile.address?.pin)) out.push('Your store’s PIN code is missing');
  const gstin = doc.billTo?.taxId || buyer?.taxId;
  if (!gstin) out.push('The buyer’s GSTIN is missing (e-invoices are for B2B bills)');
  const addr = doc.billTo?.address ?? buyer?.billingAddress;
  if (!pin(addr?.pin)) out.push('The buyer’s PIN code is missing');
  if (doc.lines.some((l) => !l.hsn)) out.push('Every item needs an HSN code');
  if (kind === 'credit' && !(doc as CreditNote).invoiceNumber) out.push('A credit note needs its invoice');
  return out;
}

/** The e-invoice JSON (IRP schema 1.1) for a saved tax invoice or credit note. */
export function eInvoiceJson(kind: 'invoice' | 'credit', doc: Invoice | CreditNote, profile: BusinessProfile, buyer?: Customer | null) {
  const g = invoiceGst(doc, profile);
  const interState = g.igst > 0;
  const sellerGstin = profile.taxIdValue ?? '';
  const bAddr = doc.billTo?.address ?? buyer?.billingAddress ?? {};
  const bGstin = doc.billTo?.taxId || buyer?.taxId || '';
  const pos = doc.placeOfSupply || stcd(bGstin, bAddr.state);
  const items = doc.lines.map((l, i) => {
    const r = doc.totals.lines[i]!;
    const tax = r.tax;
    const [c, s] = interState ? [0, 0] : [Math.round(tax / 2), tax - Math.round(tax / 2)];
    return {
      SlNo: String(i + 1),
      PrdDesc: l.name.slice(0, 300),
      IsServc: (l.hsn ?? '').startsWith('99') ? 'Y' : 'N',
      HsnCd: l.hsn ?? '',
      Qty: Math.round(l.qty * 1000) / 1000,
      Unit: uqc(l.unit),
      UnitPrice: r2(r.baseRate),
      TotAmt: r2(r.gross),
      Discount: r2(r.lineDiscount + r.overallShare),
      AssAmt: r2(r.taxable),
      GstRt: l.taxPct,
      IgstAmt: r2(interState ? tax : 0),
      CgstAmt: r2(c),
      SgstAmt: r2(s),
      TotItemVal: r2(r.amount),
    };
  });
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: kind === 'credit' ? 'CRN' : 'INV', No: doc.number, Dt: dmy(doc.date) },
    SellerDtls: {
      Gstin: sellerGstin,
      LglNm: profile.legalName || profile.name,
      TrdNm: profile.name,
      Addr1: (profile.address?.line1 || profile.name).slice(0, 100),
      ...(profile.address?.line2 ? { Addr2: profile.address.line2.slice(0, 100) } : {}),
      Loc: profile.address?.city || profile.address?.state || '',
      Pin: pin(profile.address?.pin),
      Stcd: stcd(sellerGstin, profile.address?.state),
      ...(profile.phone ? { Ph: profile.phone.replace(/\D/g, '').slice(-10) } : {}),
      ...(profile.email ? { Em: profile.email } : {}),
    },
    BuyerDtls: {
      Gstin: bGstin,
      LglNm: doc.billTo?.name ?? buyer?.name ?? '',
      Pos: pos,
      Addr1: (bAddr.line1 || doc.billTo?.name || '').slice(0, 100),
      ...(bAddr.line2 ? { Addr2: bAddr.line2.slice(0, 100) } : {}),
      Loc: bAddr.city || bAddr.state || '',
      Pin: pin(bAddr.pin),
      Stcd: stcd(bGstin, bAddr.state),
    },
    ...(kind === 'credit' ? { RefDtls: { PrecDocDtls: [{ InvNo: (doc as CreditNote).invoiceNumber ?? '', InvDt: dmy((doc as CreditNote).invoiceDate ?? doc.date) }] } } : {}),
    ItemList: items,
    ValDtls: {
      AssVal: r2(doc.totals.taxableAmount),
      CgstVal: r2(g.cgst),
      SgstVal: r2(g.sgst),
      IgstVal: r2(g.igst),
      Discount: 0,
      OthChrg: r2(doc.totals.chargesTotal),
      RndOffAmt: r2(doc.totals.roundOff),
      TotInvVal: r2(doc.totals.grandTotal),
    },
  };
}

export interface Transport {
  /** 1 road, 2 rail, 3 air, 4 ship. */
  mode: 1 | 2 | 3 | 4;
  distanceKm: number;
  vehicleNo?: string;
  transporterId?: string;
  transporterName?: string;
  /** Delivery PIN if not the buyer's address. */
  toPin?: string;
}

/** The e-way bill bulk-upload JSON for one invoice (outward supply). */
export function ewayBillJson(doc: Invoice, profile: BusinessProfile, transport: Transport, buyer?: Customer | null) {
  const g = invoiceGst(doc, profile);
  const interState = g.igst > 0;
  const sellerGstin = profile.taxIdValue ?? '';
  const ship = doc.shipTo ?? doc.billTo?.address ?? buyer?.billingAddress ?? {};
  const bGstin = doc.billTo?.taxId || buyer?.taxId || 'URP';
  const fromSt = Number(stcd(sellerGstin, profile.address?.state)) || 0;
  const toSt = Number(stcd(bGstin === 'URP' ? '' : bGstin, ship.state)) || fromSt;
  const actToSt = Number(stateCode(ship.state)) || toSt;
  return {
    version: '1.0.0621',
    billLists: [
      {
        userGstin: sellerGstin,
        supplyType: 'O',
        subSupplyType: 1,
        subSupplyDesc: '',
        docType: 'INV',
        docNo: doc.number,
        docDate: dmy(doc.date),
        transType: 1,
        fromGstin: sellerGstin,
        fromTrdName: profile.legalName || profile.name,
        fromAddr1: profile.address?.line1 ?? '',
        fromAddr2: profile.address?.line2 ?? '',
        fromPlace: profile.address?.city ?? '',
        fromPincode: pin(profile.address?.pin) ?? 0,
        fromStateCode: fromSt,
        actualFromStateCode: fromSt,
        toGstin: bGstin,
        toTrdName: doc.billTo?.name ?? '',
        toAddr1: ship.line1 ?? '',
        toAddr2: ship.line2 ?? '',
        toPlace: ship.city ?? '',
        toPincode: pin(transport.toPin) ?? pin(ship.pin) ?? 0,
        toStateCode: toSt,
        actualToStateCode: actToSt,
        totalValue: r2(doc.totals.taxableAmount),
        cgstValue: r2(g.cgst),
        sgstValue: r2(g.sgst),
        igstValue: r2(g.igst),
        cessValue: 0,
        cessNonAdvolValue: 0,
        otherValue: r2(doc.totals.chargesTotal + doc.totals.roundOff),
        totInvValue: r2(doc.totals.grandTotal),
        transMode: transport.mode,
        transDistance: Math.max(0, Math.round(transport.distanceKm)),
        transporterId: transport.transporterId ?? '',
        transporterName: transport.transporterName ?? '',
        transDocNo: '',
        transDocDate: '',
        vehicleNo: (transport.vehicleNo ?? '').replace(/[\s-]/g, '').toUpperCase(),
        vehicleType: 'R',
        itemList: doc.lines.map((l, i) => ({
          itemNo: i + 1,
          productName: l.name.slice(0, 100),
          productDesc: (l.description ?? l.name).slice(0, 100),
          hsnCode: Number(l.hsn ?? 0),
          quantity: Math.round(l.qty * 1000) / 1000,
          qtyUnit: uqc(l.unit),
          taxableAmount: r2(doc.totals.lines[i]?.taxable ?? 0),
          sgstRate: interState ? 0 : l.taxPct / 2,
          cgstRate: interState ? 0 : l.taxPct / 2,
          igstRate: interState ? l.taxPct : 0,
          cessRate: 0,
          cessNonAdvol: 0,
        })),
      },
    ],
  };
}

/** An e-way bill is needed when goods over ₹50,000 move (some states have other limits). */
export const needsEwayBill = (doc: Pick<Invoice, 'totals'>) => doc.totals.grandTotal > 5_000_000;
