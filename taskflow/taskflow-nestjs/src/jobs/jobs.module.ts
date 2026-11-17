import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../infra/redis.module.js';
import { Jobs, QUEUE_NAME, RETRY } from './jobs.service.js';

/** The producing side of the queue: everything a service needs to enqueue a job. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({ connection: redis }),
    }),
    BullModule.registerQueue({ name: QUEUE_NAME, defaultJobOptions: RETRY }),
  ],
  providers: [Jobs],
  exports: [Jobs, BullModule],
})
export class JobsModule {}
