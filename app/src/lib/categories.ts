import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Category } from './db';
import { t } from './i18n';
import { PermissionError, deleteRecord, newId, putRecord, type Actor } from './repo';

/** Paints › Emulsion › Interior is as deep as it goes. */
export const MAX_CATEGORY_DEPTH = 3;

export interface CategoryNode {
  cat: Category;
  depth: number;
  /** "Paints › Emulsion" */
  path: string;
}

export function useCategories(businessId: string): Category[] {
  return (
    useLiveQuery(
      () =>
        db.categories
          .where('businessId')
          .equals(businessId)
          .filter((c) => !c.deleted)
          .toArray(),
      [businessId],
    ) ?? []
  );
}

/** Depth-first list with paths, children sorted by name: for pickers and the manage screen. */
export function flattenCategories(cats: Category[]): CategoryNode[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of cats) {
    const k = c.parentId && cats.some((p) => p.id === c.parentId) ? c.parentId : null;
    byParent.set(k, [...(byParent.get(k) ?? []), c]);
  }
  const out: CategoryNode[] = [];
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const c of (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix} › ${c.name}` : c.name;
      out.push({ cat: c, depth, path });
      if (depth < MAX_CATEGORY_DEPTH) walk(c.id, depth + 1, path);
    }
  };
  walk(null, 1, '');
  return out;
}

/** The category and everything under it (to filter items by a category). */
export function withDescendants(id: string, cats: Category[]): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cats) if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) ids.add(c.id), (grew = true);
  }
  return ids;
}

function depthOf(id: string | null, cats: Category[]): number {
  let d = 0;
  for (let cur = cats.find((c) => c.id === id); cur && d < 10; cur = cats.find((c) => c.id === cur!.parentId)) d++;
  return d;
}

/** Add or rename a category (owner only). Names are unique among siblings; at most 3 levels. */
export async function saveCategory(actor: Actor, cats: Category[], input: { id?: string; name: string; parentId: string | null }): Promise<Category> {
  if (actor.role !== 'owner') throw new PermissionError(t('Only the owner can change categories'));
  const name = input.name.trim();
  if (!name) throw new PermissionError(t('Enter a name'));
  if (depthOf(input.parentId, cats) >= MAX_CATEGORY_DEPTH) throw new PermissionError(t('Categories go {levels} levels deep at most', { levels: MAX_CATEGORY_DEPTH }));
  const twin = cats.find((c) => c.id !== input.id && (c.parentId ?? null) === input.parentId && c.name.toLowerCase() === name.toLowerCase());
  if (twin) throw new PermissionError(t('{name} already exists here', { name }));
  const existing = input.id ? cats.find((c) => c.id === input.id) : undefined;
  return putRecord('categories', actor, { ...(existing ?? {}), id: input.id ?? newId(), name, parentId: input.parentId });
}

/** Only an empty category (no sub-categories, no items) can be deleted. */
export async function deleteCategory(actor: Actor, cats: Category[], id: string): Promise<void> {
  if (actor.role !== 'owner') throw new PermissionError(t('Only the owner can change categories'));
  if (cats.some((c) => c.parentId === id)) throw new PermissionError(t('Delete or move its sub-categories first'));
  const used = await db.items.where('businessId').equals(actor.businessId).filter((i) => i.categoryId === id && !i.deleted).count();
  if (used) throw new PermissionError(used === 1 ? t('1 item uses this category; move it first') : t('{count} items use this category; move them first', { count: used }));
  await deleteRecord('categories', actor, id);
}

/**
 * Finds or creates the category for a path like "Paints > Emulsion" (also accepts › or /).
 * `cats` is updated in place so a whole import creates each category once.
 */
export async function ensureCategoryPath(actor: Actor, cats: Category[], path: string): Promise<string | null> {
  const parts = path
    .split(/\s*(?:>|›|\/)\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, MAX_CATEGORY_DEPTH);
  let parent: string | null = null;
  for (const name of parts) {
    let found: Category | undefined = cats.find((c) => (c.parentId ?? null) === parent && c.name.toLowerCase() === name.toLowerCase());
    if (!found) {
      found = await saveCategory(actor, cats, { name, parentId: parent });
      cats.push(found);
    }
    parent = found.id;
  }
  return parent;
}
