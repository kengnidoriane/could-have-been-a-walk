import ICAL from 'ical.js';
import type { LatLon } from './geo';

type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;
type IcalEvent = InstanceType<typeof ICAL.Event>;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** One upcoming occurrence of a calendar event, flattened for scoring and planning. */
export interface Meeting {
  /** Unique per occurrence: recurring events share a UID. */
  id: string;
  uid: string;
  title: string;
  description: string;
  location: string;
  /** Epoch milliseconds. */
  start: number;
  end: number;
  durationMin: number;
  /** People expected, organizer included, rooms and resources excluded. */
  attendeeCount: number;
  /** A video-call link in the location or description (Zoom, Meet, Teams…). */
  hasVideoLink: boolean;
  recurring: boolean;
}

export interface ParseOptions {
  /** Keep meetings that end after this instant (epoch ms). Default: now. */
  from?: number;
  /** Keep meetings that start before this instant. Default: `from` + 14 days. */
  to?: number;
  /** Maximum number of meetings returned (earliest first). Default 60. */
  limit?: number;
}

export class IcsParseError extends Error {}

const VIDEO_LINK =
  /(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|meet\.jit\.si)/i;

/** Safety net for very old daily series: we iterate from DTSTART up to the window. */
const MAX_RECURRENCE_STEPS = 20_000;

function toMs(t: Time): number {
  return t.toJSDate().getTime();
}

function countAttendees(comp: Component): number {
  const people = new Set<string>();
  for (const prop of comp.getAllProperties('attendee')) {
    const cutype = String(prop.getParameter('cutype') ?? 'INDIVIDUAL').toUpperCase();
    if (cutype === 'ROOM' || cutype === 'RESOURCE') continue;
    people.add(String(prop.getFirstValue()).toLowerCase());
  }
  const organizer = comp.getFirstPropertyValue('organizer');
  if (organizer) people.add(String(organizer).toLowerCase());
  return Math.max(1, people.size);
}

function toMeeting(item: IcalEvent, start: Time, end: Time, recurring: boolean): Meeting | null {
  if (start.isDate) return null; // all-day: not a meeting
  const status = String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase();
  if (status === 'CANCELLED') return null;

  const startMs = toMs(start);
  const endMs = toMs(end);
  if (!(endMs > startMs)) return null;

  const title = (item.summary ?? '').trim() || '(untitled)';
  const description = (item.description ?? '').trim();
  const location = (item.location ?? '').trim();
  return {
    id: recurring ? `${item.uid}@${startMs}` : item.uid,
    uid: item.uid,
    title,
    description,
    location,
    start: startMs,
    end: endMs,
    durationMin: Math.round((endMs - startMs) / MINUTE),
    attendeeCount: countAttendees(item.component),
    hasVideoLink: VIDEO_LINK.test(`${location} ${description}`),
    recurring,
  };
}

/** Parse an iCalendar export into the upcoming meetings within [from, to]. */
export function parseIcs(text: string, options: ParseOptions = {}): Meeting[] {
  const from = options.from ?? Date.now();
  const to = options.to ?? from + 14 * DAY;
  const limit = options.limit ?? 60;

  let root: Component;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch (err) {
    throw new IcsParseError(
      `This file doesn't look like a calendar export (.ics): ${(err as Error).message}`,
    );
  }
  if (root.name !== 'vcalendar') throw new IcsParseError('Expected a VCALENDAR.');

  for (const vtimezone of root.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(vtimezone);
  }

  const masters: Component[] = [];
  const exceptionsByUid = new Map<string, Component[]>();
  for (const vevent of root.getAllSubcomponents('vevent')) {
    if (vevent.hasProperty('recurrence-id')) {
      const uid = String(vevent.getFirstPropertyValue('uid'));
      exceptionsByUid.set(uid, [...(exceptionsByUid.get(uid) ?? []), vevent]);
    } else {
      masters.push(vevent);
    }
  }

  const meetings: Meeting[] = [];
  const keep = (m: Meeting | null) => {
    if (m && m.end > from && m.start < to) meetings.push(m);
  };

  for (const comp of masters) {
    const uid = String(comp.getFirstPropertyValue('uid') ?? '');
    const event = new ICAL.Event(comp, {
      exceptions: exceptionsByUid.get(uid) ?? [],
      strictExceptions: true,
    });
    if (!event.startDate) continue;

    if (!event.isRecurring()) {
      keep(toMeeting(event, event.startDate, event.endDate, false));
      continue;
    }

    const iterator = event.iterator();
    for (let step = 0, next = iterator.next(); next && step < MAX_RECURRENCE_STEPS; step++) {
      if (toMs(next) >= to) break;
      const occurrence = event.getOccurrenceDetails(next);
      keep(toMeeting(occurrence.item, occurrence.startDate, occurrence.endDate, true));
      next = iterator.next();
    }
  }

  return meetings.sort((a, b) => a.start - b.start).slice(0, limit);
}

// ---------------------------------------------------------------------------------------------
// Generating the walking invite
// ---------------------------------------------------------------------------------------------

export interface WalkInviteInput {
  title: string;
  /** Epoch ms. */
  start: number;
  end: number;
  startPoint: LatLon;
  /** Human name for the start, e.g. "Office". */
  startLabel?: string;
  /** Link that opens the route on a phone. */
  routeUrl: string;
  distanceM: number;
  loopMin: number;
  /** Agenda by segment, in walking order. `when` is e.g. "0–9 min · to Tubman Blvd". */
  agenda: { when: string; topic: string }[];
  uid?: string;
  /** DTSTAMP; defaults to now. */
  now?: number;
}

/** RFC 5545 TEXT escaping. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const utf8 = new TextEncoder();

/** Fold a content line to at most 75 octets per physical line (RFC 5545 §3.1). */
export function foldLine(line: string): string {
  if (utf8.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = utf8.encode(char).length;
    if (currentBytes + bytes > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += char;
    currentBytes += bytes;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function formatUtc(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function walkInviteDescription(input: WalkInviteInput): string {
  const km = (input.distanceM / 1000).toFixed(1);
  const backBy = Math.round((input.end - input.start) / MINUTE) - input.loopMin;
  const lines = [
    `Walking meeting: "${input.title}"`,
    `Loop: ${km} km, about ${input.loopMin} min. Back ${backBy} min before the end.`,
    '',
    `Route on your phone: ${input.routeUrl}`,
  ];
  if (input.agenda.length > 0) {
    lines.push('', 'Agenda along the way:');
    input.agenda.forEach((segment, i) => lines.push(`${i + 1}. ${segment.when}: ${segment.topic}`));
  }
  lines.push(
    '',
    `Start & finish: ${input.startLabel ?? 'Office'} (${input.startPoint.lat.toFixed(5)}, ${input.startPoint.lon.toFixed(5)})`,
    "Planned with Could've Been a Walk: local AI, nothing uploaded.",
  );
  return lines.join('\n');
}

/** A standalone .ics (METHOD:PUBLISH) for the walking version of a meeting. */
export function buildWalkInvite(input: WalkInviteInput): string {
  const uid =
    input.uid ?? `walk-${hash(`${input.title}|${input.start}`)}-${input.start}@couldvebeenawalk`;
  const { lat, lon } = input.startPoint;
  const location = `${input.startLabel ?? 'Office'}, start & finish of the walk (${lat.toFixed(5)}, ${lon.toFixed(5)})`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//Could've Been a Walk//EN",
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${formatUtc(input.now ?? Date.now())}`,
    `DTSTART:${formatUtc(input.start)}`,
    `DTEND:${formatUtc(input.end)}`,
    `SUMMARY:${escapeText(`Walk: ${input.title}`)}`,
    `LOCATION:${escapeText(location)}`,
    `GEO:${lat.toFixed(6)};${lon.toFixed(6)}`,
    `URL:${input.routeUrl}`,
    `DESCRIPTION:${escapeText(walkInviteDescription(input))}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText('Walking meeting in 10 minutes. Comfortable shoes!')}`,
    'TRIGGER:-PT10M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
