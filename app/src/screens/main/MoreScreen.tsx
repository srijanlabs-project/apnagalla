import { IonBadge, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSelect, IonSelectOption, useIonAlert } from '@ionic/react';
import { APP_VERSION_LABEL } from '../../lib/version';
import { LANGS, LANG_NAMES, formatIndianMobile, type Lang } from '@invoice/shared';
import {
  businessOutline,
  languageOutline,
  trendingUpOutline,
  receiptOutline,
  libraryOutline,
  barChartOutline,
  gridOutline,
  idCardOutline,
  swapHorizontalOutline,
  ribbonOutline,
  documentTextOutline,
  constructOutline,
  cloudUploadOutline,
  busOutline,
  listOutline,
  notificationsOutline,
  carOutline,
  cartOutline,
  cashOutline,
  walletOutline,
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
  trashOutline,
  giftOutline,
} from 'ionicons/icons';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { useSession } from '../../lib/session';
import { lockSupported } from '../../lib/appLock';
import { CLIENT_KIND } from '../../lib/platform';
import { appLanguage, setAppLanguage, t } from '../../lib/i18n';

export default function MoreScreen() {
  const { me, membership, logout } = useSession();
  const { profile, perms, settings } = useBusiness();
  const [alert] = useIonAlert();
  const isOwner = membership?.role === 'owner';
  const storeCount = me?.memberships.length ?? 0;
  const ownedCount = (me?.memberships ?? []).filter((m) => m.role === 'owner' && m.active).length;

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
          <IonLabel>{t('Money and stock')}</IonLabel>
        </IonListHeader>
        <IonItem routerLink="/tabs/estimates" detail lines="full">
          <IonIcon icon={clipboardOutline} slot="start" />
          <IonLabel>{t('Estimates, work orders and challans')}</IonLabel>
        </IonItem>
        <IonItem routerLink="/tabs/jobs" detail lines="full">
          <IonIcon icon={constructOutline} slot="start" />
          <IonLabel>{t('Jobs and repairs')}</IonLabel>
        </IonItem>
        {perms.viewReports && (
          <IonItem routerLink="/tabs/reports" detail lines="full">
            <IonIcon icon={barChartOutline} slot="start" />
            <IonLabel>{t('Reports')}</IonLabel>
          </IonItem>
        )}
        <IonItem routerLink="/tabs/cash-book" detail lines="full">
          <IonIcon icon={cashOutline} slot="start" />
          <IonLabel>{t('Cash book')}</IonLabel>
        </IonItem>
        {(isOwner || perms.access === 'readonly') && (
          <IonItem routerLink="/tabs/bank" detail lines="full">
            <IonIcon icon={libraryOutline} slot="start" />
            <IonLabel>{t('Bank and cash')}</IonLabel>
          </IonItem>
        )}
        <IonItem routerLink="/tabs/cheques" detail lines="full">
          <IonIcon icon={documentTextOutline} slot="start" />
          <IonLabel>{t('Cheques')}</IonLabel>
        </IonItem>
        {perms.seeCost && (
          <>
            <IonItem routerLink="/tabs/purchases" detail lines="full">
              <IonIcon icon={cartOutline} slot="start" />
              <IonLabel>{t('Purchases')}</IonLabel>
            </IonItem>
            <IonItem routerLink="/tabs/suppliers" detail lines="full">
              <IonIcon icon={busOutline} slot="start" />
              <IonLabel>{t('Suppliers')}</IonLabel>
            </IonItem>
          </>
        )}
        <IonItem routerLink="/tabs/expenses" detail lines={isOwner || perms.access === 'readonly' ? 'full' : 'none'}>
          <IonIcon icon={walletOutline} slot="start" />
          <IonLabel>{t('Expenses')}</IonLabel>
        </IonItem>
        {(isOwner || perms.access === 'readonly') && (
          <>
            <IonItem routerLink="/tabs/income" detail lines="full">
              <IonIcon icon={trendingUpOutline} slot="start" />
              <IonLabel>{t('Other income')}</IonLabel>
            </IonItem>
            <IonItem routerLink="/tabs/loans" detail lines="none">
              <IonIcon icon={receiptOutline} slot="start" />
              <IonLabel>{t('Loans')}</IonLabel>
            </IonItem>
          </>
        )}
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
        {isOwner && (
          <IonItem routerLink="/tabs/more/loyalty" detail lines="full">
            <IonIcon icon={giftOutline} slot="start" />
            <IonLabel>{t('Loyalty points')}</IonLabel>
          </IonItem>
        )}
        <IonItem routerLink="/tabs/more/design" detail lines="full">
          <IonIcon icon={colorPaletteOutline} slot="start" />
          <IonLabel>{t('Invoice design')}</IonLabel>
        </IonItem>
        <IonItem routerLink="/tabs/more/plan" detail lines="full">
          <IonIcon icon={ribbonOutline} slot="start" />
          <IonLabel>{t('Plan and billing')}</IonLabel>
        </IonItem>
        {isOwner && (
          <IonItem routerLink="/tabs/more/deleted" detail lines="full">
            <IonIcon icon={trashOutline} slot="start" />
            <IonLabel>{t('Deleted (recycle bin)')}</IonLabel>
          </IonItem>
        )}
        {isOwner && (
          <IonItem routerLink="/tabs/more/backup" detail lines="full">
            <IonIcon icon={cloudUploadOutline} slot="start" />
            <IonLabel>{t('Daily Excel backup')}</IonLabel>
          </IonItem>
        )}
        {isOwner && (
          <IonItem routerLink="/tabs/more/staff" detail lines="none">
            <IonIcon icon={idCardOutline} slot="start" />
            <IonLabel>{t('Staff & salary')}</IonLabel>
          </IonItem>
        )}
        {ownedCount > 1 && (
          <IonItem routerLink="/tabs/more/dashboard" detail lines="none">
            <IonIcon icon={gridOutline} slot="start" />
            <IonLabel>{t('All stores')}</IonLabel>
          </IonItem>
        )}
        {(isOwner || (settings.godowns ?? []).some((g) => !g.deleted)) && perms.access !== 'warehouse' && (
          <IonItem routerLink="/tabs/items/godowns" detail lines="none">
            <IonIcon icon={businessOutline} slot="start" />
            <IonLabel>{t('Godowns')}</IonLabel>
          </IonItem>
        )}
        {isOwner && ownedCount > 1 && (
          <IonItem routerLink="/tabs/items/transfer" detail lines="none">
            <IonIcon icon={swapHorizontalOutline} slot="start" />
            <IonLabel>{t('Stock transfer')}</IonLabel>
          </IonItem>
        )}
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
        <IonItem routerLink="/tabs/deliveries" detail lines="full">
          <IonIcon icon={carOutline} slot="start" />
          <IonLabel>{t('Deliveries')}</IonLabel>
        </IonItem>
        {isOwner && (
          <IonItem routerLink="/tabs/more/product-list" detail lines="full">
            <IonIcon icon={listOutline} slot="start" />
            <IonLabel>{t('Product list')}</IonLabel>
          </IonItem>
        )}
        <IonItem routerLink="/tabs/more/alerts" detail lines="full">
          <IonIcon icon={notificationsOutline} slot="start" />
          <IonLabel>{t('Phone alerts')}</IonLabel>
        </IonItem>
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
      <p className="app-version">ApnaGalla {APP_VERSION_LABEL}</p>
    </PageShell>
  );
}
