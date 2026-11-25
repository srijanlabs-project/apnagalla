import { IonButton, IonSpinner, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useState } from 'react';
import { TextField, ToggleRow } from '../../components/Fields';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { shareFile } from '../../lib/exportTable';
import { t } from '../../lib/i18n';
import { buildTallyXml, TALLY_LEDGERS } from '../../lib/tally';

const monthStart = () => `${todayISO().slice(0, 8)}01`;

/** Bills, returns and purchases as a Tally import file (for the CA). */
export default function TallyScreen() {
  const { actor, perms } = useBusiness();
  const [toast] = useIonToast();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [withPurchases, setWithPurchases] = useState(perms.seeCost);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  return (
    <PageShell title={t('Export for Tally')} backHref="/tabs/reports">
      <TextField label={t('From')} type="date" value={from} onChange={setFrom} />
      <TextField label={t('To')} type="date" value={to} onChange={setTo} />
      {perms.seeCost && <ToggleRow label={t('Include purchase bills')} checked={withPurchases} onChange={setWithPurchases} />}
      <IonButton
        expand="block"
        disabled={busy || !from || !to || from > to}
        onClick={async () => {
          setBusy(true);
          try {
            const { xml, counts } = await buildTallyXml(actor.businessId, from, to, withPurchases && perms.seeCost);
            await shareFile(`tally-${from}-to-${to}.xml`, new Blob([xml], { type: 'application/xml' }), t('Vouchers for Tally'));
            setDone(t('{sales} sales, {returns} credit notes, {purchases} purchases', counts));
          } catch (e) {
            void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <IonSpinner name="dots" /> : t('Make the Tally file')}
      </IonButton>
      {done && <p>{done}</p>}
      <p className="section-note">
        {t('In Tally: Gateway of Tally → Import → Vouchers, pick this file. Ledgers used: {ledgers}; customers and suppliers by name (walk-in bills go to Cash). Create them in Tally first, or let Tally create missing masters.', {
          ledgers: [TALLY_LEDGERS.sales, TALLY_LEDGERS.purchase, TALLY_LEDGERS.cgst, TALLY_LEDGERS.sgst, TALLY_LEDGERS.igst, TALLY_LEDGERS.inCgst, TALLY_LEDGERS.inSgst, TALLY_LEDGERS.inIgst, TALLY_LEDGERS.roundOff].join(', '),
        })}
      </p>
    </PageShell>
  );
}
