import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closeInfra, createInfra, createServices } from './container.js';

const config = loadConfig();
const infra = createInfra(config);
const app = await buildApp(infra, createServices(infra));

closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
  if (err) app.log.error({ err }, 'crashed');
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await closeInfra(infra);
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });
