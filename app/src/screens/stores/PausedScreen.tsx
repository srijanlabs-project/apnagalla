import { IonButton, IonContent, IonHeader, IonPage, IonText, IonTitle, IonToolbar, useIonAlert } from '@ionic/react';
import { useSession } from '../../lib/session';
import StoreList from './StoreList';

/** Shown when the owner has paused this person's access to the current store. */
export default function PausedScreen() {
  const { membership, me, refreshMe, logout } = useSession();
  const [alert] = useIonAlert();
  const others = (me?.memberships ?? []).filter((m) => m.businessId !== membership?.businessId && m.active !== false);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{membership?.businessName}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonText>
          <h2>Access paused</h2>
          <p>The owner of {membership?.businessName} has paused your access. Ask them to turn it back on, then tap Check again.</p>
        </IonText>
        <IonButton expand="block" onClick={() => void refreshMe()}>
          Check again
        </IonButton>
        {others.length > 0 && <StoreList />}
        <IonButton
          expand="block"
          fill="clear"
          color="medium"
          onClick={() =>
            void logout(false).then((res) => {
              if (!res?.blockedByUnsynced) return;
              void alert({
                header: 'Unsynced changes',
                message: `${res.blockedByUnsynced} change(s) on this phone haven't reached the server yet. Logging out now will delete them.`,
                buttons: [
                  { text: 'Cancel', role: 'cancel' },
                  { text: 'Log out anyway', role: 'destructive', handler: () => void logout(true) },
                ],
              });
            })
          }
        >
          Log out
        </IonButton>
      </IonContent>
    </IonPage>
  );
}
