import {
  IonBadge,
  IonButton,
  IonFab,
  IonFabButton,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonSegment,
  IonSegmentButton,
  useIonActionSheet,
  useIonRouter,
  useIonToast,
} from '@ionic/react';
import { todayISO } from '@invoice/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { add, cameraOutline, closeCircle, constructOutline, documentTextOutline, personCircleOutline, receiptOutline, shareSocialOutline, walletOutline } from 'ionicons/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import { FormSection, TextArea, TextField } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import MoneyEntrySheet from '../../components/MoneyEntrySheet';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { db, type Estimate, type JobInfo, type JobStage } from '../../lib/db';
import { shareTable } from '../../lib/exportTable';
import { dateIN, fileToResizedDataUrl, rupees } from '../../lib/format';
import { t } from '../../lib/i18n';
import { CLOSED, jobAdvance, jobCardTable, newJob, nextStage, saveJob, setStage, stageLabel, stagesOf, takeAdvance } from '../../lib/jobs';
import { CAN_CREATE_INVOICES } from '../../lib/platform';
import { convertEstimate } from '../../lib/repo';
import CustomerPicker from '../docs/CustomerPicker';

const MAX_PHOTOS = 6;

export function JobsScreen() {
  const { actor } = useBusiness();
  const [kind, setKind] = useState<JobInfo['kind']>('work');
  const [showClosed, setShowClosed] = useState(false);
  const jobs = useLiveQuery(
    () =>
      db.estimates
        .where('businessId')
        .equals(actor.businessId)
        .filter((e) => !!e.job && !e.deleted)
        .toArray(),
    [actor.businessId],
  );
  const list = useMemo(
    () =>
      (jobs ?? [])
        .filter((e) => e.job!.kind === kind && CLOSED.includes(e.job!.stage) === showClosed)
        .sort((a, b) => (a.deliveryDate ?? '9999').localeCompare(b.deliveryDate ?? '9999') || b.date.localeCompare(a.date)),
    [jobs, kind, showClosed],
  );
  const today = todayISO();

  return (
    <PageShell title={t('Jobs')} backHref="/tabs/more" padded={false}>
      <IonSegment value={kind} onIonChange={(e) => setKind(e.detail.value as JobInfo['kind'])}>
        <IonSegmentButton value="work">
          <IonLabel>{t('Work orders')}</IonLabel>
        </IonSegmentButton>
        <IonSegmentButton value="repair">
          <IonLabel>{t('Repairs')}</IonLabel>
        </IonSegmentButton>
      </IonSegment>
      <div className="filter-chips">
        <IonButton size="small" fill={showClosed ? 'clear' : 'solid'} onClick={() => setShowClosed(false)}>
          {t('Open')}
        </IonButton>
        <IonButton size="small" fill={showClosed ? 'solid' : 'clear'} onClick={() => setShowClosed(true)}>
          {t('Done')}
        </IonButton>
      </div>
      {jobs && list.length === 0 ? (
        <EmptyState
          icon={constructOutline}
          title={kind === 'work' ? t('No work orders') : t('No repairs')}
          text={kind === 'work' ? t('Take measurements, give a quote, collect an advance and track the work until delivery.') : t('Note the device, problem and accessories, give the customer a job card, and track the repair.')}
        />
      ) : (
        <IonList>
          {list.map((e) => (
            <IonItem key={e.id} routerLink={`/tabs/jobs/${e.id}`} detail={false}>
              <IonLabel>
                <h2>{e.job!.title || e.billTo?.name || t('Job')}</h2>
                <p>
                  {[e.billTo?.name, e.number].filter(Boolean).join(' · ')}
                  {e.deliveryDate ? (
                    <span className={e.deliveryDate < today && !CLOSED.includes(e.job!.stage) ? 'text-danger' : undefined}> · {t('Due {date}', { date: dateIN(e.deliveryDate) })}</span>
                  ) : null}
                </p>
              </IonLabel>
              <div slot="end" className="list-end">
                <IonBadge color={e.job!.stage === 'ready' || e.job!.stage === 'repaired' ? 'success' : 'medium'}>{stageLabel(e.job!.stage)}</IonBadge>
                {e.totals.grandTotal > 0 && <IonNote>{rupees(e.totals.grandTotal)}</IonNote>}
              </div>
            </IonItem>
          ))}
        </IonList>
      )}
      <IonFab slot="fixed" vertical="bottom" horizontal="end">
        <IonFabButton routerLink={`/tabs/jobs/new?kind=${kind}`} aria-label={t('New job')}>
          <IonIcon icon={add} />
        </IonFabButton>
      </IonFab>
    </PageShell>
  );
}

export function JobScreen() {
  const { id } = useParams<{ id: string }>();
  const { actor, isOwner } = useBusiness();
  const router = useIonRouter();
  const [toast] = useIonToast();
  const [sheet] = useIonActionSheet();
  const params = new URLSearchParams(useLocation().search);
  const isNew = !id || id === 'new';
  const stored = useLiveQuery(() => (isNew ? undefined : db.estimates.get(id!)), [id, isNew]);
  const [est, setEst] = useState<Estimate | null>(null);
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState(false);
  const [paying, setPaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const advance = useLiveQuery(() => (isNew ? 0 : jobAdvance(actor.businessId, id!)), [actor.businessId, id, isNew]);

  useEffect(() => {
    if (isNew) {
      if (!est) void newJob(actor, params.get('kind') === 'repair' ? 'repair' : 'work', null).then(setEst);
    } else if (stored && !dirty) setEst(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, stored, dirty, actor]);

  if (!est?.job) return null;
  const job = est.job;
  const repair = job.kind === 'repair';
  const patch = (p: Partial<Estimate>) => {
    setDirty(true);
    setEst((e) => e && { ...e, ...p });
  };
  const patchJob = (p: Partial<JobInfo>) => patch({ job: { ...job, ...p } });
  // A repair is titled by its device.
  const patchDevice = (p: Partial<NonNullable<JobInfo['device']>>) => {
    const device = { ...job.device, ...p };
    patchJob({ device, title: [device.brand, device.model].filter(Boolean).join(' ') });
  };
  const next = nextStage(job);
  const closed = CLOSED.includes(job.stage);
  const canEditQuote = isOwner || est.createdBy === actor.userId;

  async function save(): Promise<Estimate | null> {
    if (!est) return null;
    setSaving(true);
    try {
      const saved = await saveJob(actor, est);
      setDirty(false);
      setEst(saved);
      void toast({ message: t('Job saved'), duration: 1500, position: 'top', color: 'success' });
      if (isNew) router.push(`/tabs/jobs/${saved.id}`, 'none', 'replace');
      return saved;
    } catch (e) {
      void toast({ message: (e as Error).message, duration: 2500, position: 'top', color: 'danger' });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function moveTo(stage: JobStage) {
    const base = dirty ? await save() : est;
    if (!base) return;
    setEst(await setStage(actor, base, stage));
    setDirty(false);
  }

  async function addPhoto(file: File) {
    if (job.photos.length >= MAX_PHOTOS) return;
    const photo = await fileToResizedDataUrl(file, 1000, true);
    patchJob({ photos: [...job.photos, photo] });
  }

  return (
    <FormPage
      title={isNew ? (repair ? t('New repair') : t('New work order')) : est.number || t('Job')}
      backHref="/tabs/jobs"
      onSave={dirty || isNew ? () => void save() : undefined}
      saving={saving}
      canSave={!!(job.title.trim() || job.device?.model?.trim()) && !!est.billTo}
    >
      <div className="party-card" onClick={() => setPicker(true)}>
        <IonIcon icon={personCircleOutline} />
        {est.billTo ? (
          <div>
            <strong>{est.billTo.name}</strong>
            <p>{est.billTo.phone}</p>
          </div>
        ) : (
          <div>
            <strong className="text-primary">{t('Select customer')}</strong>
          </div>
        )}
      </div>
      <CustomerPicker isOpen={picker} onClose={() => setPicker(false)} onPick={(party) => patch({ billTo: party })} />

      {!isNew && (
        <FormSection title={t('Stage')}>
          <div className="filter-chips">
            {stagesOf(job.kind).map((s) => (
              <IonBadge key={s} color={s === job.stage ? 'primary' : 'light'}>
                {stageLabel(s)}
              </IonBadge>
            ))}
          </div>
          {!closed && (
            <div className="detail-actions">
              {next && (
                <IonButton onClick={() => void moveTo(next)}>
                  {t('Move to: {stage}', { stage: stageLabel(next) })}
                </IonButton>
              )}
              <IonButton
                fill="outline"
                onClick={() =>
                  void sheet({
                    header: t('Change stage'),
                    buttons: [
                      ...[...stagesOf(job.kind), ...(repair ? (['returned'] as JobStage[]) : (['cancelled'] as JobStage[]))]
                        .filter((s) => s !== job.stage)
                        .map((s) => ({ text: stageLabel(s), handler: () => void moveTo(s) })),
                      { text: t('Cancel'), role: 'cancel' },
                    ],
                  })
                }
              >
                {t('Other stage')}
              </IonButton>
            </div>
          )}
          {job.stageHistory.length > 1 && (
            <p className="section-note">
              {job.stageHistory
                .slice(-4)
                .map((h) => `${stageLabel(h.stage)} ${dateIN(h.at.slice(0, 10))}${h.byName ? ` (${h.byName})` : ''}`)
                .join(' → ')}
            </p>
          )}
        </FormSection>
      )}

      <FormSection title={repair ? t('Device') : t('Work')}>
        {repair ? (
          <>
            <div className="field-row">
              <TextField label={t('Brand')} value={job.device?.brand} onChange={(brand) => patchDevice({ brand })} />
              <TextField label={t('Model')} value={job.device?.model} onChange={(model) => patchDevice({ model })} />
            </div>
            <TextField label="IMEI / Serial" value={job.device?.imei} onChange={(imei) => patchDevice({ imei })} />
            <TextArea label={t('Problem')} value={job.device?.problem} onChange={(problem) => patchDevice({ problem })} />
            <TextField label={t('Accessories taken (charger, cover…)')} value={job.device?.accessories} onChange={(accessories) => patchDevice({ accessories })} />
            <TextField label={t('Condition (scratches, cracks…)')} value={job.device?.condition} onChange={(condition) => patchDevice({ condition })} />
          </>
        ) : (
          <>
            <TextField label={t('What work')} required value={job.title} onChange={(title) => patchJob({ title })} />
            <TextArea label={t('Measurements and notes')} value={job.measurements} onChange={(measurements) => patchJob({ measurements })} rows={3} />
          </>
        )}
        <IonInput
          className="field"
          fill="outline"
          labelPlacement="floating"
          label={repair ? t('Ready by') : t('Due date')}
          type="date"
          value={est.deliveryDate ?? ''}
          onIonInput={(e) => patch({ deliveryDate: String(e.detail.value ?? '') || null })}
        />
      </FormSection>

      <FormSection title={t('Photos')}>
        <div className="photo-grid">
          {job.photos.map((p, i) => (
            <div key={i} className="photo-cell">
              <img src={p} alt="" />
              <IonIcon icon={closeCircle} onClick={() => patchJob({ photos: job.photos.filter((_, j) => j !== i) })} />
            </div>
          ))}
          {job.photos.length < MAX_PHOTOS && (
            <button type="button" className="photo-add" onClick={() => photoInput.current?.click()}>
              <IonIcon icon={cameraOutline} />
            </button>
          )}
        </div>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void addPhoto(f);
          }}
        />
      </FormSection>

      {!isNew && (
        <FormSection title={t('Quote and money')}>
          <p>
            {t('Quote')}: <strong>{rupees(est.totals.grandTotal)}</strong> · {t('Advance')}: <strong className="text-success">{rupees(advance ?? 0)}</strong>
          </p>
          <div className="detail-actions">
            {canEditQuote && est.status !== 'converted' && (
              <IonButton fill="outline" routerLink={`/tabs/estimates/${est.id}/edit`}>
                <IonIcon icon={documentTextOutline} slot="start" /> {est.lines.length ? t('Edit quote') : t('Add quote items')}
              </IonButton>
            )}
            <IonButton fill="outline" disabled={!est.billTo?.customerId} onClick={() => setPaying(true)}>
              <IonIcon icon={walletOutline} slot="start" /> {t('Take advance')}
            </IonButton>
            <IonButton fill="outline" onClick={() => void shareTable(actor.businessId, jobCardTable(est), 'pdf', t('Job card {number}', { number: est.number }))}>
              <IonIcon icon={shareSocialOutline} slot="start" /> {t('Job card')}
            </IonButton>
            {est.lines.length > 0 && (
              <IonButton fill="outline" routerLink={`/tabs/estimates/${est.id}`}>
                {t('Quote PDF')}
              </IonButton>
            )}
            {CAN_CREATE_INVOICES && est.lines.length > 0 && est.status !== 'converted' && (
              <IonButton
                color="success"
                onClick={() =>
                  void convertEstimate(actor, est.id)
                    .then((inv) => router.push(`/tabs/invoices/${inv.id}/edit`))
                    .catch((e) => toast({ message: (e as Error).message, duration: 2500, color: 'danger' }))
                }
              >
                <IonIcon icon={receiptOutline} slot="start" /> {t('Make bill')}
              </IonButton>
            )}
            {est.convertedInvoiceId && (
              <IonButton fill="clear" routerLink={`/tabs/invoices/${est.convertedInvoiceId}`}>
                {t('See bill')}
              </IonButton>
            )}
          </div>
          {!est.billTo?.customerId && <p className="section-note">{t('Pick a saved customer to take an advance.')}</p>}
        </FormSection>
      )}

      <MoneyEntrySheet
        isOpen={paying}
        onClose={() => setPaying(false)}
        title={t('Advance for {job}', { job: est.number })}
        onSave={async (m) => {
          await takeAdvance(actor, est, m);
          void toast({ message: t('Advance saved'), duration: 1500, position: 'top', color: 'success' });
        }}
      />
    </FormPage>
  );
}
