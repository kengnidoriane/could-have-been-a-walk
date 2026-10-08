import { DEFAULT_SPEED_KMH, type LatLon } from '@cbaw/core';
import { useSyncExternalStore } from 'react';

// Per-device preferences, kept in localStorage. Never sent anywhere except the start point,
// which the routing server needs to draw a loop.

export interface Office extends LatLon {
  label: string;
}

export interface Preferences {
  office: Office;
  speedKmh: number;
}

/** Demo default: downtown Monrovia, where the street grid makes clean loops. */
export const DEMO_OFFICE: Office = {
  lat: 6.3106,
  lon: -10.8047,
  label: 'Downtown Monrovia (demo)',
};

const KEY = 'cbaw.prefs.v1';
const DEFAULTS: Preferences = { office: DEMO_OFFICE, speedKmh: DEFAULT_SPEED_KMH };

function load(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    // ignore
  }
  return DEFAULTS;
}

let prefs = load();
const listeners = new Set<() => void>();

export function setPreferences(update: Partial<Preferences>) {
  prefs = { ...prefs, ...update };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
  );
}
