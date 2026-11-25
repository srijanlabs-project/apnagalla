import { App as CapApp } from '@capacitor/app';
import { IonButton, IonContent, IonIcon, IonInput, IonPage, IonSpinner, IonText, IonToggle } from '@ionic/react';
import { fingerPrintOutline, lockClosedOutline } from 'ionicons/icons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  RELOCK_AFTER_MS,
  biometricAvailable,
  biometricOn,
  checkPin,
  clearLock,
  lockEnabled,
  lockSupported,
  setPin,
  triesLeft,
  unlockWithBiometric,
  validPin,
} from '../lib/appLock';
import { db } from '../lib/db';
import { t } from '../lib/i18n';
import { useSession } from '../lib/session';
import { kv } from '../lib/storage';
import { sync } from '../lib/sync';

type Phase = 'checking' | 'setup' | 'locked' | 'otp' | 'open';
const OFFERED = 'lock.offered';

/** Must this person use the lock? (Staff of a store whose owner requires it.) */
async function lockRequired(businessId: string | undefined, role: string | undefined): Promise<boolean> {
  if (!businessId || role !== 'staff') return false;
  return !!(await db.settings.get(businessId))?.staffMustLock;
}

/**
 * Wraps the signed-in app on the phone: asks for fingerprint or PIN on start and after 5 minutes in
 * the background; offers to set a PIN after the first login (required for staff when the owner
 * says so); 5 wrong PINs or "Forgot PIN" go through an OTP, keeping the phone's data.
 */
export default function LockGate({ children }: { children: ReactNode }) {
  const { membership } = useSession();
  const [phase, setPhase] = useState<Phase>(lockSupported() ? 'checking' : 'open');
  const [required, setRequired] = useState(false);
  const hiddenAt = useRef<number | null>(null);

  const decide = useCallback(async () => {
    if (!lockSupported()) return setPhase('open');
    const req = await lockRequired(membership?.businessId, membership?.role);
    setRequired(req);
    if (await lockEnabled()) return setPhase('locked');
    if (req || !(await kv.get<boolean>(OFFERED))) return setPhase('setup');
    setPhase('open');
  }, [membership?.businessId, membership?.role]);

  useEffect(() => {
    void decide();
  }, [decide]);

  // Re-lock after 5 minutes in the background (quick trips to WhatsApp or a UPI app don't).
  useEffect(() => {
    if (!lockSupported()) return;
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current >= RELOCK_AFTER_MS) {
        hiddenAt.current = null;
        void lockEnabled().then((on) => on && setPhase('locked'));
      }
    });
    return () => void sub.then((s) => s.remove());
  }, []);

  if (phase === 'open') return <>{children}</>;
  if (phase === 'checking')
    return (
      <IonPage>
        <IonContent>
          <div className="center-fill">
            <IonSpinner />
          </div>
        </IonContent>
      </IonPage>
    );
  if (phase === 'setup')
    return (
      <SetupLock
        required={required}
        onDone={async () => {
          await kv.set(OFFERED, true);
          setPhase('open');
        }}
      />
    );
  if (phase === 'otp') return <OtpReset onDone={() => setPhase('setup')} onCancel={() => setPhase('locked')} />;
  return <LockScreen onUnlocked={() => setPhase('open')} onForgot={() => setPhase('otp')} />;
}

function LockScreen({ onUnlocked, onForgot }: { onUnlocked: () => void; onForgot: () => void }) {
  const { membership } = useSession();
  const [pin, setPinText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [bio, setBio] = useState(false);
  const [busy, setBusy] = useState(false);

  const tryBio = useCallback(async () => {
    if (await unlockWithBiometric()) onUnlocked();
  }, [onUnlocked]);

  useEffect(() => {
    void (async () => {
      if ((await triesLeft()) === 0) return onForgot();
      const on = (await biometricOn()) && (await biometricAvailable());
      setBio(on);
      if (on) void tryBio();
    })();
  }, [tryBio, onForgot]);

  async function submit(value = pin) {
    if (!validPin(value) || busy) return;
    setBusy(true);
    const r = await checkPin(value);
    setBusy(false);
    if (r.ok) return onUnlocked();
    setPinText('');
    if (r.triesLeft === 0) return onForgot();
    setMsg(r.triesLeft === 1 ? t('Wrong PIN. 1 try left before you must verify with OTP.') : t('Wrong PIN. {count} tries left.', { count: r.triesLeft }));
  }

  return (
    <IonPage>
      <IonContent className="ion-padding lock-screen">
        <IonIcon icon={lockClosedOutline} className="lock-icon" />
        <h2>{membership?.businessName ?? 'ApnaGalla'}</h2>
        <p>{t('Enter your PIN')}</p>
        <IonInput
          className="pin-input"
          type="password"
          inputmode="numeric"
          maxlength={6}
          fill="outline"
          value={pin}
          aria-label={t('PIN')}
          onIonInput={sync((e) => {
            const v = String(e.detail.value ?? '').replace(/\D/g, '');
            setPinText(v);
            setMsg(null);
          })}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        {msg && <IonText color="danger">{msg}</IonText>}
        <IonButton expand="block" disabled={!validPin(pin) || busy} onClick={() => void submit()}>
          {busy ? <IonSpinner name="dots" /> : t('Unlock')}
        </IonButton>
        {bio && (
          <IonButton expand="block" fill="outline" onClick={() => void tryBio()}>
            <IonIcon icon={fingerPrintOutline} slot="start" /> {t('Use fingerprint')}
          </IonButton>
        )}
        <IonButton expand="block" fill="clear" color="medium" onClick={onForgot}>
          {t('Forgot PIN? Verify with OTP')}
        </IonButton>
      </IonContent>
    </IonPage>
  );
}

function SetupLock({ required, onDone }: { required: boolean; onDone: () => void | Promise<void> }) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [bioAvail, setBioAvail] = useState(false);
  const [bio, setBio] = useState(true);
  const [busy, setBusy] = useState(false);
  const mismatch = second.length >= 4 && first !== second;

  useEffect(() => {
    void biometricAvailable().then(setBioAvail);
  }, []);

  async function save() {
    if (!validPin(first) || first !== second) return;
    setBusy(true);
    await setPin(first, bioAvail && bio);
    setBusy(false);
    await onDone();
  }

  return (
    <IonPage>
      <IonContent className="ion-padding lock-screen">
        <IonIcon icon={lockClosedOutline} className="lock-icon" />
        <h2>{t('Lock the app')}</h2>
        <p>{required ? t('Your store asks staff to lock the app. Set a 4–6 digit PIN.') : t('Set a 4–6 digit PIN so nobody else can open your bills on this phone.')}</p>
        <IonInput
          className="pin-input"
          type="password"
          inputmode="numeric"
          maxlength={6}
          fill="outline"
          label={t('New PIN')}
          labelPlacement="floating"
          value={first}
          onIonInput={sync((e) => setFirst(String(e.detail.value ?? '').replace(/\D/g, '')))}
        />
        <IonInput
          className="pin-input"
          type="password"
          inputmode="numeric"
          maxlength={6}
          fill="outline"
          label={t('PIN again')}
          labelPlacement="floating"
          value={second}
          onIonInput={sync((e) => setSecond(String(e.detail.value ?? '').replace(/\D/g, '')))}
          onKeyDown={(e) => e.key === 'Enter' && void save()}
        />
        {mismatch && <IonText color="danger">{t('The two PINs are different')}</IonText>}
        {bioAvail && (
          <IonToggle checked={bio} onIonChange={sync((e) => setBio(e.detail.checked))} className="lock-toggle">
            {t('Also unlock with fingerprint')}
          </IonToggle>
        )}
        <IonButton expand="block" disabled={!validPin(first) || first !== second || busy} onClick={() => void save()}>
          {busy ? <IonSpinner name="dots" /> : t('Set PIN')}
        </IonButton>
        {!required && (
          <IonButton expand="block" fill="clear" color="medium" onClick={() => void onDone()}>
            {t('Not now')}
          </IonButton>
        )}
      </IonContent>
    </IonPage>
  );
}

/** Forgot PIN / too many tries: an OTP to this login's number, then a new PIN. Data stays. */
function OtpReset({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { me, requestOtp, verifyOtp } = useSession();
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const phone = me?.user.phone ?? '';
  const locked = useRef(false);

  useEffect(() => {
    void triesLeft().then((n) => (locked.current = n === 0));
  }, []);

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      await requestOtp(phone);
      setSent(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('Could not send the code'));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setMsg(null);
    try {
      await verifyOtp(phone, code);
      await clearLock();
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('Could not verify'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <IonPage>
      <IonContent className="ion-padding lock-screen">
        <IonIcon icon={lockClosedOutline} className="lock-icon" />
        <h2>{t('Verify it’s you')}</h2>
        <p>{t('We’ll send a code to {phone}. Your bills on this phone stay as they are.', { phone })}</p>
        {sent ? (
          <>
            <IonInput
              className="pin-input"
              inputmode="numeric"
              maxlength={6}
              fill="outline"
              label={t('Code')}
              labelPlacement="floating"
              value={code}
              onIonInput={sync((e) => setCode(String(e.detail.value ?? '').replace(/\D/g, '')))}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void verify()}
            />
            <IonButton expand="block" disabled={code.length !== 6 || busy} onClick={() => void verify()}>
              {busy ? <IonSpinner name="dots" /> : t('Verify')}
            </IonButton>
          </>
        ) : (
          <IonButton expand="block" disabled={busy} onClick={() => void send()}>
            {busy ? <IonSpinner name="dots" /> : t('Send code')}
          </IonButton>
        )}
        {msg && <IonText color="danger">{msg}</IonText>}
        {!locked.current && (
          <IonButton expand="block" fill="clear" color="medium" onClick={onCancel}>
            {t('Back to PIN')}
          </IonButton>
        )}
      </IonContent>
    </IonPage>
  );
}
