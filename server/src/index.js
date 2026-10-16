import { loadConfig } from './config.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp(config);

const shutdown = async signal => {
  app.log.info({ signal }, 'Shutting down');
  try { await app.close(); } finally { process.exit(0); }
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(`PocKeep is running on http://${config.host}:${config.port} (data: ${config.dataDir})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
