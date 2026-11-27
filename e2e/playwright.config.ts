import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Sanity tests: the critical shop flows, tapped through like a shopkeeper on a phone-sized screen.
 * Runs against the phone version of the app (local dev server in phone mode, see .claude/launch.json
 * "app-as-phone" and "api"). Run after every deploy:  npm run sanity
 *
 * The test login uses the fixed OTP of the local server (server/.env), or E2E_OTP when set.
 */
function localOtp(): string | undefined {
  try {
    const m = /^OTP_FIXED_CODE=(.+)$/m.exec(readFileSync(resolve(__dirname, '../server/.env'), 'utf8'));
    return m?.[1]?.trim();
  } catch {
    return undefined;
  }
}
// Production test login (never committed): e2e/.env.e2e with E2E_PHONE=… and E2E_OTP=…
try {
  for (const line of readFileSync(resolve(__dirname, '.env.e2e'), 'utf8').split(/\r?\n/)) {
    const m = /^(E2E_\w+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim();
  }
} catch {
  /* no production test login set up */
}
const prod = process.argv.some((a) => a.includes('prod'));
if (!prod) process.env.E2E_OTP ??= localOtp();

export default defineConfig({
  testDir: '.',
  testMatch: prod ? 'prod.spec.ts' : 'sanity.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: '../e2e-report', open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE ?? 'http://localhost:5173',
    channel: 'chrome',
    headless: true,
    viewport: { width: 375, height: 812 },
    isMobile: false,
    hasTouch: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
