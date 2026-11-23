import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;

export interface Database {
  db: DB;
  kind: 'postgres' | 'pglite';
  migrate(migrationsFolder: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Real Postgres when DATABASE_URL is set (Railway), otherwise an embedded
 * PGlite database (local dev) — or an in-memory one for tests (dataDir = "memory://").
 */
export async function openDatabase(opts: { databaseUrl?: string; pgliteDir: string }): Promise<Database> {
  if (opts.databaseUrl) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new Pool({ connectionString: opts.databaseUrl, max: 10 });
    const db = drizzle(pool, { schema });
    return {
      db,
      kind: 'postgres',
      migrate: (migrationsFolder) => migrate(db, { migrationsFolder }),
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const dataDir = opts.pgliteDir;
  if (!dataDir.startsWith('memory://')) mkdirSync(path.resolve(dataDir), { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  return {
    // Same query API as node-postgres; the cast keeps one DB type across the codebase.
    db: db as unknown as DB,
    kind: 'pglite',
    migrate: (migrationsFolder) => migrate(db, { migrationsFolder }),
    close: () => client.close(),
  };
}
