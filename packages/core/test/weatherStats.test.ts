import { describe, expect, it } from 'vitest';
import { startOfWeek, weeklyStats, type WalkRecord } from '../src/stats';
import { isRainy, rainRisk, type HourlyForecast } from '../src/weather';

const forecast: HourlyForecast = {
  time: ['2026-10-13T12:00', '2026-10-13T13:00', '2026-10-13T14:00', '2026-10-13T15:00'],
  precipitation_probability: [10, 35, 80, 60],
  precipitation: [0, 0.2, 3.1, 1.0],
};

describe('rainRisk', () => {
  it('looks only at the hours the meeting overlaps', () => {
    // 14:00–14:45 UTC: only the 14:00 hour.
    const risk = rainRisk(forecast, Date.UTC(2026, 9, 13, 14, 0), Date.UTC(2026, 9, 13, 14, 45));
    expect(risk).toEqual({ probability: 80, mm: 3.1, worstHour: Date.UTC(2026, 9, 13, 14) });
    expect(isRainy(risk)).toBe(true);
  });

  it('spans hour boundaries', () => {
    const risk = rainRisk(forecast, Date.UTC(2026, 9, 13, 12, 30), Date.UTC(2026, 9, 13, 13, 15));
    expect(risk).toMatchObject({ probability: 35, mm: 0.2 });
    expect(isRainy(risk)).toBe(false);
  });

  it('says nothing when the forecast does not reach the meeting', () => {
    expect(rainRisk(forecast, Date.UTC(2026, 9, 20, 9), Date.UTC(2026, 9, 20, 10))).toBeNull();
    expect(isRainy(null)).toBe(false);
  });
});

describe('weeklyStats', () => {
  // Thursday 15 October 2026, noon local time.
  const now = new Date(2026, 9, 15, 12).getTime();
  const walk = (day: number, km: number, min: number, demo = false): WalkRecord => ({
    at: new Date(2026, 9, day, 11).getTime(),
    title: 'walk',
    distanceM: km * 1000,
    minutes: min,
    demo,
  });

  it('starts the week on Monday', () => {
    expect(startOfWeek(now)).toBe(new Date(2026, 9, 12).getTime());
  });

  it('adds up this week only, and counts demo replays apart', () => {
    const stats = weeklyStats(
      [walk(9, 5, 60), walk(12, 2, 27), walk(13, 3.2, 41, true), walk(15, 1.5, 22)],
      now,
    );
    expect(stats).toEqual({ walks: 3, distanceM: 6700, minutes: 90, demos: 1 });
  });
});
