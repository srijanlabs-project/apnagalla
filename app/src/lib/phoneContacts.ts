import { Capacitor } from '@capacitor/core';
import { db, type Customer } from './db';
import { t } from './i18n';
import { newId, putRecord, type Actor } from './repo';

const blankCustomerRecord = (actor: Actor, name: string): Customer => ({ id: newId(), businessId: actor.businessId, createdAt: '', updatedAt: '', updatedBy: '', name, billingAddress: {}, shippingAddress: null, openingBalance: 0 });

/** Indian mobile from any written form ("+91 98765-43210", "098765 43210") or null. */
export function indianMobile(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/[^\d+]/g, '').replace(/^(\+91|91|0)(?=[6-9]\d{9}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}

export interface PickedContact {
  name: string;
  phone: string | null;
  email?: string;
}

/**
 * Opens the phone's own contact picker (Android app) and returns the chosen contact, or null if cancelled.
 * Before Android asks for the contacts permission the first time, `explain` says why (and may cancel).
 */
export async function pickPhoneContact(explain?: () => Promise<boolean>): Promise<PickedContact | null> {
  if (Capacitor.isNativePlatform()) {
    const { Contacts } = await import('@capacitor-community/contacts');
    const perm = await Contacts.checkPermissions().catch(() => null);
    if (perm?.contacts !== 'granted') {
      if (explain && !(await explain())) return null;
      const asked = await Contacts.requestPermissions();
      if (asked.contacts !== 'granted' && asked.contacts !== 'limited') throw new Error(t('Allow ApnaGalla to read contacts in the phone settings to pick one.'));
    }
    try {
      const { contact } = await Contacts.pickContact({ projection: { name: true, phones: true, emails: true } });
      const phones = (contact.phones ?? []).map((p) => indianMobile(p.number)).filter((p): p is string => !!p);
      const name = contact.name?.display || [contact.name?.given, contact.name?.family].filter(Boolean).join(' ') || '';
      return { name: name.trim(), phone: phones[0] ?? null, email: contact.emails?.find((e) => e.address)?.address ?? undefined };
    } catch {
      return null; // closed without picking
    }
  }
  // Chrome on Android (web): the browser's contact picker.
  const nav = navigator as Navigator & { contacts?: { select: (p: string[], o: { multiple: boolean }) => Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]> } };
  if (nav.contacts?.select) {
    const [c] = await nav.contacts.select(['name', 'tel', 'email'], { multiple: false }).catch(() => []);
    if (!c) return null;
    return { name: c.name?.[0]?.trim() ?? '', phone: (c.tel ?? []).map(indianMobile).find((p) => !!p) ?? null, email: c.email?.[0] };
  }
  throw new Error('no-picker');
}

/** Picking works here (Android app, or a browser that has a contact picker). */
export const canPickContacts = () => Capacitor.isNativePlatform() || !!(navigator as Navigator & { contacts?: unknown }).contacts;

/** Adds the picked contact as a customer (or finds the one with that mobile). */
export async function customerFromContact(actor: Actor, c: PickedContact): Promise<{ customer: Customer; existed: boolean }> {
  if (!c.name && !c.phone) throw new Error(t('That contact has no name or number'));
  if (c.phone) {
    const found = (await db.customers.where('businessId').equals(actor.businessId).filter((x) => !x.deleted && x.phone === c.phone).toArray())[0];
    if (found) return { customer: found, existed: true };
  }
  const customer = await putRecord('customers', actor, { ...blankCustomerRecord(actor, c.name || c.phone!), ...(c.phone ? { phone: c.phone } : {}), ...(c.email ? { email: c.email } : {}) });
  return { customer, existed: false };
}
