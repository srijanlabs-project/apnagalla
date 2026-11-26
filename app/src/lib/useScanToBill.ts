import { useIonAlert } from '@ionic/react';
import { useRef } from 'react';
import { db, type DocLine, type Item } from './db';
import { t } from './i18n';
import { sellable } from './pricing';
import { parseScaleBarcode, samePlu, scaleQty, type ScaleSettings } from './scale';

/**
 * Scanning items onto a bill. A new item is added at once; scanning one already on the bill asks
 * "Add 1 more?" (when the store wants it asked). Scans while a question is open are ignored.
 */
export function useScanToBill(opts: {
  businessId: string;
  lines: () => DocLine[];
  confirmRepeat: boolean;
  /** Add a fresh line for the item (or open the line editor for sized / serial items). */
  addNew: (item: Item) => void;
  /** One more of an existing line. */
  addOne: (lineId: string) => void;
  /** The code matches no item. */
  unknown: (code: string) => void;
  /** R8: weighing-scale labels, and a line for a weighed item (always a new line). */
  scale?: ScaleSettings;
  addWeighed?: (item: Item, qty: number) => void;
}) {
  const [alert] = useIonAlert();
  const asking = useRef(false);
  return async (code: string): Promise<void> => {
    if (asking.current) return;
    const item = (await db.items.where('[businessId+barcode]').equals([opts.businessId, code]).toArray()).find(sellable);
    if (!item && opts.scale && opts.addWeighed) {
      const read = parseScaleBarcode(code, opts.scale);
      const weighed = read ? (await db.items.where('businessId').equals(opts.businessId).toArray()).find((i) => sellable(i) && samePlu(i, read.plu)) : undefined;
      if (read && weighed) return opts.addWeighed(weighed, scaleQty(weighed, read));
      if (read) return opts.unknown(t('scale code {plu}', { plu: read.plu }));
    }
    if (!item) return opts.unknown(code);
    const same = opts.lines().find((l) => l.itemId === item.id && !l.dims && !(l.serials && l.serials.length));
    if (!same) return opts.addNew(item);
    if (!opts.confirmRepeat) return opts.addOne(same.id);
    asking.current = true;
    await alert({
      header: item.name,
      message: t('Already on the bill (quantity {qty}). Add 1 more?', { qty: same.qty }),
      buttons: [
        { text: t('Skip'), role: 'cancel' },
        { text: t('Add 1 more'), handler: () => opts.addOne(same.id) },
      ],
      onDidDismiss: () => {
        asking.current = false;
      },
    });
  };
}
