import { describe, expect, it } from 'vitest';
import { distanceForMinutes, kmhToMps, minutesForDistance } from '../src/units';

describe('units', () => {
  it('converts km/h to m/s', () => {
    expect(kmhToMps(3.6)).toBe(1);
  });

  it('sizes a 27-minute walk at 4.5 km/h to about 2 km', () => {
    expect(distanceForMinutes(27, 4.5)).toBeCloseTo(2025, 6);
  });

  it('round-trips distance and minutes', () => {
    expect(minutesForDistance(distanceForMinutes(42, 3.5), 3.5)).toBeCloseTo(42, 9);
  });
});
