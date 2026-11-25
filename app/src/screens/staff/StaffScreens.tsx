import { IonButton, IonFab, IonFabButton, IonIcon, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSegment, IonSegmentButton, useIonRouter, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { add } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FormSection, MoneyField, SelectField, TextField, ToggleRow } from '../../components/Fields';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type AttendanceStatus, type Employee } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { newId, putRecord } from '../../lib/repo';
import { NEXT_STATUS, giveAdvance, markAttendance, monthSheet, paySalary } from '../../lib/staffPay';
import { sync } from '../../lib/sync';

const SHORT: Record<AttendanceStatus, () => string> = { present: () => t('P'), absent: () => t('A'), half: () => t('½'), leave: () => t('L') };
const LABEL: Record<AttendanceStatus, () => string> = { present: () => t('Present'), absent: () => t('Absent'), half: () => t('Half day'), leave: () => t('Paid leave') };

/** Owner: staff list, with today's attendance (only absences need marking). */
export function EmployeesScreen() {
  const { actor, isOwner } = useBusiness();
  const [toast] = useIonToast();
  const today = todayISO();
  const list = useLiveQuery(() => db.employees.where('businessId').equals(actor.businessId).filter((e) => !e.deleted).sortBy('name'), [actor.businessId]);
  const marks = useLiveQuery(
    async () => new Map((await db.attendance.where('[businessId+date]').equals([actor.businessId, today]).filter((a) => !a.deleted).toArray()).map((a) => [a.employeeId, a.status])),
    [actor.businessId, today],
  );
  if (!isOwner) return null;
  const active = (list ?? []).filter((e) => e.active !== false);
  const fail = (e: unknown) => void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });

  return (
    <PageShell title={t('Staff & salary')} backHref="/tabs/more">
      {active.length > 0 && (
        <IonList inset>
          <IonListHeader>
            <IonLabel>{t('Today · {date}', { date: dateIN(today) })}</IonLabel>
          </IonListHeader>
          {active.map((e) => (
            <IonItem key={e.id}>
              <IonLabel>{e.name}</IonLabel>
              <IonSegment
                className="attendance-seg"
                value={marks?.get(e.id) ?? 'present'}
                onIonChange={sync((ev) => void markAttendance(actor, e.id, today, ev.detail.value as AttendanceStatus).catch(fail))}
              >
                {(['present', 'absent', 'half', 'leave'] as AttendanceStatus[]).map((s) => (
                  <IonSegmentButton key={s} value={s}>
                    <IonLabel>{SHORT[s]()}</IonLabel>
                  </IonSegmentButton>
                ))}
              </IonSegment>
            </IonItem>
          ))}
        </IonList>
      )}
      <p className="section-note">{t('P present · A absent · ½ half day · L paid leave. Days you don’t mark count as present.')}</p>
      <IonList inset>
        {(list ?? []).map((e) => (
          <IonItem key={e.id} routerLink={`/tabs/more/staff/${e.id}`} detail>
            <IonLabel>
              <h3>{e.name}</h3>
              <p>
                {e.job ? `${e.job} · ` : ''}
                {e.pay === 'day' ? t('{amount} a day', { amount: rupees(e.rate) }) : t('{amount} a month', { amount: rupees(e.rate) })}
                {e.active === false ? ` · ${t('Left')}` : ''}
              </p>
            </IonLabel>
          </IonItem>
        ))}
      </IonList>
      {list && list.length === 0 && <p className="ion-padding">{t('Add the people who work here to keep attendance, advances and salary.')}</p>}
      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton routerLink="/tabs/more/staff/new" aria-label={t('Add staff')}>
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>
    </PageShell>
  );
}

/** One staff member: details, the month's attendance and pay, advances and salary. */
export function EmployeeScreen() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const { actor, isOwner } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const stored = useLiveQuery(() => (isNew ? undefined : db.employees.get(id!)), [id]);
  const [e, setE] = useState<Employee | null>(null);
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [sheetOpen, setSheetOpen] = useState<'advance' | 'salary' | null>(null);
  const [recover, setRecover] = useState(0);
  useEffect(() => {
    if (isNew) setE({ id: newId(), businessId: actor.businessId, createdAt: '', updatedAt: '', updatedBy: '', name: '', pay: 'month', rate: 0, active: true, joinDate: todayISO() });
    else if (stored) setE(stored);
  }, [isNew, stored, actor.businessId]);
  const sheet = useLiveQuery(() => (stored ? monthSheet(actor.businessId, stored, month) : undefined), [stored, month, actor.businessId]);
  const fail = (err: unknown) => void toast({ message: (err as Error).message, duration: 2500, color: 'danger' });
  if (!isOwner || !e) return null;
  const set = (x: Partial<Employee>) => setE({ ...e, ...x });

  return (
    <PageShell title={isNew ? t('Add staff') : e.name} backHref="/tabs/more/staff">
      <FormSection title={t('Details')}>
        <TextField label={t('Name')} value={e.name} onChange={(name) => set({ name })} required />
        <TextField label={t('Phone')} type="tel" value={e.phone ?? ''} onChange={(phone) => set({ phone })} />
        <TextField label={t('Work (helper, driver…)')} value={e.job ?? ''} onChange={(job) => set({ job })} />
        <SelectField
          label={t('Paid')}
          value={e.pay}
          options={[
            { value: 'month' as const, label: t('Monthly salary') },
            { value: 'day' as const, label: t('Daily wage') },
          ]}
          onChange={(pay) => set({ pay })}
        />
        <MoneyField label={e.pay === 'day' ? t('Wage a day') : t('Salary a month')} value={e.rate} onChange={(rate) => set({ rate: rate ?? 0 })} />
        <TextField label={t('Joined on')} type="date" value={e.joinDate ?? ''} onChange={(joinDate) => set({ joinDate: joinDate || undefined })} />
        {!isNew && <ToggleRow label={t('Still working here')} checked={e.active !== false} onChange={(active) => set({ active })} />}
        <IonButton
          expand="block"
          disabled={!e.name.trim()}
          onClick={() =>
            void putRecord('employees', actor, { ...e, name: e.name.trim() })
              .then(() => (isNew ? router.push(`/tabs/more/staff/${e.id}`, 'forward', 'replace') : void toast({ message: t('Saved'), duration: 1200, color: 'success' })))
              .catch(fail)
          }
        >
          {t('Save')}
        </IonButton>
      </FormSection>

      {stored && sheet && (
        <>
          <IonInput className="field" fill="outline" labelPlacement="floating" label={t('Month')} type="month" value={month} onIonInput={sync((ev) => setMonth(String(ev.detail.value || month)))} />
          <FormSection title={t('Pay for {month}', { month })}>
            <p>
              {t('{days} paid days of {total}', { days: sheet.paidDays, total: sheet.days.length })} · {t('Earned {amount}', { amount: rupees(sheet.earned) })}
            </p>
            <p>
              {t('Paid {amount}', { amount: rupees(sheet.paid) })}
              {sheet.recovered ? ` · ${t('advance recovered {amount}', { amount: rupees(sheet.recovered) })}` : ''} · <strong>{t('Due {amount}', { amount: rupees(sheet.due) })}</strong>
            </p>
            <p>{t('Advance not yet recovered: {amount}', { amount: rupees(sheet.advanceLeft) })}</p>
            <div className="detail-actions">
              <IonButton
                onClick={() => {
                  setRecover(Math.min(sheet.advanceLeft, sheet.due));
                  setSheetOpen('salary');
                }}
              >
                {t('Pay salary')}
              </IonButton>
              <IonButton fill="outline" onClick={() => setSheetOpen('advance')}>
                {t('Give advance')}
              </IonButton>
            </div>
          </FormSection>
          <FormSection title={t('Attendance')} note={t('Tap a day to change it: present → absent → half day → paid leave.')}>
            <div className="attendance-grid">
              {sheet.days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  className={`att att-${d.status}`}
                  title={LABEL[d.status]()}
                  onClick={() => void markAttendance(actor, stored.id, d.date, NEXT_STATUS[d.status]).catch(fail)}
                >
                  <span>{Number(d.date.slice(8))}</span>
                  <small>{SHORT[d.status]()}</small>
                </button>
              ))}
            </div>
          </FormSection>
          <MoneyEntrySheet
            isOpen={sheetOpen === 'advance'}
            onClose={() => setSheetOpen(null)}
            title={t('Advance to {name}', { name: stored.name })}
            onSave={async (m) => {
              await giveAdvance(actor, stored, m);
              void toast({ message: t('Advance saved'), duration: 1500, color: 'success' });
            }}
          />
          <MoneyEntrySheet
            isOpen={sheetOpen === 'salary'}
            onClose={() => setSheetOpen(null)}
            title={t('Salary {month} · {name}', { month, name: stored.name })}
            amount={Math.max(0, sheet.due - recover)}
            onSave={async (m) => {
              await paySalary(actor, stored, month, m, recover);
              void toast({ message: t('Salary saved'), duration: 1500, color: 'success' });
            }}
          >
            {sheet.advanceLeft > 0 && (
              <MoneyField label={t('Recover from advance (max {amount})', { amount: rupees(sheet.advanceLeft) })} value={recover} onChange={(v) => setRecover(Math.min(v ?? 0, sheet.advanceLeft))} />
            )}
          </MoneyEntrySheet>
        </>
      )}
      {!isNew && !stored && <IonNote>{t('Not found')}</IonNote>}
    </PageShell>
  );
}
