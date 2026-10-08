import { z } from 'zod';

/** Anything went wrong with the model: unreachable, missing, or still invalid after a retry. */
export class LlmError extends Error {}

export interface ChatJsonRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
}

/** Token counts and timings of one model call, for logs and the write-up. */
export interface LlmStats {
  promptTokens: number;
  promptMs: number;
  outputTokens: number;
  outputMs: number;
}

export interface ChatJsonResult<T> {
  data: T;
  model: string;
  ms: number;
  attempts: number;
  stats?: LlmStats;
}

/** What the routes need from a local model. Ollama implements it; tests use a fake. */
export interface JsonLlm {
  resolveModel(): Promise<string | null>;
  chatJson<T>(request: ChatJsonRequest<T>): Promise<ChatJsonResult<T>>;
}

export interface OllamaOptions {
  host: string;
  /** Preferred model (OLLAMA_MODEL). */
  model: string;
  /** Used, in order, when the preferred model isn't pulled yet. */
  fallbacks?: string[];
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export const DEFAULT_FALLBACKS = ['gemma4:e2b', 'gemma4:e4b', 'gemma3:4b'];

/** Zod → JSON Schema for Ollama's `format`, which constrains decoding to that shape. */
export function toOllamaSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

const withTag = (name: string) => (name.includes(':') ? name : `${name}:latest`);

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export class Ollama implements JsonLlm {
  private resolved: { model: string | null; at: number } | null = null;
  private readonly host: string;

  constructor(private readonly options: OllamaOptions) {
    this.host = options.host.replace(/\/+$/, '');
  }

  async installedModels(): Promise<string[]> {
    const res = await this.request('/api/tags', { method: 'GET' }, 3000);
    const body = (await res.json()) as { models?: { name: string }[] };
    return (body.models ?? []).map((m) => m.name);
  }

  /** The preferred model if it is pulled, else the first pulled fallback. Cached for 30 s. */
  async resolveModel(): Promise<string | null> {
    if (this.resolved && Date.now() - this.resolved.at < 30_000) return this.resolved.model;
    let model: string | null;
    try {
      const installed = new Set((await this.installedModels()).map(withTag));
      const candidates = [this.options.model, ...(this.options.fallbacks ?? DEFAULT_FALLBACKS)];
      model = candidates.find((m) => installed.has(withTag(m))) ?? null;
    } catch {
      model = null;
    }
    this.resolved = { model, at: Date.now() };
    return model;
  }

  async chatJson<T>(request: ChatJsonRequest<T>): Promise<ChatJsonResult<T>> {
    const model = await this.resolveModel();
    if (!model) throw new LlmError('No Gemma model is available in Ollama.');

    const format = toOllamaSchema(request.schema);
    const messages: Message[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ];
    const startedAt = performance.now();
    let problem = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      const body = await this.chat({
        model,
        messages,
        format,
        stream: false,
        keep_alive: '30m',
        options: { temperature: attempt === 1 ? (request.temperature ?? 0.2) : 0 },
      });
      const content = body.message?.content ?? '';
      const stats: LlmStats = {
        promptTokens: body.prompt_eval_count ?? 0,
        promptMs: Math.round((body.prompt_eval_duration ?? 0) / 1e6),
        outputTokens: body.eval_count ?? 0,
        outputMs: Math.round((body.eval_duration ?? 0) / 1e6),
      };
      try {
        const parsed = request.schema.safeParse(JSON.parse(content));
        if (parsed.success) {
          const ms = Math.round(performance.now() - startedAt);
          return { data: parsed.data, model, ms, attempts: attempt, stats };
        }
        problem = z.prettifyError(parsed.error);
      } catch (err) {
        problem = `invalid JSON (${(err as Error).message})`;
      }
      messages.push(
        { role: 'assistant', content },
        {
          role: 'user',
          content: `That answer was not valid: ${problem}. Answer again with JSON only, matching the schema.`,
        },
      );
    }
    throw new LlmError(`The model's answer was still invalid after a retry: ${problem}`);
  }

  /** Load the model into memory so the first real request doesn't pay for it. */
  async warmUp(): Promise<string | null> {
    const model = await this.resolveModel();
    if (!model) return null;
    await this.request(
      '/api/generate',
      { method: 'POST', body: JSON.stringify({ model, prompt: '', keep_alive: '30m' }) },
      180_000,
    );
    return model;
  }

  private async chat(payload: object): Promise<OllamaChatResponse> {
    const res = await this.request(
      '/api/chat',
      { method: 'POST', body: JSON.stringify(payload) },
      this.options.timeoutMs ?? 90_000,
    );
    if (!res.ok) {
      this.resolved = null; // the model may have been removed: look again next time
      throw new LlmError(`Ollama answered HTTP ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as OllamaChatResponse;
  }

  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    try {
      return await (this.options.fetch ?? fetch)(`${this.host}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new LlmError(`Ollama is unreachable at ${this.host}: ${(err as Error).message}`);
    }
  }
}
