import { useIonActionSheet } from '@ionic/react';
import { useRef } from 'react';
import { t } from '../lib/i18n';

/**
 * "Take a photo or pick one from the gallery". Android's WebView only offers the camera when the
 * input asks for capture, and only the gallery when it doesn't, so there are two hidden inputs and
 * a small sheet to choose. Render `inputs` once; call `open()` from a button.
 */
export function usePhotoSource(onFile: (file: File) => void) {
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [sheet] = useIonActionSheet();
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) onFile(f);
  };
  const open = () =>
    void sheet({
      buttons: [
        { text: t('Take a photo'), handler: () => camera.current?.click() },
        { text: t('Upload from gallery'), handler: () => gallery.current?.click() },
        { text: t('Cancel'), role: 'cancel' },
      ],
    });
  const inputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={gallery} type="file" accept="image/*" hidden onChange={pick} />
    </>
  );
  return { open, inputs };
}
