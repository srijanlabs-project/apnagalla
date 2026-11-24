import { IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonAlert } from '@ionic/react';
import { formatIndianMobile } from '@invoice/shared';
import {
  businessOutline,
  cardOutline,
  clipboardOutline,
  colorPaletteOutline,
  logOutOutline,
  peopleOutline,
  personCircleOutline,
  settingsOutline,
} from 'ionicons/icons';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { useSession } from '../../lib/session';

export default function MoreScreen() {
  const { me, membership, logout } = useSession();
  const { profile } = useBusiness();
  const [alert] = useIonAlert();
  const isOwner = membership?.role === 'owner';

  async function onLogout() {
    const res = await logout(false);
    if (res && res.blockedByUnsynced > 0) {
      void alert({
        header: 'Unsynced changes',
        message: `${res.blockedByUnsynced} change(s) on this phone haven't reached the server yet. Logging out now will delete them. Connect to the internet and wait for sync first.`,
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          { text: 'Log out anyway', role: 'destructive', handler: () => void logout(true) },
        ],
      });
      return;
    }
  }

  return (
    <PageShell title="More" padded={false}>
      <IonList inset>
        <IonItem lines="none">
          <IonIcon icon={personCircleOutline} slot="start" />
          <IonLabel>
            <h2>{me?.user.name}</h2>
            <p>{me ? formatIndianMobile(me.user.phone) : ''}</p>
          </IonLabel>
        </IonItem>
      </IonList>

      <IonList inset>
        <IonListHeader>
          <IonLabel>Business</IonLabel>
        </IonListHeader>
        <IonItem routerLink="/tabs/more/business" detail lines="full">
          <IonIcon icon={businessOutline} slot="start" />
          <IonLabel>
            {profile.name}
            <p>Business profile</p>
          </IonLabel>
          <IonNote slot="end">{membership?.role === 'owner' ? 'Owner' : 'Staff'}</IonNote>
        </IonItem>
        <IonItem routerLink="/tabs/more/payment" detail lines="full">
          <IonIcon icon={cardOutline} slot="start" />
          <IonLabel>Payment details (bank, UPI)</IonLabel>
        </IonItem>
        <IonItem routerLink="/tabs/more/invoice-settings" detail lines="full">
          <IonIcon icon={settingsOutline} slot="start" />
          <IonLabel>Invoice settings</IonLabel>
        </IonItem>
        <IonItem routerLink="/tabs/more/design" detail lines="full">
          <IonIcon icon={colorPaletteOutline} slot="start" />
          <IonLabel>Invoice design</IonLabel>
        </IonItem>
        <IonItem routerLink="/tabs/estimates" detail lines="full">
          <IonIcon icon={clipboardOutline} slot="start" />
          <IonLabel>Estimates</IonLabel>
        </IonItem>
        {isOwner && (
          <IonItem routerLink="/tabs/more/team" detail lines="none">
            <IonIcon icon={peopleOutline} slot="start" />
            <IonLabel>Team</IonLabel>
          </IonItem>
        )}
      </IonList>

      <IonList inset>
        <IonItem button onClick={() => void onLogout()} lines="none">
          <IonIcon icon={logOutOutline} slot="start" color="danger" />
          <IonLabel color="danger">Log out</IonLabel>
        </IonItem>
      </IonList>
    </PageShell>
  );
}
