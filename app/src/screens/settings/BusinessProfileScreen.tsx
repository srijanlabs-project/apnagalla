import { useIonToast } from '@ionic/react';
import { AddressFields, FormSection, TextField } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import ImagePicker from '../../components/ImagePicker';
import { useBusiness } from '../../lib/business';
import type { BusinessProfile } from '../../lib/db';
import { putRecord } from '../../lib/repo';
import { useForm } from '../../lib/useForm';

export default function BusinessProfileScreen() {
  const { profile, actor, isOwner } = useBusiness();
  const { value: p, patch, patchIn, save, saving } = useForm<BusinessProfile>(profile);
  const [toast] = useIonToast();
  if (!p) return null;
  const ro = !isOwner;
  const onError = (message: string) => void toast({ message, duration: 2000, color: 'danger' });

  return (
    <FormPage
      title="Business profile"
      backHref="/tabs/more"
      onSave={isOwner ? () => save(() => putRecord('profiles', actor, p), { message: 'Saved', back: true }) : undefined}
      saving={saving}
      canSave={!!p.name.trim()}
    >
      {ro && <p className="section-note">Only the owner can change business details.</p>}

      <FormSection title="Logo">
        <ImagePicker label="Add logo" value={p.logo} onChange={(logo) => patch({ logo })} disabled={ro} onError={onError} />
      </FormSection>

      <FormSection title="Business">
        <TextField label="Business name" required value={p.name} onChange={(name) => patch({ name })} disabled={ro} autocapitalize="words" />
        <TextField label="Legal name (if different)" value={p.legalName} onChange={(legalName) => patch({ legalName })} disabled={ro} autocapitalize="words" />
        <div className="field-row">
          <TextField label="Tax ID label" placeholder="GSTIN" value={p.taxIdLabel} onChange={(taxIdLabel) => patch({ taxIdLabel })} disabled={ro} />
          <TextField label="Tax ID" value={p.taxIdValue} onChange={(taxIdValue) => patch({ taxIdValue: taxIdValue.toUpperCase() })} disabled={ro} />
        </div>
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
