import { IonBackButton, IonButtons, IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/react';
import type { ReactNode } from 'react';
import SyncBadge from './SyncBadge';

interface Props {
  title: string;
  backHref?: string;
  children: ReactNode;
  padded?: boolean;
}

export default function PageShell({ title, backHref, children, padded = true }: Props) {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          {backHref && (
            <IonButtons slot="start">
              <IonBackButton defaultHref={backHref} />
            </IonButtons>
          )}
          <IonTitle>{title}</IonTitle>
          <IonButtons slot="end">
            <SyncBadge />
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className={padded ? 'ion-padding' : undefined}>{children}</IonContent>
    </IonPage>
  );
}
