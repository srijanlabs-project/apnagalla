import {
  IonButton,
  IonContent,
  IonInput,
  IonNote,
  IonPage,
  IonSpinner,
  IonText,
  useIonToast,
} from '@ionic/react';
import { OTP_LENGTH, formatIndianMobile, normalizeIndianMobile } from '@invoice/shared';
import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../lib/api';
import { useSession } from '../../lib/session';
import './auth.css';

type Step = { kind: 'phone' } | { kind: 'otp'; phone: string; resendAt: number };

export default function LoginScreen() {
  const { requestOtp, verifyOtp } = useSession();
  const [step, setStep] = useState<Step>({ kind: 'phone' });
  const [phoneInput, setPhoneInput] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [toast] = useIonToast();
  const otpRef = useRef<HTMLIonInputElement>(null);

  useEffect(() => {
    if (step.kind !== 'otp') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    setTimeout(() => otpRef.current?.setFocus(), 300);
    return () => clearInterval(t);
  }, [step.kind]);

  async function sendCode(phone: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await requestOtp(phone);
      setCode('');
      setStep({ kind: 'otp', phone, resendAt: Date.now() + r.resendAfterSeconds * 1000 });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onPhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    const phone = normalizeIndianMobile(phoneInput);
    if (!phone) return setError('Enter a valid 10-digit mobile number');
    await sendCode(phone);
  }

  async function onOtpSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (step.kind !== 'otp' || code.length !== OTP_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(step.phone, code);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  // Auto-submit once all digits are typed (or pasted).
  useEffect(() => {
    if (step.kind === 'otp' && code.length === OTP_LENGTH && !busy) void onOtpSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <IonPage>
      <IonContent className="ion-padding auth">
        <div className="auth-wrap">
          <div className="auth-brand">
            <div className="auth-logo">₹</div>
            <h1>Galla</h1>
            <p>Create, share and track invoices — even without internet.</p>
          </div>

          {step.kind === 'phone' ? (
            <form onSubmit={onPhoneSubmit} className="auth-card">
              <label className="auth-label">Mobile number</label>
              <div className="phone-row">
                <span className="cc">+91</span>
                <IonInput
                  type="tel"
                  inputmode="numeric"
                  autocomplete="tel-national"
                  placeholder="98765 43210"
                  value={phoneInput}
                  maxlength={14}
                  onIonInput={(e) => setPhoneInput(String(e.detail.value ?? ''))}
                  aria-label="Mobile number"
                />
              </div>
              {error && <IonText color="danger" className="auth-error">{error}</IonText>}
              <IonButton type="submit" expand="block" disabled={busy || phoneInput.replace(/\D/g, '').length < 10}>
                {busy ? <IonSpinner name="dots" /> : 'Get OTP'}
              </IonButton>
              <IonNote className="auth-note">We'll send a {OTP_LENGTH}-digit code by SMS.</IonNote>
            </form>
          ) : (
            <form onSubmit={onOtpSubmit} className="auth-card">
              <label className="auth-label">Enter the code sent to {formatIndianMobile(step.phone)}</label>
              <IonInput
                ref={otpRef}
                className="otp-input"
                type="text"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength={OTP_LENGTH}
                placeholder={'•'.repeat(OTP_LENGTH)}
                value={code}
                onIonInput={(e) => setCode(String(e.detail.value ?? '').replace(/\D/g, '').slice(0, OTP_LENGTH))}
                aria-label="One-time code"
              />
              {error && <IonText color="danger" className="auth-error">{error}</IonText>}
              <IonButton type="submit" expand="block" disabled={busy || code.length !== OTP_LENGTH}>
                {busy ? <IonSpinner name="dots" /> : 'Verify'}
              </IonButton>
              <div className="otp-actions">
                <IonButton fill="clear" size="small" onClick={() => { setStep({ kind: 'phone' }); setError(null); }}>
                  Change number
                </IonButton>
                <IonButton
                  fill="clear"
                  size="small"
                  disabled={busy || now < step.resendAt}
                  onClick={async () => {
                    await sendCode(step.phone);
                    void toast({ message: 'New code sent', duration: 1500, position: 'top' });
                  }}
                >
                  {now < step.resendAt ? `Resend in ${Math.ceil((step.resendAt - now) / 1000)}s` : 'Resend code'}
                </IonButton>
              </div>
            </form>
          )}
        </div>
      </IonContent>
    </IonPage>
  );
}
