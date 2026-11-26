import { IonButton, IonCheckbox, IonItem, IonLabel, IonList, IonNote, useIonRouter, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { parseVcf } from '../../lib/catalogShare';
import { db } from '../../lib/db';
import { t } from '../../lib/i18n';
import { putRecord } from '../../lib/repo';
import { blankCustomer } from './CustomerEditScreen';

type Contact = { name: string; phone: string; email?: string };

/**
 * Bring customers in from the phone's contacts: the phone's own picker where the browser has one,
 * else a .vcf file exported from the Contacts app. Numbers already in the customer list are skipped.
 */
export default function ContactImportScreen() {
  const { actor } = useBusiness();
  const [toast] = useIonToast();
  const router = useIonRouter();
  const file = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<Contact[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const known = useLiveQuery(async () => new Set((await db.customers.where('businessId').equals(actor.businessId).filter((c) => !c.deleted).toArray()).map((c) => c.phone ?? '')), [actor.businessId]);
  const fresh = list.filter((c) => !known?.has(c.phone));
  const nav = navigator as Navigator & { contacts?: { select: (props: string[], opts: { multiple: boolean }) => Promise<{ name?: string[]; tel?: string[]; email?: string[] }[]> } };

  const take = (cs: Contact[]) => {
    const seen = new Set<string>();
    const uniq = cs.filter((c) => !seen.has(c.phone) && seen.add(c.phone));
    setList(uniq);
    setPicked(new Set(uniq.filter((c) => !known?.has(c.phone)).map((c) => c.phone)));
    if (!uniq.length) void toast({ message: t('No contacts with an Indian mobile number found'), duration: 2500, color: 'warning' });
  };

  async function fromPicker() {
    try {
      const got = await nav.contacts!.select(['name', 'tel', 'email'], { multiple: true });
      const vcf = got.map((g) => `BEGIN:VCARD\nFN:${g.name?.[0] ?? ''}\n${(g.tel ?? []).map((x) => `TEL:${x}`).join('\n')}\n${g.email?.[0] ? `EMAIL:${g.email[0]}` : ''}\nEND:VCARD`).join('\n');
      take(parseVcf(vcf));
    } catch {
      /* cancelled */
    }
  }

  async function add() {
    let n = 0;
    for (const c of fresh.filter((x) => picked.has(x.phone))) {
      await putRecord('customers', actor, { ...blankCustomer(actor, c.name), phone: c.phone, ...(c.email ? { email: c.email } : {}) });
      n++;
    }
    void toast({ message: t('{n} customers added', { n }), duration: 2000, position: 'top', color: 'success' });
    router.push('/tabs/customers', 'back');
  }

  return (
    <PageShell title={t('Import contacts')} backHref="/tabs/customers" padded={false}>
      <div className="ion-padding">
        <p className="section-note">{t('Pick contacts from the phone, or export them from the Contacts app as a .vcf file and choose it here. Only Indian mobile numbers are taken; ones already in your customers are skipped.')}</p>
        <div className="detail-actions">
          {nav.contacts?.select && (
            <IonButton onClick={() => void fromPicker()}>{t('Pick from contacts')}</IonButton>
          )}
          <IonButton fill={nav.contacts?.select ? 'outline' : 'solid'} onClick={() => file.current?.click()}>
            {t('Choose .vcf file')}
          </IonButton>
        </div>
        <input
          ref={file}
          type="file"
          accept=".vcf,text/vcard,text/x-vcard"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) take(parseVcf(await f.text()));
          }}
        />
      </div>
      {list.length > 0 && (
        <>
          <IonList>
            {list.map((c) => {
              const dup = known?.has(c.phone);
              return (
                <IonItem key={c.phone}>
                  <IonCheckbox
                    slot="start"
                    disabled={dup}
                    checked={!dup && picked.has(c.phone)}
                    onIonChange={(e) => {
                      const next = new Set(picked);
                      if (e.detail.checked) next.add(c.phone);
                      else next.delete(c.phone);
                      setPicked(next);
                    }}
                  />
                  <IonLabel>
                    <h3>{c.name}</h3>
                    <p>{c.phone}</p>
                  </IonLabel>
                  {dup && <IonNote slot="end">{t('Already a customer')}</IonNote>}
                </IonItem>
              );
            })}
          </IonList>
          <div className="ion-padding">
            <IonButton expand="block" disabled={!fresh.some((c) => picked.has(c.phone))} onClick={() => void add()}>
              {t('Add {n} customers', { n: fresh.filter((c) => picked.has(c.phone)).length })}
            </IonButton>
          </div>
        </>
      )}
    </PageShell>
  );
}
