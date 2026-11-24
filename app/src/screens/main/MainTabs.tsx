import { IonIcon, IonLabel, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs } from '@ionic/react';
import { cubeOutline, documentTextOutline, ellipsisHorizontal, homeOutline, peopleOutline } from 'ionicons/icons';
import { Navigate, Route } from 'react-router-dom';
import { BusinessProvider } from '../../lib/business';
import CustomerDetailScreen from '../customers/CustomerDetailScreen';
import CustomerEditScreen from '../customers/CustomerEditScreen';
import CustomersScreen from '../customers/CustomersScreen';
import DocDetailScreen from '../docs/DocDetailScreen';
import DocEditorScreen from '../docs/DocEditorScreen';
import SaleScreen from '../sale/SaleScreen';
import DocListScreen from '../docs/DocListScreen';
import ItemEditScreen from '../items/ItemEditScreen';
import ItemsScreen from '../items/ItemsScreen';
import BusinessProfileScreen from '../settings/BusinessProfileScreen';
import DesignScreen from '../settings/DesignScreen';
import InvoiceSettingsScreen from '../settings/InvoiceSettingsScreen';
import PaymentDetailsScreen from '../settings/PaymentDetailsScreen';
import StoresScreen from '../stores/StoresScreen';
import DevicesScreen from './DevicesScreen';
import MoreScreen from './MoreScreen';
import { HomeScreen } from './Placeholders';
import TeamScreen from './TeamScreen';

export default function MainTabs() {
  return (
    <BusinessProvider>
      <IonTabs>
        <IonRouterOutlet>
          <Route path="home" element={<HomeScreen />} />
          <Route path="sale" element={<SaleScreen />} />

          <Route path="invoices" element={<DocListScreen kind="invoice" />} />
          <Route path="invoices/new" element={<DocEditorScreen kind="invoice" />} />
          <Route path="invoices/:id" element={<DocDetailScreen kind="invoice" />} />
          <Route path="invoices/:id/edit" element={<DocEditorScreen kind="invoice" />} />
          <Route path="estimates" element={<DocListScreen kind="estimate" />} />
          <Route path="estimates/new" element={<DocEditorScreen kind="estimate" />} />
          <Route path="estimates/:id" element={<DocDetailScreen kind="estimate" />} />
          <Route path="estimates/:id/edit" element={<DocEditorScreen kind="estimate" />} />
          <Route path="credit-notes" element={<DocListScreen kind="credit" />} />
          <Route path="credit-notes/:id" element={<DocDetailScreen kind="credit" />} />
          <Route path="credit-notes/:id/edit" element={<DocEditorScreen kind="credit" />} />

          <Route path="customers" element={<CustomersScreen />} />
          <Route path="customers/new" element={<CustomerEditScreen />} />
          <Route path="customers/:id" element={<CustomerDetailScreen />} />
          <Route path="customers/:id/edit" element={<CustomerEditScreen />} />

          <Route path="items" element={<ItemsScreen />} />
          <Route path="items/new" element={<ItemEditScreen />} />
          <Route path="items/:id" element={<ItemEditScreen />} />

          <Route path="more" element={<MoreScreen />} />
          <Route path="more/team" element={<TeamScreen />} />
          <Route path="more/stores" element={<StoresScreen />} />
          <Route path="more/devices" element={<DevicesScreen />} />
          <Route path="more/business" element={<BusinessProfileScreen />} />
          <Route path="more/payment" element={<PaymentDetailsScreen />} />
          <Route path="more/invoice-settings" element={<InvoiceSettingsScreen />} />
          <Route path="more/design" element={<DesignScreen />} />

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
    </BusinessProvider>
  );
}
