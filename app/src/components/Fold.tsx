import { IonIcon } from '@ionic/react';
import { chevronDownOutline, chevronUpOutline } from 'ionicons/icons';
import { useEffect, useState, type ReactNode } from 'react';

/** A closed section with a one-line header: keeps long forms short until the extra fields are wanted. */
export default function Fold({ title, note, open: startOpen = false, children }: { title: string; note?: string; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(startOpen);
  // Something that must be seen (e.g. a prescription needed) opens it.
  useEffect(() => {
    if (startOpen) setOpen(true);
  }, [startOpen]);
  return (
    <div className={`fold${open ? ' fold-open' : ''}`}>
      <button type="button" className="fold-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>
          <strong>{title}</strong>
          {note && !open && <small>{note}</small>}
        </span>
        <IonIcon icon={open ? chevronUpOutline : chevronDownOutline} />
      </button>
      {open && <div className="fold-body">{children}</div>}
    </div>
  );
}
