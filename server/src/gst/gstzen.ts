import { stateName, type GstinInfo } from '@invoice/shared';
import type { GstProvider } from './lookup';

/**
 * GSTZen GSTIN validator (https://my.gstzen.in/api/gstin-validator/).
 * Request: POST, headers `Token: <key>`, `x-api-version: 1.0`, JSON body {"gstin": "..."}.
 *
 * The response schema isn't public, so fields are found by name anywhere in the JSON: GSTZen's
 * own names and the GST portal's (lgnm, tradeNam, sts, dty, rgdt, pradr.addr…), which GST data
 * APIs commonly pass through. When the legal name can't be found, only the field names (never
 * the values) are logged so the mapping can be fixed.
 */

type Json = Record<string, unknown>;

export interface GstzenOptions {
  url: string;
  key: string;
  apiVersion?: string;
  timeoutMs?: number;
  /** Logs a warning (no data values). */
  warn?: (msg: string) => void;
  fetchImpl?: typeof fetch;
}

const keyOf = (k: string) => k.toLowerCase().replace(/[_\s-]/g, '');

/** Value of one field name anywhere in the JSON (nearest to the top wins). */
function findOne(obj: unknown, name: string, depth = 0): unknown {
  if (!obj || typeof obj !== 'object' || depth > 5) return undefined;
  const entries = Object.entries(obj as Json);
  for (const [k, v] of entries) if (keyOf(k) === name && v != null && v !== '') return v;
  for (const [, v] of entries) {
    const found = Array.isArray(v) ? v.map((x) => findOne(x, name, depth + 1)).find((x) => x != null) : findOne(v, name, depth + 1);
    if (found != null) return found;
  }
  return undefined;
}

/** First field found, trying `names` in order (most specific first); case and _ are ignored. */
export function findField(obj: unknown, names: string[], accept: (v: unknown) => boolean = () => true): unknown {
  for (const n of names) {
    const v = findOne(obj, keyOf(n));
    if (v != null && accept(v)) return v;
  }
  return undefined;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : undefined);

/** "21/07/2017" or "2017-07-21" → "2017-07-21". */
function isoDate(v: unknown): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  const dmy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
}

/** All key paths of a JSON value, without values: safe to log. */
export function keyPaths(obj: unknown, prefix = '', out: string[] = [], depth = 0): string[] {
  if (!obj || typeof obj !== 'object' || depth > 4) return out;
  for (const [k, v] of Object.entries(obj as Json)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.push(p);
    keyPaths(Array.isArray(v) ? v[0] : v, p, out, depth + 1);
  }
  return out;
}

/** Turns a GSTZen answer into our GstinInfo, or null when the GSTIN isn't registered. */
export function parseGstzen(gstin: string, body: unknown, warn?: (m: string) => void): Omit<GstinInfo, 'checkedAt'> | null {
  const validFlag = findField(body, ['valid', 'is_valid', 'isValid']);
  if (validFlag === false || validFlag === 'false') return null;

  const legalName = str(findField(body, ['legal_name', 'legalName', 'lgnm', 'legal_name_of_business', 'company_name']));
  if (!legalName) {
    warn?.(`GSTZen: no legal name in the response; fields were: ${keyPaths(body).join(', ')}`);
    const msg = str(findField(body, ['message', 'error', 'detail']));
    if (msg && /not\s*found|invalid|does not exist/i.test(msg)) return null;
    return null;
  }
  // A bare "status" may be the API's own (e.g. 1 / "success"): only words like Active / Cancelled count.
  const status =
    str(findField(body, ['gstin_status', 'gstinStatus', 'sts', 'taxpayer_status', 'registration_status', 'status'], (v) => typeof v === 'string' && /^(active|cancel|suspend|inactive|provision)/i.test(v))) ?? 'Unknown';
  const addr = findField(body, ['pradr', 'principal_place_of_business', 'principal_address', 'address']);
  const addrObj = (addr && typeof addr === 'object' ? ((findField(addr, ['addr']) as Json | undefined) ?? (addr as Json)) : {}) as Json;
  const addrText = typeof addr === 'string' ? addr.trim() : undefined;
  const parts = (keys: string[]) => keys.map((k) => str(findField(addrObj, [k]))).filter(Boolean).join(', ') || undefined;
  const stateCode = gstin.slice(0, 2);
  return {
    gstin,
    legalName,
    tradeName: str(findField(body, ['trade_name', 'tradeName', 'tradeNam', 'trade_name_of_business'])),
    status,
    active: /^act/i.test(status),
    taxpayerType: str(findField(body, ['taxpayer_type', 'taxpayerType', 'dty', 'constitution_of_business', 'ctb'])),
    registeredOn: isoDate(findField(body, ['registration_date', 'registrationDate', 'rgdt', 'date_of_registration'])),
    address: {
      line1: parts(['bno', 'flno', 'bnm']) ?? addrText,
      line2: parts(['st', 'loc']),
      city: str(findField(addrObj, ['dst', 'city', 'district'])),
      state: stateName(stateCode),
      pin: str(findField(addrObj, ['pncd', 'pincode', 'pin'])) ?? str(findField(body, ['pincode', 'pncd'])),
    },
    stateCode,
  };
}

export function gstzenProvider(o: GstzenOptions): GstProvider {
  const doFetch = o.fetchImpl ?? fetch;
  return {
    name: 'gstzen',
    async lookup(gstin) {
      const res = await doFetch(o.url, {
        method: 'POST',
        headers: { Token: o.key, 'x-api-version': o.apiVersion ?? '1.0', 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ gstin }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 12_000),
      });
      const body = (await res.json().catch(() => null)) as unknown;
      if (res.status === 404) return null;
      if (!res.ok) {
        o.warn?.(`GSTZen answered HTTP ${res.status}; fields: ${keyPaths(body).join(', ')}`);
        throw new Error(res.status === 401 || res.status === 403 ? 'GST lookup key was refused' : `GST lookup failed (${res.status})`);
      }
      return parseGstzen(gstin, body, o.warn);
    },
  };
}
