import { describe, expect, it } from 'vitest';
import { destination, haversine, type LatLon } from '../src/geo';
import {
  cleanPath,
  extractLandmarks,
  findLoop,
  loopWaypoints,
  NoLoopError,
  overlapRatio,
  removeSpurs,
  RouterUnavailableError,
} from '../src/loop';
import { FakeRouter } from './fakeRouter';

const OFFICE: LatLon = { lat: 6.2907, lon: -10.7605 };

describe('loopWaypoints', () => {
  it('puts the start and three waypoints on one circle, start = finish', () => {
    const [s, w1, w2, w3, f] = loopWaypoints(OFFICE, 30, 400);
    expect(s).toEqual(OFFICE);
    expect(f).toEqual(OFFICE);
    // Opposite corners of the inscribed square are a diameter apart.
    expect(haversine(s!, w2!)).toBeCloseTo(800, 0);
    expect(haversine(w1!, w3!)).toBeCloseTo(800, 0);
    // Adjacent corners are r·√2 apart.
    expect(haversine(s!, w1!)).toBeCloseTo(400 * Math.SQRT2, 0);
  });
});

describe('findLoop', () => {
  it('hits a 27-minute walk (30 min meeting, 3 min buffer) within ±5%', async () => {
    const router = new FakeRouter();
    const loop = await findLoop(router, { start: OFFICE, minutes: 30, seed: 1 });
    expect(loop.targetMin).toBe(27);
    expect(loop.targetDistanceM).toBeCloseTo(2025, 0);
    expect(loop.withinTolerance).toBe(true);
    expect(Math.abs(loop.durationMin - 27) / 27).toBeLessThanOrEqual(0.05);
    expect(haversine(loop.points[0]!, OFFICE)).toBeLessThan(0.01);
    expect(loop.routingCalls).toBeLessThanOrEqual(8);
  });

  it('adapts the radius when the street network is much twistier than expected', async () => {
    const router = new FakeRouter(() => 2.1);
    const loop = await findLoop(router, { start: OFFICE, minutes: 45, seed: 7 });
    expect(loop.withinTolerance).toBe(true);
    expect(loop.routingCalls).toBeLessThanOrEqual(8);
  });

  it('sizes the loop for a gentle pace', async () => {
    const loop = await findLoop(new FakeRouter(), {
      start: OFFICE,
      minutes: 30,
      speedKmh: 3.5,
      seed: 3,
    });
    expect(loop.targetDistanceM).toBeCloseTo(1575, 0);
    expect(loop.withinTolerance).toBe(true);
  });

  it('is reproducible with a seed', async () => {
    const a = await findLoop(new FakeRouter(), { start: OFFICE, minutes: 40, seed: 42 });
    const b = await findLoop(new FakeRouter(), { start: OFFICE, minutes: 40, seed: 42 });
    expect(a.bearing).toBe(b.bearing);
    expect(a.distanceM).toBe(b.distanceM);
  });

  it('tries another bearing when one direction cannot be routed', async () => {
    let failures = 0;
    const router = new FakeRouter(undefined, () => failures++ === 0);
    const loop = await findLoop(router, { start: OFFICE, minutes: 30, seed: 5 });
    expect(loop.withinTolerance).toBe(true);
    expect(router.calls.length).toBeGreaterThan(1);
  });

  it('never exceeds the routing budget and still returns the best try', async () => {
    // Pathological network: distance jumps around with the radius.
    const router = new FakeRouter((_, radius) => (Math.floor(radius / 37) % 2 === 0 ? 0.9 : 2.4));
    const loop = await findLoop(router, { start: OFFICE, minutes: 60, seed: 11, maxCalls: 6 });
    expect(router.calls.length).toBeLessThanOrEqual(6);
    expect(loop.routingCalls).toBe(router.calls.length);
    expect(Number.isFinite(loop.error)).toBe(true);
  });

  it('refuses meetings too short to walk', async () => {
    await expect(findLoop(new FakeRouter(), { start: OFFICE, minutes: 7 })).rejects.toThrow(
      NoLoopError,
    );
  });

  it('fails clearly when nothing can be routed', async () => {
    const router = new FakeRouter(undefined, () => true);
    await expect(findLoop(router, { start: OFFICE, minutes: 30, seed: 1 })).rejects.toThrow(
      /No walkable loop.*NoRoute/,
    );
  });

  it('reports the farthest point and landmarks', async () => {
    const loop = await findLoop(new FakeRouter(), { start: OFFICE, minutes: 30, seed: 2 });
    expect(loop.farthest.distanceM).toBeGreaterThan(0);
    expect(loop.farthest.along).toBeGreaterThan(loop.distanceM * 0.3);
    expect(loop.farthest.along).toBeLessThan(loop.distanceM * 0.7);
    expect(loop.landmarks.map((l) => l.name)).toEqual(['Street 2', 'Street 3', 'Street 4']);
  });
});

describe('overlapRatio', () => {
  it('is 0 for a clean loop and ~1 for an out-and-back', () => {
    const [s, w1, w2, w3] = loopWaypoints(OFFICE, 0, 300);
    expect(overlapRatio([s!, w1!, w2!, w3!, s!])).toBe(0);
    expect(overlapRatio([s!, w1!, w2!, w1!, s!])).toBeCloseTo(1, 6);
  });
});

describe('extractLandmarks', () => {
  const at = (along: number) => ({ lat: 6.29 + along / 1e6, lon: -10.76 });

  it('keeps named, distinct, spaced-out streets away from the start and finish', () => {
    const landmarks = extractLandmarks(
      [
        { name: 'Office Lane', along: 0, location: at(0) },
        { name: '', along: 200, location: at(200) },
        { name: 'Tubman Boulevard', along: 300, location: at(300) },
        { name: 'Tubman Boulevard', along: 500, location: at(500) },
        { name: '12th Street', along: 380, location: at(380) },
        { name: 'Lakpazee Road', along: 900, location: at(900) },
        { name: 'Office Lane', along: 1980, location: at(1980) },
      ],
      2000,
      4.5,
    );
    expect(landmarks.map((l) => l.name)).toEqual(['Tubman Boulevard', 'Lakpazee Road']);
    expect(landmarks[0]!.minute).toBeCloseTo(4, 6);
  });

  it('spreads out when there are too many', () => {
    const steps = Array.from({ length: 20 }, (_, i) => ({
      name: `Street ${i}`,
      along: 300 + i * 200,
      location: at(i),
    }));
    const landmarks = extractLandmarks(steps, 4500, 4.5, { max: 4 });
    expect(landmarks.map((l) => l.name)).toEqual([
      'Street 0',
      'Street 6',
      'Street 13',
      'Street 19',
    ]);
  });
});

describe('findLoop when the routing service is down', () => {
  it('fails fast instead of trying every bearing', async () => {
    let calls = 0;
    const router = {
      async route(): Promise<never> {
        calls++;
        throw new RouterUnavailableError('HTTP 503');
      },
    };
    await expect(findLoop(router, { start: OFFICE, minutes: 30 })).rejects.toThrow(
      RouterUnavailableError,
    );
    expect(calls).toBe(1);
  });
});

describe('removeSpurs / cleanPath', () => {
  const north = (from: LatLon, m: number) => destination(from, 0, m);
  const east = (from: LatLon, m: number) => destination(from, 90, m);

  it('cuts a short walk into an alley and back', () => {
    const a = OFFICE;
    const b = east(a, 300);
    const alley = north(b, 40);
    const alleyEnd = north(alley, 30);
    const c = east(b, 300);
    // a → b → [alley → alleyEnd → alley] → b → c: 140 m of dead end, gone.
    expect(removeSpurs([a, b, alley, alleyEnd, alley, b, c])).toEqual([a, b, c]);
  });

  it('keeps a long out-and-back (to the beach and back)', () => {
    const a = OFFICE;
    const b = east(a, 300);
    const beach = north(b, 400);
    const c = east(b, 300);
    expect(removeSpurs([a, b, beach, b, c])).toHaveLength(5);
  });

  it('re-measures the distance and drops steps that were on a spur', () => {
    const corner = east(OFFICE, 500);
    const spurEnd = north(corner, 50);
    const back = east(corner, 500);
    const path = {
      points: [OFFICE, corner, spurEnd, corner, back],
      distanceM: 1100,
      steps: [
        { name: 'Main', along: 0, location: OFFICE },
        { name: 'Dead End', along: 500, location: spurEnd },
        { name: 'Beach Road', along: 600, location: corner },
      ],
    };
    const clean = cleanPath(path);
    expect(clean.points).toHaveLength(3);
    expect(clean.distanceM).toBeCloseTo(1000, 0);
    expect(clean.steps.map((s) => s.name)).toEqual(['Main', 'Beach Road']);
    expect(clean.steps[1]!.along).toBeCloseTo(500, 0);
  });

  it('returns the same path when there is nothing to cut', () => {
    const path = { points: [OFFICE, east(OFFICE, 100)], distanceM: 100, steps: [] };
    expect(cleanPath(path)).toBe(path);
  });
});

describe('findLoop near water', () => {
  it('abandons a direction whose waypoints had to snap far away', async () => {
    const router = new FakeRouter();
    const wet = {
      async route(waypoints: LatLon[]) {
        const path = await router.route(waypoints);
        // Pretend the first direction tried is the Atlantic: waypoints snap 400 m inland.
        const first = router.calls[0]![2]!;
        const inSea = haversine(first, waypoints[2]!) < 1;
        return { ...path, snapDistancesM: [0, inSea ? 400 : 5, inSea ? 400 : 5, 5, 0] };
      },
    };
    const loop = await findLoop(wet, {
      start: OFFICE,
      minutes: 30,
      seed: 9,
      maxCallsPerBearing: 4,
    });
    expect(router.calls.length).toBeLessThanOrEqual(5);
    expect(loop.withinTolerance).toBe(true);
  });
});
