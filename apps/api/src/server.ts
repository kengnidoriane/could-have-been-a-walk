import { buildApp } from './app';
import { config } from './config';
import { Ollama } from './llm/ollama';

const app = buildApp();

// Bound to loopback only: the calendar data this API sees must never leave the machine.
app
  .listen({ port: config.port, host: '127.0.0.1' })
  .then(async () => {
    // Load Gemma into memory now, so the first score doesn't wait for it.
    const model = await new Ollama({ host: config.ollamaHost, model: config.ollamaModel })
      .warmUp()
      .catch(() => null);
    app.log.info(model ? `Gemma ready: ${model}` : 'No Gemma model in Ollama: heuristics only');
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
