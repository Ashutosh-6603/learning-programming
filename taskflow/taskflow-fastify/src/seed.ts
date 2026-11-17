import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { DEFAULT_USER, seedDefaultUser } from './modules/users/default-user.js';
import { UsersRepository } from './modules/users/users.repository.js';

/** `npm run db:seed`: creates the default development user (idempotent). */
const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
const db = createDb(config.DATABASE_URL);
const result = await seedDefaultUser(new UsersRepository(db));
await db.$client.end();
console.log(`default user ${DEFAULT_USER.email}: ${result}`);
