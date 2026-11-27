import { IonBadge, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonSearchbar, IonSelect, IonSelectOption, useIonAlert } from '@ionic/react';
import { useState } from 'react';
import { extraOn, type ShopExtra } from '../../lib/shopExtras';
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
  globeOutline,
  bookOutline,
  timeOutline,
  saveOutline,
  pricetagOutline,
  diamondOutline,
  cubeOutline,
  repeatOutline,
  locationOutline,
} from 'ionicons/icons';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { useSession } from '../../lib/session';
import { lockSupported } from '../../lib/appLock';
import { CLIENT_KIND } from '../../lib/platform';
import { API_URL } from '../../config';
import { appLanguage, setAppLanguage, t } from '../../lib/i18n';

export default function MoreScreen() {
  const { me, membership, logout } = useSession();
  const { perms, settings } = useBusiness();
  const [alert] = useIonAlert();
  const isOwner = membership?.role === 'owner';
  const storeCount = me?.memberships.length ?? 0;
  const ownedCount = (me?.memberships ?? []).filter((m) => m.role === 'owner' && m.active).length;

  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const money = isOwner || perms.access === 'readonly';
  const on = (k: ShopExtra) => extraOn(settings, k);
  type Row = { label: string; icon: string; link?: string; href?: string; note?: string; show?: boolean };
  const groups: { title: string; rows: Row[] }[] = [
    {
      title: t('Sell'),
      rows: [
        { label: on('orders') ? t('Estimates, work orders and challans') : t('Estimates'), icon: clipboardOutline, link: '/tabs/estimates' },
        { label: t('Field visits'), icon: locationOutline, link: '/tabs/customers/visits', show: on('visits') },
        { label: t('Turn on more features'), icon: settingsOutline, link: '/tabs/more/invoice-settings', note: t('Orders, books, staff, visits, rentals, jewellery…') },
        { label: t('Deliveries'), icon: carOutline, link: '/tabs/deliveries' },
        { label: t('Jobs and repairs'), icon: constructOutline, link: '/tabs/jobs', show: on('jobs') },
        { label: t('Gift vouchers'), icon: pricetagOutline, link: '/tabs/vouchers', show: on('vouchers') },
        { label: t('Rentals'), icon: repeatOutline, link: '/tabs/rentals', show: on('rentals') },
        { label: t('Loyalty points'), icon: giftOutline, link: '/tabs/more/loyalty', show: isOwner && on('loyalty') },
        { label: t('Online store'), icon: globeOutline, link: '/tabs/more/online-store', show: isOwner && on('onlineStore') },
      ],
    },
    {
      title: t('Money'),
      rows: [
        { label: t('Reports'), icon: barChartOutline, link: '/tabs/reports', show: perms.viewReports },
        { label: t('Cash book'), icon: cashOutline, link: '/tabs/cash-book' },
        { label: t('Expenses'), icon: walletOutline, link: '/tabs/expenses' },
        { label: t('Bank and cash'), icon: libraryOutline, link: '/tabs/bank', show: money },
        { label: t('Cheques'), icon: documentTextOutline, link: '/tabs/cheques', show: on('books') },
        { label: t('Other income'), icon: trendingUpOutline, link: '/tabs/income', show: money },
        { label: t('Books (ledgers, balance sheet)'), icon: bookOutline, link: '/tabs/books', show: money && on('books') },
        { label: t('Loans'), icon: receiptOutline, link: '/tabs/loans', show: money && on('books') },
      ],
    },
    {
      title: t('Stock and buying'),
      rows: [
        { label: t('Purchases'), icon: cartOutline, link: '/tabs/purchases', show: perms.seeCost },
        { label: t('Suppliers'), icon: busOutline, link: '/tabs/suppliers', show: perms.seeCost },
        { label: t('Stock transfer'), icon: swapHorizontalOutline, link: '/tabs/items/transfer', show: isOwner },
        { label: t('Godowns'), icon: businessOutline, link: '/tabs/items/godowns', show: (isOwner || (settings.godowns ?? []).some((g) => !g.deleted)) && perms.access !== 'warehouse' },
        { label: t('Store assets'), icon: cubeOutline, link: '/tabs/assets' },
        { label: t('Gold and silver rates'), icon: diamondOutline, link: '/tabs/more/jewellery', show: on('jewellery') },
        { label: t('Product list'), icon: listOutline, link: '/tabs/more/product-list', show: isOwner },
      ],
    },
    {
      title: t('Shop setup'),
      rows: [
        { label: t('Business profile'), icon: businessOutline, link: '/tabs/more/business', note: membership?.role === 'owner' ? t('Owner') : t('Staff') },
        { label: t('Payment details (bank, UPI)'), icon: cardOutline, link: '/tabs/more/payment' },
        { label: t('Invoice settings'), icon: settingsOutline, link: '/tabs/more/invoice-settings', note: t('Numbers, tax, units, shop features') },
        { label: t('Invoice design'), icon: colorPaletteOutline, link: '/tabs/more/design' },
        { label: t('Home screen'), icon: gridOutline, link: '/tabs/more/home-cards' },
        { label: t('Printer'), icon: printOutline, link: '/tabs/more/printer' },
        { label: t('Phone alerts'), icon: notificationsOutline, link: '/tabs/more/alerts' },
        { label: t('Team'), icon: peopleOutline, link: '/tabs/more/team', show: isOwner },
        { label: t('Staff & salary'), icon: idCardOutline, link: '/tabs/more/staff', show: isOwner && on('staff') },
        { label: t('All stores'), icon: gridOutline, link: '/tabs/more/dashboard', show: ownedCount > 1 },
      ],
    },
    {
      title: t('Account and data'),
      rows: [
        { label: t('Plan and billing'), icon: ribbonOutline, link: '/tabs/more/plan' },
        { label: t('Backup and restore'), icon: saveOutline, link: '/tabs/more/full-backup', show: isOwner },
        { label: t('Daily Excel backup'), icon: cloudUploadOutline, link: '/tabs/more/backup', show: isOwner },
        { label: t('Deleted (recycle bin)'), icon: trashOutline, link: '/tabs/more/deleted', show: isOwner },
        { label: t('Activity log'), icon: timeOutline, link: '/tabs/more/activity', show: isOwner },
        { label: t('App lock'), icon: lockClosedOutline, link: '/tabs/more/lock', show: lockSupported() },
        { label: t('Devices'), icon: phonePortraitOutline, link: '/tabs/more/devices' },
        { label: t('ApnaGalla admin'), icon: shieldCheckmarkOutline, href: '/admin', show: !!me?.isAdmin && CLIENT_KIND === 'web' },
        { label: t('Privacy policy'), icon: documentTextOutline, href: `${API_URL}/privacy` },
      ],
    },
  ];

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

      <div className="more-search">
        <IonSearchbar value={q} onIonInput={(e) => setQ(e.detail.value ?? '')} placeholder={t('Search settings and pages')} />
      </div>

      {groups.map((g) => {
        const rows = g.rows.filter((r) => r.show !== false && (!needle || r.label.toLowerCase().includes(needle) || (r.note ?? '').toLowerCase().includes(needle)));
        if (!rows.length) return null;
        return (
          <IonList inset key={g.title}>
            <IonListHeader>
              <IonLabel>{g.title}</IonLabel>
            </IonListHeader>
            {rows.map((r, i) => (
              <IonItem key={r.label} routerLink={r.link} href={r.href} detail lines={i === rows.length - 1 ? 'none' : 'full'}>
                <IonIcon icon={r.icon} slot="start" />
                <IonLabel>
                  {r.label}
                  {r.note && <p>{r.note}</p>}
                </IonLabel>
              </IonItem>
            ))}
          </IonList>
        );
      })}
      {needle && !groups.some((g) => g.rows.some((r) => r.show !== false && (r.label.toLowerCase().includes(needle) || (r.note ?? '').toLowerCase().includes(needle)))) && (
        <p className="section-note ion-padding-horizontal">{t('Nothing found. Some features are off: turn them on in Invoice settings → Shop features.')}</p>
      )}

      {!needle && (
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
          <IonItem button onClick={() => void onLogout()} lines="none">
            <IonIcon icon={logOutOutline} slot="start" color="danger" />
            <IonLabel color="danger">{t('Log out')}</IonLabel>
          </IonItem>
        </IonList>
      )}
      <p className="app-version">ApnaGalla {APP_VERSION_LABEL}</p>
    </PageShell>
  );
}
