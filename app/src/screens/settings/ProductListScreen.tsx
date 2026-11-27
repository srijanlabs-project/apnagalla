import { IonButton, IonCard, IonCardContent, IonCheckbox, IonItem, IonLabel, IonList, IonNote, IonSpinner, useIonToast } from '@ionic/react';
import { presetFor } from '../../lib/shopExtras';
import { CATALOG_SECTIONS, type CatalogSection } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { FormSection, ToggleRow } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { catalogCounts, refreshCatalog, SECTION_LABEL, VERSION_KEY } from '../../lib/catalog';
import { db, type BusinessSettings } from '../../lib/db';
import { t } from '../../lib/i18n';
import { putRecord } from '../../lib/repo';

/** Saves the store's product-list choice and downloads it. */
export async function chooseSections(actor: Parameters<typeof putRecord>[1], settings: BusinessSettings, sections: CatalogSection[], suggest = settings.catalogSuggest !== false) {
  // The shop type also switches on the features that kind of shop usually needs.
  await putRecord('settings', actor, { ...settings, ...presetFor(settings, sections), catalogSections: sections, catalogSuggest: suggest });
  await refreshCatalog(true);
}

function SectionChecks({ value, onChange, counts }: { value: CatalogSection[]; onChange: (v: CatalogSection[]) => void; counts?: Record<string, number> }) {
  return (
    <IonList>
      {CATALOG_SECTIONS.map((s) => (
        <IonItem key={s}>
          <IonCheckbox slot="start" checked={value.includes(s)} onIonChange={(e) => onChange(e.detail.checked ? [...value, s] : value.filter((x) => x !== s))} />
          <IonLabel>{SECTION_LABEL[s]()}</IonLabel>
          {counts && value.includes(s) && <IonNote slot="end">{t('{count} products', { count: counts[s] ?? 0 })}</IonNote>}
        </IonItem>
      ))}
    </IonList>
  );
}

/** Owner: which product lists this store uses for suggestions. */
export default function ProductListScreen() {
  const { actor, settings, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const [sections, setSections] = useState<CatalogSection[]>(settings.catalogSections ?? []);
  const [busy, setBusy] = useState(false);
  const version = useLiveQuery(async () => (await db.meta.get(VERSION_KEY))?.value ?? 0, []);
  const counts = useLiveQuery(() => catalogCounts(), [version]);
  const suggest = settings.catalogSuggest !== false;

  return (
    <PageShell title={t('Product list')} backHref="/tabs/more">
      <p className="section-note">
        {t('Pick what your shop sells. When you add an item, the app suggests products (name, unit, HSN, GST) so you only type your price. Works offline after the first download.')}
      </p>
      <FormSection title={t('My shop sells')}>
        <SectionChecks value={sections} onChange={setSections} counts={counts} />
        <ToggleRow
          label={t('Suggest products when adding items')}
          checked={suggest}
          disabled={!isOwner}
          onChange={(on) => void putRecord('settings', actor, { ...settings, catalogSuggest: on })}
          note={t('Off if you have your own full list of items.')}
        />
      </FormSection>
      <IonButton
        expand="block"
        disabled={!isOwner || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await chooseSections(actor, settings, sections);
            void toast({ message: t('Saved'), duration: 1200, color: 'success' });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <IonSpinner name="dots" /> : t('Save and download')}
      </IonButton>
      {!isOwner && <p className="section-note">{t('Only the owner can change this.')}</p>}
      <p className="section-note">{t('Your own items and prices stay private to your shop. The product list has no prices.')}</p>
    </PageShell>
  );
}

/** Home card for the owner of a store that hasn't chosen yet. */
export function ChooseProductListCard() {
  const { actor, settings, isOwner } = useBusiness();
  const [sections, setSections] = useState<CatalogSection[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!isOwner || settings.catalogSections !== undefined) return null;
  // A one-line banner on Home; the choices open only when tapped, so the day's figures stay on the first screen.
  if (!open)
    return (
      <button type="button" className="setup-banner" onClick={() => setOpen(true)}>
        <span>
          <strong>{t('What does your shop sell?')}</strong>
          <small>{t('Pick once to get ready-made item suggestions')}</small>
        </span>
        <span className="setup-banner-go">{t('Choose')}</span>
      </button>
    );
  return (
    <IonCard>
      <IonCardContent>
        <h2>{t('What does your shop sell?')}</h2>
        <p>{t('Pick it once: when you add items, the app suggests products so you only type your price.')}</p>
        <SectionChecks value={sections} onChange={setSections} />
        <div className="detail-actions">
          <IonButton
            disabled={busy || !sections.length}
            onClick={async () => {
              setBusy(true);
              await chooseSections(actor, settings, sections).finally(() => setBusy(false));
            }}
          >
            {t('Save')}
          </IonButton>
          <IonButton fill="clear" color="medium" onClick={() => void putRecord('settings', actor, { ...settings, catalogSections: [] })}>
            {t('Not now')}
          </IonButton>
        </div>
      </IonCardContent>
    </IonCard>
  );
}
