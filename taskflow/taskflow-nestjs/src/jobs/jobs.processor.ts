import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { JobHandlers } from './job-handlers.service.js';
import { QUEUE_NAME } from './jobs.service.js';

/**
 * @Processor makes Nest start a BullMQ Worker for the queue and feed every job to process().
 * This class is only ever a provider of WorkerModule: the API process enqueues, it never consumes.
 */
@Processor(QUEUE_NAME, { concurrency: 5 })
export class JobsProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly handlers: JobHandlers,
    @InjectQueue(QUEUE_NAME) private readonly queue: Queue,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(JobsProcessor.name);
  }

  /** Idempotent: re-running on every start updates the schedule instead of duplicating it. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'scan-due-reminders',
      { pattern: '*/15 * * * *' },
      { name: 'scan-due-reminders', data: {} },
    );
    await this.queue.upsertJobScheduler(
      'cleanup-stale-uploads',
      { pattern: '0 * * * *' },
      { name: 'cleanup-stale-uploads', data: {} },
    );
  }

  process(job: Job): Promise<unknown> {
    return this.handlers.run(job.name, job.data);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.info({ job: job.name, id: job.id }, 'job completed');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.warn(
      { job: job?.name, id: job?.id, attempt: job?.attemptsMade, err },
      'job failed',
    );
  }
}
