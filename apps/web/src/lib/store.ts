import type { AgendaSegment, LatLon, LoopResult, Meeting, WalkabilityScore } from '@cbaw/core';
import { useSyncExternalStore } from 'react';

// Everything here stays in this browser tab. sessionStorage only survives a reload.

export interface Plan {
  loop: LoopResult;
  /** The request that produced the loop: a new start, pace or seed means a new loop. */
  start: LatLon;
  seed: number;
  speedKmh: number;
}

export type Source = 'gemma' | 'heuristic';

export interface ScoreEntry extends WalkabilityScore {
  source: Source;
  model?: string;
}

export interface AgendaEntry {
  /** Which loop this agenda was planned for (see `planKey`). */
  planKey: string;
  segments: AgendaSegment[];
  source: Source;
  model?: string;
}

export interface AppState {
  calendarName: string | null;
  meetings: Meeting[];
  plans: Record<string, Plan>;
  scores: Record<string, ScoreEntry>;
  agendas: Record<string, AgendaEntry>;
}

const KEY = 'cbaw.session.v2';
const EMPTY: AppState = { calendarName: null, meetings: [], plans: {}, scores: {}, agendas: {} };

function load(): AppState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<AppState>) };
  } catch {
    // Private mode or corrupted entry: start fresh.
  }
  return EMPTY;
}

let state: AppState = load();
const listeners = new Set<() => void>();

export function getState(): AppState {
  return state;
}

export function setState(update: (s: AppState) => AppState) {
  state = update(state);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable: the app still works for this session.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppState<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

export function setCalendar(name: string, meetings: Meeting[]) {
  setState(() => ({ ...EMPTY, calendarName: name, meetings }));
}

export function clearCalendar() {
  setState(() => EMPTY);
}

export function planKey(plan: Plan): string {
  return `${plan.seed}|${plan.speedKmh}|${plan.start.lat},${plan.start.lon}`;
}

export function savePlan(meetingId: string, plan: Plan) {
  setState((s) => ({ ...s, plans: { ...s.plans, [meetingId]: plan } }));
}

export function saveScore(meetingId: string, score: ScoreEntry) {
  setState((s) => ({ ...s, scores: { ...s.scores, [meetingId]: score } }));
}

export function saveAgenda(meetingId: string, agenda: AgendaEntry) {
  setState((s) => ({ ...s, agendas: { ...s.agendas, [meetingId]: agenda } }));
}
