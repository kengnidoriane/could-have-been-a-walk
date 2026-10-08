import type { LatLon, LoopResult } from '@cbaw/core';

// Thin client for the local API (apps/api, proxied by Vite under /api).

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(
      "Can't reach the local API. Is it running? (pnpm dev starts it on port 8787.)",
      'api_unreachable',
      0,
    );
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  if (!res.ok) {
    throw new ApiError(
      data.message ?? `The local API answered ${res.status}.`,
      data.error ?? 'error',
      res.status,
    );
  }
  return data as T;
}

export interface LoopParams {
  start: LatLon;
  minutes: number;
  speedKmh: number;
  seed: number;
  bufferMin?: number;
}

export type LoopResponse = LoopResult & { elapsedMs: number };

export function fetchLoop(params: LoopParams, signal?: AbortSignal) {
  return post<LoopResponse>('/loop', params, signal);
}
