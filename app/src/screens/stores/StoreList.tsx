import { IonBadge, IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonSpinner, IonText } from '@ionic/react';
import { checkmarkCircle, storefrontOutline } from 'ionicons/icons';
import { useState } from 'react';
import { errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';

/** The user's stores (tap to switch) and invites waiting for them. */
export default function StoreList({ onSwitched }: { onSwitched?: () => void }) {
  const { me, membership, switchBusiness, acceptInvite, declineInvite } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && (
        <IonText color="danger">
          <p className="ion-padding-horizontal">{error}</p>
        </IonText>
      )}
      <IonList inset>
        <IonListHeader>
          <IonLabel>Your stores</IonLabel>
        </IonListHeader>
        {me.memberships.map((m) => {
          const current = m.businessId === membership?.businessId;
          const paused = m.active === false;
          return (
            <IonItem
              key={m.businessId}
              button={!current}
              detail={false}
              lines="full"
              onClick={() => {
                if (current) return;
                void switchBusiness(m.businessId).then(onSwitched);
              }}
            >
              <IonIcon icon={storefrontOutline} slot="start" />
              <IonLabel>
                <h2>{m.businessName}</h2>
                <p>
                  {m.role === 'owner' ? 'Owner' : 'Staff'}
                  {m.businessCity ? ` · ${m.businessCity}` : ''}
                </p>
              </IonLabel>
              {paused && (
                <IonBadge slot="end" color="medium">
                  Paused
                </IonBadge>
              )}
              {current && <IonIcon slot="end" icon={checkmarkCircle} color="primary" aria-label="Current store" />}
            </IonItem>
          );
        })}
      </IonList>

      {me.invites.length > 0 && (
        <IonList inset>
          <IonListHeader>
            <IonLabel>Invites for you</IonLabel>
          </IonListHeader>
          {me.invites.map((inv) => (
            <IonItem key={inv.id} lines="full">
              <IonLabel>
                <h2>{inv.businessName}</h2>
                <p>
                  Join as {inv.role}
                  {inv.invitedByName ? ` · invited by ${inv.invitedByName}` : ''}
                </p>
              </IonLabel>
              <IonButton slot="end" size="small" fill="clear" color="medium" disabled={!!busy} onClick={() => void run(inv.id + 'd', () => declineInvite(inv.id))}>
                Decline
              </IonButton>
              <IonButton slot="end" size="small" disabled={!!busy} onClick={() => void run(inv.id, () => acceptInvite(inv.id))}>
                {busy === inv.id ? <IonSpinner name="dots" /> : 'Join'}
              </IonButton>
            </IonItem>
          ))}
        </IonList>
      )}
    </>
  );
}
