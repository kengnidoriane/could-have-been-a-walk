import { describe, expect, it } from 'vitest';
import { destination, haversine, makeRoute, type LatLon } from '../src/geo';
import { decodeWalkPlan, encodeWalkPlan, WalkPlanError, type WalkPlan } from '../src/walkPlan';

const OFFICE: LatLon = { lat: 6.3106, lon: -10.8047 };

/** A wobbly 3 km loop with ~600 points, like a real OSRM geometry. */
function realisticLoop(): LatLon[] {
  const points: LatLon[] = [];
  const n = 600;
  for (let i = 0; i <= n; i++) {
    const angle = (i / n) * 360;
    const wobble = 25 * Math.sin((i / n) * Math.PI * 30);
    const onCircle = destination(destination(OFFICE, 0, 480), angle + 180, 480 + wobble);
    points.push(i === 0 || i === n ? OFFICE : onCircle);
  }
  return points;
}

const route = realisticLoop();
const length = makeRoute(route).length;

const plan: WalkPlan = {
  title: 'Q4 budget decision with Kofi',
  start: Date.UTC(2026, 9, 13, 14, 0),
  end: Date.UTC(2026, 9, 13, 14, 45),
  speedKmh: 4.5,
  route,
  startLabel: 'Downtown Monrovia (demo)',
  segments: [
    {
      topic: 'Q3 spend status',
      prompt: "What's the current status of Q3 spending?",
      startAlong: 0,
      endAlong: length * 0.25,
      untilLabel: 'Randall Street',
    },
    {
      topic: 'Community program vs. laptops',
      prompt: 'Which investment is best?',
      startAlong: length * 0.25,
      endAlong: length * 0.85,
      untilLabel: 'Lynch Street',
    },
    {
      topic: 'Next steps and owners',
      prompt: 'Who does what, by when?',
      startAlong: length * 0.85,
      endAlong: length,
      untilLabel: 'back at the start',
    },
  ],
};

describe('walk plan link', () => {
  it('round-trips everything the phone needs', async () => {
    const back = await decodeWalkPlan(await encodeWalkPlan(plan));
    expect(back.title).toBe(plan.title);
    expect(back.start).toBe(plan.start);
    expect(back.end).toBe(plan.end);
    expect(back.speedKmh).toBe(4.5);
    expect(back.startLabel).toBe('Downtown Monrovia (demo)');
    expect(back.segments.map((s) => s.topic)).toEqual(plan.segments.map((s) => s.topic));
    expect(haversine(back.route[0]!, OFFICE)).toBeLessThan(1);
  });

  it('keeps the route shape and length within 1%', async () => {
    const back = await decodeWalkPlan(await encodeWalkPlan(plan));
    const backLength = makeRoute(back.route).length;
    expect(Math.abs(backLength - length) / length).toBeLessThan(0.01);
    // Segment distances follow the simplified route.
    expect(back.segments.at(-1)!.endAlong).toBeCloseTo(backLength, -1);
  });

  it('fits in a QR code you can scan from a laptop screen', async () => {
    const text = await encodeWalkPlan(plan);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(text.length).toBeLessThan(1200);
  });

  it('rejects damaged links with a readable error', async () => {
    const text = await encodeWalkPlan(plan);
    await expect(decodeWalkPlan(text.slice(0, 40))).rejects.toThrow(WalkPlanError);
    await expect(decodeWalkPlan('not-a-walk')).rejects.toThrow(/damaged/);
  });
});
