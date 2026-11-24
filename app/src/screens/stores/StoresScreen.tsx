import { IonButton, IonIcon, IonRefresher, IonRefresherContent } from '@ionic/react';
import { addOutline } from 'ionicons/icons';
import { useState } from 'react';
import PageShell from '../../components/PageShell';
import { useSession } from '../../lib/session';
import AddStoreModal from './AddStoreModal';
import StoreList from './StoreList';

/** Switch store, add a store, join stores you've been invited to. */
export default function StoresScreen() {
  const { refreshMe } = useSession();
  const [adding, setAdding] = useState(false);

  return (
    <PageShell title="Stores" backHref="/tabs/more" padded={false}>
      <IonRefresher slot="fixed" onIonRefresh={(e) => void refreshMe().finally(() => e.detail.complete())}>
        <IonRefresherContent />
      </IonRefresher>
      <StoreList />
      <div className="ion-padding">
        <IonButton expand="block" fill="outline" onClick={() => setAdding(true)}>
          <IonIcon icon={addOutline} slot="start" /> Add a store
        </IonButton>
      </div>
      <AddStoreModal isOpen={adding} onClose={() => setAdding(false)} />
    </PageShell>
  );
}
