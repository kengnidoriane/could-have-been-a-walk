import { useSyncExternalStore } from 'react';

// Hash routing: works on any static host (GitHub Pages) and keeps the walk data in the
// fragment, which browsers never send to the server.

export interface Location {
  /** Path segments, e.g. ['route', '<meeting id>']. */
  segments: string[];
  params: URLSearchParams;
}

function read(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function parseLocation(hash: string): Location {
  const [path = '/', query = ''] = hash.split('?');
  return {
    segments: path.split('/').filter(Boolean).map(decodeURIComponent),
    params: new URLSearchParams(query),
  };
}

export function useLocation(): Location {
  const hash = useSyncExternalStore(subscribe, read, () => '/');
  return parseLocation(hash);
}

export function navigate(to: string) {
  window.location.hash = to;
}

export const paths = {
  plan: () => '/',
  route: (meetingId: string) => `/route/${encodeURIComponent(meetingId)}`,
  walk: (data: string) => `/walk?d=${data}`,
  recap: () => '/recap',
};
