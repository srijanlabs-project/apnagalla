import { IonButton, IonIcon, IonItem, IonLabel, IonList, IonNote, useIonAlert, useIonToast } from '@ionic/react';
import { addOutline, folderOpenOutline } from 'ionicons/icons';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import { useBusiness } from '../../lib/business';
import { MAX_CATEGORY_DEPTH, deleteCategory, flattenCategories, saveCategory, useCategories } from '../../lib/categories';

/** Owner: build the category tree (up to 3 levels) items are filed under. */
export default function CategoriesScreen() {
  const { actor, isOwner } = useBusiness();
  const cats = useCategories(actor.businessId);
  const tree = flattenCategories(cats);
  const [alert] = useIonAlert();
  const [toast] = useIonToast();
  const fail = (e: unknown) => void toast({ message: e instanceof Error ? e.message : 'Could not save', duration: 2500, color: 'danger' });

  function ask(header: string, value: string, onOk: (name: string) => Promise<unknown>) {
    void alert({
      header,
      inputs: [{ name: 'name', value, placeholder: 'Name', attributes: { maxlength: 40, autocapitalize: 'words' } }],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Save', handler: (v: { name?: string }) => void onOk(v.name ?? '').catch(fail) },
      ],
    });
  }

  return (
    <PageShell title="Categories" backHref="/tabs/items" padded={false}>
      {!isOwner && <p className="section-note ion-padding">Only the owner can change categories.</p>}
      {tree.length === 0 ? (
        <EmptyState icon={folderOpenOutline} title="No categories yet" text="Group items, e.g. Paints › Emulsion › Interior. Up to 3 levels." />
      ) : (
        <IonList>
          {tree.map(({ cat, depth }) => (
            <IonItem key={cat.id} lines="full">
              <IonLabel style={{ paddingLeft: `${(depth - 1) * 20}px` }}>
                <h2>{cat.name}</h2>
              </IonLabel>
              {isOwner && (
                <>
                  {depth < MAX_CATEGORY_DEPTH && (
                    <IonButton slot="end" fill="clear" size="small" onClick={() => ask(`New under ${cat.name}`, '', (name) => saveCategory(actor, cats, { name, parentId: cat.id }))}>
                      + Sub
                    </IonButton>
                  )}
                  <IonButton
                    slot="end"
                    fill="clear"
                    size="small"
                    color="medium"
                    onClick={() =>
                      void alert({
                        header: cat.name,
                        buttons: [
                          { text: 'Rename', handler: () => ask('Rename', cat.name, (name) => saveCategory(actor, cats, { id: cat.id, name, parentId: cat.parentId })) },
                          { text: 'Delete', role: 'destructive', handler: () => void deleteCategory(actor, cats, cat.id).catch(fail) },
                          { text: 'Close', role: 'cancel' },
                        ],
                      })
                    }
                  >
                    Edit
                  </IonButton>
                </>
              )}
            </IonItem>
          ))}
        </IonList>
      )}
      {isOwner && (
        <div className="ion-padding">
          <IonButton expand="block" fill="outline" onClick={() => ask('New category', '', (name) => saveCategory(actor, cats, { name, parentId: null }))}>
            <IonIcon icon={addOutline} slot="start" /> Add category
          </IonButton>
          <IonNote>Tip: Import items from Excel creates categories from a column like “Paints &gt; Emulsion”.</IonNote>
        </div>
      )}
    </PageShell>
  );
}
