import { IonButton, IonIcon, IonNote, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { copyOutline, logoWhatsapp, openOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { FormSection, MoneyField, TextArea, TextField, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import { api } from '../../lib/api';
import { useBusiness } from '../../lib/business';
import { API_URL } from '../../config';
import { db, type BusinessSettings } from '../../lib/db';
import { t } from '../../lib/i18n';
import { putRecord } from '../../lib/repo';

type OnlineStore = NonNullable<BusinessSettings['onlineStore']>;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const slugFrom = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export const storeUrl = (slug: string) => `${API_URL.replace(/\/$/, '')}/s/${slug}`;

/** Owner: the store's page where customers order online (items marked "show online"). */
export default function OnlineStoreScreen() {
  const { settings, actor, isOwner, profile } = useBusiness();
  const [toast] = useIonToast();
  const [o, setO] = useState<OnlineStore>(settings.onlineStore ?? { enabled: false, slug: slugFrom(profile.name) });
  const [free, setFree] = useState<boolean | null>(null);
  useEffect(() => setO(settings.onlineStore ?? { enabled: false, slug: slugFrom(profile.name) }), [settings.onlineStore, profile.name]);
  useEffect(() => {
    setFree(null);
    if (!SLUG_RE.test(o.slug)) return;
    const timer = setTimeout(() => void api.storeSlugFree(actor.businessId, o.slug).then((r) => setFree(r.free)).catch(() => setFree(null)), 400);
    return () => clearTimeout(timer);
  }, [o.slug, actor.businessId]);
  const shown = useLiveQuery(() => db.items.where('businessId').equals(actor.businessId).filter((i) => !!i.online && !i.deleted).count(), [actor.businessId]);
  const url = storeUrl(o.slug);
  const ro = !isOwner;
  const saved = settings.onlineStore?.enabled && settings.onlineStore.slug === o.slug;

  return (
    <FormPage
      title={t('Online store')}
      backHref="/tabs/more"
      canSave={!ro && SLUG_RE.test(o.slug) && free !== false}
      onSave={
        isOwner
          ? async () => {
              await putRecord('settings', actor, { ...settings, onlineStore: o });
              void toast({ message: t('Saved'), duration: 1200, color: 'success' });
            }
          : undefined
      }
    >
      <FormSection note={t('Customers open your store’s page, pick items and send an order with their name, phone and address. It reaches your phones as a sales order draft; you confirm it and bill. No payment is taken online.')}>
        <ToggleRow label={t('Take orders online')} checked={o.enabled} onChange={(enabled) => setO({ ...o, enabled })} disabled={ro} />
        <TextField
          label={t('Store page name')}
          value={o.slug}
          onChange={(v) => setO({ ...o, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) })}
          disabled={ro}
          error={!SLUG_RE.test(o.slug) ? t('3–40 letters, digits or -') : free === false ? t('Another store has this name') : null}
          helper={url}
        />
        <TextArea label={t('Message on the page (timings, delivery area)')} value={o.note} onChange={(note) => setO({ ...o, note })} disabled={ro} />
        <MoneyField label={t('Smallest order (optional)')} value={o.minOrder ?? null} onChange={(v) => setO({ ...o, minOrder: v || undefined })} disabled={ro} />
        <IonNote>{t('{n} items are shown. Turn on “Show in online store” on an item to add it.', { n: shown ?? 0 })}</IonNote>
      </FormSection>
      {saved && (
        <FormSection title={t('Share your store')}>
          <div className="detail-actions">
            <IonButton size="small" fill="outline" href={url} target="_blank">
              <IonIcon icon={openOutline} slot="start" /> {t('Open')}
            </IonButton>
            <IonButton size="small" fill="outline" color="success" href={`https://wa.me/?text=${encodeURIComponent(t('Order from {store} online: {link}', { store: profile.name, link: url }))}`} target="_blank">
              <IonIcon icon={logoWhatsapp} slot="start" /> {t('WhatsApp')}
            </IonButton>
            <IonButton
              size="small"
              fill="clear"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(url)
                  .then(() => toast({ message: t('Link copied'), duration: 1200, position: 'top' }))
                  .catch(() => undefined)
              }
            >
              <IonIcon icon={copyOutline} slot="start" /> {t('Copy link')}
            </IonButton>
          </div>
        </FormSection>
      )}
    </FormPage>
  );
}
