/** The slice of an Open-Meteo hourly forecast we use (requested with timezone=GMT). */
export interface HourlyForecast {
  time: string[];
  precipitation_probability: (number | null)[];
  precipitation: (number | null)[];
}

export interface RainRisk {
  /** Highest chance of rain during the meeting, %. */
  probability: number;
  /** Total expected rain during the meeting, mm. */
  mm: number;
  /** Start of the wettest hour, epoch ms. */
  worstHour: number;
}

const HOUR = 3_600_000;

/** Rain expected during [start, end), or null when the forecast doesn't cover it. */
export function rainRisk(forecast: HourlyForecast, start: number, end: number): RainRisk | null {
  let found = false;
  let probability = 0;
  let mm = 0;
  let worstHour = start;
  let worstScore = -1;
  forecast.time.forEach((time, i) => {
    const hour = Date.parse(`${time}Z`);
    if (!(hour + HOUR > start && hour < end)) return;
    found = true;
    const p = forecast.precipitation_probability[i] ?? 0;
    const r = forecast.precipitation[i] ?? 0;
    probability = Math.max(probability, p);
    mm += r;
    if (p + r * 10 > worstScore) {
      worstScore = p + r * 10;
      worstHour = hour;
    }
  });
  return found ? { probability, mm: Math.round(mm * 10) / 10, worstHour } : null;
}

/** Worth a warning: likely rain, or a real amount of it. */
export function isRainy(risk: RainRisk | null): boolean {
  return !!risk && (risk.probability >= 60 || risk.mm >= 2);
}
