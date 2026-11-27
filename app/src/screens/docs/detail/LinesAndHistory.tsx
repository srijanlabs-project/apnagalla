import { IonItem, IonLabel, IonList, IonListHeader, IonNote } from '@ionic/react';
import type { CreditNote, Estimate, Invoice } from '../../../lib/db';
import { dateIN, lineSize, rupees } from '../../../lib/format';
import { t } from '../../../lib/i18n';

type Doc = Invoice | Estimate | CreditNote;

/** The bill's items. */
export function DocLines({ doc, noTax }: { doc: Doc; noTax: boolean }) {
  return (
    <IonList inset>
      <IonListHeader>
        <IonLabel>{t('Items')}</IonLabel>
      </IonListHeader>
      {doc.lines.map((l, i) => (
        <IonItem key={l.id}>
          <IonLabel>
            <h3>{l.name}</h3>
            {lineSize(l) && <p>{lineSize(l)}</p>}
            <p>
              {l.qty} {l.unit} × {rupees(l.rate)}
              {noTax ? '' : ` · ${t('tax {pct}%', { pct: l.taxPct })}`}
              {l.hsn && !noTax ? ` · ${t('HSN {code}', { code: l.hsn })}` : ''}
            </p>
          </IonLabel>
          <IonNote slot="end">{rupees(doc.totals.lines[i]?.amount ?? 0)}</IonNote>
        </IonItem>
      ))}
    </IonList>
  );
}

/** Credit notes made against an invoice. */
export function CreditNotesList({ notes }: { notes: CreditNote[] }) {
  if (!notes.length) return null;
  return (
    <IonList inset>
      <IonListHeader>
        <IonLabel>{t('Credit notes')}</IonLabel>
      </IonListHeader>
      {notes.map((n) => (
        <IonItem key={n.id} routerLink={`/tabs/credit-notes/${n.id}`} detail={false}>
          <IonLabel>
            <h3>{n.number || t('Draft')}</h3>
            <p>
              {dateIN(n.date)} · {n.status}
            </p>
          </IonLabel>
          <IonNote slot="end">{rupees(n.totals.grandTotal)}</IonNote>
        </IonItem>
      ))}
    </IonList>
  );
}

/** Who did what to the bill, newest first. */
export function HistoryList({ doc }: { doc: Doc }) {
  return (
    <IonList inset>
      <IonListHeader>
        <IonLabel>{t('History')}</IonLabel>
      </IonListHeader>
      {[...doc.history].reverse().map((h, i) => (
        <IonItem key={i} lines="none">
          <IonLabel>
            <p>
              <strong>{historyLabel(h.action)}</strong>
              {h.detail ? ` — ${h.detail}` : ''}
            </p>
            <p>
              {h.byName || t('Someone')} · {new Date(h.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </IonLabel>
        </IonItem>
      ))}
    </IonList>
  );
}

/** History words as the shop reads them (older bills stored plain English words). */
export function historyLabel(action: string): string {
  const known: Record<string, () => string> = {
    created: () => t('Created'),
    draft: () => t('Saved as draft'),
    saved: () => t('Saved'),
    edited: () => t('Edited'),
    cancelled: () => t('Cancelled'),
    converted: () => t('Converted to invoice'),
    delivered: () => t('Delivered'),
    accepted: () => t('Accepted'),
    declined: () => t('Declined'),
    sent: () => t('Sent'),
    payment: () => t('Payment'),
    'credit note': () => t('Credit note'),
  };
  return known[action]?.() ?? action.charAt(0).toUpperCase() + action.slice(1);
}
