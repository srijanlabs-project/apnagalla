import { IonButton, IonContent, IonHeader, IonPage, IonText, IonTitle, IonToolbar, useIonAlert } from '@ionic/react';
import { t } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import StoreList from './StoreList';

/**
 * Shown when the owner has paused this person's access to the current store, or (suspended)
 * when ApnaGalla has suspended the whole store.
 */
export default function PausedScreen({ suspended = false }: { suspended?: boolean }) {
  const { membership, me, refreshMe, logout } = useSession();
  const [alert] = useIonAlert();
  const others = (me?.memberships ?? []).filter((m) => m.businessId !== membership?.businessId && m.active !== false && !m.suspended);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{membership?.businessName}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonText>
          {suspended ? (
            <>
              <h2>{t('Store suspended')}</h2>
              <p>{t('{store} has been suspended by ApnaGalla. Please contact ApnaGalla support, then tap Check again.', { store: membership?.businessName ?? '' })}</p>
            </>
          ) : (
            <>
              <h2>{t('Access paused')}</h2>
              <p>{t('The owner of {store} has paused your access. Ask them to turn it back on, then tap Check again.', { store: membership?.businessName ?? '' })}</p>
            </>
          )}
        </IonText>
        <IonButton expand="block" onClick={() => void refreshMe()}>
          {t('Check again')}
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
                header: t('Unsynced changes'),
                message:
                  res.blockedByUnsynced === 1
                    ? t("1 change on this phone hasn't reached the server yet. Logging out now will delete it.")
                    : t("{count} changes on this phone haven't reached the server yet. Logging out now will delete them.", { count: res.blockedByUnsynced }),
                buttons: [
                  { text: t('Cancel'), role: 'cancel' },
                  { text: t('Log out anyway'), role: 'destructive', handler: () => void logout(true) },
                ],
              });
            })
          }
        >
          {t('Log out')}
        </IonButton>
      </IonContent>
    </IonPage>
  );
}
