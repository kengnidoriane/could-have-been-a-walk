import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LlmError, Ollama, toOllamaSchema } from '../src/llm/ollama';

const Answer = z.object({ score: z.number().int().min(0).max(10), reason: z.string() });

type Handler = (path: string, body: Record<string, unknown> | undefined) => unknown;

function fakeOllama(installed: string[], chat: Handler) {
  const calls: { path: string; body?: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : undefined;
    calls.push({ path, body });
    if (path === '/api/tags') {
      return Response.json({ models: installed.map((name) => ({ name })) });
    }
    return Response.json(chat(path, body));
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

const reply = (content: string) => ({ message: { role: 'assistant', content } });

describe('Ollama.resolveModel', () => {
  it('uses the preferred model when it is pulled', async () => {
    const { fetch } = fakeOllama(['gemma3:4b', 'gemma4:e4b'], () => ({}));
    const llm = new Ollama({ host: 'http://ollama', model: 'gemma4:e4b', fetch });
    expect(await llm.resolveModel()).toBe('gemma4:e4b');
  });

  it('falls back to Gemma 3 4B until Gemma 4 is pulled', async () => {
    const { fetch } = fakeOllama(['gemma3:4b', 'llama3:8b'], () => ({}));
    const llm = new Ollama({ host: 'http://ollama', model: 'gemma4:e4b', fetch });
    expect(await llm.resolveModel()).toBe('gemma3:4b');
  });

  it('treats a missing tag as :latest', async () => {
    const { fetch } = fakeOllama(['gemma4:latest'], () => ({}));
    const llm = new Ollama({ host: 'http://ollama', model: 'gemma4', fetch });
    expect(await llm.resolveModel()).toBe('gemma4');
  });

  it('answers null when Ollama is not running', async () => {
    const llm = new Ollama({
      host: 'http://ollama',
      model: 'gemma4:e4b',
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    expect(await llm.resolveModel()).toBeNull();
    await expect(llm.chatJson({ system: 's', user: 'u', schema: Answer })).rejects.toThrow(
      LlmError,
    );
  });
});

describe('Ollama.chatJson', () => {
  it('sends the JSON schema as `format` and validates the answer', async () => {
    const { fetch, calls } = fakeOllama(['gemma3:4b'], () =>
      reply('{"score": 9, "reason": "1:1, no screen needed"}'),
    );
    const llm = new Ollama({ host: 'http://ollama', model: 'gemma3:4b', fetch });
    const result = await llm.chatJson({ system: 'rate', user: 'meeting', schema: Answer });

    expect(result).toMatchObject({ data: { score: 9 }, model: 'gemma3:4b', attempts: 1 });
    const chat = calls.find((c) => c.path === '/api/chat')!.body!;
    expect(chat.stream).toBe(false);
    expect(chat.think).toBe(false);
    expect(chat.format).toEqual(toOllamaSchema(Answer));
    expect(chat.format).not.toHaveProperty('$schema');
    expect(chat.messages).toEqual([
      { role: 'system', content: 'rate' },
      { role: 'user', content: 'meeting' },
    ]);
  });

  it('retries once when the answer is invalid, telling the model what was wrong', async () => {
    let n = 0;
    const { fetch, calls } = fakeOllama(['gemma3:4b'], () =>
      reply(n++ === 0 ? '{"score": 42, "reason": "too high"}' : '{"score": 4, "reason": "ok"}'),
    );
    const llm = new Ollama({ host: 'http://ollama', model: 'gemma3:4b', fetch });
    const result = await llm.chatJson({ system: 's', user: 'u', schema: Answer });

    expect(result).toMatchObject({ data: { score: 4 }, attempts: 2 });
    const retry = calls.filter((c) => c.path === '/api/chat')[1]!.body!;
    const messages = retry.messages as { role: string; content: string }[];
    expect(messages.at(-1)!.content).toMatch(/not valid/);
    expect((retry.options as { temperature: number }).temperature).toBe(0);
  });

  it('gives up after the retry so the caller can fall back', async () => {
    const { fetch } = fakeOllama(['gemma3:4b'], () => reply('Sure! Here is the JSON: {'));
    const llm = new Ollama({ host: 'http://ollama', model: 'gemma3:4b', fetch });
    await expect(llm.chatJson({ system: 's', user: 'u', schema: Answer })).rejects.toThrow(
      /still invalid/,
    );
  });
});
