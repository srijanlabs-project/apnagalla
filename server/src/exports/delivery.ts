import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Where the nightly Excel goes: email (Resend) and the owner's own cloud folder (Google Drive,
 * OneDrive or Dropbox, signed in once with OAuth). Each switches on when its keys are set.
 */

export type CloudProvider = 'google' | 'onedrive' | 'dropbox';
export const CLOUD_PROVIDERS: CloudProvider[] = ['google', 'onedrive', 'dropbox'];

export interface DeliveryEnv {
  RESEND_API_KEY?: string;
  EXPORT_EMAIL_FROM: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  DROPBOX_APP_KEY?: string;
  DROPBOX_APP_SECRET?: string;
  PUBLIC_URL: string;
}

export const emailReady = (env: DeliveryEnv) => !!env.RESEND_API_KEY;
export function cloudReady(env: DeliveryEnv, p: CloudProvider): boolean {
  if (p === 'google') return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  if (p === 'onedrive') return !!(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
  return !!(env.DROPBOX_APP_KEY && env.DROPBOX_APP_SECRET);
}

export class DeliveryError extends Error {}

async function check(r: Response, what: string): Promise<Response> {
  if (!r.ok) throw new DeliveryError(`${what} failed (${r.status})`);
  return r;
}

/* ---------- email ---------- */

export async function sendEmail(env: DeliveryEnv, to: string, subject: string, body: string, file: { fileName: string; buffer: Buffer }): Promise<void> {
  if (!env.RESEND_API_KEY) throw new DeliveryError('Email is not set up on the server');
  await check(
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EXPORT_EMAIL_FROM, to: [to], subject, text: body, attachments: [{ filename: file.fileName, content: file.buffer.toString('base64') }] }),
      signal: AbortSignal.timeout(30_000),
    }),
    'Email',
  );
}

/* ---------- OAuth ---------- */

const redirectUri = (env: DeliveryEnv, p: CloudProvider) => `${env.PUBLIC_URL.replace(/\/$/, '')}/v1/exports/callback/${p}`;

export function authorizeUrl(env: DeliveryEnv, p: CloudProvider, state: string): string {
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  if (p === 'google')
    return `https://accounts.google.com/o/oauth2/v2/auth?${q({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri(env, p),
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent',
      state,
    })}`;
  if (p === 'onedrive')
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${q({
      client_id: env.MS_CLIENT_ID!,
      redirect_uri: redirectUri(env, p),
      response_type: 'code',
      scope: 'offline_access Files.ReadWrite',
      state,
    })}`;
  return `https://www.dropbox.com/oauth2/authorize?${q({ client_id: env.DROPBOX_APP_KEY!, redirect_uri: redirectUri(env, p), response_type: 'code', token_access_type: 'offline', state })}`;
}

const TOKEN_URL: Record<CloudProvider, string> = {
  google: 'https://oauth2.googleapis.com/token',
  onedrive: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  dropbox: 'https://api.dropboxapi.com/oauth2/token',
};

function clientOf(env: DeliveryEnv, p: CloudProvider): { client_id: string; client_secret: string } {
  if (p === 'google') return { client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET! };
  if (p === 'onedrive') return { client_id: env.MS_CLIENT_ID!, client_secret: env.MS_CLIENT_SECRET! };
  return { client_id: env.DROPBOX_APP_KEY!, client_secret: env.DROPBOX_APP_SECRET! };
}

async function tokenRequest(env: DeliveryEnv, p: CloudProvider, body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string }> {
  const r = await check(
    await fetch(TOKEN_URL[p], {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...clientOf(env, p), ...body }).toString(),
      signal: AbortSignal.timeout(20_000),
    }),
    'Sign-in',
  );
  return (await r.json()) as { access_token: string; refresh_token?: string };
}

/** Exchanges the code from the consent screen for a long-lived refresh token. */
export async function exchangeCode(env: DeliveryEnv, p: CloudProvider, code: string): Promise<string> {
  const t = await tokenRequest(env, p, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(env, p), ...(p === 'onedrive' ? { scope: 'offline_access Files.ReadWrite' } : {}) });
  if (!t.refresh_token) throw new DeliveryError('The sign-in did not allow offline access');
  return t.refresh_token;
}

/* ---------- upload ---------- */

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Uploads the file into an "ApnaGalla" folder. Returns the Google folder id (made on first use). */
export async function uploadToCloud(env: DeliveryEnv, p: CloudProvider, refreshToken: string, file: { fileName: string; buffer: Buffer }, folderId?: string | null): Promise<{ folderId?: string }> {
  const { access_token } = await tokenRequest(env, p, { grant_type: 'refresh_token', refresh_token: refreshToken });
  const auth = { authorization: `Bearer ${access_token}` };
  if (p === 'google') {
    let folder = folderId ?? undefined;
    if (!folder) {
      const r = await check(
        await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'ApnaGalla', mimeType: 'application/vnd.google-apps.folder' }),
        }),
        'Google Drive folder',
      );
      folder = ((await r.json()) as { id: string }).id;
    }
    const boundary = `ag${randomBytes(8).toString('hex')}`;
    const meta = JSON.stringify({ name: file.fileName, parents: [folder] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${XLSX}\r\n\r\n`),
      file.buffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    await check(
      await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { ...auth, 'content-type': `multipart/related; boundary=${boundary}` }, body }),
      'Google Drive upload',
    );
    return { folderId: folder };
  }
  if (p === 'onedrive') {
    await check(
      await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/ApnaGalla/${encodeURIComponent(file.fileName)}:/content`, { method: 'PUT', headers: { ...auth, 'content-type': XLSX }, body: file.buffer }),
      'OneDrive upload',
    );
    return {};
  }
  await check(
    await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: `/ApnaGalla/${file.fileName}`, mode: 'overwrite', mute: true }) },
      body: file.buffer,
    }),
    'Dropbox upload',
  );
  return {};
}

/* ---------- encrypted refresh tokens ---------- */

const keyOf = (secret: string) => createHash('sha256').update(`apnagalla-exports:${secret}`).digest();

export function seal(secret: string, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

export function unseal(secret: string, sealed: string): string {
  const [iv, tag, enc] = sealed.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', keyOf(secret), iv!);
  d.setAuthTag(tag!);
  return Buffer.concat([d.update(enc!), d.final()]).toString('utf8');
}
