import type { Item } from './db';

/**
 * R11: matches the items read from a customer's message with the shop's own items. A line takes the
 * item whose name shares the most words with it (aliases in Hindi and other languages come from
 * the catalogue's names on the item when it was picked from the product list). No match = a free
 * line to price by hand.
 */

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ൿ ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

export function matchOrderLines(lines: { name: string; qty: number; unit: string }[], items: Item[]) {
  const index = items.map((it) => ({ it, w: new Set(words(`${it.name} ${it.code ?? ''}`)) }));
  return lines.map((l) => {
    const want = words(l.name);
    let best: { it: Item; score: number } | null = null;
    for (const { it, w } of index) {
      const hit = want.filter((x) => w.has(x) || [...w].some((y) => y.startsWith(x) || x.startsWith(y))).length;
      if (!hit) continue;
      // Prefer items covering more of the asked words, then shorter names (less extra).
      const score = hit / want.length - w.size * 0.01;
      if (!best || score > best.score) best = { it, score };
    }
    return { name: l.name, qty: l.qty > 0 ? l.qty : 1, unit: l.unit, item: best && best.score >= 0.49 ? best.it : null };
  });
}
