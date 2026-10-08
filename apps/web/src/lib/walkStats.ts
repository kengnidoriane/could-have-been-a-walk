import type { WalkRecord } from '@cbaw/core';

// Finished walks, kept on this device only (for the weekly mini-stat).

const KEY = 'cbaw.walks.v1';

export function loadWalks(): WalkRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as WalkRecord[];
  } catch {
    return [];
  }
}

export function saveWalk(record: WalkRecord) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...loadWalks(), record].slice(-200)));
  } catch {
    // Storage unavailable: nothing to keep.
  }
}
