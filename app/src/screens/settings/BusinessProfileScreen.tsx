import { useIonToast } from '@ionic/react';
import { checkGstin, stateCode, stateName, type GstType } from '@invoice/shared';
import { AddressFields, FormSection, SelectField, TextField } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import GstinCheck from '../../components/GstinCheck';
import ImagePicker from '../../components/ImagePicker';
import { gstinProblemText } from '../customers/CustomerEditScreen';
import { useBusiness } from '../../lib/business';
import type { BusinessProfile } from '../../lib/db';
import { effectiveGstType, putRecord } from '../../lib/repo';
import { t } from '../../lib/i18n';
import { useForm } from '../../lib/useForm';

export default function BusinessProfileScreen() {
  const { profile, actor, isOwner } = useBusiness();
  const { value: p, patch, patchIn, save, saving } = useForm<BusinessProfile>(profile);
  const [toast] = useIonToast();
  if (!p) return null;
  const ro = !isOwner;
  const gstType = effectiveGstType(p);
  const registered = gstType !== 'unregistered';
  const gstin = registered && p.taxIdValue ? checkGstin(p.taxIdValue) : null;
  const gstinError = registered ? (!p.taxIdValue?.trim() ? t('Required for a GST-registered store') : gstin && !gstin.ok ? gstinProblemText(gstin.problem, p.taxIdValue) : null) : null;
  const stateMismatch = gstin?.ok && stateCode(p.address.state) && stateCode(p.address.state) !== gstin.stateCode;
  const onError = (message: string) => void toast({ message, duration: 2000, color: 'danger' });

  return (
    <FormPage
      title={t('Business profile')}
      backHref="/tabs/more"
      onSave={
        isOwner
          ? () =>
              save(() => putRecord('profiles', actor, { ...p, gstType, ...(registered ? { taxIdLabel: 'GSTIN', taxIdValue: gstin?.ok ? gstin.gstin : p.taxIdValue } : {}) }), {
                message: t('Saved'),
                back: true,
              })
          : undefined
      }
      saving={saving}
      canSave={!!p.name.trim() && !gstinError}
    >
      {ro && <p className="section-note">{t('Only the owner can change business details.')}</p>}

      <FormSection title={t('Logo')}>
        <ImagePicker label={t('Add logo')} value={p.logo} onChange={(logo) => patch({ logo })} disabled={ro} onError={onError} />
      </FormSection>

      <FormSection title={t('Business')}>
        <TextField label={t('Business name')} required value={p.name} onChange={(name) => patch({ name })} disabled={ro} autocapitalize="words" />
        <TextField label={t('Legal name (if different)')} value={p.legalName} onChange={(legalName) => patch({ legalName })} disabled={ro} autocapitalize="words" />
      </FormSection>

      <FormSection
        title="GST"
        note={
          gstType === 'regular'
            ? t('Tax invoices charge CGST + SGST within your state and IGST outside it. You can also make bills without GST; they get their own number series.')
            : gstType === 'composition'
              ? t('Bills of supply without GST, with the composition declaration printed on them.')
              : t('Bills without GST.')
        }
      >
        <SelectField<GstType>
          label={t('GST registration')}
          value={gstType}
          options={[
            { value: 'regular', label: t('Registered (regular)') },
            { value: 'composition', label: t('Registered (composition scheme)') },
            { value: 'unregistered', label: t('Not registered') },
          ]}
          onChange={(v) => patch({ gstType: v, ...(v !== 'unregistered' ? { taxIdLabel: 'GSTIN' } : {}) })}
          disabled={ro}
        />
        {registered ? (
          <>
            <TextField
              label="GSTIN"
            required
            value={p.taxIdValue}
            onChange={(taxIdValue) => patch({ taxIdValue: taxIdValue.toUpperCase().trim() })}
            disabled={ro}
            maxlength={15}
            autocapitalize="characters"
            error={p.taxIdValue ? gstinError : null}
            helper={stateMismatch && gstin?.ok ? t('This GSTIN is registered in {gstinState}, but the address below is in {addressState}.', { gstinState: stateName(gstin.stateCode) ?? '', addressState: p.address.state ?? '' }) : undefined}
            />
            {!ro && (
              <GstinCheck
                businessId={actor.businessId}
                gstin={p.taxIdValue}
                onUse={(info) => {
                  patch({ legalName: info.legalName, ...(info.tradeName && !p.name ? { name: info.tradeName } : {}) });
                  if (info.address) patchIn('address', Object.fromEntries(Object.entries(info.address).filter(([, v]) => v)));
                }}
              />
            )}
          </>
        ) : (
          <div className="field-row">
            <TextField label={t('Other tax ID label')} placeholder={t('e.g. PAN')} value={p.taxIdLabel === 'GSTIN' ? '' : p.taxIdLabel} onChange={(taxIdLabel) => patch({ taxIdLabel })} disabled={ro} />
            <TextField label={t('Tax ID')} value={p.taxIdLabel === 'GSTIN' ? '' : p.taxIdValue} onChange={(taxIdValue) => patch({ taxIdValue: taxIdValue.toUpperCase() })} disabled={ro} />
          </div>
        )}
      </FormSection>

      <FormSection title={t('Contact')}>
        <TextField label={t('Phone')} type="tel" inputmode="tel" value={p.phone} onChange={(phone) => patch({ phone })} disabled={ro} />
        <TextField label={t('Email')} type="email" inputmode="email" value={p.email} onChange={(email) => patch({ email })} disabled={ro} autocapitalize="off" />
        <TextField label={t('Website')} type="url" inputmode="url" value={p.website} onChange={(website) => patch({ website })} disabled={ro} autocapitalize="off" />
      </FormSection>

      <FormSection title={t('Address')}>
        <AddressFields value={p.address} onChange={(a) => patchIn('address', a)} disabled={ro} />
      </FormSection>

      <FormSection title={t('Authorised signature')} note={t('Printed at the bottom of invoices when enabled in Invoice design.')}>
        <ImagePicker label={t('Add signature')} value={p.signature} onChange={(signature) => patch({ signature })} disabled={ro} maxPx={600} onError={onError} />
      </FormSection>
    </FormPage>
  );
}
