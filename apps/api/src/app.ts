import { fileURLToPath } from 'node:url';
import type { WalkRouter } from '@cbaw/core';
import Fastify from 'fastify';
import { config } from './config';
import { registerLoopRoutes } from './routes/loop';
import { OsrmRouter } from './routing/osrm';

export interface AppDeps {
  router?: WalkRouter;
}

export function buildApp(deps: AppDeps = {}) {
  const app = Fastify({
    logger: process.env.VITEST ? false : { level: process.env.LOG_LEVEL ?? 'info' },
  });

  const router =
    deps.router ??
    new OsrmRouter({
      baseUrl: config.osrmBaseUrl,
      cacheDir: fileURLToPath(new URL('../.cache/osrm/', import.meta.url)),
    });

  app.get('/api/health', async () => ({ ok: true }));
  registerLoopRoutes(app, { router });

  return app;
}
