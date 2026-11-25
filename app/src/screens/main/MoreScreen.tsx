import { IonBadge, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSelect, IonSelectOption, useIonAlert } from '@ionic/react';
import { LANGS, LANG_NAMES, formatIndianMobile, type Lang } from '@invoice/shared';
import {
  businessOutline,
  languageOutline,
  lockClosedOutline,
  shieldCheckmarkOutline,
  cardOutline,
  clipboardOutline,
  colorPaletteOutline,
  logOutOutline,
  peopleOutline,
  personCircleOutline,
  phonePortraitOutline,
  printOutline,
  settingsOutline,
  storefrontOutline,
} from 'ionicons/icons';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { useSession } from '../../lib/session';
import { lockSupported } from '../../lib/appLock';
import { CLIENT_KIND } from '../../lib/platform';
import { appLanguage, setAppLanguage, t } from '../../lib/i18n';

export default function MoreScreen() {
  const { me, membership, logout } = useSession();
  const { profile } = useBusiness();
  const [alert] = useIonAlert();
  const isOwner = membership?.role === 'owner';
  const storeCount = me?.memberships.length ?? 0;

  async function onLogout() {
    const res = await logout(false);
    if (res && res.blockedByUnsynced > 0) {
      void alert({
        header: t('Unsynced changes'),
        message:
          res.blockedByUnsynced === 1
            ? t("1 change on this phone hasn't reached the server yet. Logging out now will delete it. Connect to the internet and wait for sync first.")
            : t("{count} changes on this phone haven't reached the server yet. Logging out now will delete them. Connect to the internet and wait for sync first.", { count: res.blockedByUnsynced }),
        buttons: [
          { text: t('Cancel'), role: 'cancel' },
          { text: t('Log out anyway'), role: 'destructive', handler: () => void logout(true) },
        ],
      });
      return;
    }
  }

  return (
    <PageShell title={t('More')} padded={false}>
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
        <IonItem routerLink="/tabs/more/stores" detail lines="none">
          <IonIcon icon={storefrontOutline} slot="start" />
          <IonLabel>
            {membership?.businessName}
            <p>{storeCount > 1 ? t('Switch store ({count} stores)', { count: storeCount }) : t('Stores · add another store')}</p>
          </IonLabel>
          {(me?.invites.length ?? 0) > 0 && (
            <IonBadge slot="end" color="primary">
              {me!.invites.length > 1 ? t('{count} invites', { count: me!.invites.length }) : t('1 invite')}
            </IonBadge>
          )}
        </IonItem>
      </IonList>

      <IonList inset>
        <IonListHeader>
          <IonLabel>{t('Business')}</IonLabel>
        </IonListHeader>
        <IonItem routerLink="/tabs/more/business" detail lines="full">
          <IonIcon icon={businessOutline} slot="start" />
          <IonLabel>
            {profile.name}
            <p>{t('Business profile')}</p>
          </IonLabel>
          <IonNote slot="end">{membership?.role === 'owner' ? t('Owner') : t('Staff')}</IonNote>
        </IonItem>
        <IonItem routerLink="/tabs/more/payment" detail lines="full">
          <IonIcon icon={cardOutline} slot="start" />
          <IonLabel>{t('Payment details (bank, UPI)')}</IonLabel>
        </IonItem>
        <IonItem routerLink="/tabs/more/invoice-settings" detail lines="full">
          <IonIcon icon={settingsOutline} slot="start" />
          <IonLabel>{t('Invoice settings')}</IonLabel>
        </IonItem>
        <IonItem routerLink="/tabs/more/design" detail lines="full">
          <IonIcon icon={colorPaletteOutline} slot="start" />
          <IonLabel>{t('Invoice design')}</IonLabel>
        </IonItem>
        <IonItem routerLink="/tabs/estimates" detail lines="full">
          <IonIcon icon={clipboardOutline} slot="start" />
          <IonLabel>{t('Estimates')}</IonLabel>
        </IonItem>
        {isOwner && (
          <IonItem routerLink="/tabs/more/team" detail lines="none">
            <IonIcon icon={peopleOutline} slot="start" />
            <IonLabel>{t('Team')}</IonLabel>
          </IonItem>
        )}
      </IonList>

      <IonList inset>
        <IonItem lines="full">
          <IonIcon icon={languageOutline} slot="start" />
          <IonSelect
            label={t('Language')}
            interface="popover"
            value={appLanguage()}
            onIonChange={(e) => e.detail.value !== appLanguage() && void setAppLanguage(e.detail.value as Lang)}
          >
            {LANGS.map((l) => (
              <IonSelectOption key={l} value={l}>
                {LANG_NAMES[l]}
              </IonSelectOption>
            ))}
          </IonSelect>
        </IonItem>
        {lockSupported() && (
          <IonItem routerLink="/tabs/more/lock" detail lines="full">
            <IonIcon icon={lockClosedOutline} slot="start" />
            <IonLabel>{t('App lock')}</IonLabel>
          </IonItem>
        )}
        {me?.isAdmin && CLIENT_KIND === 'web' && (
          <IonItem href="/admin" detail lines="full">
            <IonIcon icon={shieldCheckmarkOutline} slot="start" />
            <IonLabel>{t('ApnaGalla admin')}</IonLabel>
          </IonItem>
        )}
        <IonItem routerLink="/tabs/more/printer" detail lines="full">
          <IonIcon icon={printOutline} slot="start" />
          <IonLabel>{t('Printer')}</IonLabel>
        </IonItem>
        <IonItem routerLink="/tabs/more/devices" detail lines="full">
          <IonIcon icon={phonePortraitOutline} slot="start" />
          <IonLabel>{t('Devices')}</IonLabel>
        </IonItem>
        <IonItem button onClick={() => void onLogout()} lines="none">
          <IonIcon icon={logOutOutline} slot="start" color="danger" />
          <IonLabel color="danger">{t('Log out')}</IonLabel>
        </IonItem>
      </IonList>
    </PageShell>
  );
}
