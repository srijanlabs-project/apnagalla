import { Capacitor } from '@capacitor/core';
import type { ClientKind } from '@invoice/shared';

/** The Android app is a 'mobile' login (one phone at a time); the browser is a 'web' login. */
export const CLIENT_KIND: ClientKind = Capacitor.isNativePlatform() ? 'mobile' : 'web';

/**
 * Client rule: invoices are created and edited only in the phone app. The web is for viewing,
 * sharing, payments, estimates, reports and settings. VITE_ALLOW_WEB_INVOICING=true lifts this
 * for local testing in a browser.
 */
export const CAN_CREATE_INVOICES = CLIENT_KIND === 'mobile' || import.meta.env.VITE_ALLOW_WEB_INVOICING === 'true';

export const WEB_INVOICE_NOTE = 'Invoices are created in the ApnaGalla phone app. On the web you can view, share and record payments.';
