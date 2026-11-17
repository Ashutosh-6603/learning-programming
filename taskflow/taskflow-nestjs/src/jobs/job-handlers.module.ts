import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from '../database/entities/attachment.entity.js';
import { Task } from '../database/entities/task.entity.js';
import { StorageModule } from '../infra/storage.module.js';
import { JobHandlers } from './job-handlers.service.js';
import { JobsModule } from './jobs.module.js';
import { Mailer } from './mailer.service.js';

/** The consuming side's logic, without a worker: importable by the worker process and by tests. */
@Module({
  imports: [TypeOrmModule.forFeature([Task, Attachment]), StorageModule, JobsModule],
  providers: [JobHandlers, Mailer],
  exports: [JobHandlers],
})
export class JobHandlersModule {}
