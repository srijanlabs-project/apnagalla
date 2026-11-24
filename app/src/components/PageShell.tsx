import { IonBackButton, IonButtons, IonContent, IonHeader, IonIcon, IonPage, IonRouterLink, IonTitle, IonToolbar } from '@ionic/react';
import { chevronDown } from 'ionicons/icons';
import type { ReactNode } from 'react';
import SyncBadge from './SyncBadge';

interface Props {
  title: string;
  backHref?: string;
  children: ReactNode;
  padded?: boolean;
  /** Makes the title a link with a ▾ (e.g. the store switcher on Home). */
  titleLink?: string;
}

export default function PageShell({ title, backHref, children, padded = true, titleLink }: Props) {
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          {backHref && (
            <IonButtons slot="start">
              <IonBackButton defaultHref={backHref} />
            </IonButtons>
          )}
          <IonTitle>
            {titleLink ? (
              <IonRouterLink routerLink={titleLink} color="dark" className="title-link">
                {title}
                <IonIcon icon={chevronDown} aria-hidden="true" />
              </IonRouterLink>
            ) : (
              title
            )}
          </IonTitle>
          <IonButtons slot="end">
            <SyncBadge />
          </IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent className={padded ? 'ion-padding' : undefined}>{children}</IonContent>
    </IonPage>
  );
}
