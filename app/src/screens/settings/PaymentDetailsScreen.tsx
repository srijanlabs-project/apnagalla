import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonModal,
  IonNote,
  IonTitle,
  IonToolbar,
  useIonAlert,
  useIonToast,
} from '@ionic/react';
import { addOutline, cardOutline, qrCodeOutline } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, SelectField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import { useBusiness } from '../../lib/business';
import { db, type BankAccount, type UpiId } from '../../lib/db';
import { t } from '../../lib/i18n';
import { deleteRecord, newId, putRecord, type Actor } from '../../lib/repo';

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,64}$/;

/** Only one default per kind: clear the flag on the others. */
async function setDefault(actor: Actor, table: 'bankAccounts' | 'upiIds', id: string) {
  const rows = (await (table === 'bankAccounts' ? db.bankAccounts : db.upiIds).where('businessId').equals(actor.businessId).toArray()) as (BankAccount | UpiId)[];
  for (const r of rows) {
    if (r.deleted) continue;
    if (r.isDefault !== (r.id === id)) await putRecord(table, actor, { ...r, isDefault: r.id === id });
  }
}

export default function PaymentDetailsScreen() {
  const { bankAccounts, upiIds, settings, actor, isOwner, profile } = useBusiness();
  const [bank, setBank] = useState<BankAccount | null>(null);
  const [upi, setUpi] = useState<UpiId | null>(null);
  const [other, setOther] = useState(settings.otherPaymentInstructions);
  const [alert] = useIonAlert();
  const [toast] = useIonToast();

  const blank = { businessId: actor.businessId, createdAt: '', updatedAt: '', updatedBy: '' };

  async function saveBank(b: BankAccount) {
    if (!b.holderName.trim() || !b.bankName.trim() || !b.accountNumber.trim() || !IFSC_RE.test(b.ifsc)) {
      void toast({ message: t('Fill holder name, bank, account number and a valid IFSC (e.g. HDFC0001234)'), duration: 2500, color: 'danger' });
      return;
    }
    const first = bankAccounts.length === 0;
    await putRecord('bankAccounts', actor, { ...b, isDefault: b.isDefault || first });
    if (b.isDefault || first) await setDefault(actor, 'bankAccounts', b.id);
    setBank(null);
  }

  async function saveUpi(u: UpiId) {
    if (!UPI_RE.test(u.upiId.trim()) || !u.payeeName.trim()) {
      void toast({ message: t('Enter a valid UPI ID (like name@bank) and payee name'), duration: 2500, color: 'danger' });
      return;
    }
    const first = upiIds.length === 0;
    await putRecord('upiIds', actor, { ...u, upiId: u.upiId.trim(), isDefault: u.isDefault || first });
    if (u.isDefault || first) await setDefault(actor, 'upiIds', u.id);
    setUpi(null);
  }

  function confirmDelete(message: string, fn: () => Promise<void>) {
    void alert({ message, buttons: [{ text: t('Cancel'), role: 'cancel' }, { text: t('Delete'), role: 'destructive', handler: () => void fn() }] });
  }

  return (
    <FormPage title={t('Payment details')} backHref="/tabs/more">
      {!isOwner && <p className="section-note">{t('Only the owner can change payment details.')}</p>}

      <IonList inset className="flush-list">
        <IonListHeader>
          <IonLabel>{t('Bank accounts')}</IonLabel>
          {isOwner && (
            <IonButton
              onClick={() =>
                setBank({ ...blank, id: newId(), holderName: profile.legalName || profile.name, bankName: '', accountNumber: '', ifsc: '', accountType: 'current', isDefault: false })
              }
            >
              <IonIcon icon={addOutline} slot="start" /> {t('Add')}
            </IonButton>
          )}
        </IonListHeader>
        {bankAccounts.length === 0 && (
          <IonItem lines="none">
            <IonNote>{t("No bank account yet. It's printed on invoices so customers can pay you.")}</IonNote>
          </IonItem>
        )}
        {bankAccounts.map((b) => (
          <IonItem key={b.id} button={isOwner} detail={isOwner} onClick={() => isOwner && setBank(b)}>
            <IonIcon icon={cardOutline} slot="start" />
            <IonLabel>
              <h2>{b.bankName}</h2>
              <p>
                {t('A/c ••••{last4} · {ifsc}', { last4: b.accountNumber.slice(-4), ifsc: b.ifsc })}
              </p>
            </IonLabel>
            {b.isDefault && <IonNote slot="end">{t('Default')}</IonNote>}
          </IonItem>
        ))}
      </IonList>

      <IonList inset className="flush-list">
        <IonListHeader>
          <IonLabel>{t('UPI IDs')}</IonLabel>
          {isOwner && (
            <IonButton onClick={() => setUpi({ ...blank, id: newId(), upiId: '', payeeName: profile.name, isDefault: false })}>
              <IonIcon icon={addOutline} slot="start" /> {t('Add')}
            </IonButton>
          )}
        </IonListHeader>
        {upiIds.length === 0 && (
          <IonItem lines="none">
            <IonNote>{t('Add a UPI ID to print a scan-to-pay QR code with the amount pre-filled.')}</IonNote>
          </IonItem>
        )}
        {upiIds.map((u) => (
          <IonItem key={u.id} button={isOwner} detail={isOwner} onClick={() => isOwner && setUpi(u)}>
            <IonIcon icon={qrCodeOutline} slot="start" />
            <IonLabel>
              <h2>{u.upiId}</h2>
              <p>{u.payeeName}</p>
            </IonLabel>
            {u.isDefault && <IonNote slot="end">{t('Default')}</IonNote>}
          </IonItem>
        ))}
      </IonList>

      <FormSection title={t('Other payment instructions')} note={t('Free text printed on invoices, e.g. "Cheques in favour of …"')}>
        <TextArea label={t('Instructions')} value={other} onChange={setOther} disabled={!isOwner} />
        {isOwner && other !== settings.otherPaymentInstructions && (
          <IonButton
            size="small"
            onClick={async () => {
              await putRecord('settings', actor, { ...settings, otherPaymentInstructions: other });
              void toast({ message: t('Saved'), duration: 1200, color: 'success' });
            }}
          >
            {t('Save instructions')}
          </IonButton>
        )}
      </FormSection>

      {/* Bank account editor */}
      <IonModal isOpen={!!bank} onDidDismiss={() => setBank(null)}>
        {bank && (
          <>
            <IonHeader>
              <IonToolbar>
                <IonButtons slot="start">
                  <IonButton onClick={() => setBank(null)}>{t('Cancel')}</IonButton>
                </IonButtons>
                <IonTitle>{t('Bank account')}</IonTitle>
                <IonButtons slot="end">
                  <IonButton strong onClick={() => void saveBank(bank)}>
                    {t('Save')}
                  </IonButton>
                </IonButtons>
              </IonToolbar>
            </IonHeader>
            <IonContent className="ion-padding">
              <TextField label={t('Account holder name')} required value={bank.holderName} onChange={(holderName) => setBank((b) => b && { ...b, holderName })} autocapitalize="words" />
              <TextField label={t('Bank name')} required value={bank.bankName} onChange={(bankName) => setBank((b) => b && { ...b, bankName })} autocapitalize="words" />
              <TextField label={t('Account number')} required inputmode="numeric" value={bank.accountNumber} onChange={(v) => setBank((b) => b && { ...b, accountNumber: v.replace(/\s/g, '') })} />
              <TextField
                label="IFSC"
                required
                value={bank.ifsc}
                onChange={(v) => setBank((b) => b && { ...b, ifsc: v.toUpperCase().trim() })}
                error={bank.ifsc && !IFSC_RE.test(bank.ifsc) ? t('11 characters, e.g. HDFC0001234') : null}
                maxlength={11}
              />
              <TextField label={t('Branch')} value={bank.branch} onChange={(branch) => setBank((b) => b && { ...b, branch })} autocapitalize="words" />
              <SelectField
                label={t('Account type')}
                value={bank.accountType}
                options={[
                  { value: 'current', label: t('Current') },
                  { value: 'savings', label: t('Savings') },
                ]}
                onChange={(accountType) => setBank((b) => b && { ...b, accountType })}
              />
              <ToggleRow label={t('Default (print on every invoice)')} checked={bank.isDefault} onChange={(isDefault) => setBank((b) => b && { ...b, isDefault })} />
              {bankAccounts.some((b) => b.id === bank.id) && (
                <IonButton
                  color="danger"
                  fill="clear"
                  expand="block"
                  onClick={() =>
                    confirmDelete(t('Delete this bank account?'), async () => {
                      await deleteRecord('bankAccounts', actor, bank.id);
                      setBank(null);
                    })
                  }
                >
                  {t('Delete bank account')}
                </IonButton>
              )}
            </IonContent>
          </>
        )}
      </IonModal>

      {/* UPI editor */}
      <IonModal isOpen={!!upi} onDidDismiss={() => setUpi(null)}>
        {upi && (
          <>
            <IonHeader>
              <IonToolbar>
                <IonButtons slot="start">
                  <IonButton onClick={() => setUpi(null)}>{t('Cancel')}</IonButton>
                </IonButtons>
                <IonTitle>{t('UPI ID')}</IonTitle>
                <IonButtons slot="end">
                  <IonButton strong onClick={() => void saveUpi(upi)}>
                    {t('Save')}
                  </IonButton>
                </IonButtons>
              </IonToolbar>
            </IonHeader>
            <IonContent className="ion-padding">
              <TextField
                label={t('UPI ID')}
                required
                placeholder="shopname@okbank"
                value={upi.upiId}
                onChange={(upiId) => setUpi((u) => u && { ...u, upiId })}
                autocapitalize="off"
                error={upi.upiId && !UPI_RE.test(upi.upiId.trim()) ? t('Looks like name@bank') : null}
              />
              <TextField label={t('Payee name')} required value={upi.payeeName} onChange={(payeeName) => setUpi((u) => u && { ...u, payeeName })} autocapitalize="words" />
              <ToggleRow label={t('Default (QR on every invoice)')} checked={upi.isDefault} onChange={(isDefault) => setUpi((u) => u && { ...u, isDefault })} />
              {upiIds.some((u) => u.id === upi.id) && (
                <IonButton
                  color="danger"
                  fill="clear"
                  expand="block"
                  onClick={() =>
                    confirmDelete(t('Delete this UPI ID?'), async () => {
                      await deleteRecord('upiIds', actor, upi.id);
                      setUpi(null);
                    })
                  }
                >
                  {t('Delete UPI ID')}
                </IonButton>
              )}
            </IonContent>
          </>
        )}
      </IonModal>
    </FormPage>
  );
}
