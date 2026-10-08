import { useEffect, useState } from 'react';
import { fetchHealth, type Health } from './api';

export type ModelStatus =
  | { state: 'checking' }
  | { state: 'ready'; model: string; preferred: string }
  | { state: 'no-model'; preferred: string }
  | { state: 'no-api' };

/** Which local model is answering, refreshed every 30 s (e.g. right after `ollama pull`). */
export function useModelStatus(): ModelStatus {
  const [status, setStatus] = useState<ModelStatus>({ state: 'checking' });
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetchHealth()
        .then((h: Health) => {
          if (!alive) return;
          setStatus(
            h.llm.model
              ? { state: 'ready', model: h.llm.model, preferred: h.llm.preferred }
              : { state: 'no-model', preferred: h.llm.preferred },
          );
        })
        .catch(() => alive && setStatus({ state: 'no-api' }));
    void check();
    const id = setInterval(check, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return status;
}

/** "gemma3:4b" → "Gemma 3 4B", "gemma4:e2b" → "Gemma 4 E2B". */
export function prettyModel(model: string): string {
  const match = /^gemma(\d+)(n)?:?([\w.]+)?/i.exec(model);
  if (!match) return model;
  const [, version, n, size] = match;
  const sizeLabel = size && size !== 'latest' ? ` ${size.toUpperCase()}` : '';
  return `Gemma ${version}${n ?? ''}${sizeLabel}`;
}
