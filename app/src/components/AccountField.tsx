import { useLiveQuery } from 'dexie-react-hooks';
import { useBusiness } from '../lib/business';
import { t } from '../lib/i18n';
import { accountName, bankAccountsOf, isBankMode } from '../lib/money';
import { SelectField } from './Fields';

/**
 * Which bank account the money went into (or came out of), for UPI, card, bank and cheque.
 * Shown only when the store has two or more accounts; otherwise the default account is used.
 */
export default function AccountField({ mode, value, onChange, label }: { mode: string; value: string | null | undefined; onChange: (id: string) => void; label?: string }) {
  const { actor } = useBusiness();
  const accounts = useLiveQuery(() => bankAccountsOf(actor.businessId), [actor.businessId]);
  if (!isBankMode(mode) || !accounts || accounts.length < 2) return null;
  return (
    <SelectField
      label={label ?? t('Bank account')}
      value={value ?? accounts[0]!.id}
      options={accounts.map((a) => ({ value: a.id, label: accountName(a) }))}
      onChange={onChange}
    />
  );
}
