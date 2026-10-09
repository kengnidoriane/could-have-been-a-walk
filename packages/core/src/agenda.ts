import type { LoopResult } from './loop';
import { minutesForDistance } from './units';

/** A named place along the loop where an agenda segment can end. */
export interface Checkpoint {
  id: string;
  label: string;
  /** Minutes from the start at the planned pace. */
  minute: number;
  /** Metres along the loop. */
  along: number;
}

/**
 * What a model (or the fallback) proposes: topics in order, each with a weight (1 short,
 * 2 medium, 3 long). Placing the boundaries on the route is left to code: asked to pick the
 * checkpoints itself, Gemma 3 4B gave the main topic 3 minutes and the wrap-up 20.
 */
export interface RawSegment {
  topic: string;
  prompt: string;
  weight?: number;
}

export interface AgendaSegment {
  topic: string;
  /** One question or cue to open the segment; may be empty. */
  prompt: string;
  startMin: number;
  endMin: number;
  startAlong: number;
  endAlong: number;
  /** Where the segment ends, e.g. "Tubman Boulevard" or "back at the start". */
  untilLabel: string;
}

export const FINISH_ID = 'finish';
const WRAP_UP: RawSegment = {
  topic: 'Decisions & next steps',
  prompt: 'What did we decide, and who does what by when?',
  weight: 1,
};

export type LoopForAgenda = Pick<
  LoopResult,
  'distanceM' | 'durationMin' | 'landmarks' | 'farthest' | 'speedKmh'
>;

/**
 * Places along the loop an agenda can be pinned to: named streets, the turnaround point and
 * the finish. Checkpoints too close to each other (or to the start/finish) are merged.
 */
export function buildCheckpoints(loop: LoopForAgenda): Checkpoint[] {
  const total = loop.durationMin;
  const turnaround: Checkpoint = {
    id: 'turnaround',
    label: 'the turnaround point',
    minute: minutesForDistance(loop.farthest.along, loop.speedKmh),
    along: loop.farthest.along,
  };
  const named = loop.landmarks.map((l, i) => ({
    id: `c${i + 1}`,
    label: l.name,
    minute: l.minute,
    along: l.along,
  }));

  const kept: Checkpoint[] = [];
  for (const cp of [turnaround, ...named].sort((a, b) => a.minute - b.minute)) {
    if (cp.minute < 2 || cp.minute > total - 2) continue;
    const previous = kept[kept.length - 1];
    if (previous && cp.minute - previous.minute < 1.5) {
      // Prefer a street name over "the turnaround point" when both are at the same spot.
      if (previous.id === 'turnaround') kept[kept.length - 1] = cp;
      continue;
    }
    kept.push(cp);
  }
  // Streets without names (common outside city centres), or all of them early in the walk:
  // fill the gaps with time marks, so topics can end anywhere along the loop, not just in the
  // part that happens to have names.
  const near = Math.max(2, total * 0.15);
  for (const fraction of [0.25, 0.5, 0.75]) {
    const minute = total * fraction;
    if (kept.some((c) => Math.abs(c.minute - minute) < near)) continue;
    kept.push({
      id: `t${Math.round(fraction * 100)}`,
      label: `minute ${Math.round(minute)}`,
      minute,
      along: loop.distanceM * fraction,
    });
  }
  kept.sort((a, b) => a.minute - b.minute);
  kept.push({ id: FINISH_ID, label: 'back at the start', minute: total, along: loop.distanceM });
  return kept;
}

function toSegment(
  raw: { topic: string; prompt: string },
  from: { minute: number; along: number },
  to: Checkpoint,
): AgendaSegment {
  return {
    topic: raw.topic.trim(),
    prompt: raw.prompt.trim(),
    startMin: from.minute,
    endMin: to.minute,
    startAlong: from.along,
    endAlong: to.along,
    untilLabel: to.label,
  };
}

/**
 * Share the walk between topics in proportion to their weights, each boundary snapped to the
 * checkpoint closest to its ideal minute while keeping the order. The last topic always ends
 * at the finish.
 */
export function distributeTopics(topics: RawSegment[], checkpoints: Checkpoint[]): AgendaSegment[] {
  const finish = checkpoints[checkpoints.length - 1]!;
  const inner = checkpoints.slice(0, -1);
  const n = Math.max(1, Math.min(topics.length, inner.length + 1));
  const used = topics.slice(0, n);
  const weights = used.map((t) => Math.min(3, Math.max(1, Math.round(t.weight ?? 1))));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const segments: AgendaSegment[] = [];
  let from = { minute: 0, along: 0 };
  let nextIndex = 0;
  let weightSoFar = 0;

  for (let k = 0; k < n; k++) {
    weightSoFar += weights[k]!;
    let end = finish;
    if (k < n - 1) {
      const ideal = (finish.minute * weightSoFar) / totalWeight;
      // Leave enough checkpoints for the topics still to come.
      const last = inner.length - (n - 2 - k);
      let best = nextIndex;
      for (let i = nextIndex; i < last; i++) {
        if (Math.abs(inner[i]!.minute - ideal) < Math.abs(inner[best]!.minute - ideal)) best = i;
      }
      end = inner[best]!;
      nextIndex = best + 1;
    }
    segments.push(toSegment(used[k]!, from, end));
    from = end;
  }
  return segments;
}

/** A proposed agenda, cleaned (no empty topics, at most `max`) and laid out along the route. */
export function normalizeAgenda(
  raw: RawSegment[],
  checkpoints: Checkpoint[],
  max = 5,
): AgendaSegment[] {
  const topics = raw.filter((r) => r.topic.trim().length > 0).slice(0, max);
  return topics.length === 0 ? [] : distributeTopics(topics, checkpoints);
}

/** Agenda items written in a meeting description ("1. Status", "- Budget", …). */
export function extractAgendaItems(description: string): string[] {
  const lines = description
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const listed = lines
    .filter((l) => /^(\d+[.)]|[-*•])\s+/.test(l))
    .map((l) => l.replace(/^(\d+[.)]|[-*•])\s+/, '').trim());
  if (listed.length > 0) return listed.filter((l) => l.length >= 3).map((l) => l.slice(0, 80));

  return description
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim().replace(/[.!]$/, ''))
    .filter((s) => s.length > 8 && !/^(join|link|agenda)\b/i.test(s) && !/https?:\/\//.test(s))
    .slice(0, 3)
    .map((s) => s.slice(0, 80));
}

/** Deterministic agenda: the description's own items (or a sensible default), wrap-up last. */
export function agendaHeuristic(
  meeting: { title: string; description: string },
  checkpoints: Checkpoint[],
): AgendaSegment[] {
  const items = extractAgendaItems(meeting.description).slice(0, 3);
  const topics: RawSegment[] = items.map((topic) => ({ topic, prompt: '', weight: 2 }));
  if (topics.length === 0) {
    topics.push(
      { topic: 'Check-in', prompt: 'How is everyone doing?', weight: 1 },
      { topic: meeting.title, prompt: '', weight: 3 },
    );
  }
  const alreadyWrapsUp = /\b(next steps?|action items?|owners?|decisions?)\b/i.test(
    topics[topics.length - 1]!.topic,
  );
  if (!alreadyWrapsUp) topics.push(WRAP_UP);
  return distributeTopics(topics, checkpoints);
}
