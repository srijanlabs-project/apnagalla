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
