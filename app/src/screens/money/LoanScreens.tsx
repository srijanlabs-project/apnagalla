import { IonButton, IonFab, IonFabButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonSegment, IonSegmentButton, useIonActionSheet, useIonRouter, useIonToast } from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, receiptOutline } from 'ionicons/icons';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { FormSection, MoneyField, NumberField, TextField, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type Loan, type LoanEntry } from '../../lib/db';
import { dateIN, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { sync } from '../../lib/sync';
import { addLoanEntry, loanEntryKinds, loanEntryLabel, loanStatement, saveLoan } from '../../lib/money';
import { deleteRecord, newId } from '../../lib/repo';
import { useSeesMoney } from './BankScreens';

/** Loans the store took (bank, finance company, a person) and loans it gave. */
export default function LoansScreen() {
  const { actor, isOwner } = useBusiness();
  const seesMoney = useSeesMoney();
  const router = useIonRouter();
  const list = useLiveQuery(async () => {
    const loans = await db.loans.where('businessId').equals(actor.businessId).filter((l) => !l.deleted).toArray();
    const rows = await Promise.all(loans.map((l) => loanStatement(l.id)));
    return rows.filter((r) => !!r).sort((a, b) => Number(!!a.loan.closed) - Number(!!b.loan.closed) || a.loan.name.localeCompare(b.loan.name));
  }, [actor.businessId]);
  if (!seesMoney) return <PageShell title={t('Loans')} backHref="/tabs/more">{t('Only the owner can see this.')}</PageShell>;
  const taken = (list ?? []).filter((r) => r.loan.kind === 'taken' && !r.loan.closed).reduce((a, r) => a + r.balance, 0);
  const given = (list ?? []).filter((r) => r.loan.kind === 'given' && !r.loan.closed).reduce((a, r) => a + r.balance, 0);

  return (
    <PageShell title={t('Loans')} backHref="/tabs/more" padded={false}>
      {list && list.length === 0 ? (
        <EmptyState icon={receiptOutline} title={t('No loans')} text={t('Note a bank loan, an overdraft, money from a relative, or money you lent: see what is left, EMIs and interest paid.')} />
      ) : (
        <>
          <div className="dash-grid ion-padding-horizontal">
            <div className="dash-card">
              <span>{t('We owe')}</span>
              <strong className={taken > 0 ? 'text-danger' : undefined}>{rupees(taken)}</strong>
            </div>
            <div className="dash-card">
              <span>{t('Owed to us')}</span>
              <strong>{rupees(given)}</strong>
            </div>
          </div>
          <IonList>
            {(list ?? []).map(({ loan, balance, interestPaid }) => (
              <IonItem key={loan.id} routerLink={`/tabs/loans/${loan.id}`} detail>
                <IonLabel>
                  <h3>{loan.name}</h3>
                  <p>
                    {loan.kind === 'taken' ? t('Loan taken') : t('Loan given')}
                    {loan.emi ? ` · ${t('EMI {amount}', { amount: rupees(loan.emi) })}` : ''}
                    {interestPaid ? ` · ${t('interest {amount}', { amount: rupees(interestPaid) })}` : ''}
                    {loan.closed ? ` · ${t('Closed')}` : ''}
                  </p>
                </IonLabel>
                <IonNote slot="end">{rupees(balance)}</IonNote>
              </IonItem>
            ))}
          </IonList>
        </>
      )}
      {isOwner && (
        <IonFab slot="fixed" vertical="bottom" horizontal="end">
          <IonFabButton onClick={() => router.push('/tabs/loans/new')} aria-label={t('Add loan')}>
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>
      )}
    </PageShell>
  );
}

const blank = (): Loan => ({ id: newId(), businessId: '', createdAt: '', updatedAt: '', updatedBy: '', kind: 'taken', name: '', openingBalance: 0, startDate: todayISO() });

/** Add or change a loan (owner). */
export function LoanEditScreen() {
  const { id } = useParams();
  const { actor } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const stored = useLiveQuery(() => (id && id !== 'new' ? db.loans.get(id) : undefined), [id]);
  const [l, setL] = useState<Loan>(blank);
  useEffect(() => {
    if (stored) setL(stored);
  }, [stored]);
  const patch = (p: Partial<Loan>) => setL((x) => ({ ...x, ...p }));
  const isNew = !id || id === 'new';

  return (
    <FormPage
      title={isNew ? t('Add loan') : l.name}
      backHref={isNew ? '/tabs/loans' : `/tabs/loans/${l.id}`}
      canSave={!!l.name.trim()}
      onSave={async () => {
        try {
          const saved = await saveLoan(actor, l);
          router.push(`/tabs/loans/${saved.id}`, 'back', 'replace');
        } catch (e) {
          void toast({ message: (e as Error).message, duration: 2500, color: 'danger' });
        }
      }}
    >
      <FormSection>
        <IonSegment value={l.kind} onIonChange={sync((e) => patch({ kind: e.detail.value as Loan['kind'] }))}>
          <IonSegmentButton value="taken">
            <IonLabel>{t('Loan taken')}</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="given">
            <IonLabel>{t('Loan given')}</IonLabel>
          </IonSegmentButton>
        </IonSegment>
        <TextField label={l.kind === 'taken' ? t('Lender (bank, person)') : t('Given to')} required value={l.name} onChange={(name) => patch({ name })} autocapitalize="words" />
        <MoneyField label={l.kind === 'taken' ? t('Owed on that date') : t('To get back on that date')} value={l.openingBalance || null} onChange={(v) => patch({ openingBalance: v ?? 0 })} />
        <TextField label={t('Date')} type="date" value={l.startDate} onChange={(startDate) => patch({ startDate: startDate || todayISO() })} />
        <p className="section-note">{t('The loan amount, or what was left when you start noting it here. Interest is not added; note it when paid.')}</p>
        <div className="field-row">
          <NumberField label={t('Interest % a year')} value={l.interestPct ?? null} onChange={(interestPct) => patch({ interestPct: interestPct ?? undefined })} min={0} max={100} />
          <MoneyField label={t('EMI (optional)')} value={l.emi ?? null} onChange={(emi) => patch({ emi: emi ?? undefined })} />
        </div>
        <TextField label={t('Loan account no. (optional)')} value={l.accountNumber} onChange={(accountNumber) => patch({ accountNumber })} />
        <TextField label={t('Note (optional)')} value={l.note} onChange={(note) => patch({ note })} />
        {!isNew && <ToggleRow label={t('Closed (fully paid)')} checked={!!l.closed} onChange={(closed) => patch({ closed })} />}
      </FormSection>
    </FormPage>
  );
}

/** One loan: what is left, every payment, and buttons to add one. */
export function LoanScreen() {
  const { id = '' } = useParams();
  const { actor, isOwner } = useBusiness();
  const seesMoney = useSeesMoney();
  const [toast] = useIonToast();
  const [sheet] = useIonActionSheet();
  const [kind, setKind] = useState<LoanEntry['kind'] | null>(null);
  const st = useLiveQuery(() => loanStatement(id), [id]);
  if (!seesMoney || st === null) return <PageShell title={t('Loan')} backHref="/tabs/loans">{t('Not found')}</PageShell>;
  if (!st) return null;
  const { loan } = st;

  return (
    <PageShell title={loan.name} backHref="/tabs/loans">
      <div className="dash-grid">
        <div className="dash-card">
          <span>{loan.kind === 'taken' ? t('Still owed') : t('Still to get back')}</span>
          <strong>{rupees(st.balance)}</strong>
        </div>
        <div className="dash-card">
          <span>{loan.kind === 'taken' ? t('Interest and charges paid') : t('Interest received')}</span>
          <strong>{rupees(st.interestPaid)}</strong>
        </div>
      </div>
      <p className="section-note">
        {[loan.interestPct ? t('{pct}% a year', { pct: loan.interestPct }) : '', loan.emi ? t('EMI {amount}', { amount: rupees(loan.emi) }) : '', loan.accountNumber ?? ''].filter(Boolean).join(' · ')}
      </p>
      {isOwner && !loan.closed && (
        <div className="detail-actions">
          {loanEntryKinds(loan).map((k) => (
            <IonButton key={k} fill={k === loanEntryKinds(loan)[0] ? 'solid' : 'outline'} size="small" onClick={() => setKind(k)}>
              {loanEntryLabel(k)}
            </IonButton>
          ))}
        </div>
      )}
      <IonList inset className="flush-list">
        <IonListHeader>
          <IonLabel>{t('Statement')}</IonLabel>
        </IonListHeader>
        {st.rows.map((r, i) => (
          <IonItem
            key={i}
            button={isOwner && !!r.entry}
            detail={false}
            onClick={() =>
              isOwner &&
              r.entry &&
              void sheet({
                header: `${r.label} · ${rupees(Math.abs(r.amount))}`,
                buttons: [
                  { text: t('Delete'), role: 'destructive', handler: () => void deleteRecord('loanEntries', actor, r.entry!.id) },
                  { text: t('Cancel'), role: 'cancel' },
                ],
              })
            }
          >
            <IonLabel className="ion-text-wrap">
              <h3>{r.label}</h3>
              <p>
                {dateIN(r.date)} · {t('Balance {amount}', { amount: rupees(r.balance) })}
              </p>
            </IonLabel>
            <IonNote slot="end">{rupees(Math.abs(r.amount))}</IonNote>
          </IonItem>
        ))}
      </IonList>
      {isOwner && (
        <IonButton fill="clear" routerLink={`/tabs/loans/${loan.id}/edit`}>
          {t('Edit loan')}
        </IonButton>
      )}
      <MoneyEntrySheet
        isOpen={!!kind}
        onClose={() => setKind(null)}
        title={kind ? `${loanEntryLabel(kind)} · ${loan.name}` : ''}
        amount={kind === 'repaid' && loan.emi ? loan.emi : undefined}
        onSave={async (m) => {
          await addLoanEntry(actor, { loanId: loan.id, kind: kind!, ...m });
          void toast({ message: t('Saved'), duration: 1500, position: 'top', color: 'success' });
        }}
      >
        {kind === 'repaid' && <p className="section-note">{t('Principal only. Note the interest part of an EMI separately under Interest.')}</p>}
      </MoneyEntrySheet>
    </PageShell>
  );
}

