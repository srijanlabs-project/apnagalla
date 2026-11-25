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
import { t } from '../../lib/i18n';
import { useOnline } from '../../lib/network';
import { useSession } from '../../lib/session';
import { CLIENT_KIND } from '../../lib/platform';
import { sync } from '../../lib/sync';
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
          <IonTitle>{needsName ? t('Welcome') : t('Set up your business')}</IonTitle>
          {me?.isAdmin && CLIENT_KIND === 'web' && (
            <IonButton slot="end" fill="clear" href="/admin">
              {t('ApnaGalla admin')}
            </IonButton>
          )}
          <IonButton slot="end" fill="clear" onClick={() => void logout(true)}>
            {t('Log out')}
          </IonButton>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding auth">
        <div className="auth-wrap" style={{ justifyContent: 'flex-start' }}>
          {!online && (
            <IonText color="warning">
              <p>{t('You\'re offline. Business setup needs internet the first time.')}</p>
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
              <label className="auth-label">{t('What\'s your name?')}</label>
              <IonInput
                fill="outline"
                placeholder={t('Your full name')}
                value={name}
                autocapitalize="words"
                onIonInput={sync((e) => setNameInput(String(e.detail.value ?? '')))}
                aria-label={t('Your name')}
              />
              <button type="submit" hidden aria-hidden="true" tabIndex={-1} disabled={!name.trim() || !!busy} />
              <IonButton type="submit" expand="block" disabled={!name.trim() || !!busy}>
                {busy === 'name' ? <IonSpinner name="dots" /> : t('Continue')}
              </IonButton>
            </form>
          ) : (
            <>
              {me.invites.length > 0 && (
                <IonList inset className="auth-list">
                  <IonListHeader>
                    <IonLabel>{t('You\'ve been invited')}</IonLabel>
                  </IonListHeader>
                  {me.invites.map((inv) => (
                    <IonItem key={inv.id} lines="full">
                      <IonLabel>
                        <h2>{inv.businessName}</h2>
                        <p>
                          {inv.role === 'owner' ? t('Join as owner') : t('Join as staff')}
                          {inv.invitedByName ? ` · ${t('invited by {name}', { name: inv.invitedByName })}` : ''}
                        </p>
                      </IonLabel>
                      <IonButton slot="end" size="small" fill="clear" color="medium" disabled={!!busy} onClick={() => void run(inv.id + 'd', () => declineInvite(inv.id))}>
                        {t('Decline')}
                      </IonButton>
                      <IonButton slot="end" size="small" disabled={!!busy} onClick={() => void run(inv.id, () => acceptInvite(inv.id))}>
                        {busy === inv.id ? <IonSpinner name="dots" /> : t('Join')}
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
                <label className="auth-label">{me.invites.length ? t('Or create your own business') : t('Create your business')}</label>
                <IonInput
                  fill="outline"
                  label={t('Business name')}
                  labelPlacement="floating"
                  value={biz.name}
                  autocapitalize="words"
                  onIonInput={sync((e) => { const v = String(e.detail.value ?? ''); setBiz((b) => ({ ...b, name: v })); })}
                />
                <IonInput
                  fill="outline"
                  label={t('City')}
                  labelPlacement="floating"
                  value={biz.city}
                  autocapitalize="words"
                  onIonInput={sync((e) => { const v = String(e.detail.value ?? ''); setBiz((b) => ({ ...b, city: v })); })}
                />
                <IonInput
                  fill="outline"
                  label={t('State')}
                  labelPlacement="floating"
                  value={biz.state}
                  autocapitalize="words"
                  onIonInput={sync((e) => { const v = String(e.detail.value ?? ''); setBiz((b) => ({ ...b, state: v })); })}
                />
                <button type="submit" hidden aria-hidden="true" tabIndex={-1} disabled={!biz.name.trim() || !!busy || !online} />
                <IonButton type="submit" expand="block" disabled={!biz.name.trim() || !!busy || !online}>
                  {busy === 'biz' ? <IonSpinner name="dots" /> : t('Create business')}
                </IonButton>
                <IonText color="medium" className="auth-note">
                  {t('You can add your logo, address, bank and UPI details later in Settings.')}
                </IonText>
              </form>
            </>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
