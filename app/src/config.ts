/**
 * API base URL, fixed at build time.
 * - Web dev:       http://localhost:3000 (default)
 * - Android emulator against a local server: VITE_API_URL=http://10.0.2.2:3000
 * - Real phone on the same Wi-Fi: VITE_API_URL=http://<your PC's LAN IP>:3000
 * - Production:    VITE_API_URL=https://<railway-domain>
 */
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || 'http://localhost:3000';
