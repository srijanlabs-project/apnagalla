/**
 * Sends one test OTP through MSG91 with the same code the server uses, to check the key and template
 * before switching production to real SMS. The key is read from the terminal's environment only.
 *
 *   $env:MSG91_AUTH_KEY = "<key>"; $env:MSG91_OTP_TEMPLATE_ID = "<template id>"
 *   npm run sms:test -w server -- 98XXXXXXXX
 */
import { normalizeIndianMobile } from '@invoice/shared';
import { Msg91OtpSender } from '../src/sms';

const key = process.env.MSG91_AUTH_KEY?.trim();
const template = process.env.MSG91_OTP_TEMPLATE_ID?.trim();
const phone = normalizeIndianMobile(process.argv[2] ?? '');

if (!key || !template) {
  console.error('Set MSG91_AUTH_KEY and MSG91_OTP_TEMPLATE_ID in this terminal first (see the top of this file).');
  process.exit(1);
}
if (!phone) {
  console.error('Give a 10-digit Indian mobile number, e.g.  npm run sms:test -w server -- 9812345678');
  process.exit(1);
}

const code = String(Math.floor(100000 + Math.random() * 900000));
try {
  await new Msg91OtpSender(key, template).sendOtp(phone, code);
  console.log(`MSG91 accepted the request. An SMS with code ${code} should reach ${phone} within a minute.`);
  console.log('If it does not arrive, the template is likely not DLT-approved yet: check MSG91 → Reports → Delivery for the reason.');
} catch (e) {
  console.error((e as Error).message);
  console.error('Check the key and template ID in MSG91 (OTP → Templates), and that the template is DLT-approved.');
  process.exit(1);
}
