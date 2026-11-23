import {
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonPage,
  IonSpinner,
  IonText,
  IonTitle,
  IonToolbar,
} from '@ionic/react';
import { useState } from 'react';
import { errorMessage } from '../../lib/api';
import { useOnline } from '../../lib/network';
import { useSession } from '../../lib/session';
import '../auth/auth.css';

/**
 * After first login: (1) ask the user's name, then (2) either join a business
 * they were invited to, or create their own business.
 */
export default function OnboardingScreen() {
  const { me, setName, createBusiness, acceptInvite, declineInvite, logout } = useSession();
  const online = useOnline();
  const [name, setNameInput] = useState(me?.user.name ?? '');
  const [biz, setBiz] = useState({ name: '', city: '', state: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!me) return null;
  const needsName = !me.user.name;

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
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{needsName ? 'Welcome' : 'Set up your business'}</IonTitle>
          <IonButton slot="end" fill="clear" onClick={() => void logout(true)}>
            Log out
          </IonButton>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding auth">
        <div className="auth-wrap" style={{ justifyContent: 'flex-start' }}>
          {!online && (
            <IonText color="warning">
              <p>You're offline. Business setup needs internet the first time.</p>
            </IonText>
          )}
          {error && (
            <IonText color="danger">
              <p>{error}</p>
            </IonText>
          )}

          {needsName ? (
            <form
              className="auth-card"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) void run('name', () => setName(name.trim()));
              }}
            >
              <label className="auth-label">What's your name?</label>
              <IonInput
                fill="outline"
                placeholder="Your full name"
                value={name}
                autocapitalize="words"
                onIonInput={(e) => setNameInput(String(e.detail.value ?? ''))}
                aria-label="Your name"
              />
              <IonButton type="submit" expand="block" disabled={!name.trim() || !!busy}>
                {busy === 'name' ? <IonSpinner name="dots" /> : 'Continue'}
              </IonButton>
            </form>
          ) : (
            <>
              {me.invites.length > 0 && (
                <IonList inset className="auth-list">
                  <IonListHeader>
                    <IonLabel>You've been invited</IonLabel>
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

              <form
                className="auth-card"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (biz.name.trim())
                    void run('biz', () => createBusiness({ name: biz.name.trim(), city: biz.city.trim() || undefined, state: biz.state.trim() || undefined }));
                }}
              >
                <label className="auth-label">{me.invites.length ? 'Or create your own business' : 'Create your business'}</label>
                <IonInput
                  fill="outline"
                  label="Business name"
                  labelPlacement="floating"
                  value={biz.name}
                  autocapitalize="words"
                  onIonInput={(e) => setBiz({ ...biz, name: String(e.detail.value ?? '') })}
                />
                <IonInput
                  fill="outline"
                  label="City"
                  labelPlacement="floating"
                  value={biz.city}
                  autocapitalize="words"
                  onIonInput={(e) => setBiz({ ...biz, city: String(e.detail.value ?? '') })}
                />
                <IonInput
                  fill="outline"
                  label="State"
                  labelPlacement="floating"
                  value={biz.state}
                  autocapitalize="words"
                  onIonInput={(e) => setBiz({ ...biz, state: String(e.detail.value ?? '') })}
                />
                <IonButton type="submit" expand="block" disabled={!biz.name.trim() || !!busy || !online}>
                  {busy === 'biz' ? <IonSpinner name="dots" /> : 'Create business'}
                </IonButton>
                <IonText color="medium" className="auth-note">
                  You can add your logo, address, bank and UPI details later in Settings.
                </IonText>
              </form>
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
