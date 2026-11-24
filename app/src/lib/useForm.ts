import { useIonRouter, useIonToast } from '@ionic/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionError } from './repo';

/**
 * Local draft state for an edit form, seeded once from `initial` (when it first becomes available).
 * `save` runs the async action, shows a toast and optionally navigates back.
 */
export function useForm<T>(initial: T | undefined) {
  const [value, setValue] = useState<T | undefined>(initial);
  const seeded = useRef(initial !== undefined);
  useEffect(() => {
    if (!seeded.current && initial !== undefined) {
      seeded.current = true;
      setValue(initial);
    }
  }, [initial]);

  const [saving, setSaving] = useState(false);
  const [toast] = useIonToast();
  const router = useIonRouter();

  const patch = useCallback((p: Partial<T>) => setValue((v) => (v === undefined ? v : { ...v, ...p })), []);

  /** Merge into a nested object field (e.g. an address) against the latest state. */
  const patchIn = useCallback(
    <K extends keyof T>(key: K, p: Partial<NonNullable<T[K]>>) =>
      setValue((v) => (v == null ? v : { ...v, [key]: { ...(v[key] as object | null), ...p } })),
    [],
  );

  const save = useCallback(
    async (action: () => Promise<unknown>, opts: { message?: string; back?: boolean } = {}) => {
      setSaving(true);
      try {
        await action();
        if (opts.message) void toast({ message: opts.message, duration: 1500, position: 'top', color: 'success' });
        if (opts.back && router.canGoBack()) router.goBack();
        return true;
      } catch (e) {
        const message = e instanceof PermissionError || e instanceof Error ? e.message : 'Could not save';
        void toast({ message, duration: 2500, position: 'top', color: 'danger' });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [router, toast],
  );

  return { value, setValue, patch, patchIn, save, saving };
}
