import type { Fix } from '@cbaw/core';

// Real walks, recorded on the phone so they can be replayed at 10× (for a demo video, or just
// to see how it went). Kept in this browser only, never sent anywhere; the last 3 are kept.

export interface RecordedTrack {
  /** Which walk link this track belongs to (see `trackKey`). */
  key: string;
  recordedAt: number;
  /** GPS fixes, `t` in ms since the first one. */
  fixes: Fix[];
}

const KEY = 'cbaw.tracks.v1';
const MAX_TRACKS = 3;
const MAX_FIXES = 4000; // about an hour at one fix per second

/** Short, stable id for a walk link. */
export function trackKey(walkData: string): string {
  let h = 2166136261;
  for (let i = 0; i < walkData.length; i++) {
    h ^= walkData.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function loadAll(): RecordedTrack[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecordedTrack[];
  } catch {
    return [];
  }
}

function saveAll(tracks: RecordedTrack[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tracks));
  } catch {
    // Storage full or unavailable: the walk itself is unaffected.
  }
}

export function loadTrack(key: string): RecordedTrack | null {
  return loadAll().find((t) => t.key === key) ?? null;
}

export function saveTrack(key: string, fixes: Fix[]) {
  if (fixes.length < 30) return; // not a walk worth replaying
  const first = fixes[0]!.t;
  const track: RecordedTrack = {
    key,
    recordedAt: Date.now(),
    fixes: fixes.slice(0, MAX_FIXES).map((f) => ({
      lat: Math.round(f.lat * 1e6) / 1e6,
      lon: Math.round(f.lon * 1e6) / 1e6,
      accuracy: Math.round(f.accuracy),
      t: f.t - first,
    })),
  };
  saveAll([...loadAll().filter((t) => t.key !== key), track].slice(-MAX_TRACKS));
}

export function forgetTrack(key: string) {
  saveAll(loadAll().filter((t) => t.key !== key));
}
