import { IonButton, IonButtons, IonContent, IonHeader, IonModal, IonTitle, IonToolbar } from '@ionic/react';
import { DEFAULT_STAFF_PERMISSIONS, type MemberDto, type StaffPermissions, type TeamResponse } from '@invoice/shared';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { FormSection, NumberField, ToggleRow } from './Fields';

/** Owner: what one staff member may do in the store. */
export default function PermissionsSheet({
  businessId,
  member,
  storeSeeCost,
  onClose,
  onSaved,
}: {
  businessId: string;
  member: MemberDto | null;
  storeSeeCost: boolean;
  onClose: () => void;
  onSaved: (team: TeamResponse) => void;
}) {
  const [p, setP] = useState<Required<StaffPermissions>>({ seeCost: storeSeeCost, ...DEFAULT_STAFF_PERMISSIONS });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (member) setP({ seeCost: storeSeeCost, ...DEFAULT_STAFF_PERMISSIONS, ...(member.permissions ?? {}) } as Required<StaffPermissions>);
  }, [member, storeSeeCost]);
  const set = (x: Partial<StaffPermissions>) => setP((cur) => ({ ...cur, ...x }));

  return (
    <IonModal isOpen={!!member} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{member?.name ?? t('Permissions')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>{t('Cancel')}</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <FormSection title={t('Permissions')}>
          <ToggleRow label={t('See purchases and cost prices')} note={t('Purchase bills, suppliers, cost and profit.')} checked={p.seeCost} onChange={(seeCost) => set({ seeCost })} />
          <ToggleRow label={t('See reports')} checked={p.viewReports} onChange={(viewReports) => set({ viewReports })} />
          <ToggleRow label={t('Edit items and prices')} checked={p.editItems} onChange={(editItems) => set({ editItems })} />
          <ToggleRow label={t('Delete drafts, customers and suppliers')} checked={p.deleteRecords} onChange={(deleteRecords) => set({ deleteRecords })} />
          <NumberField
            label={t('Most discount on a bill')}
            value={p.maxDiscountPct}
            onChange={(n) => set({ maxDiscountPct: n ?? 0 })}
            min={0}
            max={100}
            suffix="%"
            helper={t('100% = no limit. Offers you set up are not counted.')}
          />
        </FormSection>
        <IonButton
          expand="block"
          disabled={busy || !member}
          onClick={async () => {
            if (!member) return;
            setBusy(true);
            try {
              onSaved(await api.setPermissions(businessId, member.userId, p));
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('Save')}
        </IonButton>
      </IonContent>
    </IonModal>
  );
}
