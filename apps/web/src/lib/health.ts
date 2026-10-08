import { useSyncExternalStore } from 'react';
import { fetchHealth } from './api';

export type ModelStatus =
  | { state: 'checking' }
  | { state: 'ready'; model: string; preferred: string }
  | { state: 'no-model'; preferred: string }
  | { state: 'no-api' };

// One shared check, refreshed every 30 s (e.g. right after `ollama pull`), for every component
// that wants to know which brain is answering.

let status: ModelStatus = { state: 'checking' };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function check() {
  try {
    const h = await fetchHealth();
    status = h.llm.model
      ? { state: 'ready', model: h.llm.model, preferred: h.llm.preferred }
      : { state: 'no-model', preferred: h.llm.preferred };
  } catch {
    status = { state: 'no-api' };
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    void check();
    timer = setInterval(check, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useModelStatus(): ModelStatus {
  return useSyncExternalStore(subscribe, () => status);
}

/** "gemma3:4b" → "Gemma 3 4B", "gemma4:e2b" → "Gemma 4 E2B". */
export function prettyModel(model: string): string {
  const match = /^gemma(\d+)(n)?:?([\w.]+)?/i.exec(model);
  if (!match) return model;
  const [, version, n, size] = match;
  const sizeLabel = size && size !== 'latest' ? ` ${size.toUpperCase()}` : '';
  return `Gemma ${version}${n ?? ''}${sizeLabel}`;
}
