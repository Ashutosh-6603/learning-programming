import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Env } from './config/env.js';
import { CoreModule } from './core.module.js';
import { DEFAULT_USER, seedDefaultUser } from './modules/users/default-user.js';
import { UsersModule } from './modules/users/users.module.js';
import { UsersService } from './modules/users/users.service.js';

@Module({ imports: [CoreModule, UsersModule] })
class SeedModule {}

/** `npm run db:seed`: a standalone app (like the worker) that creates the default development user. */
const app = await NestFactory.createApplicationContext(SeedModule, { logger: false });
const config = app.get<ConfigService<Env, true>>(ConfigService);
if (config.get('NODE_ENV', { infer: true }) === 'production') {
  await app.close();
  throw new Error('Refusing to seed a production database');
}
const result = await seedDefaultUser(app.get(UsersService));
await app.close();
console.log(`default user ${DEFAULT_USER.email}: ${result}`);
