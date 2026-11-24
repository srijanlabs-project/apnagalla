import { Capacitor } from '@capacitor/core';
import type { ClientKind } from '@invoice/shared';

/**
 * The Android app is a 'mobile' login (one phone at a time); the browser is a 'web' login.
 * In local development only, VITE_DEV_CLIENT_KIND=mobile makes a browser act as the phone app,
 * so phone-only flows (invoices, credit notes) can be tested in a browser.
 */
export const CLIENT_KIND: ClientKind =
  Capacitor.isNativePlatform() || (import.meta.env.DEV && import.meta.env.VITE_DEV_CLIENT_KIND === 'mobile') ? 'mobile' : 'web';

/**
 * Client rule: invoices are created and edited only in the phone app. The web is for viewing,
 * sharing, payments, estimates, reports and settings. VITE_ALLOW_WEB_INVOICING=true lifts this
 * for local testing in a browser.
 */
export const CAN_CREATE_INVOICES = CLIENT_KIND === 'mobile' || import.meta.env.VITE_ALLOW_WEB_INVOICING === 'true';

export const WEB_INVOICE_NOTE = 'Invoices are created in the ApnaGalla phone app. On the web you can view, share and record payments.';
