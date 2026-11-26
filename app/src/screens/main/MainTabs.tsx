import RecycleBinScreen from './RecycleBinScreen';
import ActivityScreen from './ActivityScreen';
import RemindersScreen from '../customers/RemindersScreen';
import ContactImportScreen from '../customers/ContactImportScreen';
import LoyaltyScreen from '../settings/LoyaltyScreen';
import Gstr2bScreen from '../reports/Gstr2bScreen';
import BooksScreen, { JournalScreen, LedgerScreen } from '../money/BooksScreens';
import OnlineStoreScreen from '../settings/OnlineStoreScreen';
import DayEndGate from '../../components/DayEndGate';
import { IonIcon, IonLabel, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs } from '@ionic/react';
import { cubeOutline, documentTextOutline, ellipsisHorizontal, homeOutline, peopleOutline } from 'ionicons/icons';
import { Navigate, Route } from 'react-router-dom';
import { BusinessProvider } from '../../lib/business';
import { t } from '../../lib/i18n';
import CustomerDetailScreen from '../customers/CustomerDetailScreen';
import CustomerEditScreen from '../customers/CustomerEditScreen';
import CustomersScreen from '../customers/CustomersScreen';
import DocDetailScreen from '../docs/DocDetailScreen';
import DocEditorScreen from '../docs/DocEditorScreen';
import SaleScreen from '../sale/SaleScreen';
import CategoriesScreen from '../items/CategoriesScreen';
import ImportScreen from '../items/ImportScreen';
import PrinterScreen from '../settings/PrinterScreen';
import AlertsScreen from '../settings/AlertsScreen';
import ProductListScreen from '../settings/ProductListScreen';
import LockSettingsScreen from '../settings/LockSettingsScreen';
import BackupScreen from '../settings/BackupScreen';
import PlanScreen from '../settings/PlanScreen';
import DocListScreen from '../docs/DocListScreen';
import ItemEditScreen from '../items/ItemEditScreen';
import ItemsScreen from '../items/ItemsScreen';
import LowStockScreen from '../items/LowStockScreen';
import SerialSearchScreen from '../items/SerialSearchScreen';
import { OfferEditScreen, OffersScreen } from '../items/OfferScreens';
import BulkPriceScreen from '../items/BulkPriceScreen';
import LabelsScreen from '../items/LabelsScreen';
import TransferScreen from '../items/TransferScreen';
import GodownsScreen from '../items/GodownsScreen';
import AllStoresScreen from '../stores/AllStoresScreen';
import { EmployeeScreen, EmployeesScreen } from '../staff/StaffScreens';
import StockScreen from '../items/StockScreen';
import BusinessProfileScreen from '../settings/BusinessProfileScreen';
import DesignScreen from '../settings/DesignScreen';
import InvoiceSettingsScreen from '../settings/InvoiceSettingsScreen';
import PaymentDetailsScreen from '../settings/PaymentDetailsScreen';
import StoresScreen from '../stores/StoresScreen';
import DevicesScreen from './DevicesScreen';
import MoreScreen from './MoreScreen';
import DeliveriesScreen, { HomeOrDeliveries } from './DeliveriesScreen';
import TeamScreen from './TeamScreen';
import ExpensesScreen from '../expenses/ExpensesScreen';
import CashBookScreen from '../cash/CashBookScreen';
import ChequesScreen from '../cash/ChequesScreen';
import { JobScreen, JobsScreen } from '../jobs/JobScreens';
import { ReportScreen, ReportsScreen } from '../reports/ReportsScreen';
import Gstr1Screen from '../reports/Gstr1Screen';
import TallyScreen from '../reports/TallyScreen';
import CustomReportScreen from '../reports/CustomReportScreen';
import BankScreen, { BankBookScreen } from '../money/BankScreens';
import IncomeScreen from '../money/IncomeScreen';
import LoansScreen, { LoanEditScreen, LoanScreen } from '../money/LoanScreens';
import { PurchaseDetailScreen, PurchaseEditScreen, PurchaseOrderScreen, PurchasesScreen } from '../purchases/PurchaseScreens';
import { SupplierDetailScreen, SupplierEditScreen, SuppliersScreen } from '../suppliers/SupplierScreens';

export default function MainTabs() {
  return (
    <BusinessProvider>
      <IonTabs>
        <IonRouterOutlet>
          <Route path="home" element={<HomeOrDeliveries />} />
          <Route path="deliveries" element={<DeliveriesScreen />} />
          <Route path="sale" element={<DayEndGate><SaleScreen /></DayEndGate>} />

          <Route path="invoices" element={<DocListScreen kind="invoice" />} />
          <Route path="invoices/new" element={<DayEndGate backHref="/tabs/invoices"><DocEditorScreen kind="invoice" /></DayEndGate>} />
          <Route path="invoices/:id" element={<DocDetailScreen kind="invoice" />} />
          <Route path="invoices/:id/edit" element={<DocEditorScreen kind="invoice" />} />
          <Route path="estimates" element={<DocListScreen kind="estimate" />} />
          <Route path="estimates/new" element={<DayEndGate backHref="/tabs/estimates"><DocEditorScreen kind="estimate" /></DayEndGate>} />
          <Route path="estimates/:id" element={<DocDetailScreen kind="estimate" />} />
          <Route path="estimates/:id/edit" element={<DocEditorScreen kind="estimate" />} />
          <Route path="credit-notes" element={<DocListScreen kind="credit" />} />
          <Route path="credit-notes/:id" element={<DocDetailScreen kind="credit" />} />
          <Route path="credit-notes/:id/edit" element={<DocEditorScreen kind="credit" />} />

          <Route path="customers" element={<CustomersScreen />} />
          <Route path="customers/new" element={<CustomerEditScreen />} />
          <Route path="customers/reminders" element={<RemindersScreen />} />
          <Route path="customers/import-contacts" element={<ContactImportScreen />} />
          <Route path="customers/:id" element={<CustomerDetailScreen />} />
          <Route path="customers/:id/edit" element={<CustomerEditScreen />} />

          <Route path="items" element={<ItemsScreen />} />
          <Route path="items/new" element={<ItemEditScreen />} />
          <Route path="items/categories" element={<CategoriesScreen />} />
          <Route path="items/import" element={<ImportScreen />} />
          <Route path="items/low-stock" element={<LowStockScreen />} />
          <Route path="items/serials" element={<SerialSearchScreen />} />
          <Route path="items/offers" element={<OffersScreen />} />
          <Route path="items/offers/:id" element={<OfferEditScreen />} />
          <Route path="items/bulk-price" element={<BulkPriceScreen />} />
          <Route path="items/labels" element={<LabelsScreen />} />
          <Route path="items/transfer" element={<TransferScreen />} />
          <Route path="items/godowns" element={<GodownsScreen />} />
          <Route path="items/:id/stock" element={<StockScreen />} />
          <Route path="items/:id" element={<ItemEditScreen />} />

          <Route path="suppliers" element={<SuppliersScreen />} />
          <Route path="suppliers/new" element={<SupplierEditScreen />} />
          <Route path="suppliers/:id" element={<SupplierDetailScreen />} />
          <Route path="suppliers/:id/edit" element={<SupplierEditScreen />} />
          <Route path="purchases" element={<PurchasesScreen />} />
          <Route path="purchases/new" element={<PurchaseEditScreen />} />
          <Route path="purchases/:id" element={<PurchaseDetailScreen />} />
          <Route path="purchases/:id/edit" element={<PurchaseEditScreen />} />
          <Route path="purchase-orders/new" element={<PurchaseOrderScreen />} />
          <Route path="purchase-orders/:id" element={<PurchaseOrderScreen />} />
          <Route path="expenses" element={<ExpensesScreen />} />
          <Route path="cash-book" element={<CashBookScreen />} />
          <Route path="bank" element={<BankScreen />} />
          <Route path="bank/:id" element={<BankBookScreen />} />
          <Route path="income" element={<IncomeScreen />} />
          <Route path="loans" element={<LoansScreen />} />
          <Route path="loans/new" element={<LoanEditScreen />} />
          <Route path="loans/:id/edit" element={<LoanEditScreen />} />
          <Route path="loans/:id" element={<LoanScreen />} />
          <Route path="cheques" element={<ChequesScreen />} />
          <Route path="jobs" element={<JobsScreen />} />
          <Route path="jobs/new" element={<JobScreen />} />
          <Route path="jobs/:id" element={<JobScreen />} />
          <Route path="reports" element={<ReportsScreen />} />
          <Route path="reports/gstr1" element={<Gstr1Screen />} />
          <Route path="reports/gstr2b" element={<Gstr2bScreen />} />
          <Route path="reports/tally" element={<TallyScreen />} />
          <Route path="reports/custom/:id" element={<CustomReportScreen />} />
          <Route path="reports/:id" element={<ReportScreen />} />

          <Route path="more" element={<MoreScreen />} />
          <Route path="more/team" element={<TeamScreen />} />
          <Route path="more/stores" element={<StoresScreen />} />
          <Route path="more/dashboard" element={<AllStoresScreen />} />
          <Route path="more/staff" element={<EmployeesScreen />} />
          <Route path="more/deleted" element={<RecycleBinScreen />} />
          <Route path="more/activity" element={<ActivityScreen />} />
          <Route path="more/staff/:id" element={<EmployeeScreen />} />
          <Route path="more/devices" element={<DevicesScreen />} />
          <Route path="more/printer" element={<PrinterScreen />} />
          <Route path="more/alerts" element={<AlertsScreen />} />
          <Route path="more/product-list" element={<ProductListScreen />} />
          <Route path="more/lock" element={<LockSettingsScreen />} />
          <Route path="more/backup" element={<BackupScreen />} />
          <Route path="more/plan" element={<PlanScreen />} />
          <Route path="more/business" element={<BusinessProfileScreen />} />
          <Route path="more/payment" element={<PaymentDetailsScreen />} />
          <Route path="more/invoice-settings" element={<InvoiceSettingsScreen />} />
          <Route path="more/design" element={<DesignScreen />} />
          <Route path="more/loyalty" element={<LoyaltyScreen />} />
          <Route path="books" element={<BooksScreen />} />
          <Route path="books/ledger/:account" element={<LedgerScreen />} />
          <Route path="books/journal/:id" element={<JournalScreen />} />
          <Route path="more/online-store" element={<OnlineStoreScreen />} />

          <Route index element={<Navigate to="home" replace />} />
        </IonRouterOutlet>
        <IonTabBar slot="bottom">
          <IonTabButton tab="home" href="/tabs/home">
            <IonIcon icon={homeOutline} />
            <IonLabel>{t('Home')}</IonLabel>
          </IonTabButton>
          <IonTabButton tab="invoices" href="/tabs/invoices">
            <IonIcon icon={documentTextOutline} />
            <IonLabel>{t('Invoices')}</IonLabel>
          </IonTabButton>
          <IonTabButton tab="customers" href="/tabs/customers">
            <IonIcon icon={peopleOutline} />
            <IonLabel>{t('Customers')}</IonLabel>
          </IonTabButton>
          <IonTabButton tab="items" href="/tabs/items">
            <IonIcon icon={cubeOutline} />
            <IonLabel>{t('Items')}</IonLabel>
          </IonTabButton>
          <IonTabButton tab="more" href="/tabs/more">
            <IonIcon icon={ellipsisHorizontal} />
            <IonLabel>{t('More')}</IonLabel>
          </IonTabButton>
        </IonTabBar>
      </IonTabs>
    </BusinessProvider>
  );
}
