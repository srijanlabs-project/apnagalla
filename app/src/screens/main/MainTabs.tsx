import { HomeCardsScreen, ToCollectScreen, UrgentDeliveriesScreen } from './HomeExtras';
import DayEndGate from '../../components/DayEndGate';
import SyncNotices from '../../components/SyncNotices';
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
import DocListScreen from '../docs/DocListScreen';
import ItemEditScreen from '../items/ItemEditScreen';
import ItemsScreen from '../items/ItemsScreen';
import MoreScreen from './MoreScreen';
import DeliveriesScreen, { HomeOrDeliveries } from './DeliveriesScreen';
import ExpensesScreen from '../expenses/ExpensesScreen';
import CashBookScreen from '../cash/CashBookScreen';
import { lazyScreen } from '../../components/lazyScreen';

// Less-used screens load when first opened, so the app starts faster on slow phones.
const RecycleBinScreen = lazyScreen(() => import('./RecycleBinScreen'));
const MessageOrderScreen = lazyScreen(() => import('../sale/MessageOrderScreen'));
const FullBackupScreen = lazyScreen(() => import('../settings/FullBackupScreen'));
const ActivityScreen = lazyScreen(() => import('./ActivityScreen'));
const RemindersScreen = lazyScreen(() => import('../customers/RemindersScreen'));
const VisitsScreen = lazyScreen(() => import('../customers/VisitsScreen'));
const CratesScreen = lazyScreen(() => import('../customers/CratesScreen'));
const AssetsScreen = lazyScreen(() => import('../money/AssetsScreen'));
const ContactImportScreen = lazyScreen(() => import('../customers/ContactImportScreen'));
const LoyaltyScreen = lazyScreen(() => import('../settings/LoyaltyScreen'));
const RentalsScreen = lazyScreen(() => import('../money/ExtrasScreens').then((m) => ({ default: m.RentalsScreen })));
const SchemesScreen = lazyScreen(() => import('../money/ExtrasScreens').then((m) => ({ default: m.SchemesScreen })));
const VouchersScreen = lazyScreen(() => import('../money/ExtrasScreens').then((m) => ({ default: m.VouchersScreen })));
const Gstr2bScreen = lazyScreen(() => import('../reports/Gstr2bScreen'));
const BooksScreen = lazyScreen(() => import('../money/BooksScreens'));
const JournalScreen = lazyScreen(() => import('../money/BooksScreens').then((m) => ({ default: m.JournalScreen })));
const LedgerScreen = lazyScreen(() => import('../money/BooksScreens').then((m) => ({ default: m.LedgerScreen })));
const OnlineStoreScreen = lazyScreen(() => import('../settings/OnlineStoreScreen'));
const CategoriesScreen = lazyScreen(() => import('../items/CategoriesScreen'));
const ImportScreen = lazyScreen(() => import('../items/ImportScreen'));
const PrinterScreen = lazyScreen(() => import('../settings/PrinterScreen'));
const AlertsScreen = lazyScreen(() => import('../settings/AlertsScreen'));
const ProductListScreen = lazyScreen(() => import('../settings/ProductListScreen'));
const LockSettingsScreen = lazyScreen(() => import('../settings/LockSettingsScreen'));
const BackupScreen = lazyScreen(() => import('../settings/BackupScreen'));
const PlanScreen = lazyScreen(() => import('../settings/PlanScreen'));
const LowStockScreen = lazyScreen(() => import('../items/LowStockScreen'));
const SerialSearchScreen = lazyScreen(() => import('../items/SerialSearchScreen'));
const OfferEditScreen = lazyScreen(() => import('../items/OfferScreens').then((m) => ({ default: m.OfferEditScreen })));
const OffersScreen = lazyScreen(() => import('../items/OfferScreens').then((m) => ({ default: m.OffersScreen })));
const BulkPriceScreen = lazyScreen(() => import('../items/BulkPriceScreen'));
const LabelsScreen = lazyScreen(() => import('../items/LabelsScreen'));
const TransferScreen = lazyScreen(() => import('../items/TransferScreen'));
const GodownsScreen = lazyScreen(() => import('../items/GodownsScreen'));
const RatesScreen = lazyScreen(() => import('../items/FreshScreens').then((m) => ({ default: m.RatesScreen })));
const WastageScreen = lazyScreen(() => import('../items/FreshScreens').then((m) => ({ default: m.WastageScreen })));
const JewelleryScreen = lazyScreen(() => import('../items/TradeScreens').then((m) => ({ default: m.JewelleryScreen })));
const RecipesScreen = lazyScreen(() => import('../items/TradeScreens').then((m) => ({ default: m.RecipesScreen })));
const AllStoresScreen = lazyScreen(() => import('../stores/AllStoresScreen'));
const EmployeeScreen = lazyScreen(() => import('../staff/StaffScreens').then((m) => ({ default: m.EmployeeScreen })));
const EmployeesScreen = lazyScreen(() => import('../staff/StaffScreens').then((m) => ({ default: m.EmployeesScreen })));
const StockScreen = lazyScreen(() => import('../items/StockScreen'));
const BusinessProfileScreen = lazyScreen(() => import('../settings/BusinessProfileScreen'));
const DesignScreen = lazyScreen(() => import('../settings/DesignScreen'));
const InvoiceSettingsScreen = lazyScreen(() => import('../settings/InvoiceSettingsScreen'));
const PaymentDetailsScreen = lazyScreen(() => import('../settings/PaymentDetailsScreen'));
const StoresScreen = lazyScreen(() => import('../stores/StoresScreen'));
const DevicesScreen = lazyScreen(() => import('./DevicesScreen'));
const TeamScreen = lazyScreen(() => import('./TeamScreen'));
const ChequesScreen = lazyScreen(() => import('../cash/ChequesScreen'));
const JobScreen = lazyScreen(() => import('../jobs/JobScreens').then((m) => ({ default: m.JobScreen })));
const JobsScreen = lazyScreen(() => import('../jobs/JobScreens').then((m) => ({ default: m.JobsScreen })));
const ReportScreen = lazyScreen(() => import('../reports/ReportsScreen').then((m) => ({ default: m.ReportScreen })));
const ReportsScreen = lazyScreen(() => import('../reports/ReportsScreen').then((m) => ({ default: m.ReportsScreen })));
const Gstr1Screen = lazyScreen(() => import('../reports/Gstr1Screen'));
const TallyScreen = lazyScreen(() => import('../reports/TallyScreen'));
const CustomReportScreen = lazyScreen(() => import('../reports/CustomReportScreen'));
const BankScreen = lazyScreen(() => import('../money/BankScreens'));
const BankBookScreen = lazyScreen(() => import('../money/BankScreens').then((m) => ({ default: m.BankBookScreen })));
const IncomeScreen = lazyScreen(() => import('../money/IncomeScreen'));
const LoansScreen = lazyScreen(() => import('../money/LoanScreens'));
const LoanEditScreen = lazyScreen(() => import('../money/LoanScreens').then((m) => ({ default: m.LoanEditScreen })));
const LoanScreen = lazyScreen(() => import('../money/LoanScreens').then((m) => ({ default: m.LoanScreen })));
const PurchaseDetailScreen = lazyScreen(() => import('../purchases/PurchaseScreens').then((m) => ({ default: m.PurchaseDetailScreen })));
const PurchaseEditScreen = lazyScreen(() => import('../purchases/PurchaseScreens').then((m) => ({ default: m.PurchaseEditScreen })));
const PurchaseOrderScreen = lazyScreen(() => import('../purchases/PurchaseScreens').then((m) => ({ default: m.PurchaseOrderScreen })));
const PurchasesScreen = lazyScreen(() => import('../purchases/PurchaseScreens').then((m) => ({ default: m.PurchasesScreen })));
const SupplierDetailScreen = lazyScreen(() => import('../suppliers/SupplierScreens').then((m) => ({ default: m.SupplierDetailScreen })));
const SupplierEditScreen = lazyScreen(() => import('../suppliers/SupplierScreens').then((m) => ({ default: m.SupplierEditScreen })));
const SuppliersScreen = lazyScreen(() => import('../suppliers/SupplierScreens').then((m) => ({ default: m.SuppliersScreen })));

export default function MainTabs() {
  return (
    <BusinessProvider>
      <SyncNotices />
      <IonTabs>
        <IonRouterOutlet>
          <Route path="home" element={<HomeOrDeliveries />} />
          <Route path="deliveries" element={<DeliveriesScreen />} />
          <Route path="sale" element={<DayEndGate><SaleScreen /></DayEndGate>} />
          <Route path="message-order" element={<MessageOrderScreen />} />

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
          <Route path="customers/visits" element={<VisitsScreen />} />
          <Route path="assets" element={<AssetsScreen />} />
          <Route path="to-collect" element={<ToCollectScreen />} />
          <Route path="deliveries/urgent" element={<UrgentDeliveriesScreen />} />
          <Route path="more/home-cards" element={<HomeCardsScreen />} />
          <Route path="assets/crates" element={<CratesScreen />} />
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
          <Route path="items/rates" element={<RatesScreen />} />
          <Route path="items/wastage" element={<WastageScreen />} />
          <Route path="items/recipes" element={<RecipesScreen />} />
          <Route path="more/jewellery" element={<JewelleryScreen />} />
          <Route path="items/:id/stock" element={<StockScreen />} />
          <Route path="items/:id" element={<ItemEditScreen />} />

          <Route path="suppliers" element={<SuppliersScreen />} />
          <Route path="suppliers/schemes" element={<SchemesScreen />} />
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
          <Route path="more/full-backup" element={<FullBackupScreen />} />
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
          <Route path="vouchers" element={<VouchersScreen />} />
          <Route path="rentals" element={<RentalsScreen />} />
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
