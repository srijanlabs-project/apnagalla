import { IonButton, IonChip, IonIcon, IonLabel } from '@ionic/react';
import { closeCircle, pricetagOutline } from 'ionicons/icons';
import { useState } from 'react';
import { t } from '../lib/i18n';
import { checkCoupon } from '../lib/offers';
import { TextField } from './Fields';

/** Type a coupon code on a bill; the offer then applies itself. */
export default function CouponField({ businessId, value, date, invoiceId, onChange }: { businessId: string; value?: string | null; date?: string; invoiceId?: string; onChange: (code: string | null) => void }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (value)
    return (
      <IonChip color="success" onClick={() => onChange(null)}>
        <IonIcon icon={pricetagOutline} />
        <IonLabel>{t('Coupon {code}', { code: value })}</IonLabel>
        <IonIcon icon={closeCircle} />
      </IonChip>
    );
  return (
    <>
      <div className="search-row">
        <TextField label={t('Coupon code')} value={code} onChange={(v) => (setCode(v.toUpperCase()), setMsg(null))} autocapitalize="characters" />
        <IonButton
          fill="clear"
          disabled={!code.trim()}
          onClick={async () => {
            const r = await checkCoupon(businessId, code, date, invoiceId);
            if (r.ok) {
              onChange(code.trim().toUpperCase());
              setCode('');
            } else setMsg(r.reason);
          }}
        >
          {t('Apply')}
        </IonButton>
      </div>
      {msg && <p className="section-note text-danger">{msg}</p>}
    </>
  );
}
