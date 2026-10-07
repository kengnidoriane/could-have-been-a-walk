import { buildApp } from './app';
import { config } from './config';

const app = buildApp();

// Bound to loopback only: the calendar data this API sees must never leave the machine.
app.listen({ port: config.port, host: '127.0.0.1' }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
