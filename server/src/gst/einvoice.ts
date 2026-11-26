/**
 * R10 e-invoice through the store's GST provider (GSP). The app builds the IRP JSON (schema 1.1);
 * the server forwards it with the GSP's credentials and returns the IRN, acknowledgement and the
 * signed QR. GSPs differ in paths and headers: this adapter uses the common "plain JSON with
 * credentials in headers" style and reads the usual answer fields; set EINVOICE_* on Railway from
 * the GSP's documentation (and adjust the paths if that GSP names them differently).
 */

export interface EInvoiceResult {
  irn: string;
  ackNo: string;
  ackDate: string;
  signedQr: string;
}

export interface EInvoiceProvider {
  readonly name: string;
  generate(gstin: string, payload: unknown): Promise<EInvoiceResult>;
  cancel(gstin: string, irn: string, reason: '1' | '2' | '3' | '4', remark: string): Promise<void>;
}

export class EInvoiceError extends Error {}

export interface EInvoiceEnv {
  EINVOICE_API_URL?: string;
  EINVOICE_CLIENT_ID?: string;
  EINVOICE_CLIENT_SECRET?: string;
  EINVOICE_USERNAME?: string;
  EINVOICE_PASSWORD?: string;
}

type Json = Record<string, unknown>;
const pick = (o: Json | undefined, ...keys: string[]): string | undefined => {
  if (!o) return undefined;
  for (const k of keys) if (o[k] != null && o[k] !== '') return String(o[k]);
  return undefined;
};
/** GSPs wrap the IRP's answer differently: look in the body, then in data / result / Data. */
const bodyOf = (j: Json): Json[] => [j, j.data as Json, j.result as Json, j.Data as Json, (j.data as Json | undefined)?.data as Json].filter((x): x is Json => !!x && typeof x === 'object');

export class GenericGspProvider implements EInvoiceProvider {
  readonly name = 'gsp';
  constructor(private readonly env: Required<Pick<EInvoiceEnv, 'EINVOICE_API_URL'>> & EInvoiceEnv) {}

  private headers(gstin: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      client_id: this.env.EINVOICE_CLIENT_ID ?? '',
      client_secret: this.env.EINVOICE_CLIENT_SECRET ?? '',
      username: this.env.EINVOICE_USERNAME ?? '',
      user_name: this.env.EINVOICE_USERNAME ?? '',
      password: this.env.EINVOICE_PASSWORD ?? '',
      gstin,
    };
  }

  private async call(path: string, gstin: string, body: unknown): Promise<Json> {
    const res = await fetch(`${this.env.EINVOICE_API_URL.replace(/\/$/, '')}${path}`, { method: 'POST', headers: this.headers(gstin), body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    let j: Json = {};
    try {
      j = JSON.parse(text) as Json;
    } catch {
      /* not JSON */
    }
    const ok = res.ok && !(j.status === 0 || j.status === '0' || j.Status === 0 || j.success === false);
    if (!ok) {
      const msg = bodyOf(j).map((b) => pick(b, 'ErrorMessage', 'error_message', 'message', 'Message', 'errorMessage')).find(Boolean) ?? `The GST provider answered ${res.status}`;
      throw new EInvoiceError(msg.slice(0, 300));
    }
    return j;
  }

  async generate(gstin: string, payload: unknown): Promise<EInvoiceResult> {
    const j = await this.call('/einvoice/generate', gstin, payload);
    for (const b of bodyOf(j)) {
      const irn = pick(b, 'Irn', 'irn', 'IRN');
      if (irn) return { irn, ackNo: pick(b, 'AckNo', 'ack_no', 'ackNo') ?? '', ackDate: pick(b, 'AckDt', 'ack_date', 'ackDt') ?? '', signedQr: pick(b, 'SignedQRCode', 'signed_qr_code', 'signedQRCode', 'QRCode') ?? '' };
    }
    throw new EInvoiceError('The GST provider did not send an IRN');
  }

  async cancel(gstin: string, irn: string, reason: '1' | '2' | '3' | '4', remark: string): Promise<void> {
    await this.call('/einvoice/cancel', gstin, { Irn: irn, CnlRsn: reason, CnlRem: remark.slice(0, 100) || 'Cancelled' });
  }
}

export function eInvoiceProviderFromEnv(env: EInvoiceEnv): EInvoiceProvider | null {
  return env.EINVOICE_API_URL ? new GenericGspProvider({ ...env, EINVOICE_API_URL: env.EINVOICE_API_URL }) : null;
}
