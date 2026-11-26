import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonNote, IonProgressBar, useIonAlert, useIonRouter, useIonToast } from '@ionic/react';
import { addDaysISO, todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { addOutline, closeCircle, logoWhatsapp } from 'ionicons/icons';
import { useState } from 'react';
import { FormSection, MoneyField, NumberField, SelectField, TextField } from '../../components/Fields';
import ItemPicker from '../../components/ItemPicker';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type Customer, type Rental, type Scheme } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { newId, putRecord } from '../../lib/repo';
import { overdueRentals, rentalDays, returnRental, schemeProgress, sellVoucher, startRental, voucherLeft } from '../../lib/retailExtras';
import CustomerPicker from '../docs/CustomerPicker';

/* ---------- supplier schemes ---------- */

export function SchemesScreen() {
  const { actor, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const list = useLiveQuery(() => schemeProgress(actor.businessId), [actor.businessId]);
  const suppliers = useLiveQuery(() => db.suppliers.where('businessId').equals(actor.businessId).filter((s) => !s.deleted).sortBy('name'), [actor.businessId]);
  const [s, setS] = useState<Partial<Scheme>>({ basis: 'value', from: todayISO(), to: addDaysISO(todayISO(), 30) });
  return (
    <PageShell title={t('Supplier schemes')} backHref="/tabs/suppliers" padded={false}>
      <IonList>
        {(list ?? []).map((p) => (
          <IonItem key={p.scheme.id} lines="full">
            <IonLabel className="ion-text-wrap">
              <h3>
                {p.scheme.supplierName} · {p.scheme.name}
              </h3>
              <p>
                {p.scheme.basis === 'value' ? `${rupees(p.done)} / ${rupees(p.scheme.target)}` : `${p.done} / ${p.scheme.target}`} · {p.scheme.reward}
                {' · '}
                {p.scheme.received ? t('Received') : p.reached ? t('Target met: claim it') : p.daysLeft >= 0 ? t('{n} days left', { n: p.daysLeft }) : t('Ended')}
              </p>
              <IonProgressBar value={p.pct / 100} color={p.reached ? 'success' : 'primary'} />
            </IonLabel>
            {isOwner && p.reached && !p.scheme.received && (
              <IonButton slot="end" size="small" onClick={() => void putRecord('schemes', actor, { ...p.scheme, received: true })}>
                {t('Got it')}
              </IonButton>
            )}
          </IonItem>
        ))}
      </IonList>
      {isOwner && (
        <div className="ion-padding">
          <FormSection title={t('New scheme')} note={t('From the distributor: buy this much between these dates and get free goods, a rate difference or a bonus.')}>
            <SelectField label={t('Supplier')} value={s.supplierId ?? ''} options={[{ value: '', label: t('Choose') }, ...(suppliers ?? []).map((x) => ({ value: x.id, label: x.name }))]} onChange={(supplierId) => setS({ ...s, supplierId })} />
            <TextField label={t('Scheme name')} value={s.name} onChange={(name) => setS({ ...s, name })} />
            <div className="field-row">
              <TextField label={t('From')} type="date" value={s.from} onChange={(from) => setS({ ...s, from })} />
              <TextField label={t('To')} type="date" value={s.to} onChange={(to) => setS({ ...s, to })} />
            </div>
            <SelectField label={t('Target is')} value={s.basis ?? 'value'} options={[{ value: 'value', label: t('Value bought (before tax)') }, { value: 'qty', label: t('Quantity bought') }]} onChange={(basis) => setS({ ...s, basis })} />
            {s.basis === 'qty' ? <NumberField label={t('Target quantity')} value={s.target ?? null} onChange={(target) => setS({ ...s, target: target ?? 0 })} min={0} /> : <MoneyField label={t('Target value')} value={s.target ?? null} onChange={(target) => setS({ ...s, target: target ?? 0 })} />}
            <TextField label={t('What you get (e.g. 1 carton free per 10)')} value={s.reward} onChange={(reward) => setS({ ...s, reward })} />
            <MoneyField label={t('Worth (optional)')} value={s.rewardValue ?? null} onChange={(rewardValue) => setS({ ...s, rewardValue: rewardValue ?? undefined })} />
            <IonButton
              expand="block"
              disabled={!s.supplierId || !s.name?.trim() || !(s.target! > 0)}
              onClick={async () => {
                const sup = suppliers!.find((x) => x.id === s.supplierId)!;
                await putRecord('schemes', actor, { id: newId(), supplierId: sup.id, supplierName: sup.name, name: s.name!.trim(), from: s.from!, to: s.to!, basis: s.basis!, target: s.target!, reward: s.reward ?? '', rewardValue: s.rewardValue } as Scheme);
                setS({ basis: 'value', from: todayISO(), to: addDaysISO(todayISO(), 30) });
                void toast({ message: t('Saved'), duration: 1200, position: 'top', color: 'success' });
              }}
            >
              <IonIcon icon={addOutline} slot="start" /> {t('Save scheme')}
            </IonButton>
          </FormSection>
        </div>
      )}
    </PageShell>
  );
}

/* ---------- gift vouchers ---------- */

export function VouchersScreen() {
  const { actor, profile } = useBusiness();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const vouchers = useLiveQuery(async () => {
    const list = await db.vouchers.where('businessId').equals(actor.businessId).filter((v) => !v.deleted && !v.voidedAt).reverse().sortBy('date');
    return Promise.all(list.map(async (v) => ({ v, left: (await voucherLeft(actor.businessId, v.code))?.left ?? 0 })));
  }, [actor.businessId]);
  const [amount, setAmount] = useState<number | null>(null);
  const [soldTo, setSoldTo] = useState('');
  const [mode, setMode] = useState<'cash' | 'upi' | 'card'>('cash');
  const [validTill, setValidTill] = useState(addDaysISO(todayISO(), 365));
  return (
    <PageShell title={t('Gift vouchers')} backHref="/tabs/more" padded={false}>
      <div className="ion-padding">
        <FormSection title={t('Sell a voucher')} note={t('Anyone with the code can use it on a bill (Bill → Pay with gift voucher) until it runs out or expires.')}>
          <MoneyField label={t('Amount')} value={amount} onChange={setAmount} />
          <TextField label={t('For (name, optional)')} value={soldTo} onChange={setSoldTo} />
          <div className="field-row">
            <SelectField label={t('Paid by')} value={mode} options={[{ value: 'cash', label: t('Cash') }, { value: 'upi', label: 'UPI' }, { value: 'card', label: t('Card') }]} onChange={setMode} />
            <TextField label={t('Valid till')} type="date" value={validTill} onChange={setValidTill} />
          </div>
          <IonButton
            expand="block"
            disabled={!(amount! > 0)}
            onClick={async () => {
              const v = await sellVoucher(actor, { amount: amount!, mode, soldTo: soldTo || undefined, validTill });
              setAmount(null);
              setSoldTo('');
              void alert({
                header: t('Voucher {code}', { code: v.code }),
                message: t('{amount}, valid till {date}', { amount: rupees(v.amount), date: dateIN(validTill) }),
                buttons: [
                  { text: t('Share on WhatsApp'), handler: () => void window.open(`https://wa.me/?text=${encodeURIComponent(t('Gift voucher from {store}: code {code} worth {amount}, valid till {date}.', { store: profile.name, code: v.code, amount: rupees(v.amount), date: dateIN(validTill) }))}`, '_blank') },
                  { text: t('OK') },
                ],
              });
              void toast({ message: t('Saved'), duration: 1000, position: 'top', color: 'success' });
            }}
          >
            {t('Sell voucher')}
          </IonButton>
        </FormSection>
      </div>
      <IonList>
        {(vouchers ?? []).map(({ v, left }) => (
          <IonItem key={v.id}>
            <IonLabel>
              <h3>{v.code}</h3>
              <p>
                {dateIN(v.date)}
                {v.soldTo ? ` · ${v.soldTo}` : ''}
                {v.validTill ? ` · ${t('till {date}', { date: dateIN(v.validTill) })}` : ''}
              </p>
            </IonLabel>
            <IonNote slot="end">
              {rupees(left)} / {rupees(v.amount)}
            </IonNote>
          </IonItem>
        ))}
      </IonList>
    </PageShell>
  );
}

/* ---------- rentals ---------- */

export function RentalsScreen() {
  const { actor } = useBusiness();
  const [toast] = useIonToast();
  const [alert] = useIonAlert();
  const router = useIonRouter();
  const rentals = useLiveQuery(() => db.rentals.where('businessId').equals(actor.businessId).filter((r) => !r.deleted).reverse().sortBy('date'), [actor.businessId]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [picking, setPicking] = useState<'customer' | 'item' | null>(null);
  const [lines, setLines] = useState<Rental['lines']>([]);
  const [dueBack, setDueBack] = useState(addDaysISO(todayISO(), 1));
  const [deposit, setDeposit] = useState<number | null>(null);
  const late = overdueRentals(rentals ?? []);
  const fail = (e: unknown) => void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });

  const giveBack = (r: Rental) =>
    void alert({
      header: t('{number} came back', { number: r.number }),
      message: t('{days} days. The rent bill is made as a draft; the deposit can pay it (Use advance).', { days: rentalDays(r, todayISO()) }),
      inputs: [
        { name: 'late', type: 'number', placeholder: t('Late charge ₹ (optional)'), min: 0 },
        { name: 'damage', type: 'number', placeholder: t('Damage charge ₹ (optional)'), min: 0 },
      ],
      buttons: [
        { text: t('Cancel'), role: 'cancel' },
        {
          text: t('Make rent bill'),
          handler: (v: { late: string; damage: string }) =>
            void returnRental(actor, r, { late: Math.round((Number(v.late) || 0) * 100) || undefined, damage: Math.round((Number(v.damage) || 0) * 100) || undefined })
              .then((inv) => router.push(`/tabs/invoices/${inv.id}/edit`))
              .catch(fail),
        },
      ],
    });

  return (
    <PageShell title={t('Rentals')} backHref="/tabs/more" padded={false}>
      {late.length > 0 && <p className="renew-banner">{t('{n} rentals are late', { n: late.length })}</p>}
      <IonList>
        {(rentals ?? []).map((r) => (
          <IonItem key={r.id} button={r.status === 'out'} detail={false} onClick={() => r.status === 'out' && giveBack(r)} routerLink={r.status !== 'out' && r.invoiceId ? `/tabs/invoices/${r.invoiceId}` : undefined}>
            <IonLabel className="ion-text-wrap">
              <h3>
                {r.number} · {r.customerName}
              </h3>
              <p>
                {r.lines.map((l) => `${l.name} × ${l.qty}`).join(', ')} · {t('back by {date}', { date: dateIN(r.dueBack) })}
              </p>
            </IonLabel>
            <IonNote slot="end" color={r.status === 'out' ? (r.dueBack < todayISO() ? 'danger' : 'warning') : 'success'}>
              {r.status === 'out' ? (r.dueBack < todayISO() ? t('Late') : t('Out')) : t('Returned')}
            </IonNote>
            {r.status === 'out' && r.phone && r.dueBack < todayISO() && (
              <IonButton slot="end" fill="clear" color="success" href={`https://wa.me/${r.phone.replace('+', '')}?text=${encodeURIComponent(t('Please return the rented items ({number}); they were due on {date}.', { number: r.number, date: dateIN(r.dueBack) }))}`} target="_blank">
                <IonIcon icon={logoWhatsapp} slot="icon-only" />
              </IonButton>
            )}
          </IonItem>
        ))}
      </IonList>
      <div className="ion-padding">
        <FormSection title={t('Rent out')}>
          <IonButton fill="outline" expand="block" onClick={() => setPicking('customer')}>
            {customer ? customer.name : t('Choose customer')}
          </IonButton>
          {lines.map((l, i) => (
            <div key={i} className="po-line">
              <p className="po-line-name">{l.name}</p>
              <div className="search-row">
                <NumberField label={t('Qty')} value={l.qty} onChange={(qty) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: qty ?? 0 } : x)))} min={0} />
                <MoneyField label={t('Rent per day')} value={l.ratePerDay} onChange={(v) => setLines(lines.map((x, j) => (j === i ? { ...x, ratePerDay: v ?? 0 } : x)))} />
                <IonButton fill="clear" color="medium" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={t('Remove')}>
                  <IonIcon icon={closeCircle} slot="icon-only" />
                </IonButton>
              </div>
            </div>
          ))}
          <IonButton size="small" fill="outline" onClick={() => setPicking('item')}>
            <IonIcon icon={addOutline} slot="start" /> {t('Add item')}
          </IonButton>
          <div className="field-row">
            <TextField label={t('Back by')} type="date" value={dueBack} onChange={setDueBack} />
            <MoneyField label={t('Deposit (cash)')} value={deposit} onChange={setDeposit} />
          </div>
          <IonButton
            expand="block"
            disabled={!customer || !lines.length}
            onClick={async () => {
              try {
                await startRental(actor, customer!, { lines, dueBack, deposit: deposit ?? 0, depositMode: 'cash' });
                setLines([]);
                setDeposit(null);
                setCustomer(null);
                void toast({ message: t('Saved'), duration: 1200, position: 'top', color: 'success' });
              } catch (e) {
                fail(e);
              }
            }}
          >
            {t('Rent out')}
          </IonButton>
        </FormSection>
      </div>
      <CustomerPicker
        isOpen={picking === 'customer'}
        onClose={() => setPicking(null)}
        onPick={(_p, c) => {
          setPicking(null);
          if (c) setCustomer(c);
          else void toast({ message: t('Rentals need a saved customer (for the deposit)'), duration: 2500, color: 'warning' });
        }}
      />
      <ItemPicker
        isOpen={picking === 'item'}
        onClose={() => setPicking(null)}
        businessId={actor.businessId}
        onPick={(it) => {
          setLines([...lines, { itemId: it.id, name: it.name, qty: 1, ratePerDay: it.rate }]);
          setPicking(null);
        }}
      />
    </PageShell>
  );
}
