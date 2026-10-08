const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const day = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

export const formatTime = (ms: number) => time.format(ms);
export const formatDay = (ms: number) => day.format(ms);
export const formatShortDay = (ms: number) => shortDay.format(ms);

export function formatRange(start: number, end: number): string {
  return `${formatTime(start)}–${formatTime(end)}`;
}

export function formatKm(meters: number): string {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** Local calendar-day key, for grouping. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function isToday(ms: number): boolean {
  return dayKey(ms) === dayKey(Date.now());
}

export function isTomorrow(ms: number): boolean {
  return dayKey(ms) === dayKey(Date.now() + 86_400_000);
}

export function relativeDay(ms: number): string {
  if (isToday(ms)) return 'Today';
  if (isTomorrow(ms)) return 'Tomorrow';
  return formatDay(ms);
}
