

import { rupees } from '../../../lib/format';

/** One line of the totals. */
export function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={strong ? 'summary-row strong' : 'summary-row'}>
      <span>{label}</span>
      <span>{rupees(value)}</span>
    </div>
  );
}
