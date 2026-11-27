import { IonButton, IonContent, IonModal } from '@ionic/react';
import { t } from '../lib/i18n';

export interface MenuItem {
  text: string;
  handler: () => void;
  /** Red: cancels or deletes something. */
  danger?: boolean;
}
export interface MenuGroup {
  title: string;
  items: MenuItem[];
}

/**
 * A bottom sheet of actions in named groups ("Share and print", "Other ways to pay"…), so a long
 * list of rarely used actions stays readable. Empty groups are left out.
 */
export default function ActionMenu({ isOpen, onClose, title, groups }: { isOpen: boolean; onClose: () => void; title?: string; groups: MenuGroup[] }) {
  const shown = groups.filter((g) => g.items.length > 0);
  return (
    <IonModal isOpen={isOpen} onDidDismiss={onClose} initialBreakpoint={0.75} breakpoints={[0, 0.75, 1]} className="action-menu">
      <IonContent>
        {title && <h2 className="action-menu-title">{title}</h2>}
        {shown.map((g) => (
          <section key={g.title} className="action-menu-group">
            <h3>{g.title}</h3>
            {g.items.map((it) => (
              <button
                key={it.text}
                type="button"
                className={it.danger ? 'action-menu-item danger' : 'action-menu-item'}
                onClick={() => {
                  onClose();
                  // Let the sheet close before an alert or a new page opens.
                  setTimeout(it.handler, 150);
                }}
              >
                {it.text}
              </button>
            ))}
          </section>
        ))}
        <div className="action-menu-close">
          <IonButton expand="block" fill="outline" color="medium" onClick={onClose}>
            {t('Close')}
          </IonButton>
        </div>
      </IonContent>
    </IonModal>
  );
}
