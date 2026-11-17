import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

// A standalone application: the DI container without an HTTP server.
const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
const logger = app.get(Logger);
app.useLogger(logger);
// On SIGTERM, Nest closes the BullMQ worker (it finishes its active jobs first), then the connections.
app.enableShutdownHooks();
logger.log('taskflow-nestjs worker started');
