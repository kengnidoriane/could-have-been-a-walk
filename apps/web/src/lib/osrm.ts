import { decodePolyline, type LatLon } from '@cbaw/core';

// The phone asks the routing server for one thing only: the shortest walk back to the start,
// when it starts to matter. No other call leaves the walk page (besides map tiles).

const BASE = (
  (import.meta.env.VITE_OSRM_BASE_URL as string | undefined) ??
  'https://routing.openstreetmap.de/routed-foot'
).replace(/\/+$/, '');

export interface WayBack {
  from: LatLon;
  distanceM: number;
  points: LatLon[];
}

export async function fetchWayBack(
  from: LatLon,
  to: LatLon,
  signal?: AbortSignal,
): Promise<WayBack> {
  const coords = [from, to].map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const res = await fetch(`${BASE}/route/v1/foot/${coords}?overview=full&geometries=polyline`, {
    signal,
  });
  const body = (await res.json()) as {
    code: string;
    routes?: { distance: number; geometry: string }[];
  };
  const route = body.routes?.[0];
  if (body.code !== 'Ok' || !route) throw new Error(`No way back: ${body.code}`);
  return { from, distanceM: route.distance, points: [from, ...decodePolyline(route.geometry)] };
}
