import { describe, expect, it } from 'vitest';
import { TrackReplay } from '../src/simulate';

describe('TrackReplay', () => {
  const fix = (t: number) => ({ lat: 6.31, lon: -10.8, accuracy: 8, t });

  it('hands over the fixes whose time has come, in order, once', () => {
    const replay = new TrackReplay([fix(0), fix(1000), fix(2000), fix(5000)]);
    expect(replay.due(1500).map((f) => f.t)).toEqual([0, 1000]);
    expect(replay.due(1500)).toEqual([]);
    expect(replay.due(4000).map((f) => f.t)).toEqual([2000]);
    expect(replay.done).toBe(false);
    expect(replay.due(60_000).map((f) => f.t)).toEqual([5000]);
    expect(replay.done).toBe(true);
  });
});
