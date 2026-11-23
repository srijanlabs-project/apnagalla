import path from 'node:path';
import { buildApp } from './app';
import { openDatabase } from './db/client';
import { loadEnv } from './env';

const env = loadEnv();
const database = await openDatabase({ databaseUrl: env.DATABASE_URL, pgliteDir: env.PGLITE_DIR });
await database.migrate(path.resolve(env.MIGRATIONS_DIR));

const app = await buildApp({ env, database });
app.log.info(`Database: ${database.kind}; OTP provider: ${env.OTP_PROVIDER}${env.OTP_FIXED_CODE && env.NODE_ENV !== 'production' ? ' (fixed dev code)' : ''}`);

const shutdown = async () => {
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
