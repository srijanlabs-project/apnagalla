import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { rupees } from '../lib/format';
import { t } from '../lib/i18n';
import { khataOf } from '../lib/khata';

/** Warns when this bill on credit would take the customer above their credit limit. */
export default function CreditLimitNote({ businessId, customerId, billAmount }: { businessId: string; customerId: string | null | undefined; billAmount: number }) {
  const info = useLiveQuery(async () => {
    const c = customerId ? await db.customers.get(customerId) : undefined;
    if (!c?.creditLimit) return null;
    return { limit: c.creditLimit, balance: (await khataOf(businessId, c)).balance };
  }, [customerId, businessId]);
  if (!info) return null;
  const after = info.balance + billAmount;
  if (after <= info.limit) return null;
  return (
    <p className="section-note text-danger">
      {t('Credit limit {limit}: already owes {balance}; with this bill {after}.', { limit: rupees(info.limit), balance: rupees(info.balance), after: rupees(after) })}
    </p>
  );
}
