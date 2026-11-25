import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { db, type DocLine } from './db';
import { applyOffers, offerRuns, sameOffers } from './offers';

/** Keeps a bill's offer discounts up to date as lines change. `enabled` = a bill still being made. */
export function useOffers(businessId: string, lines: DocLine[] | undefined, date: string | undefined, enabled: boolean, onChange: (lines: DocLine[]) => void) {
  const data = useLiveQuery(async () => {
    const offers = (await db.offers.where('businessId').equals(businessId).toArray()).filter((o) => offerRuns(o, date));
    if (!offers.length) return { offers, items: new Map(), cats: [] };
    const [items, cats] = await Promise.all([db.items.where('businessId').equals(businessId).toArray(), db.categories.where('businessId').equals(businessId).toArray()]);
    return { offers, items: new Map(items.map((i) => [i.id, i])), cats };
  }, [businessId, date]);
  useEffect(() => {
    if (!enabled || !lines || !data) return;
    // No offers running: still clear discounts left by an offer that has ended.
    const next = applyOffers(lines, data.offers, data.items, data.cats, date);
    if (!sameOffers(lines, next)) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lines, data, date]);
}
