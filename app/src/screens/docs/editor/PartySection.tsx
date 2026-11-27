import { addressLines } from '../../../lib/format';
import { GST_STATES } from '@invoice/shared';

import { IonIcon, IonLabel, IonSegment, IonSegmentButton } from '@ionic/react';

import { personCircleOutline } from 'ionicons/icons';

import { AddressFields, FormSection, SelectField, ToggleRow } from '../../../components/Fields';

import { db } from '../../../lib/db';

import { t } from '../../../lib/i18n';

import CreditLimitNote from '../../../components/CreditLimitNote';

import { sync } from '../../../lib/sync';

import type { EditorCtx } from './types';

/** Who the bill is for: GST kind, customer, ship-to and place of supply. */
export default function PartySection({ c }: { c: EditorCtx }) {
  const { doc, patch, locked, view, credit, totals, actor, wasDraft, gstType, setPicker, againstBefore, againstAfter, kind } = c;
  return (
    <>
        {/* ---------- GST kind ---------- */}
        {credit ? (
          <div className="target-chip">
            <span>
              {againstBefore}
              <strong>{credit.invoiceNumber}</strong>
              {againstAfter}
            </span>
          </div>
        ) : gstType === 'regular' && wasDraft ? (
          <IonSegment value={doc.taxMode ?? 'gst'} disabled={locked} onIonChange={sync((e) => patch({ taxMode: e.detail.value as 'gst' | 'none' }))}>
            <IonSegmentButton value="gst">
              <IonLabel>{kind === 'estimate' ? t('With GST') : t('Tax invoice (GST)')}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="none">
              <IonLabel>{t('Without GST')}</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        ) : gstType !== 'regular' && wasDraft ? (
          <p className="section-note">
            {gstType === 'composition'
              ? t('Composition scheme: bills of supply without GST. Change this in More → Business profile.')
              : t('Your store is not GST-registered, so bills have no GST. Change this in More → Business profile.')}
          </p>
        ) : null}

        {/* ---------- customer ---------- */}
        <div className="party-card" onClick={() => !locked && !credit && setPicker(true)}>
          <IonIcon icon={personCircleOutline} />
          {doc.billTo ? (
            <div>
              <strong>{doc.billTo.name}</strong>
              <p>{[doc.billTo.phone, ...addressLines(doc.billTo.address)].filter(Boolean).join(' · ')}</p>
            </div>
          ) : (
            <div>
              <strong className="text-primary">{t('Select customer')}</strong>
              <p>{t('Bill to')}</p>
            </div>
          )}
        </div>
        {kind === 'invoice' && doc.status === 'draft' && <CreditLimitNote businessId={actor.businessId} customerId={doc.billTo?.customerId} billAmount={totals?.grandTotal ?? 0} />}
        {doc.billTo?.customerId && !credit && (
          <ToggleRow
            label={t('Ship to a different address')}
            checked={!!doc.shipTo}
            onChange={async (on) => {
              const c = on && doc.billTo?.customerId ? await db.customers.get(doc.billTo.customerId) : null;
              patch({ shipTo: on ? { ...(c?.shippingAddress ?? doc.billTo!.address) } : null });
            }}
            disabled={locked}
          />
        )}
        {doc.shipTo && !credit && (
          <FormSection title={t('Ship to')}>
            <AddressFields value={doc.shipTo} onChange={(a) => patch((cur) => ({ shipTo: { ...cur.shipTo, ...a } }))} disabled={locked} />
          </FormSection>
        )}
        {view.mode === 'gst' && (
          <SelectField
            label={t('Place of supply')}
            value={view.pos ?? ''}
            options={[...(view.pos ? [] : [{ value: '', label: t('Choose the state') }]), ...GST_STATES.map((st) => ({ value: st.code, label: `${st.name} (${st.code})` }))]}
            onChange={(code) => patch({ placeOfSupply: code || null })}
            disabled={locked || !!credit}
          />
        )}

    </>
  );
}
