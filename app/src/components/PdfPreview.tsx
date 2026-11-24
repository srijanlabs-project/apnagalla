import { IonSpinner } from '@ionic/react';
import { useEffect, useRef, useState } from 'react';

/**
 * Renders PDF pages to canvases with pdf.js. (Android WebView has no built-in PDF viewer,
 * so an <iframe> preview would be blank on the phone.)
 */
export default function PdfPreview({ blob }: { blob: Blob | null }) {
  const host = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        // Legacy build: the modern one needs very recent JS (e.g. Uint8Array.toHex) that older
        // Android WebViews lack — common on phones without Google Play services.
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
        }
        const data = new Uint8Array(await blob.arrayBuffer());
        const pdf = await pdfjs.getDocument({ data }).promise;
        const el = host.current;
        if (!el || cancelled) return;
        const width = el.clientWidth || 360;
        const canvases: HTMLCanvasElement[] = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const unscaled = page.getViewport({ scale: 1 });
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const viewport = page.getViewport({ scale: (width / unscaled.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = '100%';
          canvas.className = 'pdf-page';
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
          canvases.push(canvas);
        }
        if (cancelled) return;
        el.replaceChildren(...canvases);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not show preview');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);

  return (
    <div className="pdf-preview">
      {busy && (
        <div className="pdf-preview-busy">
          <IonSpinner />
        </div>
      )}
      {error && <p className="text-danger">{error}</p>}
      <div ref={host} />
    </div>
  );
}
