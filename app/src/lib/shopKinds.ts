import { addDaysISO, todayISO } from '@invoice/shared';
import { db, type CrateEntry, type Estimate, type Invoice } from './db';
import { t } from './i18n';
import { newId, newInvoiceDraft, PermissionError, putRecord, saveInvoice, type Actor } from './repo';

/** R11 pieces used by many kinds of shop: crates, one bill for many challans, instalments. */

const canChange = (actor: Actor) => {
  if (actor.access === 'readonly' || actor.access === 'warehouse') throw new PermissionError(t('This login can only view the books'));
};

/* ---------- crates and containers ---------- */

export async function saveCrates(actor: Actor, e: Omit<CrateEntry, 'id' | 'businessId' | 'createdAt' | 'updatedAt' | 'updatedBy'>): Promise<CrateEntry> {
  canChange(actor);
  if (!(e.out > 0) && !(e.back > 0) && !e.deposit) throw new Error(t('Enter crates given, taken back or a deposit'));
  return putRecord('crates', actor, { ...e, id: newId(), kind: e.kind.trim() || t('Crate') } as CrateEntry);
}

export interface CrateBalance {
  partyId: string;
  partyName: string;
  partyType: CrateEntry['partyType'];
  kind: string;
  /** With the party (+) or with us from them (−). */
  out: number;
  deposit: number;
}

export async function crateBalances(businessId: string): Promise<CrateBalance[]> {
  const list = await db.crates.where('businessId').equals(businessId).filter((c) => !c.deleted).toArray();
  const m = new Map<string, CrateBalance>();
  for (const c of list) {
    const k = `${c.partyId}|${c.kind.toLowerCase()}`;
    const s = m.get(k) ?? (m.set(k, { partyId: c.partyId, partyName: c.partyName, partyType: c.partyType, kind: c.kind, out: 0, deposit: 0 }), m.get(k)!);
    s.out += (c.out || 0) - (c.back || 0);
    s.deposit += c.deposit || 0;
  }
  return [...m.values()].filter((b) => b.out !== 0 || b.deposit !== 0).sort((a, b) => b.out - a.out);
}

/* ---------- daily delivery, one bill ---------- */

/** Challans of a customer not yet billed, oldest first. */
export async function unbilledChallans(businessId: string, customerId: string): Promise<Estimate[]> {
  const list = await db.estimates.where('businessId').equals(businessId).filter((e) => !!e.challan && !e.consignment && !e.deleted && e.status !== 'draft' && e.status !== 'converted' && e.status !== 'declined' && e.billTo?.customerId === customerId).toArray();
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** One draft bill for several challans (their lines, each marked with its challan); the challans are marked billed. */
export async function billChallans(actor: Actor, challanIds: string[]): Promise<Invoice> {
  canChange(actor);
  const challans = (await db.estimates.bulkGet(challanIds)).filter((c): c is Estimate => !!c && !!c.challan && c.status !== 'converted');
  if (!challans.length) throw new Error(t('No challans to bill'));
  const first = challans[0]!;
  const draft = await newInvoiceDraft(actor);
  const dates = challans.map((c) => c.date).sort();
  const saved = await saveInvoice(
    actor,
    {
      ...draft,
      reference: t('Challans {list}', { list: challans.map((c) => c.number).join(', ') }).slice(0, 200),
      notes: t('For deliveries {from} to {to}', { from: dates[0]!.split('-').reverse().join('/'), to: dates[dates.length - 1]!.split('-').reverse().join('/') }),
      taxMode: first.taxMode ?? draft.taxMode,
      billTo: first.billTo,
      shipTo: first.shipTo,
      lines: challans.flatMap((c) => c.lines.map((l) => ({ ...l, id: newId(), description: [l.description, `${c.number} · ${c.date.split('-').reverse().join('/')}`].filter(Boolean).join(' · ') }))),
      fromChallanIds: challans.map((c) => c.id),
    },
    { finalize: false },
  );
  for (const c of challans) await putRecord('estimates', actor, { ...c, status: 'converted', convertedInvoiceId: saved.id });
  return saved;
}

/* ---------- instalments run by the shop ---------- */

export interface Instalment {
  n: number;
  due: string;
  amount: number;
  paid: number;
  state: 'paid' | 'part' | 'due' | 'late';
}

/** The plan's dates and amounts, and how much of each is paid (payments fill them in order). */
export function instalmentSchedule(inv: Pick<Invoice, 'instalments' | 'totals'>, paidSoFar: number, today = todayISO()): Instalment[] {
  const plan = inv.instalments;
  if (!plan || plan.count < 1) return [];
  const rest = Math.max(0, inv.totals.grandTotal - plan.downPayment);
  const each = Math.floor(rest / plan.count);
  let left = Math.max(0, paidSoFar - plan.downPayment);
  const out: Instalment[] = [];
  for (let i = 0; i < plan.count; i++) {
    const amount = i === plan.count - 1 ? rest - each * (plan.count - 1) : each;
    const due = plan.every === 'week' ? addDaysISO(plan.first, 7 * i) : addMonthsISO(plan.first, i);
    const paid = Math.min(amount, left);
    left -= paid;
    out.push({ n: i + 1, due, amount, paid, state: paid >= amount ? 'paid' : paid > 0 ? 'part' : due < today ? 'late' : 'due' });
  }
  return out;
}

export function addMonthsISO(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const base = new Date(y, m - 1 + n, 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  return todayISO(new Date(base.getFullYear(), base.getMonth(), Math.min(d, last)));
}

/** Bills on instalments with something late, for the owner's list. */
export async function lateInstalments(businessId: string, paidOf: (inv: Invoice) => number, today = todayISO()) {
  const bills = await db.invoices.where('businessId').equals(businessId).filter((i) => i.status === 'saved' && !i.deleted && !!i.instalments).toArray();
  return bills
    .map((inv) => ({ inv, late: instalmentSchedule(inv, paidOf(inv), today).filter((x) => x.state === 'late' || (x.state === 'part' && x.due < today)) }))
    .filter((x) => x.late.length)
    .map((x) => ({ ...x, amount: x.late.reduce((a, i) => a + i.amount - i.paid, 0) }));
}

/* ---------- contractor sites ---------- */

/** A contractor's bills by site, with what is still to pay on each. */
export async function sitesOf(businessId: string, customerId: string) {
  const { buildLedger, moneyOf } = await import('./ledger');
  const [bills, pays, notes] = await Promise.all([
    db.invoices.where('billTo.customerId').equals(customerId).filter((i) => i.businessId === businessId && i.status === 'saved' && !i.deleted && !!i.site?.trim()).toArray(),
    db.payments.where('businessId').equals(businessId).toArray(),
    db.creditNotes.where('businessId').equals(businessId).toArray(),
  ]);
  const ledger = buildLedger(pays, notes);
  const m = new Map<string, { site: string; bills: Invoice[]; total: number; pending: number }>();
  for (const b of bills) {
    const k = b.site!.trim();
    const s = m.get(k.toLowerCase()) ?? (m.set(k.toLowerCase(), { site: k, bills: [], total: 0, pending: 0 }), m.get(k.toLowerCase())!);
    s.bills.push(b);
    s.total += b.totals.grandTotal;
    s.pending += moneyOf(b, ledger).pending;
  }
  return [...m.values()].sort((a, b) => b.pending - a.pending);
}

/** Statement of one site for the contractor to pass on to their client. */
export async function siteTable(businessId: string, customerName: string, site: Awaited<ReturnType<typeof sitesOf>>[number]) {
  const { buildLedger, moneyOf } = await import('./ledger');
  const [pays, notes] = await Promise.all([db.payments.where('businessId').equals(businessId).toArray(), db.creditNotes.where('businessId').equals(businessId).toArray()]);
  const ledger = buildLedger(pays, notes);
  const rows = site.bills
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((b) => {
      const mo = moneyOf(b, ledger);
      return [b.date, b.number, b.totals.grandTotal, mo.paid, mo.pending];
    });
  return {
    title: t('Statement for site'),
    subtitle: [customerName, site.site],
    columns: [{ label: t('Date'), kind: 'date' as const }, { label: t('Bill') }, { label: t('Amount'), kind: 'money' as const }, { label: t('Paid'), kind: 'money' as const }, { label: t('Pending'), kind: 'money' as const }],
    rows,
    foot: [[t('Total'), '', site.total, site.total - site.pending, site.pending]],
    fileBase: `Site-${site.site}`.replace(/[^\w-]+/g, '-'),
  };
}
