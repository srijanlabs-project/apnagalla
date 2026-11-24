import { IonApp, IonContent, IonPage, IonRouterOutlet, IonSpinner } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Navigate, Route } from 'react-router-dom';
import Splash from './components/Splash';
import { SessionProvider, useSession } from './lib/session';
import LoginScreen from './screens/auth/LoginScreen';
import MainTabs from './screens/main/MainTabs';
import OnboardingScreen from './screens/onboarding/OnboardingScreen';
import PausedScreen from './screens/stores/PausedScreen';

/**
 * Top-level gate:
 *   not logged in            -> Login (phone + OTP)
 *   no name / no business    -> Onboarding
 *   member of a business     -> Main tabs (router)
 */
function Gate() {
  const { status } = useSession();
  return (
    <>
      <Screens />
      <Splash ready={status !== 'loading'} />
    </>
  );
}

function Screens() {
  const { status, me, membership } = useSession();

  if (status === 'loading') {
    return (
      <IonPage>
        <IonContent className="ion-padding">
          <div className="center-fill">
            <IonSpinner />
          </div>
        </IonContent>
      </IonPage>
    );
  }
  if (status === 'signedOut' || !me) return <LoginScreen />;
  if (!me.user.name || !membership) return <OnboardingScreen />;
  if (membership.active === false) return <PausedScreen />;

  // Keyed by store: switching stores rebuilds every screen with that store's data.
  return (
    <IonReactRouter key={membership.businessId}>
      <IonRouterOutlet>
        <Route path="/tabs/*" element={<MainTabs />} />
        <Route path="*" element={<Navigate to="/tabs/home" replace />} />
      </IonRouterOutlet>
    </IonReactRouter>
  );
}

export default function App() {
  return (
    <IonApp>
      <SessionProvider>
        <Gate />
      </SessionProvider>
    </IonApp>
  );
}
