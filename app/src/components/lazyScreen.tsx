import { IonContent, IonPage, IonSpinner } from '@ionic/react';
import { lazy, Suspense, type ComponentType } from 'react';

/**
 * A screen whose code is downloaded the first time it is opened (then kept), so the app's first
 * download stays small. Shows a spinner for that moment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyScreen = ComponentType<any>;

export function lazyScreen(load: () => Promise<{ default: AnyScreen }>) {
  const Screen = lazy(load);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function LazyScreen(props: any) {
    return (
      <Suspense
        fallback={
          <IonPage>
            <IonContent>
              <div className="center-fill">
                <IonSpinner />
              </div>
            </IonContent>
          </IonPage>
        }
      >
        <Screen {...props} />
      </Suspense>
    );
  };
}
