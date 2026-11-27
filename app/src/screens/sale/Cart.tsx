import { IonButton, IonIcon, IonItem, IonLabel, IonList } from '@ionic/react';
import { addOutline, removeOutline } from 'ionicons/icons';
import { isAreaLine, lineSize, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import type { SaleCtx } from './saleTypes';

/** The bill so far (or quick items when it is empty). */
export default function Cart({ c }: { c: SaleCtx }) {
  const { bill, items, addItem, setEditing, totals, step } = c;
  return (
    <>
      {bill.lines.length === 0 ? (
            <div className="sale-empty">
              <p>{t('Search an item above to start the bill.')}</p>
              {(items ?? []).length > 0 && (
                <div className="sale-quick">
                  {(items ?? []).slice(0, 12).map((it) => (
                    <IonButton key={it.id} fill="outline" size="small" onClick={() => addItem(it)}>
                      {it.name}
                    </IonButton>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <>
            {(items ?? []).length > 0 && (
              <div className="sale-quick sale-quick-row">
                {(items ?? []).slice(0, 12).map((it) => (
                  <IonButton key={it.id} fill="outline" size="small" onClick={() => addItem(it)}>
                    {it.name}
                  </IonButton>
                ))}
              </div>
            )}
            <IonList className="cart">
              {bill.lines.map((l, i) => (
                <IonItem key={l.id} lines="full">
                  <IonLabel onClick={() => setEditing({ line: l, isNew: false })}>
                    <h2>{l.name}</h2>
                    <p>
                      {isAreaLine(l) ? lineSize(l) : `${rupees(l.rate)} / ${l.unit}`}
                      {(bill.taxMode ?? 'gst') !== 'none' && !l.rateIncludesTax && l.taxPct > 0 ? ` ${t('+ {pct}% GST', { pct: l.taxPct })}` : ''}
                    </p>
                  </IonLabel>
                  <div slot="end" className="qty-stepper">
                    {isAreaLine(l) ? (
                      <IonButton fill="clear" size="small" onClick={() => setEditing({ line: l, isNew: false })}>
                        {t('Size')}
                      </IonButton>
                    ) : (
                      <>
                        <IonButton fill="outline" size="small" onClick={() => step(l.id, -1)} aria-label={t('One less')}>
                          <IonIcon icon={removeOutline} />
                        </IonButton>
                        <span>{l.qty}</span>
                        <IonButton fill="outline" size="small" onClick={() => step(l.id, 1)} aria-label={t('One more')}>
                          <IonIcon icon={addOutline} />
                        </IonButton>
                      </>
                    )}
                    <strong>{rupees(totals.lines[i]?.amount ?? 0)}</strong>
                  </div>
                </IonItem>
              ))}
            </IonList>
            </>
          )}
    </>
  );
}
