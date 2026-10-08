import { scoreWalkabilityHeuristic, type Meeting } from '@cbaw/core';
import { useSyncExternalStore } from 'react';
import { fetchScore } from './api';
import { getState, saveScore } from './store';

// One meeting at a time, earliest first: on a laptop CPU each answer takes a few seconds, so
// the list fills in progressively instead of waiting for the whole week.

const queue: Meeting[] = [];
let current: string | null = null;
let paused = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function scoreMeetings(meetings: Meeting[]) {
  const scores = getState().scores;
  for (const m of meetings) {
    if (!scores[m.id] && m.id !== current && !queue.some((q) => q.id === m.id)) queue.push(m);
  }
  void pump();
}

export function cancelScoring() {
  queue.length = 0;
  notify();
}

/**
 * Ollama answers one request at a time. While a meeting is being planned, its agenda must not
 * wait behind the rest of the week: background scoring pauses after the current meeting.
 */
export function setScoringPaused(value: boolean) {
  paused = value;
  if (!paused) void pump();
}

async function pump() {
  if (current) return;
  while (queue.length > 0 && !paused) {
    const meeting = queue.shift()!;
    // The calendar may have been replaced meanwhile.
    if (!getState().meetings.some((m) => m.id === meeting.id)) continue;
    current = meeting.id;
    notify();
    try {
      const { score, reason, kind, needsScreen, source, model } = await fetchScore(meeting);
      saveScore(meeting.id, { score, reason, kind, needsScreen, source, model });
    } catch {
      // Local API down (or a static deploy without it): the rules still give an answer.
      saveScore(meeting.id, { ...scoreWalkabilityHeuristic(meeting), source: 'heuristic' });
    }
  }
  current = null;
  notify();
}

export interface ScoringStatus {
  current: string | null;
  queued: number;
}

let snapshot: ScoringStatus = { current: null, queued: 0 };

export function useScoringStatus(): ScoringStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => {
      if (snapshot.current !== current || snapshot.queued !== queue.length) {
        snapshot = { current, queued: queue.length };
      }
      return snapshot;
    },
  );
}
