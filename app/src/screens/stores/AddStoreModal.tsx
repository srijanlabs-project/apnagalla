import { IonButton, IonButtons, IonContent, IonHeader, IonModal, IonNote, IonSpinner, IonText, IonTitle, IonToolbar } from '@ionic/react';
import { MAX_OWNED_STORES } from '@invoice/shared';
import { useState } from 'react';
import { FormSection, SelectField, TextField } from '../../components/Fields';
import { errorMessage } from '../../lib/api';
import { INDIAN_STATES } from '../../lib/format';
import { useOnline } from '../../lib/network';
import { useSession } from '../../lib/session';

/** Creates another store owned by the current user, then switches to it. Needs internet. */
export default function AddStoreModal({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated?: () => void }) {
  const { me, createBusiness } = useSession();
  const online = useOnline();
  const [form, setForm] = useState({ name: '', city: '', state: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owned = me?.memberships.filter((m) => m.role === 'owner').length ?? 0;
  const atLimit = owned >= MAX_OWNED_STORES;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await createBusiness({ name: form.name.trim(), city: form.city.trim() || undefined, state: form.state || undefined });
      setForm({ name: '', city: '', state: '' });
      onClose();
      onCreated?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose}>Cancel</IonButton>
          </IonButtons>
          <IonTitle>New store</IonTitle>
          <IonButtons slot="end">
            <IonButton strong disabled={!form.name.trim() || busy || !online || atLimit} onClick={() => void create()}>
              {busy ? <IonSpinner name="dots" /> : 'Create'}
            </IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {!online && (
          <IonText color="warning">
            <p>You're offline. Creating a store needs internet.</p>
          </IonText>
        )}
        {atLimit && (
          <IonText color="warning">
            <p>You already have {MAX_OWNED_STORES} stores, the most allowed.</p>
          </IonText>
        )}
        {error && (
          <IonText color="danger">
            <p>{error}</p>
          </IonText>
        )}
        <FormSection>
          <TextField label="Store name" required value={form.name} onChange={(name) => setForm((f) => ({ ...f, name }))} autocapitalize="words" />
          <TextField label="City" value={form.city} onChange={(city) => setForm((f) => ({ ...f, city }))} autocapitalize="words" />
          <SelectField label="State" value={form.state} options={INDIAN_STATES.map((s) => ({ value: s, label: s }))} onChange={(state) => setForm((f) => ({ ...f, state }))} />
        </FormSection>
        <IonNote>Each store has its own customers, items, invoice numbers, GST details and team. You can add the logo, address, bank and UPI details after creating it.</IonNote>
      </IonContent>
    </IonModal>
  );
}
