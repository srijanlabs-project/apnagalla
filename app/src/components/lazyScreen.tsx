import { lazy, Suspense, type ComponentType } from 'react';

/**
 * A screen whose code is downloaded separately (so the app's first download stays small), then kept.
 *
 * Ionic's page stack must see exactly one IonPage per route: a loading IonPage that is then swapped
 * for the real one leaves the real page hidden (a white screen). So nothing is shown while the code
 * loads, and every such screen is fetched in the background shortly after start-up, so opening it is
 * instant.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyScreen = ComponentType<any>;

const loaders: Array<() => Promise<unknown>> = [];
let preloading = false;

/** Fetch every on-demand screen in the background (once), when the phone is idle. */
export function preloadScreens() {
  if (preloading) return;
  preloading = true;
  const run = async () => {
    for (const load of loaders) await load().catch(() => undefined);
  };
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) idle(() => void run());
  else setTimeout(() => void run(), 1500);
}

export function lazyScreen(load: () => Promise<{ default: AnyScreen }>) {
  let pending: Promise<{ default: AnyScreen }> | null = null;
  const once = () => (pending ??= load().catch((e) => {
    pending = null; // a failed download can be tried again
    throw e;
  }));
  loaders.push(once);
  const Screen = lazy(once);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function LazyScreen(props: any) {
    return (
      <Suspense fallback={null}>
        <Screen {...props} />
      </Suspense>
    );
  };
}
