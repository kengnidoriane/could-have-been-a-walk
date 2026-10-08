export interface LatLon {
  lat: number;
  lon: number;
}

/** Mean Earth radius (IUGG), metres. */
export const EARTH_RADIUS_M = 6_371_008.8;
const M_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres. */
export function haversine(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from north in [0, 360). */
export function bearing(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const Δλ = toRad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point reached by walking `distanceM` from `p` along the great circle at `bearingDeg`. */
export function destination(p: LatLon, bearingDeg: number, distanceM: number): LatLon {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(p.lat);
  const λ1 = toRad(p.lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}

/**
 * Local flat projection around `origin`, in metres (x east, y north).
 * Accurate to well under a metre over the few kilometres a walking loop spans.
 */
function toXY(origin: LatLon, q: LatLon): [number, number] {
  return [
    (q.lon - origin.lon) * M_PER_DEG * Math.cos(toRad(origin.lat)),
    (q.lat - origin.lat) * M_PER_DEG,
  ];
}

/** A polyline with its cumulative distances precomputed. */
export interface Route {
  points: LatLon[];
  /** cum[i] = distance from points[0] to points[i] along the line, metres. */
  cum: number[];
  length: number;
}

export function makeRoute(points: LatLon[]): Route {
  if (points.length === 0) throw new Error('A route needs at least one point');
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1]! + haversine(points[i - 1]!, points[i]!));
  }
  return { points, cum, length: cum[cum.length - 1]! };
}

/** Index of the segment [i, i+1] that contains distance `d` (clamped to the route). */
function segmentAt(route: Route, d: number): number {
  let lo = 0;
  let hi = route.points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (route.cum[mid]! <= d) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Point at distance `d` along the route (clamped to [0, length]). */
export function pointAt(route: Route, d: number): LatLon {
  const { points, cum } = route;
  if (points.length === 1 || d <= 0) return points[0]!;
  if (d >= route.length) return points[points.length - 1]!;
  const i = segmentAt(route, d);
  const segLen = cum[i + 1]! - cum[i]!;
  const t = segLen > 0 ? (d - cum[i]!) / segLen : 0;
  const a = points[i]!;
  const b = points[i + 1]!;
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

/** The sub-polyline between distances `from` and `to` along the route. */
export function sliceRoute(route: Route, from: number, to: number): LatLon[] {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(route.length, Math.max(from, to));
  const out = [pointAt(route, a)];
  for (let i = 0; i < route.points.length; i++) {
    if (route.cum[i]! > a && route.cum[i]! < b) out.push(route.points[i]!);
  }
  out.push(pointAt(route, b));
  return out;
}

export interface Projection {
  /** Distance along the route of the closest point, metres. */
  along: number;
  /** Distance from the query point to the route, metres. */
  offset: number;
  point: LatLon;
}

/**
 * Closest point on the route to `p`. Pass a window (`from`/`to`, metres along the route)
 * to search only part of it: on a loop the start and the finish are the same place, so the
 * caller must say which one it means. Without a window, ties resolve to the start.
 */
export function projectOnRoute(
  route: Route,
  p: LatLon,
  window: { from?: number; to?: number } = {},
): Projection {
  const from = Math.max(0, window.from ?? 0);
  const to = Math.min(route.length, window.to ?? route.length);
  const { points, cum } = route;
  if (points.length === 1) {
    return { along: 0, offset: haversine(points[0]!, p), point: points[0]! };
  }

  let best: Projection | undefined;
  for (let i = 0; i < points.length - 1; i++) {
    const segLen = cum[i + 1]! - cum[i]!;
    if (cum[i + 1]! < from || cum[i]! > to) continue;
    const tMin = segLen > 0 ? Math.max(0, (from - cum[i]!) / segLen) : 0;
    const tMax = segLen > 0 ? Math.min(1, (to - cum[i]!) / segLen) : 0;

    const [ax, ay] = toXY(p, points[i]!);
    const [bx, by] = toXY(p, points[i + 1]!);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.min(tMax, Math.max(tMin, t));
    const offset = Math.hypot(ax + t * dx, ay + t * dy);

    // Near-ties (start vs finish of a loop) go to the earliest point in the window.
    if (!best || offset < best.offset - 1e-6) {
      const a = points[i]!;
      const b = points[i + 1]!;
      best = {
        along: cum[i]! + t * segLen,
        offset,
        point: { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t },
      };
    }
  }
  return (
    best ?? { along: from, offset: haversine(pointAt(route, from), p), point: pointAt(route, from) }
  );
}

/** Douglas–Peucker simplification; keeps the first and last points. */
export function simplify(points: LatLon[], toleranceM: number): LatLon[] {
  if (points.length <= 2) return points.slice();
  const origin = points[0]!;
  const xy = points.map((q) => toXY(origin, q));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = xy[first]!;
    const [bx, by] = xy[last]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    let maxDist = -1;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = xy[i]!;
      const dist =
        len > 0
          ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
          : Math.hypot(px - ax, py - ay);
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (index !== -1 && maxDist > toleranceM) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}
