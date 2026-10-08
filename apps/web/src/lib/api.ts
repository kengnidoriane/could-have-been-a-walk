import type {
  AgendaSegment,
  LatLon,
  LoopResult,
  Meeting,
  Recap,
  WalkabilityScore,
} from '@cbaw/core';
import type { Source } from './store';

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

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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

export interface Health {
  ok: boolean;
  llm: { model: string | null; preferred: string; available: boolean };
}

export function fetchHealth(signal?: AbortSignal) {
  return request<Health>('/health', undefined, signal);
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
  return request<LoopResponse>('/loop', params, signal);
}

export interface ScoreResponse extends WalkabilityScore {
  id: string;
  source: Source;
  model?: string;
  ms?: number;
}

/** Only the fields the model needs leave the page, and only to localhost. */
export async function fetchScore(meeting: Meeting, signal?: AbortSignal): Promise<ScoreResponse> {
  const { id, title, description, location, durationMin, attendeeCount, hasVideoLink } = meeting;
  const { scores } = await request<{ scores: ScoreResponse[] }>(
    '/score',
    { meetings: [{ id, title, description, location, durationMin, attendeeCount, hasVideoLink }] },
    signal,
  );
  return scores[0]!;
}

export interface AgendaResponse {
  segments: AgendaSegment[];
  source: Source;
  model?: string;
  ms?: number;
}

export function fetchAgenda(meeting: Meeting, loop: LoopResult, signal?: AbortSignal) {
  return request<AgendaResponse>(
    '/agenda',
    {
      meeting: {
        title: meeting.title,
        description: meeting.description,
        durationMin: meeting.durationMin,
        attendeeCount: meeting.attendeeCount,
      },
      loop: {
        distanceM: loop.distanceM,
        durationMin: loop.durationMin,
        speedKmh: loop.speedKmh,
        landmarks: loop.landmarks,
        farthest: loop.farthest,
      },
    },
    signal,
  );
}

export interface RecapResponse {
  transcript: string;
  recap: Recap;
  source: Source;
  model?: string;
  transcribedBy?: string;
}

export function fetchRecap(body: {
  consent: true;
  title: string;
  notes?: string;
  audio?: string[];
}) {
  return request<RecapResponse>('/recap', body);
}
