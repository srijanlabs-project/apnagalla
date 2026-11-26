import type { StorePage } from './store';

/** The public store page: plain HTML, a small cart in the browser, the order posted as JSON. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const rs = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function renderStorePage(page: StorePage, slug: string): string {
  const items = page.items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, rate: i.rate }));
  const groups = new Map<string, typeof page.items>();
  for (const it of page.items) {
    const k = it.category || 'Items';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  const list = [...groups.entries()]
    .map(
      ([cat, its]) => `<h2>${esc(cat)}</h2>` +
        its
          .map(
            (i) => `<div class="item">
  ${i.photo ? `<img src="${esc(i.photo)}" alt="" loading="lazy">` : '<div class="noimg"></div>'}
  <div class="info"><b>${esc(i.name)}</b>${i.description ? `<small>${esc(i.description)}</small>` : ''}
    <span>${rs(i.rate)} / ${esc(i.unit)}${i.mrp && i.mrp > i.rate ? ` <s>${rs(i.mrp)}</s>` : ''}</span></div>
  <div class="qty" data-id="${esc(i.id)}"><button type="button" data-d="-1" aria-label="Less">−</button><output>0</output><button type="button" data-d="1" aria-label="More">+</button></div>
</div>`,
          )
          .join(''),
    )
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.name)} · Order online</title>
<style>
:root{--a:#1c6b4f;--bg:#f6f7f5;--fg:#1c211f;--mut:#5d6763;--line:#e1e5e2;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121614;--fg:#e6ebe8;--mut:#9aa5a0;--line:#2b3330;--card:#1a1f1d;--a:#5cc79c}}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:18px 16px 8px}header h1{margin:0;font-size:22px}header p{margin:4px 0 0;color:var(--mut)}
main{padding:0 16px 120px;max-width:720px;margin:0 auto}h2{font-size:15px;color:var(--mut);margin:18px 0 6px;text-transform:uppercase;letter-spacing:.04em}
.item{display:flex;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px;margin-bottom:8px}
.item img,.noimg{width:56px;height:56px;border-radius:8px;object-fit:cover;background:var(--line);flex:none}
.info{flex:1;min-width:0;display:flex;flex-direction:column}.info small{color:var(--mut)}.info span{font-variant-numeric:tabular-nums}.info s{color:var(--mut)}
.qty{display:flex;align-items:center;gap:6px}.qty button{width:34px;height:34px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font-size:18px}
.qty output{min-width:24px;text-align:center;font-variant-numeric:tabular-nums}
#bar{position:fixed;left:0;right:0;bottom:0;background:var(--card);border-top:1px solid var(--line);padding:12px 16px calc(12px + env(safe-area-inset-bottom));display:flex;gap:12px;align-items:center;justify-content:space-between}
#bar b{font-size:18px}button.go{background:var(--a);color:#fff;border:0;border-radius:10px;padding:12px 18px;font-size:16px}button.go:disabled{opacity:.4}
form{display:none;flex-direction:column;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-top:16px}
form input,form textarea{font:inherit;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
#msg{margin:16px 0;padding:12px;border-radius:10px;display:none}
</style></head><body>
<header><h1>${esc(page.name)}</h1><p>${[page.address, page.phone].filter(Boolean).map((x) => esc(x!)).join(' · ')}</p>${page.note ? `<p>${esc(page.note)}</p>` : ''}</header>
<main>${list || '<p>No items online yet.</p>'}
<form id="f"><b>Your details</b>
<input name="name" required minlength="2" maxlength="80" placeholder="Name" autocomplete="name">
<input name="phone" required inputmode="tel" pattern="(\\+91)?[6-9][0-9]{9}" placeholder="Mobile number" autocomplete="tel">
<textarea name="address" maxlength="300" rows="2" placeholder="Address (for delivery)"></textarea>
<textarea name="note" maxlength="300" rows="2" placeholder="Anything else?"></textarea>
<button class="go" type="submit">Send order</button></form>
<div id="msg"></div></main>
<div id="bar"><span><b id="tot">₹0</b> <small id="cnt"></small></span><button class="go" id="next" disabled>Order</button></div>
<script>
const items=${JSON.stringify(items).replace(/</g, '\\u003c')};const min=${page.minOrder ?? 0};const cart={};
const fmt=p=>'₹'+(p/100).toLocaleString('en-IN',{maximumFractionDigits:2});
function draw(){let t=0,n=0;for(const [id,q] of Object.entries(cart)){const it=items.find(i=>i.id===id);if(it&&q>0){t+=it.rate*q;n++}}
document.getElementById('tot').textContent=fmt(t);document.getElementById('cnt').textContent=n?n+' items':'';document.getElementById('next').disabled=!n||t<min;
if(min&&t<min&&n)document.getElementById('cnt').textContent='min '+fmt(min);}
document.querySelectorAll('.qty').forEach(q=>q.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const id=q.dataset.id;cart[id]=Math.max(0,(cart[id]||0)+Number(b.dataset.d));q.querySelector('output').textContent=cart[id];draw();}));
document.getElementById('next').onclick=()=>{const f=document.getElementById('f');f.style.display='flex';f.scrollIntoView({behavior:'smooth'});};
document.getElementById('f').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const body={name:fd.get('name'),phone:String(fd.get('phone')).replace(/\\s/g,''),address:fd.get('address'),note:fd.get('note'),lines:Object.entries(cart).filter(([,q])=>q>0).map(([itemId,qty])=>({itemId,qty}))};
const m=document.getElementById('msg');m.style.display='block';m.textContent='Sending…';
try{const r=await fetch('/v1/store/${slug}/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();
if(!r.ok)throw new Error(j.message||'Could not send the order');m.textContent='Order sent: '+fmt(j.total)+'. The shop will call you to confirm.';e.target.style.display='none';document.getElementById('bar').style.display='none';}
catch(err){m.textContent=err.message;}};
</script></body></html>`;
}

export function storeNotFound(): string {
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Store not found</title></head><body style="font:16px system-ui;padding:24px"><h1>Store not found</h1><p>This store is not taking orders online.</p></body></html>';
}
