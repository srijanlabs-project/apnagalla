import { IonButton, IonLabel, IonSegment, IonSegmentButton } from '@ionic/react';
import { todayISO, addDaysISO } from '@invoice/shared';
import { useEffect, useMemo, useState } from 'react';
import { FormSection, ToggleRow } from '../../components/Fields';
import FormPage from '../../components/FormPage';
import PdfPreview from '../../components/PdfPreview';
import { useBusiness } from '../../lib/business';
import type { DesignSettings, Invoice, TemplateId } from '../../lib/db';
import { t } from '../../lib/i18n';
import { renderPdf } from '../../lib/pdf';
import { computeTotals, putRecord } from '../../lib/repo';
import { sync } from '../../lib/sync';

const TEMPLATES: { id: TemplateId; name: string; hint: string }[] = [
  { id: 'classic', name: 'Classic', hint: 'Bordered table, traditional' },
  { id: 'modern', name: 'Modern', hint: 'Colour header band' },
  { id: 'minimal', name: 'Minimal', hint: 'Black & white, saves ink' },
];
// i18n: labels above are translated where rendered
const COLORS = ['#3b5bdb', '#0b7285', '#2b8a3e', '#c2255c', '#e8590c', '#5f3dc4', '#212529'];

const TOGGLES: { key: keyof DesignSettings['show']; label: string }[] = [
  { key: 'logo', label: 'Logo' },
  { key: 'taxId', label: 'Tax ID' },
  { key: 'shipTo', label: 'Ship-to address' },
  { key: 'itemDescription', label: 'Item description' },
  { key: 'unitColumn', label: 'Unit column' },
  { key: 'discountColumn', label: 'Discount column' },
  { key: 'taxColumn', label: 'Tax column' },
  { key: 'bankDetails', label: 'Bank details' },
  { key: 'upiQr', label: 'UPI QR code' },
  { key: 'signature', label: 'Signature' },
  { key: 'terms', label: 'Terms & conditions' },
  { key: 'amountInWords', label: 'Amount in words' },
  { key: 'mrpColumn', label: 'MRP column' },
];
// i18n: labels above are translated where rendered

/** A realistic sample invoice for the live preview. */
function sampleInvoice(businessId: string): Invoice {
  const date = todayISO();
  const base = {
    lines: [
      { id: '1', name: 'Basmati Rice 5kg', description: 'Premium long grain', qty: 2, unit: 'bag', rate: 65000, rateIncludesTax: false, taxPct: 5, discount: { type: 'pct' as const, value: 10 } },
      { id: '2', name: 'Sunflower Oil 1L', qty: 6, unit: 'pcs', rate: 16500, rateIncludesTax: true, taxPct: 5 },
      { id: '3', name: 'Home delivery service', qty: 1, unit: 'job', rate: 10000, rateIncludesTax: false, taxPct: 18 },
    ],
    overallDiscount: null,
    charges: [{ label: 'Packing', amount: 2000, taxPct: 0 }],
    roundOff: true,
    targetTotal: null,
  };
  return {
    ...base,
    id: 'sample',
    businessId,
    createdAt: '',
    updatedAt: '',
    updatedBy: '',
    number: 'INV/26-27/0042',
    date,
    dueDate: addDaysISO(date, 15),
    reference: 'PO-1187',
    customFields: [],
    billTo: { name: 'Sharma General Store', phone: '+919876543210', address: { line1: '12, MG Road', city: 'Pune', state: 'Maharashtra', pin: '411001' } },
    shipTo: null,
    notes: 'Thank you for your business!',
    terms: 'Goods once sold will not be taken back.',
    bankAccountId: null,
    upiIdId: null,
    totals: computeTotals(base),
    createdBy: '',
    history: [],
    status: 'saved',
    payment: { status: 'partial', amountPaid: 50000 },
  };
}

export default function DesignScreen() {
  const { settings, actor, isOwner, profile, bankAccounts, upiIds } = useBusiness();
  const [d, setD] = useState<DesignSettings>(settings.design);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [saving, setSaving] = useState(false);
  const sample = useMemo(() => sampleInvoice(actor.businessId), [actor.businessId]);
  const set = (p: Partial<DesignSettings>) => setD((cur) => ({ ...cur, ...p }));

  // Re-render the preview (debounced) whenever the design changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      const { id: _i, businessId: _b, createdAt: _c, updatedAt: _u, updatedBy: _ub, deleted: _d, ...business } = profile;
      void renderPdf({
        kind: 'invoice',
        doc: sample,
        business,
        design: d,
        bank: bankAccounts.find((b) => b.isDefault) ?? bankAccounts[0] ?? { holderName: profile.name, bankName: 'Your Bank', accountNumber: '000011112222', ifsc: 'BANK0001234', accountType: 'current', isDefault: true, id: 'x', businessId: '', createdAt: '', updatedAt: '', updatedBy: '' },
        upi: upiIds.find((u) => u.isDefault) ?? upiIds[0] ?? { upiId: 'yourshop@upi', payeeName: profile.name, isDefault: true, id: 'x', businessId: '', createdAt: '', updatedAt: '', updatedBy: '' },
        otherPaymentInstructions: settings.otherPaymentInstructions,
      }).then((r) => setBlob(r.blob));
    }, 300);
    return () => clearTimeout(timer);
  }, [d, profile, sample, bankAccounts, upiIds, settings.otherPaymentInstructions]);

  const dirty = JSON.stringify(d) !== JSON.stringify(settings.design);

  return (
    <FormPage
      title={t('Invoice design')}
      backHref="/tabs/more"
      onSave={
        isOwner
          ? async () => {
              setSaving(true);
              await putRecord('settings', actor, { ...settings, design: d });
              setSaving(false);
            }
          : undefined
      }
      saveLabel={dirty ? t('Save design') : t('Saved')}
      canSave={dirty}
      saving={saving}
    >
      {!isOwner && <p className="section-note">{t('Only the owner can change the invoice design.')}</p>}
      <p className="section-note">{t('One design is used for all invoices and estimates.')}</p>

      <div className="template-grid">
        {TEMPLATES.map((tpl) => (
          <button key={tpl.id} className={d.template === tpl.id ? 'template-card selected' : 'template-card'} disabled={!isOwner} onClick={() => set({ template: tpl.id })}>
            <strong>{t(tpl.name)}</strong>
            <span>{t(tpl.hint)}</span>
          </button>
        ))}
      </div>

      {d.template !== 'minimal' && (
        <FormSection title={t('Colour')}>
          <div className="color-row">
            {COLORS.map((c) => (
              <button key={c} className={d.color === c ? 'color-dot selected' : 'color-dot'} style={{ background: c }} aria-label={t('Colour {color}', { color: c })} disabled={!isOwner} onClick={() => set({ color: c })} />
            ))}
          </div>
        </FormSection>
      )}

      <FormSection title={t('Text size & paper')}>
        <IonSegment value={d.fontSize} disabled={!isOwner} onIonChange={sync((e) => set({ fontSize: e.detail.value as DesignSettings['fontSize'] }))}>
          <IonSegmentButton value="S">
            <IonLabel>{t('Small')}</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="M">
            <IonLabel>{t('Medium')}</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="L">
            <IonLabel>{t('Large')}</IonLabel>
          </IonSegmentButton>
        </IonSegment>
        <IonSegment value={d.paper} disabled={!isOwner} onIonChange={sync((e) => set({ paper: e.detail.value as DesignSettings['paper'] }))} style={{ marginTop: 8 }}>
          <IonSegmentButton value="A4">
            <IonLabel>A4</IonLabel>
          </IonSegmentButton>
          <IonSegmentButton value="A5">
            <IonLabel>A5</IonLabel>
          </IonSegmentButton>
        </IonSegment>
      </FormSection>

      <FormSection title={t('Preview (sample invoice)')}>
        <PdfPreview blob={blob} />
      </FormSection>

      <FormSection title={t('Show on invoice')}>
        {TOGGLES.map((tg) => (
          <ToggleRow key={tg.key} label={t(tg.label)} checked={d.show[tg.key]} disabled={!isOwner} onChange={(v) => set({ show: { ...d.show, [tg.key]: v } })} />
        ))}
      </FormSection>

      {dirty && isOwner && (
        <IonButton fill="clear" expand="block" onClick={() => setD(settings.design)}>
          {t('Discard changes')}
        </IonButton>
      )}
    </FormPage>
  );
}
