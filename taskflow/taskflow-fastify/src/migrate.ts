import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';

/** Applies pending migrations from ./drizzle. Production runs this with plain `node`. */
const db = createDb(loadConfig().DATABASE_URL);
await migrate(db, { migrationsFolder: 'drizzle' });
await db.$client.end();
console.log('migrations applied');
