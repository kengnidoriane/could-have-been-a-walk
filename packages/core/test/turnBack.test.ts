import { describe, expect, it } from 'vitest';
import { destination, makeRoute, type LatLon } from '../src/geo';
import { jitter, seededRandom, VirtualWalker, type WalkerLeg } from '../src/simulate';
import { assess, segmentIndexAt, startTracker, type Decision } from '../src/turnBack';
import { distanceForMinutes, kmhToMps } from '../src/units';

const OFFICE: LatLon = { lat: 6.3106, lon: -10.8047 };
const MIN = 60_000;
const SPEED_KMH = 4.5;
const PLANNED = kmhToMps(SPEED_KMH);

/** A round 42-minute loop (3150 m at 4.5 km/h) for a 45-minute meeting, like the planner makes. */
function circleLoop(): LatLon[] {
  const length = distanceForMinutes(42, SPEED_KMH);
  const radius = length / (2 * Math.PI);
  const center = destination(OFFICE, 0, radius);
  const points: LatLon[] = [];
  for (let i = 0; i <= 240; i++) {
    points.push(i === 0 || i === 240 ? OFFICE : destination(center, 180 + (i / 240) * 360, radius));
  }
  return points;
}

const LOOP = circleLoop();
const ROUTE = makeRoute(LOOP);
const T0 = Date.UTC(2026, 9, 13, 14, 0);
const END = T0 + 45 * MIN;

interface Scenario {
  legs?: WalkerLeg[];
  speedFactor?: number;
  noiseM?: number;
  /** Every n-th fix is junk: 80 m accuracy, 150 m off. */
  junkEvery?: number;
  startDelayMs?: number;
  seed?: number;
}

function simulate(s: Scenario = {}) {
  const legs = s.legs ?? [{ untilAlong: Infinity, speedFactor: s.speedFactor ?? 1 }];
  const walker = new VirtualWalker(LOOP, PLANNED, legs);
  const random = seededRandom(s.seed ?? 1);
  let tracker = startTracker();
  let t = T0 + (s.startDelayMs ?? 0);
  const timeline: { t: number; decision: Decision }[] = [];
  let turnBackAt: number | null = null;
  let arrivedAt: number | null = null;
  let diverted = false;
  let lateByMs = 0;

  for (let i = 1; i < 20 * 70; i++) {
    walker.step(5000);
    t += 5000;
    const junk = s.junkEvery !== undefined && i % s.junkEvery === 0;
    let p = walker.position;
    if (s.noiseM) p = jitter(p, s.noiseM, random);
    if (junk) p = jitter(p, 150, random);
    const result = assess(tracker, {
      route: ROUTE,
      fix: { lat: p.lat, lon: p.lon, accuracy: junk ? 80 : 8, t },
      now: t,
      end: END,
      speedKmh: SPEED_KMH,
    });
    tracker = result.tracker;
    const { decision } = result.assessment;
    if (timeline.at(-1)?.decision !== decision) timeline.push({ t, decision });
    if (decision === 'TURN_BACK_NOW' && !diverted) {
      turnBackAt = t;
      lateByMs = result.assessment.lateByMs;
      walker.divert([walker.position, OFFICE], s.speedFactor ?? 1); // they obey, at their own pace
      diverted = true;
    }
    if (result.assessment.arrived) {
      arrivedAt = t;
      break;
    }
  }
  const changes = timeline.length - 1;
  return { timeline, changes, turnBackAt, arrivedAt, lateByMs };
}

const minutes = (ms: number | null) => (ms === null ? null : (ms - T0) / MIN);

describe('turnBack: simulated walks', () => {
  it('leaves an on-pace walker alone and gets them back before the meeting ends', () => {
    const run = simulate();
    expect(run.turnBackAt).toBeNull();
    expect(run.changes).toBe(0);
    expect(minutes(run.arrivedAt)).toBeGreaterThan(41);
    expect(minutes(run.arrivedAt)).toBeLessThanOrEqual(43);
  });

  it('tells a slow walker to turn back at the last responsible moment, not at the first minute', () => {
    const run = simulate({ speedFactor: 0.7 });
    // Without the alert they would be back after 60 minutes, 15 minutes late.
    expect(run.turnBackAt).not.toBeNull();
    expect(minutes(run.turnBackAt)).toBeGreaterThan(15);
    expect(run.lateByMs).toBe(0);
    expect(run.arrivedAt).not.toBeNull();
    expect(run.arrivedAt!).toBeLessThanOrEqual(END);
    expect(run.arrivedAt!).toBeGreaterThan(END - 10 * MIN);
    expect(run.timeline.filter((e) => e.decision === 'TURN_BACK_NOW')).toHaveLength(1);
  });

  it('suggests an extension to a fast walker and never sends them back', () => {
    const run = simulate({ speedFactor: 1.3 });
    expect(run.turnBackAt).toBeNull();
    expect(run.timeline.map((e) => e.decision)).toContain('SUGGEST_EXTENSION');
    expect(run.arrivedAt!).toBeLessThan(END - 10 * MIN);
  });

  it('does not flicker with noisy GPS and the occasional junk fix', () => {
    const run = simulate({ noiseM: 12, junkEvery: 7, seed: 3 });
    expect(run.turnBackAt).toBeNull();
    expect(run.changes).toBeLessThanOrEqual(1);
    expect(run.arrivedAt).not.toBeNull();
    expect(run.arrivedAt!).toBeLessThanOrEqual(END);
  });

  it('cuts a long chat at the far end short, then gets them home on time', () => {
    const run = simulate({
      legs: [
        { untilAlong: ROUTE.length / 2, speedFactor: 1 },
        { untilAlong: Infinity, speedFactor: 1, pauseMs: 15 * MIN },
      ],
    });
    // They reach the far end around minute 21, and the alert interrupts the chat.
    expect(minutes(run.turnBackAt)).toBeGreaterThan(21);
    expect(minutes(run.turnBackAt)).toBeLessThan(30);
    expect(run.arrivedAt!).toBeLessThanOrEqual(END);
  });

  it('copes with a late start', () => {
    const run = simulate({ startDelayMs: 12 * MIN });
    expect(run.timeline.filter((e) => e.decision === 'TURN_BACK_NOW')).toHaveLength(1);
    expect(run.arrivedAt!).toBeLessThanOrEqual(END);
  });

  it('keeps reporting how late they will be when nothing can save the walk', () => {
    const run = simulate({ speedFactor: 0.5, startDelayMs: 25 * MIN });
    expect(run.lateByMs).toBeGreaterThanOrEqual(0);
    expect(run.arrivedAt).not.toBeNull();
  });
});

describe('turnBack: details', () => {
  it('knows the office is the start of the walk, not the finish', () => {
    const { assessment } = assess(startTracker(), {
      route: ROUTE,
      fix: { ...jitter(OFFICE, 5, seededRandom(1)), accuracy: 10, t: T0 },
      now: T0,
      end: END,
      speedKmh: SPEED_KMH,
    });
    expect(assessment.along).toBeLessThan(20);
    expect(assessment.arrived).toBe(false);
    expect(assessment.decision).toBe('ON_TRACK');
  });

  it('ignores imprecise fixes', () => {
    const far = destination(OFFICE, 90, 500);
    const { assessment } = assess(startTracker(), {
      route: ROUTE,
      fix: { ...far, accuracy: 120, t: T0 },
      now: T0,
      end: END,
      speedKmh: SPEED_KMH,
    });
    expect(assessment.along).toBe(0);
    expect(assessment.paceSource).toBe('planned');
  });

  it('only switches decision once the new one has held for a while', () => {
    // Walk on pace to 35% of the loop, then pretend the clock says "late".
    let tracker = startTracker();
    let t = T0;
    const walker = new VirtualWalker(LOOP, PLANNED);
    for (let i = 0; i < 180; i++) {
      walker.step(5000);
      t += 5000;
      tracker = assess(tracker, {
        route: ROUTE,
        fix: { ...walker.position, accuracy: 8, t },
        now: t,
        end: END,
        speedKmh: SPEED_KMH,
      }).tracker;
    }
    const tightEnd = t + 25 * MIN; // the rest of the loop needs ~27 min: it no longer fits
    const verdicts: Decision[] = [];
    // The confirmed way back flips between "fits easily" and "just fits" every 5 s.
    for (let i = 0; i < 6; i++) {
      walker.step(5000);
      t += 5000;
      const r = assess(tracker, {
        route: ROUTE,
        fix: { ...walker.position, accuracy: 8, t },
        now: t,
        end: tightEnd,
        speedKmh: SPEED_KMH,
        directM: i % 2 === 0 ? 200 : 1655,
      });
      tracker = r.tracker;
      verdicts.push(r.assessment.decision);
    }
    expect(verdicts.every((d) => d === 'ON_TRACK')).toBe(true);

    // A steady "just fits" for longer than the hold time does switch.
    for (let i = 0; i < 4; i++) {
      walker.step(5000);
      t += 5000;
      const r = assess(tracker, {
        route: ROUTE,
        fix: { ...walker.position, accuracy: 8, t },
        now: t,
        end: tightEnd,
        speedKmh: SPEED_KMH,
        directM: 1655,
      });
      tracker = r.tracker;
      verdicts.push(r.assessment.decision);
    }
    expect(verdicts.at(-1)).toBe('TURN_BACK_NOW');
  });

  it('finds the current agenda segment', () => {
    const segments = [{ endAlong: 500 }, { endAlong: 2000 }, { endAlong: 3150 }];
    expect(segmentIndexAt(segments, 0)).toBe(0);
    expect(segmentIndexAt(segments, 1200)).toBe(1);
    expect(segmentIndexAt(segments, 3149)).toBe(2);
    expect(segmentIndexAt(segments, 9999)).toBe(2);
  });
});
