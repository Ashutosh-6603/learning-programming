import dataSource from './database/data-source.js';

/** Applies pending migrations. Production runs this with plain `node dist/migrate.js`. */
await dataSource.initialize();
const applied = await dataSource.runMigrations();
await dataSource.destroy();
console.log(`migrations applied: ${applied.length}`);
