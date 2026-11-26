import { IonButton, IonSpinner, useIonAlert, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useBusiness } from '../lib/business';
import { db, type Invoice } from '../lib/db';
import { eInvoiceJson, eInvoiceProblems, ewayBillJson, needsEwayBill } from '../lib/einvoice';
import { shareFile } from '../lib/exportTable';
import { t } from '../lib/i18n';
import { putRecord } from '../lib/repo';
import { FormSection } from './Fields';

/** E-invoice (IRN) and e-way bill for a saved tax invoice (owner). */
export default function EInvoicePanel({ inv }: { inv: Invoice }) {
  const { actor, profile } = useBusiness();
  const [alert] = useIonAlert();
  const [toast] = useIonToast();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => void api.features().then((f) => setOn(!!f.eInvoice)).catch(() => setOn(false)), []);
  const buyer = useLiveQuery(() => (inv.billTo?.customerId ? db.customers.get(inv.billTo.customerId) : undefined), [inv.billTo?.customerId]);
  const seller = inv.businessSnapshot ? { ...profile, ...inv.businessSnapshot } : profile;
  const problems = eInvoiceProblems('invoice', inv, seller, buyer);
  const e = inv.einvoice && !inv.einvoice.cancelledAt ? inv.einvoice : null;
  const fail = (err: unknown) => void toast({ message: (err as Error).message, duration: 3500, color: 'danger' });
  const json = (name: string, data: unknown) => void shareFile(name, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })).catch(fail);

  async function getIrn() {
    if (problems.length) {
      void alert({ header: t('Not ready for an e-invoice'), message: problems.map((p) => `• ${t(p)}`).join('\n'), buttons: [t('OK')] });
      return;
    }
    setBusy(true);
    try {
      const r = await api.eInvoice(actor.businessId, seller.taxIdValue!, eInvoiceJson('invoice', inv, seller, buyer));
      await putRecord('invoices', actor, { ...inv, einvoice: { irn: r.irn, ackNo: r.ackNo, ackDate: r.ackDate, qr: r.signedQr } });
      void toast({ message: t('E-invoice ready: IRN saved on the bill'), duration: 2500, position: 'top', color: 'success' });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  function cancelIrn() {
    void alert({
      header: t('Cancel the e-invoice?'),
      message: t('Only within 24 hours of the IRN. The bill itself stays; cancel it separately if needed.'),
      inputs: [
        { type: 'radio', label: t('Duplicate'), value: '1', checked: true },
        { type: 'radio', label: t('Data entry mistake'), value: '2' },
        { type: 'radio', label: t('Order cancelled'), value: '3' },
        { type: 'radio', label: t('Other'), value: '4' },
      ],
      buttons: [
        { text: t('Keep'), role: 'cancel' },
        {
          text: t('Cancel IRN'),
          role: 'destructive',
          handler: (reason: '1' | '2' | '3' | '4') =>
            void api
              .eInvoiceCancel(actor.businessId, { gstin: seller.taxIdValue!, irn: e!.irn, reason, remark: '' })
              .then(() => putRecord('invoices', actor, { ...inv, einvoice: { ...e!, cancelledAt: new Date().toISOString() } }))
              .catch(fail),
        },
      ],
    });
  }

  function ewayBill() {
    void alert({
      header: t('E-way bill'),
      message: t('Fill the transport details. Then upload the file on ewaybillgst.gov.in → e-Waybill → Generate Bulk.'),
      inputs: [
        { name: 'vehicle', placeholder: t('Vehicle no. (e.g. MH12AB1234)') },
        { name: 'km', type: 'number', placeholder: t('Distance in km'), min: 0 },
        { name: 'tid', placeholder: t('Transporter GSTIN / ID (optional)') },
        { name: 'tname', placeholder: t('Transporter name (optional)') },
      ],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Make file'),
          handler: (v: { vehicle: string; km: string; tid: string; tname: string }) => {
            if (!v.vehicle.trim() && !v.tid.trim()) {
              void toast({ message: t('Give the vehicle number or the transporter ID'), duration: 2500, color: 'warning' });
              return false;
            }
            json(`EWB-${inv.number.replace(/[^\w-]/g, '-')}.json`, ewayBillJson(inv, seller, { mode: 1, distanceKm: Number(v.km) || 0, vehicleNo: v.vehicle, transporterId: v.tid, transporterName: v.tname }, buyer));
            return true;
          },
        },
      ],
    });
  }

  if (inv.status !== 'saved' || inv.taxMode === 'none') return null;
  return (
    <FormSection title={t('E-invoice and e-way bill')}>
      {e ? (
        <p className="section-note">
          IRN {e.irn.slice(0, 16)}… · {t('Ack {no}', { no: e.ackNo })}
        </p>
      ) : (
        !!inv.billTo?.taxId && <p className="section-note">{on ? t('B2B bill: get its IRN if your turnover needs e-invoicing.') : t('E-invoicing starts once your GST provider details are set up (ask ApnaGalla).')}</p>
      )}
      {needsEwayBill(inv) && <p className="section-note text-danger">{t('Goods over ₹50,000: an e-way bill is needed before they move.')}</p>}
      <div className="detail-actions">
        {on && !e && !!inv.billTo?.taxId && (
          <IonButton size="small" onClick={() => void getIrn()} disabled={busy}>
            {busy ? <IonSpinner name="dots" /> : t('Get IRN')}
          </IonButton>
        )}
        {on && e && (
          <IonButton size="small" fill="clear" color="danger" onClick={cancelIrn}>
            {t('Cancel IRN')}
          </IonButton>
        )}
        <IonButton size="small" fill="outline" onClick={ewayBill}>
          {t('E-way bill file')}
        </IonButton>
        {!!inv.billTo?.taxId && (
          <IonButton size="small" fill="clear" onClick={() => (problems.length ? void alert({ header: t('Not ready for an e-invoice'), message: problems.map((p) => `• ${t(p)}`).join('\n'), buttons: [t('OK')] }) : json(`EINV-${inv.number.replace(/[^\w-]/g, '-')}.json`, eInvoiceJson('invoice', inv, seller, buyer)))}>
            {t('E-invoice JSON')}
          </IonButton>
        )}
      </div>
    </FormSection>
  );
}
