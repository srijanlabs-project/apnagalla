import { IonIcon, IonLabel, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs } from '@ionic/react';
import { cubeOutline, documentTextOutline, ellipsisHorizontal, homeOutline, peopleOutline } from 'ionicons/icons';
import { Navigate, Route } from 'react-router-dom';
import MoreScreen from './MoreScreen';
import { CustomersScreen, HomeScreen, InvoicesScreen, ItemsScreen } from './Placeholders';
import TeamScreen from './TeamScreen';

export default function MainTabs() {
  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route path="home" element={<HomeScreen />} />
        <Route path="invoices" element={<InvoicesScreen />} />
        <Route path="customers" element={<CustomersScreen />} />
        <Route path="items" element={<ItemsScreen />} />
        <Route path="more" element={<MoreScreen />} />
        <Route path="more/team" element={<TeamScreen />} />
        <Route index element={<Navigate to="home" replace />} />
      </IonRouterOutlet>
      <IonTabBar slot="bottom">
        <IonTabButton tab="home" href="/tabs/home">
          <IonIcon icon={homeOutline} />
          <IonLabel>Home</IonLabel>
        </IonTabButton>
        <IonTabButton tab="invoices" href="/tabs/invoices">
          <IonIcon icon={documentTextOutline} />
          <IonLabel>Invoices</IonLabel>
        </IonTabButton>
        <IonTabButton tab="customers" href="/tabs/customers">
          <IonIcon icon={peopleOutline} />
          <IonLabel>Customers</IonLabel>
        </IonTabButton>
        <IonTabButton tab="items" href="/tabs/items">
          <IonIcon icon={cubeOutline} />
          <IonLabel>Items</IonLabel>
        </IonTabButton>
        <IonTabButton tab="more" href="/tabs/more">
          <IonIcon icon={ellipsisHorizontal} />
          <IonLabel>More</IonLabel>
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
  );
}
