import { IonButton, IonButtons, IonContent, IonHeader, IonModal, IonTitle, IonToolbar } from '@ionic/react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called for each code read. Return false to keep scanning (counter mode), anything else to close. */
  onScan: (code: string) => boolean | void;
  /** Counter mode: stay open and keep adding items. */
  continuous?: boolean;
  title?: string;
}

const FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE,
];

/** The same code within this time is one scan, not two. */
const SAME_CODE_MS = 1500;

/**
 * Reads barcodes with the phone's back camera, inside the app (ZXing, open source, no Google
 * services). Works in the Android app and in a browser.
 */
export default function BarcodeScanner({ isOpen, onClose, onScan, continuous, title = t('Scan barcode') }: Props) {
  const video = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  // Callbacks via refs: a new function from the parent must not restart the camera.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    let controls: IScannerControls | null = null;
    let stopped = false;
    let lastCode = '';
    let lastAt = 0;
    setError(null);
    setLast(null);
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, FORMATS]]);
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });

    // The modal's video element appears after it animates in.
    const start = async () => {
      for (let i = 0; i < 20 && !video.current; i++) await new Promise((r) => setTimeout(r, 50));
      if (stopped || !video.current) return;
      try {
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video.current, (result) => {
          if (!result || stopped) return;
          const code = result.getText().trim();
          const now = Date.now();
          if (code === lastCode && now - lastAt < SAME_CODE_MS) return;
          lastCode = code;
          lastAt = now;
          navigator.vibrate?.(60);
          setLast(code);
          const keepGoing = onScanRef.current(code) === false || continuous;
          if (!keepGoing) {
            stopped = true;
            controls?.stop();
            onCloseRef.current();
          }
        });
        if (stopped) controls.stop();
      } catch (e) {
        const name = (e as Error).name;
        setError(
          name === 'NotAllowedError'
            ? t('Camera permission was refused. Allow the camera for ApnaGalla in your phone settings.')
            : name === 'NotFoundError'
              ? t('No camera found on this device.')
              : t('Could not start the camera.'),
        );
      }
    };
    void start();
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [isOpen, continuous]);

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonButton onClick={onClose}>{continuous ? t('Done') : t('Cancel')}</IonButton>
          </IonButtons>
          <IonTitle>{title}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="scanner">
        {error ? (
          <p className="ion-padding text-danger">{error}</p>
        ) : (
          <div className="scanner-view">
            <video ref={video} muted playsInline />
            <div className="scanner-frame" />
          </div>
        )}
        {!error && <p className="ion-padding scanner-hint">{last ? t('Read {code}', { code: last }) : t('Point the camera at the barcode.')}</p>}
      </IonContent>
    </IonModal>
  );
}
