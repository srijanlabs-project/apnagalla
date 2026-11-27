import { CREDIT_REASONS } from './creditReasons';

import Fold from '../../../components/Fold';

import { IonButton } from '@ionic/react';
import { addDaysISO } from '@invoice/shared';

import { FormSection, SelectField, TextArea, TextField, ToggleRow } from '../../../components/Fields';

import { type CreditNote, type Estimate } from '../../../lib/db';

import { t } from '../../../lib/i18n';
import { dateIN } from '../../../lib/format';

import { PAYMENT_TERMS } from '../../settings/InvoiceSettingsScreen';

import { blankJob } from '../../../lib/jobs';

import { godownsOf } from '../../../lib/godowns';

import type { EditorCtx } from './types';

/** Bill number, date, terms, reference; estimate kinds and where goods leave from. */
export default function HeaderSection({ c }: { c: EditorCtx }) {
  const { doc, patch, locked, credit, settings, actor, byKind, wasDraft, nextNumber, isOwner, setTerms, kind } = c;
  return (
    <>
        {/* ---------- header ---------- */}
        <Fold
          title={byKind(t('Invoice no., date and terms'), t('Estimate no. and date'), t('Credit note no. and date'))}
          note={[doc.number || nextNumber || t('Number given when you save'), dateIN(doc.date), kind === 'invoice' && doc.dueDate && doc.dueDate !== doc.date ? t('due {date}', { date: dateIN(doc.dueDate) }) : null, doc.reference || null].filter(Boolean).join(' · ')}
          open={!!credit || doc.customFields.length > 0}
        >
        <FormSection title={byKind(t('Invoice details'), t('Estimate details'), t('Credit note details'))}>
          <div className="field-row">
            <TextField
              label={byKind(t('Invoice no.'), t('Estimate no.'), t('Credit note no.'))}
              value={doc.number}
              placeholder={nextNumber}
              helper={!doc.number && wasDraft ? (nextNumber ? t('Auto: {number}', { number: nextNumber }) : t('Auto: given when you save')) : undefined}
              onChange={(number) => patch({ number: number.trim() })}
              disabled={locked || (!isOwner && !wasDraft)}
            />
            <label className="date-field">
              <span>{t('Date')}</span>
              <input
                type="date"
                value={doc.date}
                disabled={locked}
                onChange={(e) =>
                  e.target.value && patch({ date: e.target.value, dueDate: doc.paymentTermsDays != null ? addDaysISO(e.target.value, doc.paymentTermsDays) : doc.dueDate })
                }
              />
            </label>
          </div>
          {credit && (
            <SelectField label={t('Reason')} value={credit.reason} options={CREDIT_REASONS.map((x) => ({ ...x, label: t(x.label) }))} onChange={(reason) => patch({ reason } as Partial<CreditNote>)} disabled={locked || !isOwner} />
          )}
          {kind === 'invoice' && (
            <div className="field-row">
              {/* i18n: PAYMENT_TERMS labels (from InvoiceSettingsScreen) are translated where rendered */}
              <SelectField
                label={t('Payment terms')}
                value={PAYMENT_TERMS.some((p) => p.value === doc.paymentTermsDays) ? doc.paymentTermsDays : -1}
                options={[...PAYMENT_TERMS.map((x) => ({ ...x, label: t(x.label) })), { value: -1, label: t('Custom date') }]}
                onChange={(v) => (v === -1 ? patch({ paymentTermsDays: undefined }) : setTerms(v))}
                disabled={locked}
              />
              <label className="date-field">
                <span>{t('Due date')}</span>
                <input type="date" value={doc.dueDate ?? ''} min={doc.date} disabled={locked} onChange={(e) => patch({ dueDate: e.target.value || undefined, paymentTermsDays: undefined })} />
              </label>
            </div>
          )}
          {!credit && <TextField label={t('Reference / PO no.')} value={doc.reference} onChange={(reference) => patch({ reference })} disabled={locked} />}
          {doc.customFields.map((f, i) => (
            <TextField
              key={f.label}
              label={f.label}
              value={f.value}
              onChange={(value) => patch((cur) => ({ customFields: cur.customFields.map((x, j) => (j === i ? { ...x, value } : x)) }))}
              disabled={locked}
            />
          ))}
        </FormSection>
        </Fold>

        {kind === 'estimate' && (doc as Estimate).challan && (
          <FormSection>
            <ToggleRow
              label={t('Sale or return (consignment)')}
              note={t('The party pays for what sells and sends back the rest. Bill and take back from the challan.')}
              checked={!!(doc as Estimate).consignment}
              onChange={(consignment) => patch({ consignment } as Partial<Estimate>)}
              disabled={locked}
            />
          </FormSection>
        )}
        {kind !== 'credit' && (
          <FormSection>
            {godownsOf(settings).length > 0 && (
          <SelectField
            label={t('Goods leave from')}
            value={doc.godownId ?? ''}
            options={[{ value: '', label: t('Shop') }, ...godownsOf(settings).map((g) => ({ value: g.id, label: g.name }))]}
            onChange={(v) => patch({ godownId: v || undefined })}
            disabled={locked}
          />
        )}
          </FormSection>
        )}
        {kind === 'estimate' && !(doc as Estimate).challan && !(doc as Estimate).order && !(doc as Estimate).proforma && (
          <FormSection>
            <ToggleRow
              label={t('This is a work order')}
              note={t('Track it from measurement to delivery, with photos and an advance.')}
              checked={!!(doc as Estimate).job}
              onChange={(on) => patch({ job: on ? ((doc as Estimate).job ?? blankJob('work', actor.userName)) : null } as Partial<Estimate>)}
              disabled={locked}
            />
            {(doc as Estimate).job && (
              <>
                <TextField label={t('What work')} value={(doc as Estimate).job!.title} onChange={(title) => patch({ job: { ...(doc as Estimate).job!, title } } as Partial<Estimate>)} disabled={locked} />
                <TextArea label={t('Measurements and notes')} value={(doc as Estimate).job!.measurements} onChange={(measurements) => patch({ job: { ...(doc as Estimate).job!, measurements } } as Partial<Estimate>)} disabled={locked} />
                {!wasDraft || doc.number ? (
                  <IonButton size="small" fill="clear" routerLink={`/tabs/jobs/${doc.id}`}>
                    {t('Open the work order (stages, photos, advance)')}
                  </IonButton>
                ) : null}
              </>
            )}
          </FormSection>
        )}
    </>
  );
}
