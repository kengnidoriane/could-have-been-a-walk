// Live check of Gemma scoring on the fake sample week: `pnpm --filter @cbaw/api try-score`
import { readFileSync } from 'node:fs';
import { parseIcs, scoreWalkabilityHeuristic } from '@cbaw/core';

const ics = readFileSync(new URL('../../../fixtures/sample-calendar.ics', import.meta.url), 'utf8');
const meetings = parseIcs(ics, { from: Date.UTC(2026, 9, 12), to: Date.UTC(2026, 9, 17) });
const api = process.env.API_URL ?? 'http://127.0.0.1:8787';

for (const m of meetings) {
  const t0 = performance.now();
  const res = await fetch(`${api}/api/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ meetings: [m] }),
  });
  const [s] = (
    (await res.json()) as {
      scores: {
        score: number;
        reason: string;
        source: string;
        kind: string;
        needsScreen: boolean;
      }[];
    }
  ).scores;
  const h = scoreWalkabilityHeuristic(m);
  console.log(
    `${String(s?.score).padStart(2)}/10 (rules ${String(h.score).padStart(2)}) ${Math.round(
      performance.now() - t0,
    )
      .toString()
      .padStart(
        6,
      )} ms  ${s?.source.padEnd(9)} ${m.title.padEnd(45)} ${s?.kind}${s?.needsScreen ? '+screen' : ''}: ${s?.reason}`,
  );
}
