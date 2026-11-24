import { IonButton } from '@ionic/react';
import { useRef } from 'react';
import { fileToResizedDataUrl } from '../lib/format';

interface Props {
  label: string;
  value?: string;
  onChange: (dataUrl: string | undefined) => void;
  maxPx?: number;
  disabled?: boolean;
  onError?: (message: string) => void;
}

/** Pick an image from the gallery/files (works in Android WebView and browsers, no Google services). */
export default function ImagePicker({ label, value, onChange, maxPx = 512, disabled, onError }: Props) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="image-picker">
      <div className="image-picker-preview" onClick={() => !disabled && input.current?.click()}>
        {value ? <img src={value} alt={label} /> : <span>{label}</span>}
      </div>
      <div className="image-picker-actions">
        <IonButton size="small" fill="outline" disabled={disabled} onClick={() => input.current?.click()}>
          {value ? 'Change' : 'Choose image'}
        </IonButton>
        {value && (
          <IonButton size="small" fill="clear" color="danger" disabled={disabled} onClick={() => onChange(undefined)}>
            Remove
          </IonButton>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            onChange(await fileToResizedDataUrl(file, maxPx));
          } catch (err) {
            onError?.(err instanceof Error ? err.message : 'Could not read that image');
          }
        }}
      />
    </div>
  );
}
