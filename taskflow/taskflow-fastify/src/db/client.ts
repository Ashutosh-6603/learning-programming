import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as relations from './relations.js';
import * as tables from './schema.js';

export const schema = { ...tables, ...relations };

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };
/** The `tx` handed to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run a query: the pool-backed client or an open transaction. */
export type Db = Database | Tx;

export function createDb(databaseUrl: string): Database {
  return drizzle({ client: new pg.Pool({ connectionString: databaseUrl, max: 10 }), schema });
}
