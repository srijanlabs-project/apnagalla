import { useIonToast } from '@ionic/react';
import { checkGstin, stateCode, stateName, type GstType } from '@invoice/shared';
import { AddressFields, FormSection, SelectField, TextField } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import ImagePicker from '../../components/ImagePicker';
import { useBusiness } from '../../lib/business';
import type { BusinessProfile } from '../../lib/db';
import { effectiveGstType, putRecord } from '../../lib/repo';
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
  const gstinError = registered ? (!p.taxIdValue?.trim() ? 'Required for a GST-registered store' : gstin && !gstin.ok ? gstin.message : null) : null;
  const stateMismatch = gstin?.ok && stateCode(p.address.state) && stateCode(p.address.state) !== gstin.stateCode;
  const onError = (message: string) => void toast({ message, duration: 2000, color: 'danger' });

  return (
    <FormPage
      title="Business profile"
      backHref="/tabs/more"
      onSave={
        isOwner
          ? () =>
              save(() => putRecord('profiles', actor, { ...p, gstType, ...(registered ? { taxIdLabel: 'GSTIN', taxIdValue: gstin?.ok ? gstin.gstin : p.taxIdValue } : {}) }), {
                message: 'Saved',
                back: true,
              })
          : undefined
      }
      saving={saving}
      canSave={!!p.name.trim() && !gstinError}
    >
      {ro && <p className="section-note">Only the owner can change business details.</p>}

      <FormSection title="Logo">
        <ImagePicker label="Add logo" value={p.logo} onChange={(logo) => patch({ logo })} disabled={ro} onError={onError} />
      </FormSection>

      <FormSection title="Business">
        <TextField label="Business name" required value={p.name} onChange={(name) => patch({ name })} disabled={ro} autocapitalize="words" />
        <TextField label="Legal name (if different)" value={p.legalName} onChange={(legalName) => patch({ legalName })} disabled={ro} autocapitalize="words" />
      </FormSection>

      <FormSection
        title="GST"
        note={
          gstType === 'regular'
            ? 'Tax invoices charge CGST + SGST within your state and IGST outside it. You can also make bills without GST; they get their own number series.'
            : gstType === 'composition'
              ? 'Bills of supply without GST, with the composition declaration printed on them.'
              : 'Bills without GST.'
        }
      >
        <SelectField<GstType>
          label="GST registration"
          value={gstType}
          options={[
            { value: 'regular', label: 'Registered (regular)' },
            { value: 'composition', label: 'Registered (composition scheme)' },
            { value: 'unregistered', label: 'Not registered' },
          ]}
          onChange={(v) => patch({ gstType: v, ...(v !== 'unregistered' ? { taxIdLabel: 'GSTIN' } : {}) })}
          disabled={ro}
        />
        {registered ? (
          <TextField
            label="GSTIN"
            required
            value={p.taxIdValue}
            onChange={(taxIdValue) => patch({ taxIdValue: taxIdValue.toUpperCase().trim() })}
            disabled={ro}
            maxlength={15}
            autocapitalize="characters"
            error={p.taxIdValue ? gstinError : null}
            helper={stateMismatch && gstin?.ok ? `This GSTIN is registered in ${stateName(gstin.stateCode)}, but the address below is in ${p.address.state}.` : undefined}
          />
        ) : (
          <div className="field-row">
            <TextField label="Other tax ID label" placeholder="e.g. PAN" value={p.taxIdLabel === 'GSTIN' ? '' : p.taxIdLabel} onChange={(taxIdLabel) => patch({ taxIdLabel })} disabled={ro} />
            <TextField label="Tax ID" value={p.taxIdLabel === 'GSTIN' ? '' : p.taxIdValue} onChange={(taxIdValue) => patch({ taxIdValue: taxIdValue.toUpperCase() })} disabled={ro} />
          </div>
        )}
      </FormSection>

      <FormSection title="Contact">
        <TextField label="Phone" type="tel" inputmode="tel" value={p.phone} onChange={(phone) => patch({ phone })} disabled={ro} />
        <TextField label="Email" type="email" inputmode="email" value={p.email} onChange={(email) => patch({ email })} disabled={ro} autocapitalize="off" />
        <TextField label="Website" type="url" inputmode="url" value={p.website} onChange={(website) => patch({ website })} disabled={ro} autocapitalize="off" />
      </FormSection>

      <FormSection title="Address">
        <AddressFields value={p.address} onChange={(a) => patchIn('address', a)} disabled={ro} />
      </FormSection>

      <FormSection title="Authorised signature" note="Printed at the bottom of invoices when enabled in Invoice design.">
        <ImagePicker label="Add signature" value={p.signature} onChange={(signature) => patch({ signature })} disabled={ro} maxPx={600} onError={onError} />
      </FormSection>
    </FormPage>
  );
}
