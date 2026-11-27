import { IonIcon, IonModal, useIonAlert } from '@ionic/react';
import { cameraOutline, closeCircle, imagesOutline, lockClosed } from 'ionicons/icons';
import { useRef, useState } from 'react';
import type { PhotoInfo } from '../lib/db';
import { todayISO } from '@invoice/shared';
import { dateIN, fileToResizedDataUrl } from '../lib/format';
import { t } from '../lib/i18n';
import { FormSection } from './Fields';

const MAX = 12;
const dayOf = (at: string) => dateIN(todayISO(new Date(at)));

export interface PhotosValue {
  photos: string[];
  photoInfo: PhotoInfo[];
}

/**
 * Photos attached to a bill (the paper bill, a delivery proof…). Each keeps the date it was added and
 * an optional note. Photos that were on the bill when it was sent to the customer are locked: more can
 * be added, but those cannot be removed. Tap a photo to see it large.
 */
export default function DocPhotos({
  photos,
  info,
  lockedCount,
  canAdd,
  onChange,
}: {
  photos: string[];
  info: PhotoInfo[];
  lockedCount: number;
  canAdd: boolean;
  onChange: (v: PhotosValue) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [big, setBig] = useState<number | null>(null);
  const [alert] = useIonAlert();
  if (!photos.length && !canAdd) return null;
  const infoAt = (i: number): PhotoInfo => info[i] ?? { at: '' };
  const add = (added: string[]) => {
    const at = new Date().toISOString();
    const full = photos.map((_, i) => infoAt(i));
    onChange({ photos: [...photos, ...added], photoInfo: [...full, ...added.map(() => ({ at }))] });
  };
  const remove = (i: number) =>
    onChange({ photos: photos.filter((_, j) => j !== i), photoInfo: photos.map((_, j) => infoAt(j)).filter((_, j) => j !== i) });
  const editNote = (i: number) =>
    void alert({
      header: t('Note for this photo'),
      inputs: [{ name: 'note', type: 'textarea', value: infoAt(i).note ?? '', attributes: { maxlength: 200 } }],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Save'),
          handler: (v: { note: string }) => {
            const next = photos.map((_, j) => infoAt(j));
            next[i] = { ...next[i]!, note: v.note.trim() || undefined };
            onChange({ photos, photoInfo: next });
          },
        },
      ],
    });

  return (
    <FormSection title={t('Photos')}>
      <div className="photo-grid">
        {photos.map((p, i) => {
          const locked = i < lockedCount;
          const meta = infoAt(i);
          return (
            <div key={i} className="photo-item">
              <div className="photo-cell">
                <img src={p} alt="" onClick={() => setBig(i)} />
                {locked ? (
                  <IonIcon icon={lockClosed} className="photo-lock" aria-label={t('Sent to the customer: cannot be removed')} />
                ) : (
                  canAdd && <IonIcon icon={closeCircle} onClick={() => remove(i)} aria-label={t('Remove')} />
                )}
              </div>
              {meta.at && <small className="photo-date">{dayOf(meta.at)}</small>}
              <button type="button" className="photo-note" onClick={() => canAdd && editNote(i)} disabled={!canAdd}>
                {meta.note || (canAdd ? t('+ Add note') : '')}
              </button>
            </div>
          );
        })}
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
      {lockedCount > 0 && <p className="section-note">{t('Photos sent to the customer are locked. You can still add more.')}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) add([await fileToResizedDataUrl(f, 1200, true)]);
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
          if (added.length) add(added);
        }}
      />
      <IonModal isOpen={big !== null} onDidDismiss={() => setBig(null)}>
        {big !== null && photos[big] && (
          <div className="photo-big" onClick={() => setBig(null)}>
            <img src={photos[big]} alt="" />
            {(infoAt(big).at || infoAt(big).note) && (
              <p>
                {infoAt(big).at && dayOf(infoAt(big).at)}
                {infoAt(big).note && ` · ${infoAt(big).note}`}
              </p>
            )}
          </div>
        )}
      </IonModal>
    </FormSection>
  );
}
