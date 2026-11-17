import { Worker } from 'bullmq';
import { loadConfig } from './config.js';
import { closeInfra, createInfra } from './container.js';
import { Mailer } from './jobs/mailer.js';
import { createProcessors, dispatch } from './jobs/processors.js';
import { Jobs, QUEUE_NAME } from './jobs/queue.js';

const config = loadConfig();
const infra = createInfra(config);
const mailer = new Mailer(config);
const processors = createProcessors({
  db: infra.db,
  storage: infra.storage,
  mailer,
  jobs: new Jobs(infra.queue),
  logger: infra.logger,
  frontendUrl: config.FRONTEND_URL,
});

// Idempotent: re-running on every start updates the schedule instead of duplicating it.
await infra.queue.upsertJobScheduler(
  'scan-due-reminders',
  { pattern: '*/15 * * * *' },
  { name: 'scan-due-reminders', data: {} },
);
await infra.queue.upsertJobScheduler(
  'cleanup-stale-uploads',
  { pattern: '0 * * * *' },
  { name: 'cleanup-stale-uploads', data: {} },
);

const worker = new Worker(QUEUE_NAME, dispatch(processors), {
  connection: infra.redis.duplicate(),
  concurrency: 5,
});

worker.on('completed', (job) => {
  infra.logger.info({ job: job.name, id: job.id }, 'job completed');
});
worker.on('failed', (job, err) => {
  infra.logger.warn({ job: job?.name, id: job?.id, attempt: job?.attemptsMade, err }, 'job failed');
});

infra.logger.info('taskflow-fastify worker started');

async function shutdown(signal: string): Promise<void> {
  infra.logger.info({ signal }, 'worker shutting down');
  await worker.close();
  mailer.close();
  await closeInfra(infra);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
