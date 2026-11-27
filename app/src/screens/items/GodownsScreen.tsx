import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonListHeader, IonNote, useIonAlert } from '@ionic/react';
import { addOutline, closeCircle, swapHorizontalOutline } from 'ionicons/icons';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { godownsOf } from '../../lib/godowns';
import { t } from '../../lib/i18n';
import { newId, putRecord } from '../../lib/repo';

/** Godowns of this store: add / rename them (owner); goods move on the Stock transfer screen. */
export default function GodownsScreen() {
  const { actor, settings, isOwner, perms } = useBusiness();
  const [alert] = useIonAlert();
  const godowns = godownsOf(settings);
  const canMove = perms.access !== 'readonly' && perms.access !== 'warehouse';

  const saveGodowns = (list: NonNullable<typeof settings.godowns>) => putRecord('settings', actor, { ...settings, godowns: list });
  const name = (header: string, value: string, onOk: (v: string) => void) =>
    void alert({
      header,
      inputs: [{ name: 'name', value, attributes: { maxlength: 40 } }],
      buttons: [{ text: t('Cancel'), role: 'cancel' }, { text: t('Save'), handler: (v: { name: string }) => (v.name.trim() ? onOk(v.name.trim()) : false) }],
    });

  return (
    <PageShell title={t('Godowns')} backHref="/tabs/items">
      <IonList inset className="flush-list">
        <IonListHeader>
          <IonLabel>{t('Places')}</IonLabel>
          {isOwner && (
            <IonButton onClick={() => name(t('New godown'), '', (n) => void saveGodowns([...(settings.godowns ?? []), { id: newId(), name: n }]))}>
              <IonIcon icon={addOutline} slot="start" /> {t('Add')}
            </IonButton>
          )}
        </IonListHeader>
        <IonItem lines="full">
          <IonLabel>{t('Shop')}</IonLabel>
          <IonNote slot="end">{t('Default')}</IonNote>
        </IonItem>
        {godowns.map((g) => (
          <IonItem
            key={g.id}
            button={isOwner}
            detail={false}
            onClick={() =>
              isOwner &&
              name(t('Rename godown'), g.name, (n) => void saveGodowns((settings.godowns ?? []).map((x) => (x.id === g.id ? { ...x, name: n } : x))))
            }
          >
            <IonLabel>{g.name}</IonLabel>
            {isOwner && (
              <IonIcon
                slot="end"
                icon={closeCircle}
                color="medium"
                onClick={(e) => {
                  e.stopPropagation();
                  void alert({
                    message: t('Remove {name}? Move its goods out first; its history stays.', { name: g.name }),
                    buttons: [{ text: t('Cancel'), role: 'cancel' }, { text: t('Remove'), role: 'destructive', handler: () => void saveGodowns((settings.godowns ?? []).map((x) => (x.id === g.id ? { ...x, deleted: true } : x))) }],
                  });
                }}
              />
            )}
          </IonItem>
        ))}
        {godowns.length === 0 && (
          <IonItem lines="none">
            <IonNote>{t('Add a godown to keep stock in more than one place: a back room, a warehouse.')}</IonNote>
          </IonItem>
        )}
      </IonList>

      {godowns.length > 0 && canMove && (
        <div className="ion-padding-horizontal">
          <IonButton expand="block" routerLink="/tabs/items/transfer">
            <IonIcon icon={swapHorizontalOutline} slot="start" /> {t('Move stock (godowns and stores)')}
          </IonButton>
        </div>
      )}
    </PageShell>
  );
}
