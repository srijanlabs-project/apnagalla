import { IonButton, IonButtons, IonCheckbox, IonContent, IonHeader, IonItem, IonLabel, IonList, IonModal, IonSearchbar, IonTitle, IonToolbar, useIonToast } from '@ionic/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { SelectField } from '../../components/Fields';
import { api } from '../../lib/api';
import { useBusiness } from '../../lib/business';
import { db } from '../../lib/db';
import { t } from '../../lib/i18n';
import { planVisits } from '../../lib/visits';

/** Owner: put customers on a salesperson's visit list for a day. */
export default function PlanVisits({ isOpen, onClose, date }: { isOpen: boolean; onClose: () => void; date: string }) {
  const { actor } = useBusiness();
  const [toast] = useIonToast();
  const [team, setTeam] = useState<{ userId: string; name: string }[]>([{ userId: actor.userId, name: actor.userName || t('Me') }]);
  const [person, setPerson] = useState(actor.userId);
  const [day, setDay] = useState(date);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!isOpen) return;
    setDay(date);
    setPicked(new Set());
    void api
      .team(actor.businessId)
      .then((r) => setTeam(r.members.filter((m) => m.active).map((m) => ({ userId: m.userId, name: m.name ?? m.phone }))))
      .catch(() => undefined);
  }, [isOpen, date, actor.businessId]);
  const customers = useLiveQuery(
    () =>
      db.customers
        .where('businessId')
        .equals(actor.businessId)
        .filter((c) => !c.deleted)
        .sortBy('name'),
    [actor.businessId],
  );
  const s = q.trim().toLowerCase();
  const shown = (customers ?? []).filter((c) => !s || c.name.toLowerCase().includes(s) || (c.billingAddress?.city ?? '').toLowerCase().includes(s));

  async function save() {
    const who = team.find((m) => m.userId === person) ?? team[0]!;
    const list = (customers ?? []).filter((c) => picked.has(c.id));
    const n = await planVisits(actor, day, who, list);
    void toast({ message: t('{n} visits planned for {name}', { n, name: who.name }), duration: 1800, position: 'top', color: 'success' });
    onClose();
  }

  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose}>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{t('Plan visits')}</IonTitle>
          <IonButtons slot="end">
            <IonButton onClick={onClose}>{t('Cancel')}</IonButton>
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent>
        <div className="ion-padding-horizontal">
          <SelectField label={t('Salesperson')} value={person} options={team.map((m) => ({ value: m.userId, label: m.name }))} onChange={setPerson} />
          <label className="date-field">
            <span>{t('Day')}</span>
            <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
        </div>
        <IonSearchbar value={q} onIonInput={(e) => setQ(String(e.detail.value ?? ''))} placeholder={t('Search customer or city')} />
        <IonList>
          {shown.map((c) => (
            <IonItem key={c.id}>
              <IonCheckbox
                slot="start"
                checked={picked.has(c.id)}
                onIonChange={(e) => {
                  const next = new Set(picked);
                  if (e.detail.checked) next.add(c.id);
                  else next.delete(c.id);
                  setPicked(next);
                }}
              />
              <IonLabel>
                <h3>{c.name}</h3>
                {c.billingAddress?.city && <p>{c.billingAddress.city}</p>}
              </IonLabel>
            </IonItem>
          ))}
        </IonList>
      </IonContent>
      <div className="action-bar">
        <IonButton disabled={!picked.size} onClick={() => void save()}>
          {t('Plan {n} visits', { n: picked.size })}
        </IonButton>
      </div>
    </IonModal>
  );
}
