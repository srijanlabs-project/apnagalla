/**
 * The public privacy policy at /privacy (Play Store listing, contacts permission, India's DPDP Act 2023).
 * The four OWNER values below are the business's own details: fill them in before release, and have the
 * whole text reviewed by a lawyer. Until they are filled, the page shows them highlighted.
 */
const OWNER = {
  legalName: '[Company legal name]',
  supportEmail: '[support email]',
  address: '[registered address]',
  grievanceOfficer: '[Grievance Officer name]',
};
const UPDATED = '28 November 2026';

const v = (s: string) => (s.startsWith('[') ? `<mark>${s}</mark>` : s);

export function privacyPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ApnaGalla privacy policy</title>
<style>
:root{--g:#1f7a4d;--ink:#17201b;--muted:#5b6660;--bg:#f6f7f5;--card:#fff;--line:#dce3de}
@media (prefers-color-scheme:dark){:root{--g:#4fb582;--ink:#e8ede9;--muted:#a3ada7;--bg:#111513;--card:#181d1a;--line:#2c342f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI","Nirmala UI",sans-serif}
header{background:var(--g);color:#fff;padding:28px 20px}
header div{max-width:780px;margin:0 auto}header b{font-size:15px;opacity:.9;letter-spacing:.3px}
h1{font-size:30px;margin:6px 0 4px;line-height:1.2}header p{margin:0;opacity:.9;font-size:14px}
main{max-width:780px;margin:0 auto;padding:20px 20px 64px}
.summary{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px;margin:4px 0 8px}
.summary li{margin:4px 0}
nav{display:flex;flex-wrap:wrap;gap:6px 14px;margin:16px 0 8px;font-size:14px}nav a{color:var(--g);white-space:nowrap}
h2{font-size:20px;margin:32px 0 8px;color:var(--g)}
table{width:100%;border-collapse:collapse;font-size:15px;background:var(--card);border-radius:12px;overflow:hidden}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}th{width:34%;font-weight:600}
mark{background:#fff3c4;color:#5a4500;padding:0 4px;border-radius:4px}
a{color:var(--g)}footer{margin-top:40px;font-size:14px;color:var(--muted)}
</style></head><body>
<header><div><b>ApnaGalla</b><h1>Privacy policy</h1><p>Last updated ${UPDATED}</p></div></header>
<main>
<section class="summary">
<strong>In short</strong>
<ul>
<li>Your shop's bills, customers and stock belong to you. We keep them only to run the app for you.</li>
<li>We never sell your data, show ads, or read your phone's contacts beyond the one person you pick.</li>
<li>You can export everything, and ask us to delete your account and data at any time.</li>
</ul>
</section>
<nav><a href="#who">Who we are</a><a href="#what">What we keep</a><a href="#permissions">Phone permissions</a><a href="#where">Where</a><a href="#share">Sharing</a><a href="#rights">Your rights</a><a href="#delete">Deleting</a><a href="#contact">Contact</a></nav>

<h2 id="who">Who we are</h2>
<p>ApnaGalla is billing, khata and stock software for shops in India. It is run by ${v(OWNER.legalName)} ("we"). For your shop's records you are in control of the data; we process it on your behalf to provide the service.</p>

<h2 id="what">What we keep, and why</h2>
<table>
<tr><th>Your sign-in</th><td>Your mobile number and name, to sign you in with a one-time code and to know which shops you can open.</td></tr>
<tr><th>Your shop's records</th><td>Bills, estimates, payments, customers, suppliers, items, stock, expenses, cash book and settings that you or your staff enter, so the app can work and keep every phone of your shop in step.</td></tr>
<tr><th>Your customers' details</th><td>Names, phone numbers, addresses and GST numbers you enter, used only to bill them, keep their khata, and send them bills or reminders when you choose to.</td></tr>
<tr><th>Plan payments</th><td>If you buy a paid plan, the payment is handled by Razorpay. We receive the payment result, not your card or bank details.</td></tr>
<tr><th>Crash reports</th><td>When the app fails, a short technical message (which screen, the error, the app version), never the contents of your bills, so we can fix it.</td></tr>
</table>

<h2 id="permissions">Phone permissions, used only when you tap</h2>
<table>
<tr><th>Contacts</th><td>When you tap "From phone contacts", your phone's contact list opens so you can pick one person. Only that contact is saved as a customer. We never read, copy, upload or change the rest of your contacts. (Android groups reading and changing contacts into one permission; the app only reads the contact you pick.)</td></tr>
<tr><th>Camera</th><td>To scan barcodes, and to take photos of bills or deliveries that you choose to attach.</td></tr>
<tr><th>Location</th><td>Only when a salesperson taps "Check in" on a field visit, to note where the visit happened. Nothing is tracked in the background.</td></tr>
<tr><th>Notifications</th><td>Reminders made by the phone itself (open the store, close the day, low stock). No outside notification service is used.</td></tr>
</table>

<h2 id="where">Where your data is stored</h2>
<p>Records are kept on your phone so the app works without internet, and copied to our servers so your other phones and staff see the same data and nothing is lost if a phone is. Our servers are run by Railway, a cloud provider, in the United States (Virginia). Data travels over encrypted connections (HTTPS) and access is limited to the people of your shop and to us for support.</p>

<h2 id="share">Who we share it with</h2>
<p>We do not sell your data or share it with advertisers. We share only what is needed with the providers that help run ApnaGalla, under confidentiality:</p>
<ul>
<li>Railway: hosting our servers and database.</li>
<li>An SMS provider: to send sign-in codes to your mobile number.</li>
<li>GSTZen: to look up a GST number you enter, and for e-invoices or GST returns if you switch those on.</li>
<li>Razorpay: to take payment for paid plans.</li>
</ul>
<p>We may also disclose information when the law requires it.</p>

<h2 id="rights">Your rights</h2>
<p>Under India's Digital Personal Data Protection Act, 2023, you can ask us to tell you what we hold about you, correct it, or erase it, and you can withdraw consent at any time (which ends your use of the service). You can also name someone to act for you. Write to the Grievance Officer below; we reply within 30 days.</p>

<h2 id="delete">How long we keep it, and deleting it</h2>
<p>Your shop's records are kept while your account is active, and for as long as tax law requires accounts to be kept. You can export everything at any time from More → Backup and restore. To delete your account and your shop's data, write to ${v(OWNER.supportEmail)} from the mobile number you sign in with. We confirm and delete within 30 days, except records the law requires us to keep.</p>

<h2>Children</h2>
<p>ApnaGalla is for businesses and is not meant for anyone under 18.</p>

<h2>Changes</h2>
<p>If this policy changes, we update this page and the date at the top, and tell you in the app for important changes.</p>

<h2 id="contact">Contact and Grievance Officer</h2>
<p>${v(OWNER.grievanceOfficer)}, Grievance Officer<br>Email: ${v(OWNER.supportEmail)}<br>Address: ${v(OWNER.address)}</p>

<footer>ApnaGalla · ${v(OWNER.legalName)}</footer>
</main></body></html>`;
}
