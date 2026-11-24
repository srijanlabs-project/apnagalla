import { z } from 'zod';

try {
  // Node >= 21.7: load server/.env when present (Railway injects real env vars instead).
  process.loadEnvFile();
} catch {
  /* no .env file — fine */
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().optional().transform((v) => (v ? v : undefined)),
  PGLITE_DIR: z.string().default('.data/pglite'),
  MIGRATIONS_DIR: z.string().default('drizzle'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGINS: z.string().default(''),
  OTP_PROVIDER: z.enum(['console', 'msg91']).default('console'),
  OTP_FIXED_CODE: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined))
    .pipe(z.string().regex(/^\d{6}$/).optional()),
  ALLOW_CONSOLE_OTP: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_OTP_TEMPLATE_ID: z.string().optional(),
  /** GSTIN lookup through the client's GST API. Unset = lookups answer "not set up". */
  GST_API_PROVIDER: z.string().optional().transform((v) => (v ? v : undefined)),
  GST_API_URL: z.string().optional().transform((v) => (v ? v : undefined)),
  GST_API_KEY: z.string().optional().transform((v) => (v ? v : undefined)),
  /** Most GSTIN lookups per store per day (each may cost money). */
  GST_LOOKUPS_PER_DAY: z.coerce.number().int().positive().default(200),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  const env = schema.parse({ ...process.env, ...overrides });

  if (env.NODE_ENV === 'production') {
    if (env.OTP_PROVIDER === 'console' && !env.ALLOW_CONSOLE_OTP) {
      throw new Error('OTP_PROVIDER=console is not allowed in production. Set OTP_PROVIDER=msg91 or ALLOW_CONSOLE_OTP=true (staging only).');
    }
    if (env.JWT_SECRET.startsWith('dev-only')) {
      throw new Error('Set a real JWT_SECRET in production.');
    }
  }
  // A fixed code lets anyone log in as any number, so it is only allowed in console (test) mode.
  // Production console mode already needs ALLOW_CONSOLE_OTP=true; switching to MSG91 with a fixed
  // code still set stops the server instead of silently keeping the bypass.
  if (env.OTP_FIXED_CODE && env.OTP_PROVIDER !== 'console') {
    throw new Error('OTP_FIXED_CODE is only allowed with OTP_PROVIDER=console. Remove it before using real SMS.');
  }
  if (env.OTP_PROVIDER === 'msg91' && (!env.MSG91_AUTH_KEY || !env.MSG91_OTP_TEMPLATE_ID)) {
    throw new Error('OTP_PROVIDER=msg91 requires MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID.');
  }
  return env;
}
