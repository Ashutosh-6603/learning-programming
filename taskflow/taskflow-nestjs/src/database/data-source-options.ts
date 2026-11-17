import type { DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities/index.js';
import { MIGRATIONS } from './migrations/index.js';
import { SnakeNamingStrategy } from './naming-strategy.js';

/** One definition of "how to reach the database", shared by the app, the CLI and the tests. */
export function dataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    namingStrategy: new SnakeNamingStrategy(),
    // The schema changes only through migrations, never by TypeORM guessing at startup.
    synchronize: false,
    poolSize: 10,
  };
}
