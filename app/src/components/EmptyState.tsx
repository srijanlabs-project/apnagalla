import { IonIcon } from '@ionic/react';

interface Props {
  icon: string;
  title: string;
  text: string;
}

export default function EmptyState({ icon, title, text }: Props) {
  return (
    <div className="empty-state">
      <IonIcon icon={icon} />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
