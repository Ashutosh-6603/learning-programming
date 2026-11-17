import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { JobHandlersModule } from './jobs/job-handlers.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { JobsProcessor } from './jobs/jobs.processor.js';

/** The worker process's root module: no controllers, no gateway, no HTTP at all. */
@Module({
  imports: [CoreModule, JobsModule, JobHandlersModule],
  providers: [JobsProcessor],
})
export class WorkerModule {}
