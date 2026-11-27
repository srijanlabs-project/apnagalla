
import Fold from '../../../components/Fold';

import { FormSection, SelectField, TextArea, TextField } from '../../../components/Fields';

import { type Invoice } from '../../../lib/db';

import { t } from '../../../lib/i18n';
import { dateIN } from '../../../lib/format';

import type { EditorCtx } from './types';

/** Delivery, notes and bank details, folded until needed. */
export default function ExtrasSection({ c }: { c: EditorCtx }) {
  const { doc, patch, locked, credit, actor, bankOptions, upiOptions, bankAccounts, upiIds, team, rxNeeded, kind } = c;
  return (
    <>
        <Fold
          title={t('Delivery, notes and bank details')}
          note={doc.deliveryDate ? t('Delivery {date}', { date: dateIN(doc.deliveryDate) }) : t('Optional')}
          open={!!doc.deliveryDate || !!rxNeeded}
        >
        {/* ---------- footer ---------- */}
        {!credit && (
        <FormSection title={t('Payment details on the PDF')}>
          <SelectField label={t('Bank account')} value={doc.bankAccountId ?? ''} options={bankOptions} onChange={(v) => patch({ bankAccountId: v || null })} disabled={locked} />
          <SelectField label={t('UPI QR code')} value={doc.upiIdId ?? ''} options={upiOptions} onChange={(v) => patch({ upiIdId: v || null })} disabled={locked} />
          {bankAccounts.length === 0 && upiIds.length === 0 && <p className="section-note">{t('Add bank / UPI details in More → Payment details.')}</p>}
        </FormSection>
        )}
        {!credit && (
          <FormSection title={t('Delivery')} note={t('Optional. The day before, the person delivering gets a phone alert.')}>
            <div className="field-row">
              <label className="date-field">
                <span>{t('Delivery date')}</span>
                <input type="date" value={doc.deliveryDate ?? ''} min={doc.date} disabled={locked} onChange={(e) => patch({ deliveryDate: e.target.value || null })} />
              </label>
              {doc.deliveryDate && (
                <SelectField
                  label={t('Delivered by')}
                  value={doc.deliveryAssignee?.userId ?? ''}
                  options={[{ value: '', label: t('Not assigned') }, ...team.map((m) => ({ value: m.userId, label: m.userId === actor.userId ? t('Me ({name})', { name: m.name }) : m.name }))]}
                  onChange={(userId) => patch({ deliveryAssignee: userId ? { userId, name: team.find((t) => t.userId === userId)?.name ?? '' } : null })}
                  disabled={locked}
                />
              )}
            </div>
            {doc.deliveryDate && (
              <div className="field-row">
                <TextField label={t('Time / slot')} value={doc.deliverySlot} onChange={(deliverySlot) => patch({ deliverySlot: deliverySlot || undefined })} placeholder={t('Morning, 2–4 pm…')} disabled={locked} />
                <TextField label={t('Floor / lift')} value={doc.deliveryFloor} onChange={(deliveryFloor) => patch({ deliveryFloor: deliveryFloor || undefined })} placeholder={t('3rd floor, no lift')} disabled={locked} />
              </div>
            )}
            {kind === 'invoice' && rxNeeded && (
              <>
                <p className="section-note text-danger">{t('Scheduled medicine on this bill: note the prescription.')}</p>
                <div className="field-row">
                  <TextField label={t('Patient')} value={(doc as Invoice).rx?.patient} onChange={(patient) => patch({ rx: { ...(doc as Invoice).rx, patient } } as Partial<Invoice>)} disabled={locked} />
                  <TextField label={t('Doctor')} value={(doc as Invoice).rx?.doctor} onChange={(doctor) => patch({ rx: { ...(doc as Invoice).rx, doctor } } as Partial<Invoice>)} disabled={locked} />
                </div>
                <TextField label={t('Prescription no. (optional)')} value={(doc as Invoice).rx?.number} onChange={(number) => patch({ rx: { ...(doc as Invoice).rx, number } } as Partial<Invoice>)} disabled={locked} />
              </>
            )}
            {kind === 'invoice' && (
              <TextField label={t('Site / project (contractors)')} value={(doc as Invoice).site} onChange={(site) => patch({ site: site || undefined } as Partial<Invoice>)} placeholder={t('e.g. Sharma house, Sector 12')} disabled={locked} />
            )}
          </FormSection>
        )}

        <FormSection title={t('Notes & terms')}>
          <TextArea label={t('Notes')} value={doc.notes} onChange={(notes) => patch({ notes })} disabled={locked} />
          <TextArea label={t('Notes for us (not printed)')} value={doc.privateNotes} onChange={(privateNotes) => patch({ privateNotes })} helper={t('Only the shop sees these; never on the bill or WhatsApp.')} />
          <TextArea label={t('Terms & conditions')} value={doc.terms} onChange={(terms) => patch({ terms })} disabled={locked} rows={3} />
        </FormSection>
        </Fold>
    </>
  );
}
