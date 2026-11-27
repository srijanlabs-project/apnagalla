/**
 * The public privacy policy at /privacy (needed for the Play Store listing and the contacts permission).
 * DRAFT: the bracketed parts and the whole text need the owner's legal review before release.
 */
const UPDATED = '27 November 2026';

export function privacyPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ApnaGalla privacy policy</title>
<style>
body{margin:0;background:#f6f7f5;color:#17201b;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 20px 64px}
h1{color:#1f7a4d;font-size:28px;margin:0 0 4px}h2{font-size:19px;margin:28px 0 6px}
p,li{color:#2d3a33}.note{color:#5b6660;font-size:14px}
</style></head><body><main>
<h1>Privacy policy</h1>
<p class="note">ApnaGalla · last updated ${UPDATED}</p>

<p>ApnaGalla is billing and accounts software for shops. This page says what information the app keeps, why, and what control you have. [Company legal name] runs ApnaGalla.</p>

<h2>What we keep</h2>
<ul>
<li><b>Your sign-in:</b> your mobile number and name, used to sign you in with a one-time code.</li>
<li><b>Your shop's records:</b> bills, estimates, payments, customers, suppliers, items, stock, expenses and settings that you or your staff enter. They belong to your shop.</li>
<li><b>Your customers' details you enter:</b> names, phone numbers and addresses, used only to bill them and send them their bills or reminders when you choose to.</li>
<li><b>Crash reports:</b> when the app fails, a short technical message (no bill contents) so we can fix it.</li>
</ul>

<h2>Phone permissions, and only when you use them</h2>
<ul>
<li><b>Contacts:</b> when you tap "From phone contacts", your phone's contact list opens so you can pick one person. Only the contact you pick is saved as a customer. We never read, copy or upload the rest of your contacts.</li>
<li><b>Camera:</b> to scan barcodes and take photos of bills or deliveries that you choose to attach.</li>
<li><b>Location:</b> only when a salesperson taps "Check in" on a field visit, to record where the visit happened.</li>
<li><b>Notifications:</b> reminders the phone itself shows (open the store, close the day, low stock). They are made on the phone, not sent by an outside service.</li>
</ul>

<h2>Where it is stored</h2>
<p>Records are kept on your phone so the app works without internet, and copied to our servers so your other phones and staff see the same data and nothing is lost if a phone is. Our servers are run by [hosting provider] in [country/region]. Data is sent over encrypted connections.</p>

<h2>Who can see it</h2>
<p>Only the people you add to your shop, with the access you give them. We do not sell your data, show ads, or share it with advertisers. We share it only when the law requires, or with service providers who help run ApnaGalla (hosting, SMS for sign-in codes, GST services you switch on), under confidentiality.</p>

<h2>How long, and deleting it</h2>
<p>Your shop's records are kept while your account is active, and as long as tax law requires you to keep accounts. You can export everything (More → Backup and restore). To delete your account and your shop's data, write to [support email] from the mobile number you sign in with; we confirm and delete within 30 days, except what the law requires us to keep.</p>

<h2>Children</h2>
<p>ApnaGalla is for businesses and is not meant for children under 18.</p>

<h2>Changes and contact</h2>
<p>If this policy changes we update this page and the date above. Questions: [support email], [postal address].</p>
</main></body></html>`;
}
