import { todayISO } from '@invoice/shared';
import type { CashMode } from '../components/MoneyEntrySheet';
import { db, type Customer, type Estimate, type Invoice, type JobInfo, type JobStage, type PaymentEntry, type RepairStage, type WorkStage } from './db';
import type { ExportTable } from './exportTable';
import { t } from './i18n';
import { applyAdvance, khataOf } from './khata';
import { moneyOf, buildLedger } from './ledger';
import { newEstimateDraft, newId, putRecord, saveEstimate, type Actor } from './repo';

/**
 * Jobs: work orders (painting, carpentry, flex, acrylic) and repairs (phones, electronics). A job is
 * an estimate with a stage, so its quote, PDF and "make bill" are the estimate's. Advances are khata
 * payments on account tagged with the job, used on the job's bill.
 */

export const WORK_STAGES: WorkStage[] = ['measure', 'quoted', 'confirmed', 'in_progress', 'ready', 'delivered'];
export const REPAIR_STAGES: RepairStage[] = ['received', 'diagnosing', 'waiting_parts', 'repaired', 'delivered'];
/** Stages a job can end in. */
export const CLOSED: JobStage[] = ['delivered', 'cancelled', 'returned'];

const STAGE_TEXT: Record<JobStage, () => string> = {
  measure: () => t('Measurement'),
  quoted: () => t('Quote given'),
  confirmed: () => t('Confirmed'),
  in_progress: () => t('In progress'),
  ready: () => t('Ready'),
  delivered: () => t('Delivered'),
  cancelled: () => t('Cancelled'),
  received: () => t('Received'),
  diagnosing: () => t('Checking'),
  waiting_parts: () => t('Waiting for parts'),
  repaired: () => t('Repaired'),
  returned: () => t('Returned without repair'),
};
export const stageLabel = (s: JobStage): string => STAGE_TEXT[s]?.() ?? s;

export const stagesOf = (kind: JobInfo['kind']): JobStage[] => (kind === 'work' ? WORK_STAGES : REPAIR_STAGES);

/** The next step forward, if any. */
export function nextStage(job: JobInfo): JobStage | null {
  const list = stagesOf(job.kind);
  const i = list.indexOf(job.stage);
  return i >= 0 && i < list.length - 1 ? list[i + 1]! : null;
}

export async function newJob(actor: Actor, kind: JobInfo['kind'], customer: Customer | null): Promise<Estimate> {
  const draft = await newEstimateDraft(actor);
  const first: JobStage = kind === 'work' ? 'measure' : 'received';
  return {
    ...draft,
    billTo: customer ? { customerId: customer.id, name: customer.name, phone: customer.phone, email: customer.email, address: customer.billingAddress, taxId: customer.taxId } : null,
    job: { kind, stage: first, title: '', photos: [], stageHistory: [{ stage: first, at: new Date().toISOString(), byName: actor.userName }] },
  };
}

/** Saves the job (first save gives it a number, like an estimate). */
export async function saveJob(actor: Actor, est: Estimate): Promise<Estimate> {
  return saveEstimate(actor, est, { finalize: true });
}

/** Moves a job to a stage; delivered also marks the delivery done. */
export async function setStage(actor: Actor, est: Estimate, stage: JobStage): Promise<Estimate> {
  if (!est.job) return est;
  const at = new Date().toISOString();
  const job: JobInfo = { ...est.job, stage, stageHistory: [...est.job.stageHistory, { stage, at, byName: actor.userName }] };
  const delivered = stage === 'delivered' && !est.deliveredAt ? { deliveredAt: at, deliveredByName: actor.userName } : {};
  return putRecord('estimates', actor, { ...est, job, ...delivered });
}

/** Advances taken for this job, less what was already used on its bill. */
export async function jobAdvance(businessId: string, jobId: string): Promise<number> {
  const pays = await db.payments.where('businessId').equals(businessId).filter((p) => p.jobId === jobId && !p.voidedAt && !p.deleted).toArray();
  return pays.reduce((a, p) => a + (p.kind === 'refund' ? -p.amount : p.amount), 0);
}

/** Takes an advance for the job: money on the customer's account, tagged with the job. */
export async function takeAdvance(actor: Actor, est: Estimate, input: { amount: number; mode: CashMode; date: string; reference?: string; note?: string }): Promise<PaymentEntry> {
  const customerId = est.billTo?.customerId;
  if (!customerId) throw new Error(t('Pick a customer first'));
  if (!(input.amount > 0)) throw new Error(t('Amount must be more than zero'));
  return putRecord('payments', actor, {
    id: newId(),
    invoiceId: '',
    customerId,
    jobId: est.id,
    kind: 'payment',
    amount: input.amount,
    mode: input.mode,
    date: input.date || todayISO(),
    reference: input.reference?.trim() || undefined,
    note: input.note?.trim() || t('Advance for {job}', { job: est.number || est.job?.title || '' }),
    receivedBy: actor.userId,
    receivedByName: actor.userName,
  } as PaymentEntry);
}

/**
 * After the job's bill is saved: the job's advance pays it (as far as the customer's advance and
 * the bill allow). The used amount is tagged with the job, so it isn't used twice.
 */
export async function settleJobAdvance(actor: Actor, invoice: Invoice): Promise<number> {
  if (!invoice.fromEstimateId || invoice.status !== 'saved' || !invoice.billTo?.customerId) return 0;
  const left = await jobAdvance(actor.businessId, invoice.fromEstimateId);
  if (left <= 0) return 0;
  const customer = await db.customers.get(invoice.billTo.customerId);
  if (!customer) return 0;
  const before = await db.payments.where('businessId').equals(actor.businessId).toArray();
  const notes = await db.creditNotes.where('businessId').equals(actor.businessId).toArray();
  const pending = moneyOf(invoice, buildLedger(before, notes)).pending;
  const amount = Math.min(left, pending, (await khataOf(actor.businessId, customer)).advance);
  if (amount <= 0) return 0;
  await applyAdvance(actor, customer, invoice, amount, invoice.fromEstimateId);
  return amount;
}

/** A job card the customer keeps (repairs): what was handed over and the promised date. */
export function jobCardTable(est: Estimate): ExportTable {
  const j = est.job!;
  const rows: [string, string][] = [
    [t('Customer'), [est.billTo?.name, est.billTo?.phone].filter(Boolean).join(' · ')],
    ...(j.kind === 'repair'
      ? ([
          [t('Device'), [j.device?.brand, j.device?.model].filter(Boolean).join(' ') || j.title],
          ['IMEI / Serial', j.device?.imei ?? ''],
          [t('Problem'), j.device?.problem ?? ''],
          [t('Accessories taken'), j.device?.accessories ?? ''],
          [t('Condition'), j.device?.condition ?? ''],
        ] as [string, string][])
      : ([
          [t('Work'), j.title],
          [t('Measurements'), j.measurements ?? ''],
        ] as [string, string][])),
    [t('Status'), stageLabel(j.stage)],
    [t('Ready by'), est.deliveryDate ? est.deliveryDate.split('-').reverse().join('/') : ''],
    [t('Estimate'), est.totals.grandTotal ? (est.totals.grandTotal / 100).toFixed(2) : ''],
  ];
  return {
    title: j.kind === 'repair' ? t('Repair job card {number}', { number: est.number }) : t('Job card {number}', { number: est.number }),
    subtitle: [t('Date: {date}', { date: est.date.split('-').reverse().join('/') })],
    columns: [{ label: '', width: 130 }, { label: '' }],
    rows: rows.filter(([, v]) => v),
    after: est.terms ? [est.terms] : [],
    fileBase: `Job-${est.number || est.id.slice(0, 6)}`,
  };
}

export const isOpenJob = (e: Estimate) => !!e.job && !CLOSED.includes(e.job.stage) && !e.deleted;
