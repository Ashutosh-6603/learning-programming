import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv, type Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { loggerOptions } from './infra/logger.js';
import { RedisModule } from './infra/redis.module.js';

/** What every process needs, API and worker alike: configuration, logging, Postgres, Redis. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        loggerOptions({ LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }) }),
    }),
    DatabaseModule,
    RedisModule,
  ],
})
export class CoreModule {}
