import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch {
  // No .env file: defaults below apply.
}

export const config = {
  port: Number(process.env.API_PORT ?? 8787),
  ollamaHost: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
  ollamaModel: process.env.OLLAMA_MODEL ?? 'gemma4:e4b',
  osrmBaseUrl: process.env.OSRM_BASE_URL ?? 'https://routing.openstreetmap.de/routed-foot',
};
