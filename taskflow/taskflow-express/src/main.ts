import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { closeInfra, createInfra, createServices } from './container.js';
import { RealtimeGateway } from './modules/realtime/gateway.js';

const config = loadConfig();
const infra = createInfra(config);
const services = createServices(infra);
const app = createApp(infra, services);

const server = createServer(app);
const gateway = new RealtimeGateway(
  infra.redis.duplicate(), // a Redis connection in SUBSCRIBE mode can't run other commands
  services.tickets,
  services.access,
  services.presence,
  services.realtime,
  infra.logger,
);
server.on('upgrade', (req, socket, head) => {
  gateway.handleUpgrade(req, socket, head);
});

server.listen(config.PORT, () => {
  infra.logger.info({ port: config.PORT }, 'taskflow-express listening');
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  infra.logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await gateway.close();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  await closeInfra(infra);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
