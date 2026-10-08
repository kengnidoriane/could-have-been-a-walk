import { fileURLToPath } from 'node:url';
import type { WalkRouter } from '@cbaw/core';
import Fastify from 'fastify';
import { config } from './config';
import { Ollama, type JsonLlm } from './llm/ollama';
import { registerAgendaRoutes } from './routes/agenda';
import { registerLoopRoutes } from './routes/loop';
import { registerScoreRoutes } from './routes/score';
import { OsrmRouter } from './routing/osrm';

export interface AppDeps {
  router?: WalkRouter;
  llm?: JsonLlm;
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
  const llm = deps.llm ?? new Ollama({ host: config.ollamaHost, model: config.ollamaModel });

  app.get('/api/health', async () => {
    const model = await llm.resolveModel();
    return { ok: true, llm: { model, preferred: config.ollamaModel, available: model !== null } };
  });
  registerLoopRoutes(app, { router });
  registerScoreRoutes(app, { llm });
  registerAgendaRoutes(app, { llm });

  return app;
}
