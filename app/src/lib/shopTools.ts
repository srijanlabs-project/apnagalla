import { Capacitor, registerPlugin } from '@capacitor/core';
import { shareFile } from './exportTable';

/** Our own Android plugin (ShopToolsPlugin.java): WhatsApp chat with a file, Wi-Fi printing. */
interface ShopToolsPlugin {
  whatsAppFile(o: { phone: string; fileName: string; mime?: string; text?: string }): Promise<void>;
  printTcp(o: { host: string; port?: number; data: string }): Promise<void>;
  printPdf(o: { fileName: string; title?: string }): Promise<void>;
}

// Never return this from an async function: the plugin answers every property, `then` included.
export const ShopTools = registerPlugin<ShopToolsPlugin>('ShopTools');

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Writes the file to the app's cache, where the native side can read it. */
export async function toCache(fileName: string, blob: Blob): Promise<void> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  await Filesystem.writeFile({ path: fileName, data: await blobToBase64(blob), directory: Directory.Cache });
}

/**
 * Opens WhatsApp in the customer's chat with the file attached; the seller taps send. Falls back
 * to the share sheet (pick WhatsApp and the chat) when that isn't possible (web, no WhatsApp…).
 */
export async function sendOnWhatsApp(phone: string | undefined, fileName: string, blob: Blob, text?: string): Promise<'whatsapp' | 'shared' | 'downloaded'> {
  if (Capacitor.getPlatform() === 'android' && phone) {
    try {
      await toCache(fileName, blob);
      await ShopTools.whatsAppFile({ phone, fileName, mime: blob.type || 'application/pdf', text });
      return 'whatsapp';
    } catch {
      /* fall back below */
    }
  }
  return shareFile(fileName, blob, text);
}

/** Android's print screen for a PDF (Wi-Fi / network A4 printers). Web: the browser's print. */
export async function printPdfFile(fileName: string, blob: Blob, title?: string): Promise<void> {
  if (Capacitor.getPlatform() === 'android') {
    await toCache(fileName, blob);
    await ShopTools.printPdf({ fileName, title });
    return;
  }
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  w?.addEventListener('load', () => w.print());
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
