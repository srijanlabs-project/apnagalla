import { IonButton, IonCard, IonCardContent, IonSpinner } from '@ionic/react';
import { checkGstin, formatDateIN, type GstinInfo } from '@invoice/shared';
import { useState } from 'react';
import { ApiError, NetworkError, api } from '../lib/api';
import { t } from '../lib/i18n';

/**
 * "Check GSTIN" with the GST system (through our server and the store's GST API): shows the
 * registered name, status and address, and offers to fill them in.
 */
export default function GstinCheck({ businessId, gstin, onUse }: { businessId: string; gstin: string | undefined; onUse?: (info: GstinInfo) => void }) {
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<GstinInfo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const valid = !!gstin && checkGstin(gstin).ok;

  async function check() {
    if (!gstin) return;
    setBusy(true);
    setMessage(null);
    setInfo(null);
    try {
      const r = await api.gstinLookup(businessId, gstin);
      if (r.info) setInfo(r.info);
      else setMessage(t('This GSTIN was not found in the GST records.'));
    } catch (e) {
      setMessage(e instanceof NetworkError ? t('No internet: the GSTIN format was checked on the phone only.') : e instanceof ApiError ? e.message : t('Could not check right now.'));
    } finally {
      setBusy(false);
    }
  }

  if (!valid) return null;
  return (
    <>
      <IonButton size="small" fill="outline" onClick={() => void check()} disabled={busy}>
        {busy ? <IonSpinner name="dots" /> : t('Check with GST records')}
      </IonButton>
      {message && <p className="section-note">{message}</p>}
      {info && (
        <IonCard className="gstin-card">
          <IonCardContent>
            <strong>{info.legalName}</strong>
            {info.tradeName && info.tradeName !== info.legalName && <p>{t('Trade name: {name}', { name: info.tradeName })}</p>}
            <p className={info.active ? 'text-success' : 'text-danger'}>
              {info.status}
              {info.taxpayerType ? ` · ${info.taxpayerType}` : ''}
              {info.registeredOn ? ` · ${t('since {date}', { date: formatDateIN(info.registeredOn) })}` : ''}
            </p>
            {info.address && <p>{[info.address.line1, info.address.line2, info.address.city, info.address.state, info.address.pin].filter(Boolean).join(', ')}</p>}
            {!info.active && <p className="text-danger">{t('Not active: GST on bills to this GSTIN may not be accepted for input credit.')}</p>}
            {onUse && (
              <IonButton size="small" onClick={() => onUse(info)}>
                {t('Use these details')}
              </IonButton>
            )}
          </IonCardContent>
        </IonCard>
      )}
    </>
  );
}
