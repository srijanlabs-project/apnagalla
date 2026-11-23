import { IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle } from '@ionic/react';
import { cubeOutline, documentTextOutline, peopleOutline } from 'ionicons/icons';
import EmptyState from '../../components/EmptyState';
import PageShell from '../../components/PageShell';
import { useSession } from '../../lib/session';

export function HomeScreen() {
  const { me, membership } = useSession();
  const first = me?.user.name?.split(' ')[0];
  return (
    <PageShell title={membership?.businessName ?? 'Home'}>
      <h2 className="greeting">Hi{first ? `, ${first}` : ''} 👋</h2>
      <div className="stat-grid">
        {[
          ['Sales this month', '₹0'],
          ['Received', '₹0'],
          ['Outstanding', '₹0'],
          ['Overdue', '0'],
        ].map(([label, value]) => (
          <IonCard key={label} className="stat-card">
            <IonCardHeader>
              <IonCardSubtitle>{label}</IonCardSubtitle>
              <IonCardTitle>{value}</IonCardTitle>
            </IonCardHeader>
          </IonCard>
        ))}
      </div>
      <IonCard>
        <IonCardContent>The dashboard fills up once you create invoices (milestone M2–M4).</IonCardContent>
      </IonCard>
    </PageShell>
  );
}

export function InvoicesScreen() {
  return (
    <PageShell title="Invoices">
      <EmptyState icon={documentTextOutline} title="No invoices yet" text="Creating invoices and estimates arrives in the next milestone (M2)." />
    </PageShell>
  );
}

export function CustomersScreen() {
  return (
    <PageShell title="Customers">
      <EmptyState icon={peopleOutline} title="No customers yet" text="Your customer list arrives in the next milestone (M2)." />
    </PageShell>
  );
}

export function ItemsScreen() {
  return (
    <PageShell title="Items">
      <EmptyState icon={cubeOutline} title="No items yet" text="Your product & service catalogue arrives in the next milestone (M2)." />
    </PageShell>
  );
}
