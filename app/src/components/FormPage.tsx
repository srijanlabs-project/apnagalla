import { IonBackButton, IonButton, IonButtons, IonContent, IonFooter, IonHeader, IonPage, IonSpinner, IonTitle, IonToolbar } from '@ionic/react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  backHref: string;
  children: ReactNode;
  /** Shows a sticky Save button when provided. */
  onSave?: () => unknown;
  saveLabel?: string;
  saving?: boolean;
  canSave?: boolean;
  headerEnd?: ReactNode;
}

/** Page with back button and a sticky bottom save bar — used by all edit screens. */
export default function FormPage({ title, backHref, children, onSave, saveLabel = 'Save', saving, canSave = true, headerEnd }: Props) {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonButtons slot="start">
            <IonBackButton defaultHref={backHref} />
          </IonButtons>
          <IonTitle>{title}</IonTitle>
          {headerEnd && <IonButtons slot="end">{headerEnd}</IonButtons>}
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding form-content">{children}</IonContent>
      {onSave && (
        <IonFooter className="save-bar">
          <IonToolbar>
            <IonButton expand="block" onClick={() => void onSave()} disabled={!canSave || saving}>
              {saving ? <IonSpinner name="dots" /> : saveLabel}
            </IonButton>
          </IonToolbar>
        </IonFooter>
      )}
    </IonPage>
  );
}
