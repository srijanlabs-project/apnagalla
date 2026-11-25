import { z } from 'zod';
import { normalizeIndianMobile } from './phone';

export const ROLES = ['owner', 'staff'] as const;
export type Role = (typeof ROLES)[number];

export const OTP_LENGTH = 6;

/** Stores one person can own (plans may change this later). */
export const MAX_OWNED_STORES = 10;

/** A login on a phone (one at a time per user) or in the web app (cannot create invoices). */
export const CLIENT_KINDS = ['mobile', 'web'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

const phoneField = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizeIndianMobile(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number' });
      return z.NEVER;
    }
    return n;
  });

/* ---------- Auth ---------- */

export const otpRequestBody = z.object({ phone: phoneField });
export type OtpRequestBody = z.input<typeof otpRequestBody>;

export const otpVerifyBody = z.object({
  phone: phoneField,
  code: z.string().trim().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`),
  deviceName: z.string().trim().max(100).optional(),
  client: z.enum(CLIENT_KINDS).default('mobile'),
});
export type OtpVerifyBody = z.input<typeof otpVerifyBody>;

export const refreshBody = z.object({ refreshToken: z.string().min(20) });

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** seconds until accessToken expires */
  expiresIn: number;
}

/* ---------- User / business ---------- */

export const updateMeBody = z.object({ name: z.string().trim().min(1, 'Name is required').max(80) });

export const createBusinessBody = z.object({
  name: z.string().trim().min(1, 'Business name is required').max(120),
  phone: z.string().trim().max(20).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
});
export type CreateBusinessBody = z.input<typeof createBusinessBody>;
export type CreateBusinessInput = z.output<typeof createBusinessBody>;

export const createInviteBody = z.object({
  phone: phoneField,
  role: z.enum(['staff']).default('staff'),
});
export type CreateInviteBody = z.input<typeof createInviteBody>;

export interface UserDto {
  id: string;
  phone: string;
  name: string | null;
}

/** What a staff member may do in a store (the owner may do everything). */
export interface StaffPermissions {
  /** Purchase prices, purchases, suppliers, profit. Missing = the store's "staff can see costs" setting. */
  seeCost?: boolean;
  /** Most discount % on a bill (100 = no limit). Offers made by the owner don't count. */
  maxDiscountPct?: number;
  viewReports?: boolean;
  /** Change catalogue items (prices, details). */
  editItems?: boolean;
  /** Delete draft bills, customers and suppliers. */
  deleteRecords?: boolean;
}

export const DEFAULT_STAFF_PERMISSIONS: Required<Omit<StaffPermissions, 'seeCost'>> = { maxDiscountPct: 100, viewReports: true, editItems: false, deleteRecords: false };

export const staffPermissionsBody = z.object({
  seeCost: z.boolean().optional(),
  maxDiscountPct: z.number().min(0).max(100).optional(),
  viewReports: z.boolean().optional(),
  editItems: z.boolean().optional(),
  deleteRecords: z.boolean().optional(),
});

export interface MembershipDto {
  businessId: string;
  businessName: string;
  /** City/state entered at sign-up; used to pre-fill the business profile on a new device. */
  businessCity: string | null;
  businessState: string | null;
  role: Role;
  /** false = the owner paused this person's access to the store. */
  active: boolean;
  /** This person's series letter in the store ("" for the owner). */
  seriesCode: string;
  /** ApnaGalla suspended the whole store: nobody can use it until it is reactivated. */
  suspended?: boolean;
  /** Staff: what this person may do (owner: none, may do everything). */
  permissions?: StaffPermissions | null;
}

export interface InviteDto {
  id: string;
  businessId: string;
  businessName: string;
  phone: string;
  role: Role;
  invitedByName: string | null;
  createdAt: string;
}

export interface MeResponse {
  user: UserDto;
  memberships: MembershipDto[];
  /** Pending invites addressed to this user's phone number */
  invites: InviteDto[];
  /** ApnaGalla staff who may use the admin panel (web only). */
  isAdmin?: boolean;
}

/* ---------- admin panel (ApnaGalla staff) ---------- */

export interface AdminStoreDto {
  id: string;
  name: string;
  city: string | null;
  createdAt: string;
  ownerName: string | null;
  ownerPhone: string | null;
  members: number;
  bills: number;
  /** Last time any phone synced a change. */
  lastActivity: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
}

export const adminCreateStoreBody = z.object({
  name: z.string().trim().min(1, 'Store name is required').max(120),
  ownerPhone: phoneField,
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
});
export type AdminCreateStoreBody = z.input<typeof adminCreateStoreBody>;

export const suspendStoreBody = z.object({ reason: z.string().trim().min(1, 'Give a reason').max(300) });

export interface AuditEntryDto {
  at: string;
  actorName: string | null;
  actorPhone: string | null;
  action: string;
  detail: Record<string, unknown> | null;
}

export interface BusinessDto {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
  state: string | null;
  createdAt: string;
}

export interface MemberDto {
  userId: string;
  name: string | null;
  phone: string;
  role: Role;
  joinedAt: string;
  active: boolean;
  seriesCode: string;
  permissions?: StaffPermissions | null;
}

export const setSeriesCodeBody = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z]{1,2}$/, 'Use one or two letters') });

export interface SessionDto {
  id: string;
  deviceName: string | null;
  client: ClientKind;
  createdAt: string;
  lastSeenAt: string;
  /** The session making this request. */
  current: boolean;
}

export interface TeamResponse {
  members: MemberDto[];
  invites: InviteDto[];
}

export interface VerifyOtpResponse extends AuthTokens {
  me: MeResponse;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}
