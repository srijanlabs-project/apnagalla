import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Lang } from '@invoice/shared';
import { t } from './i18n';
import { canvasToJob, toBase64, type PaperWidth } from './receipt/escpos';
import { renderReceipt, type ReceiptInput } from './receipt/render';
import { ShopTools } from './shopTools';
import { KEYS, kv } from './storage';

/*
 * Bluetooth thermal printers. Two kinds:
 *  - classic: paired once in Android settings (most cheap ESC/POS printers), our own plugin;
 *  - BLE: found by a scan (@capacitor-community/bluetooth-le), written to a writable characteristic.
 * The chosen printer and its paper width are kept on this phone.
 */

interface ClassicPrinterPlugin {
  listPaired(): Promise<{ devices: { name: string; address: string }[] }>;
  print(o: { address: string; data: string }): Promise<void>;
}
const Classic = registerPlugin<ClassicPrinterPlugin>('ClassicPrinter');

export interface PrinterConfig {
  kind: 'classic' | 'ble' | 'wifi';
  /** MAC address (classic), BLE device id, or IP address (Wi-Fi / network printer). */
  id: string;
  name: string;
  paper: PaperWidth;
  /** Print the store logo at the top. */
  logo: boolean;
  /** Print automatically after each counter sale. */
  autoPrint: boolean;
  /** Wi-Fi printers: the raw printing port (9100 on almost all). */
  port?: number;
}

/** A Wi-Fi / LAN printer address: four numbers 0-255. */
export const isIpAddress = (s: string) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s.trim()) && s.trim().split('.').every((n) => Number(n) <= 255);

export const canPrint = () => Capacitor.isNativePlatform();

export async function loadPrinter(): Promise<PrinterConfig | null> {
  return kv.get<PrinterConfig>(KEYS.printer);
}

export async function savePrinter(p: PrinterConfig | null): Promise<void> {
  if (p) await kv.set(KEYS.printer, p);
  else await kv.remove(KEYS.printer);
}

export async function pairedClassicPrinters(): Promise<{ name: string; address: string }[]> {
  return (await Classic.listPaired()).devices;
}

/** Opens Android's BLE scan list and returns the printer picked. */
export async function pickBlePrinter(): Promise<{ id: string; name: string }> {
  const { BleClient } = await import('@capacitor-community/bluetooth-le');
  await BleClient.initialize({ androidNeverForLocation: true });
  const d = await BleClient.requestDevice({ optionalServices: BLE_PRINTER_SERVICES });
  return { id: d.deviceId, name: d.name ?? d.deviceId };
}

/** Services common BLE receipt printers use for their write channel. */
const BLE_PRINTER_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb'];

async function sendBle(id: string, bytes: Uint8Array) {
  const { BleClient } = await import('@capacitor-community/bluetooth-le');
  await BleClient.initialize({ androidNeverForLocation: true });
  await BleClient.connect(id);
  try {
    const services = await BleClient.getServices(id);
    // Prefer a known printer service, else any characteristic we can write to.
    const ordered = [...services].sort((a, b) => Number(BLE_PRINTER_SERVICES.includes(b.uuid)) - Number(BLE_PRINTER_SERVICES.includes(a.uuid)));
    let target: { service: string; characteristic: string; noResponse: boolean } | null = null;
    for (const s of ordered) {
      const c = s.characteristics.find((c) => c.properties.writeWithoutResponse || c.properties.write);
      if (c) {
        target = { service: s.uuid, characteristic: c.uuid, noResponse: c.properties.writeWithoutResponse };
        break;
      }
    }
    if (!target) throw new Error(t('This Bluetooth device does not accept print data.'));
    const mtu = await BleClient.getMtu(id).catch(() => 23);
    const chunk = Math.max(20, Math.min(180, mtu - 3));
    for (let i = 0; i < bytes.length; i += chunk) {
      const part = bytes.subarray(i, i + chunk);
      const view = new DataView(part.buffer, part.byteOffset, part.byteLength);
      if (target.noResponse) {
        await BleClient.writeWithoutResponse(id, target.service, target.characteristic, view);
        await new Promise((r) => setTimeout(r, 12)); // don't overrun the printer's buffer
      } else {
        await BleClient.write(id, target.service, target.characteristic, view);
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    await BleClient.disconnect(id).catch(() => undefined);
  }
}

export async function sendToPrinter(p: PrinterConfig, bytes: Uint8Array): Promise<void> {
  if (!canPrint()) throw new Error(t('Printing works in the ApnaGalla phone app.'));
  if (p.kind === 'classic') await Classic.print({ address: p.id, data: toBase64(bytes) });
  else if (p.kind === 'wifi') await ShopTools.printTcp({ host: p.id, port: p.port ?? 9100, data: toBase64(bytes) });
  else await sendBle(p.id, bytes);
}

/** Draws the receipt and prints it on the saved printer. */
export async function printReceipt(p: PrinterConfig, input: Omit<ReceiptInput, 'paper' | 'showLogo'>): Promise<void> {
  const canvas = await renderReceipt({ ...input, paper: p.paper, showLogo: p.logo });
  await sendToPrinter(p, canvasToJob(canvas));
}

/** A short test page: shows the paper width is right and all four scripts print. */
export async function testPrint(p: PrinterConfig, shop: string, lang: Lang): Promise<void> {
  const W = p.paper === 58 ? 384 : 576;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = 330;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, c.height);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  ctx.font = '700 28px sans-serif';
  ctx.fillText(shop || 'ApnaGalla', 4, 6);
  ctx.font = '22px sans-serif';
  const lines = [`Printer test · ${p.paper} mm · ${lang}`, 'English: Total ₹1,234.50', 'हिन्दी: कुल राशि', 'ગુજરાતી: કુલ રકમ', 'ਪੰਜਾਬੀ: ਕੁੱਲ ਰਕਮ'];
  lines.forEach((l, i) => ctx.fillText(l, 4, 50 + i * 34));
  // Edge marks: both should print fully on the right paper width.
  ctx.fillRect(0, 230, W, 4);
  ctx.fillRect(0, 230, 4, 60);
  ctx.fillRect(W - 4, 230, 4, 60);
  await sendToPrinter(p, canvasToJob(c));
}
