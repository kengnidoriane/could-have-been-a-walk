import { haversine, pointAt, projectOnRoute, type LatLon, type Route } from './geo';
import { kmhToMps } from './units';

export type Decision = 'ON_TRACK' | 'TURN_BACK_NOW' | 'SUGGEST_EXTENSION';

/** One GPS reading. */
export interface Fix {
  lat: number;
  lon: number;
  /** Radius of uncertainty, metres. */
  accuracy: number;
  /** Epoch ms. */
  t: number;
}

export interface TurnBackOptions {
  /** Aim to be back this long before the meeting ends. */
  marginMs: number;
  /** Straight line × this ≈ walking distance, until the router confirms. */
  detourFactor: number;
  /** Rolling window for the pace. */
  paceWindowMs: number;
  /** Fixes less precise than this are ignored. */
  maxAccuracyM: number;
  /** Further than this from the loop counts as off the loop. */
  offRouteM: number;
  /** A new decision must hold this long before it is shown (no flicker). */
  holdMs: number;
  /** Turn back when the shortest way home leaves less slack than this. */
  lookaheadMs: number;
  /** Suggest an extension when the loop leaves at least this much spare time. */
  extensionMs: number;
}

export const TURN_BACK_DEFAULTS: TurnBackOptions = {
  marginMs: 2 * 60_000,
  detourFactor: 1.3,
  paceWindowMs: 2 * 60_000,
  maxAccuracyM: 35,
  offRouteM: 60,
  holdMs: 15_000,
  lookaheadMs: 60_000,
  extensionMs: 6 * 60_000,
};

/** State carried from one GPS fix to the next. */
export interface WalkTracker {
  along: number;
  position: LatLon | null;
  lastFixAt: number | null;
  samples: { along: number; t: number }[];
  /** Smoothed pace once measured with enough data, m/s. */
  paceMps: number | null;
  /** Since when the full loop has looked too long (hysteresis for `willCutShort`). */
  lateSince: number | null;
  decision: Decision;
  candidate: { decision: Decision; since: number } | null;
  turnedBackAt: number | null;
  arrived: boolean;
}

export interface WalkInput {
  route: Route;
  fix: Fix | null;
  now: number;
  /** Meeting end, epoch ms. */
  end: number;
  /** Planned pace, used until the walkers' own pace is known. */
  speedKmh: number;
  /** Walking distance back to the start from here, if a router confirmed it. */
  directM?: number | null;
}

export interface Assessment {
  along: number;
  progress: number;
  position: LatLon;
  offsetM: number;
  offRoute: boolean;
  paceMps: number;
  paceSource: 'planned' | 'measured';
  remainingLoopM: number;
  directM: number;
  directConfirmed: boolean;
  etaLoop: number;
  etaDirect: number;
  deadline: number;
  /** This instant's verdict, before debouncing. */
  raw: Decision;
  /** What the phone shows. */
  decision: Decision;
  /** The full loop won't fit, but turning back can still wait. */
  willCutShort: boolean;
  /** Even the best way back gets there after the end. */
  lateByMs: number;
  arrived: boolean;
}

export function startTracker(): WalkTracker {
  return {
    along: 0,
    position: null,
    lastFixAt: null,
    samples: [],
    paceMps: null,
    lateSince: null,
    decision: 'ON_TRACK',
    candidate: null,
    turnedBackAt: null,
    arrived: false,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Where are we, how fast are we going, and do we make it back in time? Pure: same inputs,
 * same answer. Call it on every GPS fix (and on a timer: time passes even without fixes).
 *
 * TURN_BACK_NOW comes at the last responsible moment: when the full loop no longer fits AND
 * the shortest way back is only just still on time. Earlier than that, walkers can keep going.
 */
export function assess(
  tracker: WalkTracker,
  input: WalkInput,
  options: Partial<TurnBackOptions> = {},
): { tracker: WalkTracker; assessment: Assessment } {
  const o = { ...TURN_BACK_DEFAULTS, ...options };
  const { route, fix, now, end } = input;
  const planned = kmhToMps(input.speedKmh);
  const start = route.points[0]!;
  let { along, position, lastFixAt, samples, paceMps } = tracker;
  let offsetM = 0;
  let offRoute = false;
  let fixUsed = false;

  // 1. Progress along the loop.
  if (fix && fix.accuracy <= o.maxAccuracyM) {
    const here = { lat: fix.lat, lon: fix.lon };
    // Search near where we were: on a loop, the start and the finish are the same place.
    const reach = lastFixAt === null ? 400 : 100 + (2.5 * Math.max(0, fix.t - lastFixAt)) / 1000;
    const projection = projectOnRoute(route, here, {
      from: Math.max(0, along - 80),
      to: along + reach,
    });
    offsetM = projection.offset;
    offRoute = offsetM > o.offRouteM;
    // Once heading back the short way, progress along the loop no longer means anything.
    if (!offRoute && tracker.decision !== 'TURN_BACK_NOW') {
      along = projection.along;
      samples = [...samples, { along, t: fix.t }].filter((s) => s.t >= fix.t - o.paceWindowMs);
    }
    position = here;
    lastFixAt = fix.t;
    fixUsed = true;
  }

  // 2. Moving pace over the last couple of minutes. Samples are grouped in ~30 s chunks;
  // chunks spent standing still are cut out (the clock already counts the stop, and once
  // people walk again they walk at their usual pace). The pace is the least-squares slope of
  // progress over the remaining "moving time": every fix counts, so GPS noise averages out.
  const { slope, movingMs } = movingPace(samples.filter((s) => s.t >= now - o.paceWindowMs));
  let pace = paceMps ?? planned;
  let paceSource: Assessment['paceSource'] = paceMps === null ? 'planned' : 'measured';
  if (slope !== null) {
    // Trust the measurement gradually: two minutes of walking to fully replace the plan.
    const weight = Math.min(1, movingMs / 120_000);
    const measured = weight * slope + (1 - weight) * planned;
    // Smoothed from fix to fix, so "back at 14:41" doesn't jump around.
    if (paceMps === null) pace = measured;
    else if (fixUsed) pace = paceMps + 0.25 * (measured - paceMps);
    paceSource = weight >= 0.5 ? 'measured' : 'planned';
    if (movingMs >= 30_000 || paceMps !== null) paceMps = pace;
  }
  pace = clamp(pace, 0.4, 2.2);

  // 3. Distances and arrival times.
  const here = position ?? pointAt(route, along);
  const straight = haversine(here, start);
  const directConfirmed = input.directM !== undefined && input.directM !== null;
  const directM = directConfirmed ? input.directM! : straight * o.detourFactor;
  const remainingLoopM = Math.max(0, route.length - along);
  const etaLoop = now + (remainingLoopM / pace) * 1000;
  const etaDirect = now + (directM / pace) * 1000;
  const deadline = end - o.marginMs;

  const arrived =
    tracker.arrived ||
    remainingLoopM < 25 ||
    (straight < 35 && (along > route.length * 0.5 || tracker.turnedBackAt !== null));

  // 4. This instant's verdict. "The loop is too long" needs a clear minute of lateness to
  // start, and the loop to fit again to stop: walkers right on schedule don't see it blink.
  let raw: Decision = 'ON_TRACK';
  let cutShort = false;
  const directHelps = etaDirect < etaLoop - 60_000;
  const wasLate = tracker.lateSince !== null || tracker.decision === 'TURN_BACK_NOW';
  const loopLate = etaLoop > deadline + (wasLate ? 0 : 60_000);
  if (!arrived) {
    if (loopLate) {
      if (directHelps) {
        // Still "won't fit" while TURN_BACK_NOW waits out its hold: no "on track" flash.
        cutShort = true;
        if (etaDirect >= deadline - o.lookaheadMs) raw = 'TURN_BACK_NOW';
      }
    } else if (deadline - etaLoop >= o.extensionMs && along / route.length >= 0.4) {
      raw = 'SUGGEST_EXTENSION';
    }
  }
  const lateSince = loopLate && !arrived ? (tracker.lateSince ?? now) : null;

  // 5. Debounce: show a new decision only once it has held for a while. Turning back is
  // sticky: walkers already heading home must not be sent back out by a lucky GPS fix.
  let { decision, candidate, turnedBackAt } = tracker;
  if (arrived) {
    decision = 'ON_TRACK';
    candidate = null;
  } else if (raw === decision) {
    candidate = null;
  } else {
    if (!candidate || candidate.decision !== raw) candidate = { decision: raw, since: now };
    const urgent = raw === 'TURN_BACK_NOW' && etaDirect >= deadline;
    const leavingTurnBack = decision === 'TURN_BACK_NOW';
    const recovered = etaLoop <= deadline - 2 * 60_000;
    const hold = leavingTurnBack ? 4 * o.holdMs : o.holdMs;
    if ((urgent || now - candidate.since >= hold) && (!leavingTurnBack || recovered)) {
      decision = raw;
      candidate = null;
    }
  }
  if (decision === 'TURN_BACK_NOW' && turnedBackAt === null) turnedBackAt = now;

  // Informational, not urgent: it can wait twice as long as a decision before showing.
  const willCutShort =
    cutShort &&
    decision !== 'TURN_BACK_NOW' &&
    lateSince !== null &&
    now - lateSince >= 2 * o.holdMs;

  const bestEta =
    decision === 'TURN_BACK_NOW' || directHelps ? Math.min(etaDirect, etaLoop) : etaLoop;
  const assessment: Assessment = {
    along,
    progress: route.length > 0 ? along / route.length : 0,
    position: here,
    offsetM,
    offRoute,
    paceMps: pace,
    paceSource,
    remainingLoopM,
    directM,
    directConfirmed,
    etaLoop,
    etaDirect,
    deadline,
    raw,
    decision,
    willCutShort,
    lateByMs: arrived ? 0 : Math.max(0, bestEta - end),
    arrived,
  };
  return {
    tracker: {
      along,
      position,
      lastFixAt,
      samples,
      paceMps,
      lateSince,
      decision,
      candidate,
      turnedBackAt,
      arrived,
    },
    assessment,
  };
}

/** Least-squares walking speed (m/s) over the moving parts of `samples`. */
function movingPace(samples: { along: number; t: number }[]): {
  slope: number | null;
  movingMs: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];
  let movingMs = 0;
  let first = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[first]!;
    const b = samples[i]!;
    const dt = b.t - a.t;
    const lastSample = i === samples.length - 1;
    if (dt < 30_000 && !(lastSample && dt >= 10_000)) continue;
    if ((b.along - a.along) / (dt / 1000) > 0.3) {
      for (let k = xs.length === 0 ? first : first + 1; k <= i; k++) {
        xs.push(movingMs + (samples[k]!.t - a.t));
        ys.push(samples[k]!.along);
      }
      movingMs += dt;
    }
    first = i;
  }
  // A slope fitted on a few noisy fixes is worse than the plan: wait for a minute of walking.
  if (xs.length < 3 || movingMs < 60_000) return { slope: null, movingMs };
  const mx = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const my = ys.reduce((sum, y) => sum + y, 0) / ys.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return { slope: den > 0 ? (num / den) * 1000 : null, movingMs };
}

/** Index of the agenda segment covering `along` (the last one once past the end). */
export function segmentIndexAt(segments: { endAlong: number }[], along: number): number {
  const i = segments.findIndex((s) => along < s.endAlong);
  return i === -1 ? Math.max(0, segments.length - 1) : i;
}
