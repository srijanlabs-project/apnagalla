

import { amountInWords } from '@invoice/shared';

import { ToggleRow } from '../../../components/Fields';

import { taxRows } from '../../../lib/gstView';
import { t } from '../../../lib/i18n';
import { rupees } from '../../../lib/format';

import type { EditorCtx } from './types';
import { Row } from './TotalsRow';

/** The total with its tax breakup and round-off. */
export default function TotalsSection({ c }: { c: EditorCtx }) {
  const { doc, patch, locked, view, noTax, credit, totals, overCredit, room } = c;
  return (
    <>
        {/* ---------- summary ---------- */}
        <div className="summary">
          <Row label={t('Subtotal')} value={totals.subtotal} />
          {totals.itemDiscount > 0 && <Row label={t('Item discounts')} value={-totals.itemDiscount} />}
          {totals.overallDiscount > 0 && <Row label={t('Discount on total')} value={-totals.overallDiscount} />}
          {!noTax && <Row label={t('Taxable amount')} value={totals.taxableAmount + totals.chargesTotal} />}
          {noTax && totals.chargesTotal > 0 && <Row label={t('Charges')} value={totals.chargesTotal} />}
          {taxRows(view, totals).map((t) => (
            <Row key={t.label} label={t.label} value={t.amount} />
          ))}
          {totals.roundOff !== 0 && <Row label={t('Round off')} value={totals.roundOff} />}
          <Row label={t('Total')} value={totals.grandTotal} strong />
          {view.mode === 'gst' && view.pos && <p className="in-words">
              {view.interState ? t('Other state: place of supply {place}', { place: view.posLabel }) : t('Same state: place of supply {place}', { place: view.posLabel })}
            </p>}
          {overCredit && <p className="in-words text-danger">{t('More than the {amount} left on invoice {number}', { amount: rupees(room!), number: credit!.invoiceNumber })}</p>}
          <p className="in-words">{amountInWords(totals.grandTotal)}</p>
        </div>
        <ToggleRow label={t('Round off to nearest ₹1')} checked={doc.roundOff} onChange={(roundOff) => patch({ roundOff })} disabled={locked || doc.targetTotal != null} />
    </>
  );
}
