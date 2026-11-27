import { IonButton, IonIcon, IonSearchbar } from '@ionic/react';
import { barcodeOutline } from 'ionicons/icons';
import { t } from '../../lib/i18n';
import type { SaleCtx } from './saleTypes';

/** The search box and barcode button. */
export default function ItemSearch({ c }: { c: SaleCtx }) {
  const { q, setQ, items, matches, addItem, byBarcode, setScanning } = c;
  return (
    <>
          <div className="search-row">
            <IonSearchbar
              value={q}
              onIonInput={(e) => setQ(String(e.detail.value ?? ''))}
              // A USB / Bluetooth scanner types the code and presses Enter.
              onKeyDown={(e) => {
                if (e.key === 'Enter' && q.trim()) {
                  const code = q.trim();
                  if ((items ?? []).some((i) => i.barcode === code)) byBarcode(code);
                  else if (matches.length === 1) addItem(matches[0]!);
                }
              }}
              placeholder={t('Search item or type barcode')}
              debounce={0}
            />
            <IonButton fill="clear" onClick={() => setScanning(true)} aria-label={t('Scan barcode')}>
              <IonIcon icon={barcodeOutline} slot="icon-only" />
            </IonButton>
          </div>

    </>
  );
}
