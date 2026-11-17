import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';

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

export function createQueue(connection: Redis): Queue {
  return new Queue(QUEUE_NAME, { connection, defaultJobOptions: RETRY });
}

/** The typed facade services use; they never touch BullMQ directly. */
export class Jobs {
  constructor(private readonly queue: Queue) {}

  async enqueue<N extends JobName>(name: N, data: JobData[N]): Promise<void> {
    await this.queue.add(name, data);
  }
}
