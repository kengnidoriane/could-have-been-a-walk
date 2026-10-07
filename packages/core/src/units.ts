/** Brisk-but-talkable pace used to size loops by default. */
export const DEFAULT_SPEED_KMH = 4.5;
/** "Gentle pace" option: strolling, heels, or a long conversation. */
export const GENTLE_SPEED_KMH = 3.5;
/** Minutes kept free at the end so walkers are back before the meeting ends. */
export const DEFAULT_BUFFER_MIN = 3;

export function kmhToMps(kmh: number): number {
  return kmh / 3.6;
}

/** Distance a walker covers in `minutes` at `speedKmh`, in metres. */
export function distanceForMinutes(minutes: number, speedKmh: number): number {
  return minutes * 60 * kmhToMps(speedKmh);
}

/** Minutes needed to walk `meters` at `speedKmh`. */
export function minutesForDistance(meters: number, speedKmh: number): number {
  return meters / kmhToMps(speedKmh) / 60;
}
