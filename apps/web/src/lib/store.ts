import type { LatLon, LoopResult, Meeting } from '@cbaw/core';
import { useSyncExternalStore } from 'react';

// Everything here stays in this browser tab. sessionStorage only survives a reload.

export interface Plan {
  loop: LoopResult;
  /** The request that produced the loop: a new start, pace or seed means a new loop. */
  start: LatLon;
  seed: number;
  speedKmh: number;
}

export interface AppState {
  calendarName: string | null;
  meetings: Meeting[];
  plans: Record<string, Plan>;
}

const KEY = 'cbaw.session.v1';

function load(): AppState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as AppState;
  } catch {
    // Private mode or corrupted entry: start fresh.
  }
  return { calendarName: null, meetings: [], plans: {} };
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
  setState(() => ({ calendarName: name, meetings, plans: {} }));
}

export function clearCalendar() {
  setState(() => ({ calendarName: null, meetings: [], plans: {} }));
}

export function savePlan(meetingId: string, plan: Plan) {
  setState((s) => ({ ...s, plans: { ...s.plans, [meetingId]: plan } }));
}
