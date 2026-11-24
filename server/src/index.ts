import path from 'node:path';
import { buildApp } from './app';
import { openDatabase } from './db/client';
import { loadEnv } from './env';

const env = loadEnv();
const database = await openDatabase({ databaseUrl: env.DATABASE_URL, pgliteDir: env.PGLITE_DIR });
await database.migrate(path.resolve(env.MIGRATIONS_DIR));

const app = await buildApp({ env, database });
app.log.info(`Database: ${database.kind}; OTP provider: ${env.OTP_PROVIDER}`);
if (env.OTP_FIXED_CODE && env.OTP_PROVIDER === 'console') {
  app.log.warn('OTP_FIXED_CODE is set: every number accepts the same code. Test use only — remove before real users.');
}

const shutdown = async () => {
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
