import { useIonRouter, useIonToast } from '@ionic/react';
import { useState } from 'react';
import { useBusiness } from './business';
import type { CreditNote, Estimate, Invoice } from './db';
import { canPrint, loadPrinter, printReceipt } from './printer';
import { renderReceipt, type ReceiptInput } from './receipt/render';
import { billMoney, type DocKind } from './repo';
import { t } from './i18n';

/**
 * Print a bill on this phone's printer, or (web / no printer yet) draw the receipt for a preview.
 */
export function usePrint() {
  const { profile, settings, upiIds } = useBusiness();
  const [toast] = useIonToast();
  const router = useIonRouter();
  const [busy, setBusy] = useState(false);

  async function inputFor(kind: DocKind, doc: Invoice | CreditNote | Estimate, change?: number): Promise<Omit<ReceiptInput, 'paper' | 'showLogo'>> {
    const upi = upiIds.find((u) => u.id === doc.upiIdId) ?? upiIds.find((u) => u.isDefault) ?? upiIds[0] ?? null;
    const { id: _i, businessId: _b, createdAt: _c, updatedAt: _u, updatedBy: _ub, deleted: _d, ...live } = profile;
    return {
      kind,
      doc,
      business: doc.businessSnapshot ?? live,
      money: kind === 'invoice' && doc.status === 'saved' ? await billMoney(doc.id) : null,
      change,
      upi,
      lang: settings.billLanguage ?? 'en',
    };
  }

  /** Prints; returns false when no printer is set up (the caller may offer setup or a preview). */
  async function print(kind: DocKind, doc: Invoice | CreditNote | Estimate, change?: number): Promise<boolean> {
    if (!canPrint()) return false;
    const p = await loadPrinter();
    if (!p) {
      void toast({
        message: t('Choose your printer first.'),
        duration: 3000,
        buttons: [{ text: t('Set up'), handler: () => router.push('/tabs/more/printer') }],
      });
      return false;
    }
    setBusy(true);
    try {
      await printReceipt(p, await inputFor(kind, doc, change));
      return true;
    } catch (e) {
      void toast({ message: e instanceof Error ? e.message : t('Could not print'), duration: 3500, color: 'danger' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** The receipt as an image (for the on-screen preview). */
  async function preview(kind: DocKind, doc: Invoice | CreditNote | Estimate): Promise<string> {
    const p = await loadPrinter();
    const canvas = await renderReceipt({ ...(await inputFor(kind, doc)), paper: p?.paper ?? 58, showLogo: p?.logo ?? false });
    return canvas.toDataURL('image/png');
  }

  return { print, preview, busy, canPrint: canPrint() };
}
