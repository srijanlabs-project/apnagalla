import { IonChip } from '@ionic/react';
import { t } from '../lib/i18n';
import { TextField } from './Fields';

/** A group name, with the groups already used as one-tap choices. */
export default function GroupField({ value, groups, onChange, disabled }: { value?: string; groups: string[]; onChange: (g: string | undefined) => void; disabled?: boolean }) {
  return (
    <>
      <TextField label={t('Group (optional)')} value={value} onChange={(v) => onChange(v.trim() ? v : undefined)} autocapitalize="words" disabled={disabled} />
      {groups.length > 0 && (
        <div className="filter-chips wrap">
          {groups.map((g) => (
            <IonChip key={g} outline={value !== g} color={value === g ? 'primary' : undefined} onClick={() => !disabled && onChange(value === g ? undefined : g)}>
              {g}
            </IonChip>
          ))}
        </div>
      )}
    </>
  );
}

/** Groups in use, sorted. */
export const groupsIn = (rows: { group?: string; deleted?: boolean }[] | undefined) => [...new Set((rows ?? []).filter((r) => !r.deleted && r.group?.trim()).map((r) => r.group!.trim()))].sort();
