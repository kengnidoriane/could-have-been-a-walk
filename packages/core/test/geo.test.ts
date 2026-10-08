import { describe, expect, it } from 'vitest';
import {
  bearing,
  destination,
  haversine,
  makeRoute,
  pointAt,
  projectOnRoute,
  simplify,
  sliceRoute,
  type LatLon,
} from '../src/geo';
import { decodePolyline, encodePolyline } from '../src/polyline';

const OFFICE: LatLon = { lat: 6.2907, lon: -10.7605 };

describe('haversine', () => {
  it('measures one degree of latitude as ~111.2 km', () => {
    expect(haversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(111_195, 0);
  });

  it('is zero for the same point and symmetric', () => {
    const b = { lat: 6.3, lon: -10.79 };
    expect(haversine(OFFICE, OFFICE)).toBe(0);
    expect(haversine(OFFICE, b)).toBeCloseTo(haversine(b, OFFICE), 9);
  });
});

describe('destination & bearing', () => {
  it('round-trips a 750 m walk on any bearing', () => {
    for (const deg of [0, 45, 90, 135, 180, 270, 359]) {
      const p = destination(OFFICE, deg, 750);
      expect(haversine(OFFICE, p)).toBeCloseTo(750, 3);
      expect(bearing(OFFICE, p)).toBeCloseTo(deg % 360, 3);
    }
  });
});

// A 400 m x 300 m rectangle walked clockwise from the office, back to the office.
function rectangleLoop(): LatLon[] {
  const ne = destination(OFFICE, 0, 300);
  const nne = destination(ne, 90, 400);
  const se = destination(OFFICE, 90, 400);
  return [OFFICE, ne, nne, se, OFFICE];
}

describe('route helpers', () => {
  const route = makeRoute(rectangleLoop());

  it('accumulates distances', () => {
    expect(route.cum[0]).toBe(0);
    expect(route.cum[1]).toBeCloseTo(300, 0);
    expect(route.length).toBeCloseTo(1400, 0);
  });

  it('finds points along the line', () => {
    expect(haversine(pointAt(route, 150), destination(OFFICE, 0, 150))).toBeLessThan(0.5);
    expect(pointAt(route, -10)).toEqual(OFFICE);
    expect(pointAt(route, 99_999)).toEqual(OFFICE);
  });

  it('slices a sub-path', () => {
    const part = sliceRoute(route, 100, 500);
    expect(makeRoute(part).length).toBeCloseTo(400, 0);
  });

  it('projects a point beside the route', () => {
    // 20 m west of the northbound leg, 120 m up.
    const p = destination(destination(OFFICE, 0, 120), 270, 20);
    const proj = projectOnRoute(route, p);
    expect(proj.along).toBeCloseTo(120, 0);
    expect(proj.offset).toBeCloseTo(20, 0);
  });

  it('respects a search window on a loop (start vs finish)', () => {
    const nearOffice = destination(OFFICE, 180, 5);
    expect(projectOnRoute(route, nearOffice).along).toBeLessThan(10);
    expect(projectOnRoute(route, nearOffice, { from: 1000 }).along).toBeGreaterThan(1390);
  });
});

describe('simplify', () => {
  it('collapses a straight line to its ends and keeps corners', () => {
    const straight = Array.from({ length: 50 }, (_, i) => destination(OFFICE, 90, i * 10));
    expect(simplify(straight, 2)).toHaveLength(2);
    expect(simplify(rectangleLoop(), 2)).toHaveLength(5);
  });
});

describe('polyline', () => {
  it('matches the reference example of the encoded polyline format', () => {
    const points = [
      { lat: 38.5, lon: -120.2 },
      { lat: 40.7, lon: -120.95 },
      { lat: 43.252, lon: -126.453 },
    ];
    expect(encodePolyline(points)).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual(points);
  });

  it('round-trips a loop to within ~1 m', () => {
    const loop = rectangleLoop();
    const back = decodePolyline(encodePolyline(loop));
    back.forEach((p, i) => expect(haversine(p, loop[i]!)).toBeLessThan(1));
  });

  it('rejects truncated input', () => {
    expect(() => decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq')).toThrow(/Truncated/);
  });
});
