import { destination, haversine, makeRoute, projectOnRoute, type LatLon } from './geo';
import {
  DEFAULT_BUFFER_MIN,
  DEFAULT_SPEED_KMH,
  distanceForMinutes,
  minutesForDistance,
} from './units';

/** A named street the route starts following at `along` metres. */
export interface RouteStep {
  name: string;
  along: number;
  location: LatLon;
}

export interface RoutedPath {
  points: LatLon[];
  distanceM: number;
  steps: RouteStep[];
  /** How far each waypoint had to move to reach a walkable way, metres (if the router says). */
  snapDistancesM?: number[];
}

/** Anything that can route a walker through waypoints: OSRM, GraphHopper, a test double. */
export interface WalkRouter {
  route(waypoints: LatLon[]): Promise<RoutedPath>;
}

export interface LoopRequest {
  start: LatLon;
  /** Meeting length, minutes. */
  minutes: number;
  bufferMin?: number;
  speedKmh?: number;
  /** Accepted relative error on distance (and so on walking time). Default 0.05. */
  tolerance?: number;
  /** Seed for the random initial bearing; same seed, same loop. */
  seed?: number;
  maxCallsPerBearing?: number;
  maxBearings?: number;
  /** Hard cap on routing calls across all bearings. */
  maxCalls?: number;
  /** Called after every routing attempt; handy for tracing the search. */
  onProbe?: (probe: LoopProbe) => void;
}

export interface LoopProbe {
  bearing: number;
  radiusM: number;
  /** Router distance before dead ends were cut; undefined if the router failed. */
  rawDistanceM?: number;
  distanceM?: number;
  error?: number;
  failure?: string;
}

export interface Landmark {
  name: string;
  along: number;
  point: LatLon;
  /** Minutes from the start at the planned pace. */
  minute: number;
}

export interface LoopResult {
  points: LatLon[];
  distanceM: number;
  /** Walking time at the planned pace, minutes. */
  durationMin: number;
  targetDistanceM: number;
  targetMin: number;
  speedKmh: number;
  /** (distance - target) / target */
  error: number;
  withinTolerance: boolean;
  /** Share of the route walked twice (dead ends, out-and-back). */
  overlapRatio: number;
  landmarks: Landmark[];
  /** Farthest point from the start: the natural place to turn around. */
  farthest: { along: number; point: LatLon; distanceM: number };
  bearing: number;
  radiusM: number;
  routingCalls: number;
}

export class NoLoopError extends Error {}
/** The routing service is unreachable or unwell: retrying other directions won't help. */
export class RouterUnavailableError extends Error {}

/**
 * A square inscribed in a circle of radius `radiusM` that passes through the start.
 * The circle's centre lies `radiusM` away from the start at `bearingDeg`, so the walk heads
 * out in that direction and comes back from the other side, without retracing its steps.
 */
export function loopWaypoints(start: LatLon, bearingDeg: number, radiusM: number): LatLon[] {
  const center = destination(start, bearingDeg, radiusM);
  const back = bearingDeg + 180; // from the centre, the start lies this way
  return [
    start,
    destination(center, back + 90, radiusM),
    destination(center, back + 180, radiusM),
    destination(center, back + 270, radiusM),
    start,
  ];
}

/** Square perimeter / radius, times a typical street-network detour factor. */
const METRES_PER_RADIUS = 4 * Math.SQRT2 * 1.3;

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Share of the length made of segments walked more than once (either direction). */
export function overlapRatio(points: LatLon[]): number {
  const key = (p: LatLon) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
  const seen = new Map<string, { count: number; length: number }>();
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = key(points[i - 1]!);
    const b = key(points[i]!);
    if (a === b) continue;
    const length = haversine(points[i - 1]!, points[i]!);
    total += length;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    const entry = seen.get(k) ?? { count: 0, length };
    entry.count++;
    seen.set(k, entry);
  }
  if (total === 0) return 0;
  let repeated = 0;
  for (const { count, length } of seen.values()) if (count > 1) repeated += count * length;
  return repeated / total;
}

/** Named streets along the way, spaced out, away from the start/finish. */
export function extractLandmarks(
  steps: RouteStep[],
  routeLength: number,
  speedKmh: number,
  { minSpacingM = 150, max = 6 } = {},
): Landmark[] {
  const candidates: Landmark[] = [];
  let lastName = '';
  for (const step of steps) {
    const name = step.name.trim();
    if (!name || name === lastName) continue;
    lastName = name;
    if (step.along < routeLength * 0.05 || step.along > routeLength * 0.95) continue;
    if (candidates.some((c) => c.name === name)) continue;
    const previous = candidates[candidates.length - 1];
    if (previous && step.along - previous.along < minSpacingM) continue;
    candidates.push({
      name,
      along: step.along,
      point: step.location,
      minute: minutesForDistance(step.along, speedKmh),
    });
  }
  if (candidates.length <= max) return candidates;
  // Keep `max` landmarks spread evenly along the route.
  return Array.from(
    { length: max },
    (_, i) => candidates[Math.round((i * (candidates.length - 1)) / (max - 1))]!,
  );
}

const samePoint = (a: LatLon, b: LatLon) =>
  Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;

/**
 * Cut short out-and-back detours: a path that goes A, …, X, …, A becomes A when walking to X
 * and back is at most `maxSpurM` in total. Those are routing artefacts (a waypoint snapped
 * into an alley). Longer out-and-backs ("down to the beach and back") are kept: in a sparse
 * street network they are what makes a loop the right length.
 */
export function removeSpurs(points: LatLon[], maxSpurM = 150): LatLon[] {
  const path = points.filter((p, i) => i === 0 || !samePoint(points[i - 1]!, p));
  let changed = true;
  while (changed) {
    changed = false;
    for (let tip = 1; tip < path.length - 1; tip++) {
      if (!samePoint(path[tip - 1]!, path[tip + 1]!)) continue;
      // Widen the spur while the way back retraces the way in.
      let k = 1;
      while (
        tip - k - 1 >= 0 &&
        tip + k + 1 < path.length &&
        samePoint(path[tip - k - 1]!, path[tip + k + 1]!)
      ) {
        k++;
      }
      let length = 0;
      for (let i = tip - k; i < tip; i++) length += haversine(path[i]!, path[i + 1]!);
      if (2 * length <= maxSpurM) {
        path.splice(tip - k + 1, 2 * k);
        changed = true;
        break;
      }
    }
  }
  return path;
}

/**
 * The router's path without its short dead-end detours. Steps that were on a removed spur
 * are dropped; the others are re-measured along the cleaned path.
 */
export function cleanPath(path: RoutedPath, maxSpurM = 150): RoutedPath {
  const before = makeRoute(path.points).length;
  const points = removeSpurs(path.points, maxSpurM);
  if (points.length === path.points.length || before === 0) return path;
  const route = makeRoute(points);

  const scale = path.distanceM / before;
  const steps: RouteStep[] = [];
  let from = 0;
  for (const step of path.steps) {
    const projection = projectOnRoute(route, step.location, { from });
    if (projection.offset > 20) continue;
    steps.push({ ...step, along: projection.along * scale });
    from = projection.along;
  }
  return { points, distanceM: route.length * scale, steps };
}

function farthestPoint(points: LatLon[]): LoopResult['farthest'] {
  const route = makeRoute(points);
  let best = { along: 0, point: points[0]!, distanceM: 0 };
  points.forEach((point, i) => {
    const distanceM = haversine(points[0]!, point);
    if (distanceM > best.distanceM) best = { along: route.cum[i]!, point, distanceM };
  });
  return best;
}

interface Candidate {
  path: RoutedPath;
  bearing: number;
  radiusM: number;
  error: number;
  overlap: number;
}

/**
 * Lower is better. Any loop within tolerance beats any loop outside it; among those, the one
 * that retraces its steps the least wins.
 */
function score(c: Candidate, tolerance: number): number {
  return (Math.abs(c.error) <= tolerance ? 0 : 1) + Math.abs(c.error) + c.overlap;
}

/** Good enough to stop searching: right length, mostly a real loop. */
const isGoodEnough = (c: Candidate, tolerance: number) =>
  Math.abs(c.error) <= tolerance && c.overlap <= 0.25;

/**
 * Find a walking loop from `start` whose length matches the meeting.
 *
 * For each bearing, a bounded search adjusts the radius: proportional steps until the target
 * is bracketed, then regula falsi inside the bracket. Street networks make distance(radius)
 * only roughly monotonic (a few metres of radius can snap a waypoint onto another street),
 * so every probe is kept and the best one wins. Short dead-end detours are cut from every
 * probe before it is measured.
 */
export async function findLoop(router: WalkRouter, request: LoopRequest): Promise<LoopResult> {
  const speedKmh = request.speedKmh ?? DEFAULT_SPEED_KMH;
  const bufferMin = request.bufferMin ?? DEFAULT_BUFFER_MIN;
  const tolerance = request.tolerance ?? 0.05;
  const maxCallsPerBearing = request.maxCallsPerBearing ?? 4;
  const maxBearings = Math.min(8, request.maxBearings ?? 6);
  const budget = { remaining: request.maxCalls ?? 12 };

  const targetMin = request.minutes - bufferMin;
  if (targetMin < 5) throw new NoLoopError('Meeting too short for a walk.');
  const target = distanceForMinutes(targetMin, speedKmh);

  const random = mulberry32(request.seed ?? Math.floor(Math.random() * 2 ** 31));
  const firstBearing = random() * 360;
  // Opposite directions first: if one side is the sea, the other side probably isn't.
  const bearings = [0, 180, 90, 270, 45, 225, 135, 315]
    .slice(0, maxBearings)
    .map((offset) => (firstBearing + offset) % 360);

  const candidates: Candidate[] = [];
  let calls = 0;
  let lastError: unknown;
  // Metres of route per metre of radius, learned from each probe to aim the next bearing better.
  const ratios: number[] = [];

  for (const bearing of bearings) {
    const metresPerRadius =
      ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : METRES_PER_RADIUS;
    let radius = target / metresPerRadius;
    let below: { r: number; d: number } | undefined;
    let above: { r: number; d: number } | undefined;

    for (let i = 0; i < maxCallsPerBearing && budget.remaining > 0; i++) {
      budget.remaining--;
      calls++;
      let path: RoutedPath;
      let rawDistanceM: number;
      try {
        const raw = await router.route(loopWaypoints(request.start, bearing, radius));
        rawDistanceM = raw.distanceM;
        path = cleanPath(raw);
      } catch (err) {
        if (err instanceof RouterUnavailableError) throw err;
        lastError = err;
        request.onProbe?.({ bearing, radiusM: radius, failure: String(err) });
        break; // this direction is a dead end (river, ocean…): try the next bearing
      }
      const error = (path.distanceM - target) / target;
      request.onProbe?.({
        bearing,
        radiusM: radius,
        rawDistanceM,
        distanceM: path.distanceM,
        error,
      });
      if (path.distanceM > 0) ratios.push(path.distanceM / radius);
      candidates.push({
        path,
        bearing,
        radiusM: radius,
        error,
        overlap: overlapRatio(path.points),
      });
      if (isGoodEnough(candidates[candidates.length - 1]!, tolerance)) break;
      // Waypoints that had to jump far to reach a path were in water or private land: the
      // loop collapses onto whatever road skirts it. Don't polish this direction, move on.
      const snaps = path.snapDistancesM?.slice(1, -1) ?? [];
      if (snaps.some((d) => d > Math.max(60, 0.5 * radius))) break;

      if (path.distanceM < target) {
        if (!below || radius > below.r) below = { r: radius, d: path.distanceM };
      } else if (!above || radius < above.r) {
        above = { r: radius, d: path.distanceM };
      }

      let next: number;
      if (below && above && below.r < above.r) {
        const gap = above.r - below.r;
        next =
          above.d !== below.d
            ? below.r + ((target - below.d) * gap) / (above.d - below.d)
            : below.r + gap / 2;
        next = Math.min(above.r - 0.1 * gap, Math.max(below.r + 0.1 * gap, next));
      } else if (below && above) {
        next = (below.r + above.r) / 2;
      } else {
        next = radius * Math.min(2, Math.max(0.5, target / Math.max(path.distanceM, 1)));
      }
      if (Math.abs(next - radius) < 5) break;
      radius = next;
    }

    if (candidates.some((c) => isGoodEnough(c, tolerance))) break;
    if (budget.remaining <= 0) break;
  }

  const best = candidates.reduce<Candidate | undefined>(
    (acc, c) => (!acc || score(c, tolerance) < score(acc, tolerance) ? c : acc),
    undefined,
  );
  if (!best) {
    throw new NoLoopError(
      `No walkable loop found around this start point${lastError instanceof Error ? `: ${lastError.message}` : '.'}`,
      { cause: lastError },
    );
  }

  const { path } = best;
  return {
    points: path.points,
    distanceM: path.distanceM,
    durationMin: minutesForDistance(path.distanceM, speedKmh),
    targetDistanceM: target,
    targetMin,
    speedKmh,
    error: best.error,
    withinTolerance: Math.abs(best.error) <= tolerance,
    overlapRatio: best.overlap,
    landmarks: extractLandmarks(path.steps, path.distanceM, speedKmh),
    farthest: farthestPoint(path.points),
    bearing: best.bearing,
    radiusM: best.radiusM,
    routingCalls: calls,
  };
}
