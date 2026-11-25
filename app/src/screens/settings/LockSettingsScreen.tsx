import { IonButton, IonInput, IonText, IonToggle, useIonToast } from '@ionic/react';
import { useEffect, useState } from 'react';
import { FormSection } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { biometricAvailable, biometricOn, checkPin, clearLock, lockEnabled, lockSupported, setBiometric, setPin, validPin } from '../../lib/appLock';
import { useBusiness } from '../../lib/business';
import { t } from '../../lib/i18n';
import { sync } from '../../lib/sync';

/** This phone's app lock: change the PIN, fingerprint on/off, or turn the lock off. */
export default function LockSettingsScreen() {
  const { settings, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const [on, setOn] = useState<boolean | null>(null);
  const [bioAvail, setBioAvail] = useState(false);
  const [bio, setBio] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const required = !isOwner && settings.staffMustLock;

  useEffect(() => {
    void (async () => {
      setOn(await lockEnabled());
      setBioAvail(await biometricAvailable());
      setBio(await biometricOn());
    })();
  }, []);

  if (!lockSupported()) {
    return (
      <PageShell title={t('App lock')} backHref="/tabs/more">
        <p>{t('The app lock works in the ApnaGalla Android app.')}</p>
      </PageShell>
    );
  }

  /** Checks the current PIN (when one is set) before a change. */
  async function confirmCurrent(): Promise<boolean> {
    if (!on) return true;
    const r = await checkPin(current);
    if (!r.ok) setMsg(r.triesLeft === 0 ? t('Too many wrong PINs. Close and reopen the app to verify with OTP.') : t('Current PIN is wrong'));
    return r.ok;
  }

  async function save() {
    setMsg(null);
    if (!(await confirmCurrent())) return;
    await setPin(next, bioAvail && bio);
    setOn(true);
    setCurrent('');
    setNext('');
    void toast({ message: t('PIN saved'), duration: 1500, color: 'success' });
  }

  async function turnOff() {
    setMsg(null);
    if (!(await confirmCurrent())) return;
    await clearLock();
    setOn(false);
    setCurrent('');
    void toast({ message: t('App lock turned off'), duration: 1500 });
  }

  const pinField = (label: string, value: string, set: (v: string) => void) => (
    <IonInput
      className="pin-input"
      type="password"
      inputmode="numeric"
      maxlength={6}
      fill="outline"
      label={label}
      labelPlacement="floating"
      value={value}
      onIonInput={sync((e) => set(String(e.detail.value ?? '').replace(/\D/g, '')))}
    />
  );

  return (
    <PageShell title={t('App lock')} backHref="/tabs/more">
      <FormSection note={t('The app asks for your PIN or fingerprint when it opens and after 5 minutes away. Forgot it? Verify with OTP; your bills stay on the phone.')}>
        <p>
          <strong>{on ? t('App lock is on') : t('App lock is off')}</strong>
          {required && ` · ${t('required by your store')}`}
        </p>
        {on && pinField(t('Current PIN'), current, setCurrent)}
        {pinField(on ? t('New PIN') : t('PIN (4–6 digits)'), next, setNext)}
        {msg && <IonText color="danger">{msg}</IonText>}
        <IonButton expand="block" disabled={!validPin(next) || (on === true && !validPin(current))} onClick={() => void save()}>
          {on ? t('Change PIN') : t('Turn on app lock')}
        </IonButton>
        {on && bioAvail && (
          <IonToggle
            className="lock-toggle"
            checked={bio}
            onIonChange={sync((e) => {
              setBio(e.detail.checked);
              void setBiometric(e.detail.checked);
            })}
          >
            {t('Unlock with fingerprint')}
          </IonToggle>
        )}
        {on && !required && (
          <IonButton expand="block" fill="clear" color="danger" disabled={!validPin(current)} onClick={() => void turnOff()}>
            {t('Turn off app lock')}
          </IonButton>
        )}
      </FormSection>
    </PageShell>
  );
}
