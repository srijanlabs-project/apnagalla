import {
  IonButton,
  IonInput,
  IonItem,
  IonItemOption,
  IonItemOptions,
  IonItemSliding,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonRefresher,
  IonRefresherContent,
  IonSpinner,
  IonText,
  useIonAlert,
  useIonToast,
} from '@ionic/react';
import { formatIndianMobile, normalizeIndianMobile, type TeamResponse } from '@invoice/shared';
import { useCallback, useEffect, useState } from 'react';
import PageShell from '../../components/PageShell';
import { api, errorMessage } from '../../lib/api';
import { useBusiness } from '../../lib/business';
import { t } from '../../lib/i18n';
import { useSession } from '../../lib/session';
import { sync } from '../../lib/sync';

/** Owner-only: invite staff by phone, pause / turn on access, see pending invites, remove staff. Needs internet. */
export default function TeamScreen() {
  const { membership, me } = useSession();
  const businessId = membership?.businessId;
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [alert] = useIonAlert();
  const [toast] = useIonToast();
  const perPerson = useBusiness().settings.numberingMode !== 'shared';

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      setTeam(await api.team(businessId));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    const normalized = normalizeIndianMobile(phone);
    if (!businessId || !normalized) return setError(t('Enter a valid 10-digit mobile number'));
    setBusy(true);
    try {
      await api.invite(businessId, { phone: normalized, role: 'staff' });
      setPhone('');
      void toast({ message: t('Invite created. Ask them to log in with {phone}.', { phone: formatIndianMobile(normalized) }), duration: 3000 });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function doToggle(userId: string, active: boolean) {
    setToggling(userId);
    try {
      setTeam(await api.setMemberActive(businessId!, userId, active));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setToggling(null);
    }
  }

  function changeLetter(userId: string, current: string, who: string) {
    void alert({
      header: t('Series letter for {name}', { name: who }),
      message: t('Their invoice numbers look like {example}. You can change the letter until their first bill is saved.', { example: `INV-${current}/26-27/0001` }),
      inputs: [{ name: 'code', value: current, attributes: { maxlength: 2, autocapitalize: 'characters' } }],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Save'),
          handler: (v: { code?: string }) => {
            const code = (v.code ?? '').trim().toUpperCase();
            if (!/^[A-Z]{1,2}$/.test(code)) {
              void toast({ message: t('Use one or two letters'), duration: 2000, color: 'danger' });
              return false;
            }
            void api
              .setSeriesCode(businessId!, userId, code)
              .then((res) => {
                setTeam(res);
                setError(null);
              })
              .catch((e) => setError(errorMessage(e)));
            return true;
          },
        },
      ],
    });
  }

  function toggleActive(userId: string, active: boolean, who: string) {
    if (active) return doToggle(userId, true);
    void alert({
      header: t('Pause {name}?', { name: who }),
      message: t('They are blocked from this store right away, on every device. Their past bills stay. You can turn their access back on any time.'),
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        { text: t('Pause'), role: 'destructive', handler: () => void doToggle(userId, false) },
      ],
    });
  }

  function confirm(message: string, action: () => Promise<void>) {
    void alert({
      message,
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Remove'),
          role: 'destructive',
          handler: async () => {
            try {
              await action();
              await load();
            } catch (e) {
              setError(errorMessage(e));
            }
          },
        },
      ],
    });
  }

  return (
    <PageShell title={t('Team')} backHref="/tabs/more" padded={false}>
      <IonRefresher slot="fixed" onIonRefresh={(e) => void load().finally(() => e.detail.complete())}>
        <IonRefresherContent />
      </IonRefresher>

      <form onSubmit={invite} className="ion-padding">
        <IonInput
          fill="outline"
          type="tel"
          inputmode="numeric"
          label={t('Staff mobile number')}
          labelPlacement="floating"
          value={phone}
          onIonInput={sync((e) => {
            setPhone(String(e.detail.value ?? ''));
            setError(null);
          })}
        />
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} disabled={busy} />
        <IonButton type="submit" expand="block" className="ion-margin-top" disabled={busy || phone.replace(/\D/g, '').length < 10}>
          {busy ? <IonSpinner name="dots" /> : t('Invite staff')}
        </IonButton>
        <IonNote>{t('They log in with this number and tap "Join". Staff can create invoices but can\'t edit or delete them.')}</IonNote>
        {error && (
          <IonText color="danger">
            <p>{error}</p>
          </IonText>
        )}
      </form>

      {!team && !error && (
        <div className="ion-text-center ion-padding">
          <IonSpinner />
        </div>
      )}

      {team && (
        <>
          <IonList inset>
            <IonListHeader>
              <IonLabel>{t('Members')}</IonLabel>
            </IonListHeader>
            {team.members.map((m) => (
              <IonItemSliding key={m.userId} disabled={m.userId === me?.user.id}>
                <IonItem lines="full">
                  <IonLabel>
                    <h2>{m.name ?? t('Not set')}</h2>
                    <p>
                      {formatIndianMobile(m.phone)} · {m.role === 'owner' ? t('Owner') : t('Staff')}
                      {!m.active && <span className="text-danger"> · {t('Paused')}</span>}
                    </p>
                    {perPerson && <p>{m.seriesCode ? t('Bill numbers with letter {letter}', { letter: m.seriesCode }) : t('Bill numbers without a letter')}</p>}
                  </IonLabel>
                  {perPerson && m.role !== 'owner' && m.seriesCode && (
                    <IonButton slot="end" size="small" fill="clear" onClick={() => changeLetter(m.userId, m.seriesCode, m.name ?? formatIndianMobile(m.phone))}>
                      {t('Letter {letter}', { letter: m.seriesCode })}
                    </IonButton>
                  )}
                  {m.role !== 'owner' && (
                    <IonButton
                      slot="end"
                      size="small"
                      fill="outline"
                      color={m.active ? 'medium' : 'success'}
                      disabled={toggling === m.userId}
                      onClick={() => void toggleActive(m.userId, !m.active, m.name ?? formatIndianMobile(m.phone))}
                    >
                      {toggling === m.userId ? <IonSpinner name="dots" /> : m.active ? t('Pause') : t('Turn on')}
                    </IonButton>
                  )}
                </IonItem>
                <IonItemOptions side="end">
                  <IonItemOption color="danger" onClick={() => confirm(t('Remove {name} from the team?', { name: m.name ?? formatIndianMobile(m.phone) }), () => api.removeMember(businessId!, m.userId))}>
                    {t('Remove')}
                  </IonItemOption>
                </IonItemOptions>
              </IonItemSliding>
            ))}
          </IonList>

          {team.invites.length > 0 && (
            <IonList inset>
              <IonListHeader>
                <IonLabel>{t('Pending invites')}</IonLabel>
              </IonListHeader>
              {team.invites.map((inv) => (
                <IonItem key={inv.id} lines="full">
                  <IonLabel>{formatIndianMobile(inv.phone)}</IonLabel>
                  <IonButton slot="end" fill="clear" color="danger" size="small" onClick={() => confirm(t('Cancel this invite?'), () => api.revokeInvite(businessId!, inv.id))}>
                    {t('Cancel')}
                  </IonButton>
                </IonItem>
              ))}
            </IonList>
          )}
        </>
      )}
    </PageShell>
  );
}
