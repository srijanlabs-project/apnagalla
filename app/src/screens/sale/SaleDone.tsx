import { IonButton, IonContent, IonIcon, IonSpinner } from '@ionic/react';
import { addOutline, printOutline, checkmarkCircle, logoWhatsapp, shareSocialOutline } from 'ionicons/icons';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import type { SaleCtx } from './saleTypes';

/** After Pay: the change to give back, print, WhatsApp, next sale. */
export default function SaleDone({ c }: { c: SaleCtx }) {
  const { done, printer, whatsappText, shareBill, startNew, giveBackBefore, giveBackAfter } = c;
  if (!done) return null;
  return (
    <>
        <IonContent className="ion-padding">
          <div className="sale-done">
            <IonIcon icon={checkmarkCircle} color="success" />
            <h2>
              {done.invoice.number} · {rupees(done.invoice.totals.grandTotal)}
            </h2>
            <p>
              {done.paid >= done.invoice.totals.grandTotal
                ? t('Paid in full')
                : done.paid > 0
                  ? t('Paid {paid}, balance {balance}', { paid: rupees(done.paid), balance: rupees(done.invoice.totals.grandTotal - done.paid) })
                  : t('Saved unpaid')}
            </p>
            {done.change > 0 && (
              <p className="sale-change">
                {giveBackBefore}
                <strong>{rupees(done.change)}</strong>
                {giveBackAfter}
              </p>
            )}
          </div>
          <div className="detail-actions">
            {printer.canPrint && (
              <IonButton onClick={() => void printer.print('invoice', done.invoice, done.change)} disabled={printer.busy}>
                {printer.busy ? <IonSpinner name="dots" /> : <IonIcon icon={printOutline} slot="start" />} {t('Print')}
              </IonButton>
            )}
            <IonButton color="success" onClick={() => whatsappText(done.invoice, done.paid)}>
              <IonIcon icon={logoWhatsapp} slot="start" /> {t('WhatsApp bill')}
            </IonButton>
            <IonButton fill="outline" onClick={() => void shareBill(done.invoice)}>
              <IonIcon icon={shareSocialOutline} slot="start" /> {t('Share PDF')}
            </IonButton>
            <IonButton fill="clear" routerLink={`/tabs/invoices/${done.invoice.id}`}>
              {t('Open bill')}
            </IonButton>
          </div>
          <IonButton expand="block" size="large" onClick={startNew}>
            <IonIcon icon={addOutline} slot="start" /> {t('Next sale')}
          </IonButton>
        </IonContent>

    </>
  );
}
