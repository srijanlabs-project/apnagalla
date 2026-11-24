import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonNote, IonRefresher, IonRefresherContent, IonSpinner, IonText, useIonAlert } from '@ionic/react';
import type { SessionDto } from '@invoice/shared';
import { desktopOutline, phonePortraitOutline } from 'ionicons/icons';
import { useCallback, useEffect, useState } from 'react';
import PageShell from '../../components/PageShell';
import { api, errorMessage } from '../../lib/api';
import { t } from '../../lib/i18n';

function when(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Where this login is signed in; sign out a lost phone or a shared computer. Needs internet. */
export default function DevicesScreen() {
  const [list, setList] = useState<SessionDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alert] = useIonAlert();

  const load = useCallback(async () => {
    try {
      setList(await api.sessions());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageShell title={t('Devices')} backHref="/tabs/more" padded={false}>
      <IonRefresher slot="fixed" onIonRefresh={(e) => void load().finally(() => e.detail.complete())}>
        <IonRefresherContent />
      </IonRefresher>
      <p className="section-note ion-padding-horizontal">
        {t('Your login works on one phone at a time; logging in on a new phone signs the old one out. You can also be signed in on the web.')}
      </p>
      {error && (
        <IonText color="danger">
          <p className="ion-padding-horizontal">{error}</p>
        </IonText>
      )}
      {!list && !error && (
        <div className="ion-text-center ion-padding">
          <IonSpinner />
        </div>
      )}
      {list && (
        <IonList inset>
          {list.map((s) => (
            <IonItem key={s.id} lines="full">
              <IonIcon slot="start" icon={s.client === 'web' ? desktopOutline : phonePortraitOutline} />
              <IonLabel>
                <h2>{s.deviceName || (s.client === 'web' ? t('Web browser') : t('Phone'))}</h2>
                <p>
                  {s.client === 'web' ? t('Web') : t('Phone app')} · {t('last active {time}', { time: when(s.lastSeenAt) })}
                </p>
              </IonLabel>
              {s.current ? (
                <IonNote slot="end">{t('This device')}</IonNote>
              ) : (
                <IonButton
                  slot="end"
                  fill="clear"
                  color="danger"
                  size="small"
                  onClick={() =>
                    void alert({
                      message: s.deviceName ? t('Sign out {device}?', { device: s.deviceName }) : t('Sign out this device?'),
                      buttons: [
                        { text: t('Cancel'), role: 'cancel' },
                        {
                          text: t('Sign out'),
                          role: 'destructive',
                          handler: async () => {
                            try {
                              await api.signOutDevice(s.id);
                              await load();
                            } catch (e) {
                              setError(errorMessage(e));
                            }
                          },
                        },
                      ],
                    })
                  }
                >
                  {t('Sign out')}
                </IonButton>
              )}
            </IonItem>
          ))}
        </IonList>
      )}
    </PageShell>
  );
}
