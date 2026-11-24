import { flushSync } from 'react-dom';

/**
 * Wrap Ionic input/change handlers so the state update is applied immediately.
 *
 * Ionic delivers typing as custom events (`ionInput`, `ionChange`). React treats state
 * updates from unknown events as normal priority and may apply them later, so a tap on
 * Save (or Enter) right after typing could run with the old values. A plain React
 * `onChange` is applied synchronously; this restores that behaviour.
 */
export function sync<A extends unknown[]>(fn: (...args: A) => void) {
  return (...args: A) => flushSync(() => fn(...args));
}
