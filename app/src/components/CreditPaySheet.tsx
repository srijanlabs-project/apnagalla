import { IonButton, IonButtons, IonContent, IonHeader, IonItem, IonLabel, IonList, IonModal, IonNote, IonTitle, IonToolbar } from '@ionic/react';
import { useEffect, useState } from 'react';
import { openCredits } from '../lib/credit';
import type { CreditNote } from '../lib/db';
import { dateIN, rupees } from '../lib/format';
import { t } from '../lib/i18n';
import { TextField } from './Fields';

/** Pick a credit note with credit left (the customer's, or by number for a walk-in). */
export default function CreditPaySheet({
  isOpen,
  onClose,
  businessId,
  customerId,
  onPick,
}: {
  isOpen: boolean;
  onClose: () => void;
  businessId: string;
  customerId?: string | null;
  onPick: (note: CreditNote, left: number) => void;
}) {
  const [list, setList] = useState<{ note: CreditNote; left: number }[]>([]);
  const [number, setNumber] = useState('');
  const [searched, setSearched] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setNumber('');
    setSearched(false);
    void openCredits(businessId, { customerId }).then(setList);
  }, [isOpen, businessId, customerId]);

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.7} breakpoints={[0, 0.7, 1]}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('Pay with credit note')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>{t('Cancel')}</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <div className="search-row">
          <TextField label={t('Credit note number')} value={number} onChange={(v) => setNumber(v.toUpperCase())} autocapitalize="characters" />
          <IonButton
            fill="clear"
            disabled={!number.trim()}
            onClick={() =>
              void openCredits(businessId, { number }).then((r) => {
                setList(r);
                setSearched(true);
              })
            }
          >
            {t('Find')}
          </IonButton>
        </div>
        <IonList>
          {list.map(({ note, left }) => (
            <IonItem
              key={note.id}
              button
              detail={false}
              onClick={() => {
                onPick(note, left);
                onClose();
              }}
            >
              <IonLabel>
                <h3>{note.number}</h3>
                <p>
                  {dateIN(note.date)} · {note.billTo?.name ?? ''}
                </p>
              </IonLabel>
              <IonNote slot="end">{t('Left {amount}', { amount: rupees(left) })}</IonNote>
            </IonItem>
          ))}
        </IonList>
        {list.length === 0 && <p className="section-note">{searched ? t('No credit left on that note.') : t('No credit notes with credit left for this customer. Type a note number to find one.')}</p>}
      </IonContent>
    </IonModal>
  );
}
