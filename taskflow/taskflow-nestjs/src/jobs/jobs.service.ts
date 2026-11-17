import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';

export const QUEUE_NAME = 'taskflow';

export interface JobData {
  'send-invitation-email': {
    email: string;
    workspaceName: string;
    inviterName: string;
    token: string;
  };
  'send-due-reminder': { taskId: string };
  'delete-storage-prefix': { prefix: string };
  'scan-due-reminders': Record<string, never>;
  'cleanup-stale-uploads': Record<string, never>;
}

export type JobName = keyof JobData;

export const RETRY: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000, jitter: 0.5 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** The typed facade services use; they never touch BullMQ directly. */
@Injectable()
export class Jobs {
  constructor(@InjectQueue(QUEUE_NAME) private readonly queue: Queue) {}

  async enqueue<N extends JobName>(name: N, data: JobData[N]): Promise<void> {
    await this.queue.add(name, data);
  }
}
