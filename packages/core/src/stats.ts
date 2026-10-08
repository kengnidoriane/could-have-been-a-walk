/** A finished walk, as kept on the device. */
export interface WalkRecord {
  /** Epoch ms when the walk ended. */
  at: number;
  title: string;
  distanceM: number;
  minutes: number;
  demo: boolean;
}

export interface WeeklyStats {
  walks: number;
  distanceM: number;
  minutes: number;
  /** How many of those were demo replays. */
  demos: number;
}

/** Monday 00:00 (local time) of the week containing `now`. */
export function startOfWeek(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** "This week: 3 walks, 4.2 km, 95 min away from the chair." */
export function weeklyStats(records: WalkRecord[], now: number): WeeklyStats {
  const from = startOfWeek(now);
  const week = records.filter((r) => r.at >= from && r.at <= now);
  return {
    walks: week.length,
    distanceM: week.reduce((sum, r) => sum + r.distanceM, 0),
    minutes: week.reduce((sum, r) => sum + r.minutes, 0),
    demos: week.filter((r) => r.demo).length,
  };
}
