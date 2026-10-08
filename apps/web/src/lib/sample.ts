import { parseIcs, type Meeting } from '@cbaw/core';
import sampleIcs from '../../../../fixtures/sample-calendar.ics?raw';

const DAY = 86_400_000;

/** The `count` weekdays (Mon–Fri) after `now`, as local midnights. */
function nextWeekdays(now: number, count: number): Date[] {
  const days: Date[] = [];
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  while (days.length < count) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) days.push(new Date(d));
  }
  return days;
}

/**
 * The fake sample week (Mon 12 – Fri 16 Oct 2026), moved onto the next five weekdays: whenever
 * someone tries the demo, the meetings are upcoming and the clock times stay the same.
 */
export function sampleMeetings(now = Date.now()): Meeting[] {
  const fixtureMonday = new Date(2026, 9, 12).getTime(); // local midnight
  const meetings = parseIcs(sampleIcs, { from: fixtureMonday - DAY, to: fixtureMonday + 6 * DAY });
  const targets = nextWeekdays(now, 5);

  const move = (ms: number) => {
    const d = new Date(ms);
    const index = Math.min(4, Math.max(0, d.getDay() - 1)); // Mon = 0 … Fri = 4
    const target = targets[index]!;
    return new Date(
      target.getFullYear(),
      target.getMonth(),
      target.getDate(),
      d.getHours(),
      d.getMinutes(),
    ).getTime();
  };

  return meetings
    .map((m) => {
      const start = move(m.start);
      return { ...m, id: `${m.id}#sample`, start, end: start + (m.end - m.start) };
    })
    .sort((a, b) => a.start - b.start);
}
