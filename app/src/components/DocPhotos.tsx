import { IonIcon, IonModal } from '@ionic/react';
import { cameraOutline, closeCircle, imagesOutline } from 'ionicons/icons';
import { useRef, useState } from 'react';
import { fileToResizedDataUrl } from '../lib/format';
import { t } from '../lib/i18n';
import { FormSection } from './Fields';

const MAX = 6;

/** Photos attached to a bill (the paper bill, a delivery proof…); tap one to see it large. */
export default function DocPhotos({ photos, canAdd, onChange }: { photos: string[]; canAdd: boolean; onChange: (photos: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [big, setBig] = useState<string | null>(null);
  if (!photos.length && !canAdd) return null;
  return (
    <FormSection title={t('Photos')}>
      <div className="photo-grid">
        {photos.map((p, i) => (
          <div key={i} className="photo-cell">
            <img src={p} alt="" onClick={() => setBig(p)} />
            {canAdd && <IonIcon icon={closeCircle} onClick={() => onChange(photos.filter((_, j) => j !== i))} />}
          </div>
        ))}
        {canAdd && photos.length < MAX && (
          <>
            <button type="button" className="photo-add" onClick={() => input.current?.click()} aria-label={t('Take a photo')}>
              <IonIcon icon={cameraOutline} />
              <small>{t('Camera')}</small>
            </button>
            <button type="button" className="photo-add" onClick={() => gallery.current?.click()} aria-label={t('Upload a picture')}>
              <IonIcon icon={imagesOutline} />
              <small>{t('Gallery')}</small>
            </button>
          </>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onChange([...photos, await fileToResizedDataUrl(f, 1200, true)]);
        }}
      />
      <input
        ref={gallery}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])].slice(0, MAX - photos.length);
          e.target.value = '';
          const added: string[] = [];
          for (const f of files) added.push(await fileToResizedDataUrl(f, 1200, true));
          if (added.length) onChange([...photos, ...added]);
        }}
      />
      <IonModal isOpen={!!big} onDidDismiss={() => setBig(null)}>
        {big && <img src={big} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }} onClick={() => setBig(null)} />}
      </IonModal>
    </FormSection>
  );
}
