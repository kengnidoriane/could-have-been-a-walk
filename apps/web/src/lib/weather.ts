import { rainRisk, type HourlyForecast, type LatLon, type RainRisk } from '@cbaw/core';

// Open-Meteo: free, no key, open data. Coordinates are rounded to ~1 km: plenty for a forecast,
// and the weather service doesn't learn where exactly your office is.

const HOUR = 3_600_000;

export async function fetchRainRisk(
  at: LatLon,
  start: number,
  end: number,
  signal?: AbortSignal,
): Promise<RainRisk | null> {
  const lat = at.lat.toFixed(2);
  const lon = at.lon.toFixed(2);
  const key = `cbaw.weather.${lat},${lon}`;

  let forecast: HourlyForecast | null = null;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) ?? 'null') as {
      at: number;
      hourly: HourlyForecast;
    } | null;
    if (cached && Date.now() - cached.at < HOUR) forecast = cached.hourly;
  } catch {
    // no cache
  }

  if (!forecast) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&hourly=precipitation_probability,precipitation&timezone=GMT&forecast_days=16';
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    forecast = ((await res.json()) as { hourly?: HourlyForecast }).hourly ?? null;
    if (!forecast) return null;
    try {
      sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), hourly: forecast }));
    } catch {
      // storage full: fine
    }
  }
  return rainRisk(forecast, start, end);
}

/** A walk that dodges the worst of it: about 60% of the meeting, at least 15 minutes. */
export function shorterMinutes(meetingMinutes: number): number {
  return Math.max(15, Math.round(meetingMinutes * 0.6));
}
