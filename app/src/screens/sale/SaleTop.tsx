import { IonChip, IonIcon, IonLabel } from '@ionic/react';
import { personCircleOutline } from 'ionicons/icons';
import { rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { WALK_IN } from '../docs/CustomerPicker';
import CreditLimitNote from '../../components/CreditLimitNote';
import { extraOn } from '../../lib/shopExtras';
import CouponField from '../../components/CouponField';
import { loyaltyOf } from '../../lib/loyalty';
import type { SaleCtx } from './saleTypes';

/** Customer, GST or not, and the extras (credit note, points, voucher, coupon) as "+" chips once an item is on the bill. */
export default function SaleTop({ c }: { c: SaleCtx }) {
  const { bill, patch, settings, totals, walkIn, exchange, actor, creditUse, setCreditUse, setCreditPick, pointsLeft, usePoints, setUsePoints, pointsValue, voucherUse, setVoucherUse, voucherValue, askVoucher, couponOpen, setCouponOpen, regular, setPicker } = c;
  return (
    <>
          <div className="sale-top">
            <IonChip onClick={() => setPicker(true)}>
              <IonIcon icon={personCircleOutline} />
              <IonLabel>{walkIn && (!bill.billTo || bill.billTo.name === WALK_IN.name) ? t('Walk-in customer') : bill.billTo!.name}</IonLabel>
            </IonChip>
            {regular && (
              <div className="sale-tax">
                {(['gst', 'none'] as const).map((m) => (
                  <IonChip key={m} color={(bill.taxMode ?? 'gst') === m ? 'primary' : undefined} outline={(bill.taxMode ?? 'gst') !== m} onClick={() => patch({ taxMode: m })}>
                    <IonLabel>{m === 'gst' ? t('GST bill') : t('No GST')}</IonLabel>
                  </IonChip>
                ))}
              </div>
            )}
          </div>
          <div className="sale-extras">
            {exchange && exchange.credit > 0 && (
              <p className="section-note text-success">{t('Exchange: {amount} from bill {number} is taken off', { amount: rupees(exchange.credit), number: exchange.old.number })}</p>
            )}
            {!walkIn && <CreditLimitNote businessId={actor.businessId} customerId={bill.billTo?.customerId} billAmount={totals?.grandTotal ?? 0} />}
            {bill.lines.length > 0 &&
              (!walkIn || !!creditUse) &&
              (creditUse ? (
                <IonChip color="success" onClick={() => setCreditUse(null)}>
                  <IonLabel>{t('Credit note {number}: {amount}', { number: creditUse.number, amount: rupees(Math.min(creditUse.left, totals?.grandTotal ?? 0)) })} ✕</IonLabel>
                </IonChip>
              ) : (
                <IonChip outline className="add-chip" onClick={() => setCreditPick(true)}>
                  <IonLabel>+ {t('Credit note')}</IonLabel>
                </IonChip>
              ))}
            {bill.lines.length > 0 && !walkIn && pointsLeft >= loyaltyOf(settings).minRedeem && (
              <IonChip color={usePoints ? 'success' : undefined} outline={!usePoints} onClick={() => setUsePoints(!usePoints)}>
                <IonLabel>
                  {usePoints ? t('Points: {amount} off', { amount: rupees(pointsValue) }) : t('Use {n} points ({amount})', { n: pointsLeft, amount: rupees(pointsLeft * loyaltyOf(settings).pointValue) })}
                  {usePoints ? ' ✕' : ''}
                </IonLabel>
              </IonChip>
            )}
            {bill.lines.length > 0 && extraOn(settings, 'vouchers') && (
              <IonChip color={voucherUse ? 'success' : undefined} outline={!voucherUse} className={voucherUse ? undefined : 'add-chip'} onClick={() => (voucherUse ? setVoucherUse(null) : askVoucher())}>
                <IonLabel>{voucherUse ? `${t('Voucher {code}: {amount}', { code: voucherUse.code, amount: rupees(voucherValue) })} ✕` : `+ ${t('Gift voucher')}`}</IonLabel>
              </IonChip>
            )}
            {bill.lines.length > 0 && !couponOpen && !bill.coupon && (
              <IonChip outline className="add-chip" onClick={() => setCouponOpen(true)}>
                <IonLabel>+ {t('Discount / coupon')}</IonLabel>
              </IonChip>
            )}
            {bill.lines.length > 0 && (couponOpen || !!bill.coupon) && <CouponField businessId={actor.businessId} value={bill.coupon} date={bill.date} invoiceId={bill.id} onChange={(coupon) => patch({ coupon })} />}
          </div>

    </>
  );
}
