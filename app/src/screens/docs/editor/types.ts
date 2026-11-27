import type { useBusiness } from '../../../lib/business';
import type { BankAccount, CreditNote, DocBase, DocLine, Estimate, Invoice, UpiId } from '../../../lib/db';
import type { gstViewOf } from '../../../lib/gstView';
import type { computeTotals, DocKind } from '../../../lib/repo';
import type { useScanToBill } from '../../../lib/useScanToBill';

export type Doc = Invoice | Estimate | CreditNote;

/** What every section of the bill form shares: the draft, how to change it, and the store's settings. */
export interface EditorCtx {
  kind: DocKind;
  doc: Doc;
  setDoc: (f: (cur: Doc | null) => Doc | null) => void;
  patch: (p: Partial<DocBase> | ((cur: Doc) => Partial<DocBase>)) => void;
  locked: boolean;
  view: ReturnType<typeof gstViewOf>;
  noTax: boolean;
  credit: CreditNote | null;
  totals: ReturnType<typeof computeTotals>;
  settings: ReturnType<typeof useBusiness>['settings'];
  actor: ReturnType<typeof useBusiness>['actor'];
  byKind: (invoice: string, estimate: string, creditNote: string) => string;
  wasDraft: boolean;
  nextNumber: string;
  isOwner: boolean;
  gstType: string;
  setPicker: (open: boolean) => void;
  setEditing: (e: { line: DocLine; isNew: boolean } | null) => void;
  scanning: boolean;
  setScanning: (on: boolean) => void;
  scanToBill: ReturnType<typeof useScanToBill>;
  askTargetTotal: () => void;
  targetBefore: string;
  targetAfter: string;
  overCredit: boolean | null;
  room: number | null;
  setTerms: (days: number) => void;
  bankOptions: { value: string; label: string }[];
  upiOptions: { value: string; label: string }[];
  bankAccounts: BankAccount[];
  upiIds: UpiId[];
  team: { userId: string; name: string }[];
  rxNeeded: boolean | undefined;
  againstBefore: string;
  againstAfter: string;
}
