import { readFileSync } from 'node:fs';
import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { buildWalkInvite, escapeText, foldLine, IcsParseError, parseIcs } from '../src/ics';

const sample = readFileSync(
  new URL('../../../fixtures/sample-calendar.ics', import.meta.url),
  'utf8',
);
const WEEK = { from: Date.UTC(2026, 9, 12), to: Date.UTC(2026, 9, 17) }; // Mon 12 – Sat 17 Oct 2026

describe('parseIcs', () => {
  const meetings = parseIcs(sample, WEEK);
  const byTitle = (title: string) => meetings.find((m) => m.title === title)!;

  it('lists the upcoming meetings in order, skipping all-day and cancelled events', () => {
    expect(meetings.map((m) => m.title)).toEqual([
      'Weekly team stand-up',
      '1:1 with Amara - career check-in',
      'Q4 budget decision with Kofi',
      'Code review: payments refactor',
      'Design review - onboarding screens',
      'Brainstorm: neighbourhood clean-up campaign',
      'Mentoring session with Joseph',
      'Weekly team stand-up (moved)',
      'Quarterly all-hands',
    ]);
  });

  it('reads times, durations and unescapes folded text', () => {
    const budget = byTitle('Q4 budget decision with Kofi');
    expect(budget.start).toBe(Date.UTC(2026, 9, 13, 14, 0));
    expect(budget.durationMin).toBe(45);
    expect(budget.description).toBe(
      'Agenda:\n1. Status of Q3 spend\n2. Decide: community program or new laptops\n3. Next steps and owners',
    );
  });

  it('converts other time zones to absolute time', () => {
    // 18:00 in Paris on 15 Oct 2026 is CEST (UTC+2).
    expect(byTitle('Mentoring session with Joseph').start).toBe(Date.UTC(2026, 9, 15, 16, 0));
  });

  it('counts people (organizer included, rooms excluded)', () => {
    expect(byTitle('1:1 with Amara - career check-in').attendeeCount).toBe(2);
    expect(byTitle('Q4 budget decision with Kofi').attendeeCount).toBe(2);
    expect(byTitle('Weekly team stand-up').attendeeCount).toBe(8);
    expect(byTitle('Quarterly all-hands').attendeeCount).toBe(12);
  });

  it('flags video-call links', () => {
    expect(byTitle('Code review: payments refactor').hasVideoLink).toBe(true);
    expect(byTitle('Design review - onboarding screens').hasVideoLink).toBe(true);
    expect(byTitle('Q4 budget decision with Kofi').hasVideoLink).toBe(false);
  });

  it('expands recurrences with EXDATE and moved occurrences', () => {
    const standups = meetings.filter((m) => m.uid === 'standup-weekly@example.org');
    expect(standups.map((m) => new Date(m.start).toISOString())).toEqual([
      '2026-10-12T09:00:00.000Z',
      '2026-10-16T09:30:00.000Z',
    ]);
    expect(new Set(standups.map((m) => m.id)).size).toBe(2);
    expect(standups.every((m) => m.recurring)).toBe(true);
  });

  it('honours the window and the limit', () => {
    const tuesday = parseIcs(sample, { from: Date.UTC(2026, 9, 13), to: Date.UTC(2026, 9, 14) });
    expect(tuesday).toHaveLength(2);
    expect(parseIcs(sample, { ...WEEK, limit: 3 })).toHaveLength(3);
  });

  it('rejects files that are not calendars', () => {
    expect(() => parseIcs('hello world', WEEK)).toThrow(IcsParseError);
  });
});

describe('walking invite', () => {
  const input = {
    title: 'Q4 budget decision with Kofi',
    start: Date.UTC(2026, 9, 13, 14, 0),
    end: Date.UTC(2026, 9, 13, 14, 45),
    startPoint: { lat: 6.2907, lon: -10.7605 },
    startLabel: 'Office',
    routeUrl: 'https://example.org/#/walk?d=abc123',
    distanceM: 3150,
    loopMin: 42,
    agenda: [
      { when: '0–14 min · to Tubman Boulevard', topic: 'Status of Q3 spend' },
      { when: '14–28 min · around 12th Street', topic: 'Decide: community program, or laptops?' },
      { when: '28–42 min · way back', topic: 'Next steps; owners' },
    ],
    now: Date.UTC(2026, 9, 8, 12, 0),
  };
  const ics = buildWalkInvite(input);

  it('round-trips through a real iCalendar parser', () => {
    const event = new ICAL.Event(
      new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent')!,
    );
    expect(event.summary).toBe('Walk: Q4 budget decision with Kofi');
    expect(event.startDate.toJSDate().getTime()).toBe(input.start);
    expect(event.endDate.toJSDate().getTime()).toBe(input.end);
    expect(event.description).toContain('Route on your phone: https://example.org/#/walk?d=abc123');
    expect(event.description).toContain(
      '2. 14–28 min · around 12th Street: Decide: community program, or laptops?',
    );
    expect(event.location).toContain('6.29070, -10.76050');
  });

  it('is parsed back as an upcoming meeting', () => {
    const [meeting] = parseIcs(ics, { from: input.now });
    expect(meeting?.durationMin).toBe(45);
  });

  it('uses CRLF and folds lines to 75 octets', () => {
    const lines = ics.split('\r\n');
    expect(lines.at(-1)).toBe('');
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it('is deterministic for the same meeting', () => {
    expect(buildWalkInvite(input)).toBe(ics);
  });
});

describe('text helpers', () => {
  it('escapes RFC 5545 special characters', () => {
    expect(escapeText('a;b,c\\d\ne')).toBe('a\\;b\\,c\\\\d\\ne');
  });

  it('never splits a multi-byte character when folding', () => {
    const folded = foldLine(`DESCRIPTION:${'é'.repeat(80)}`);
    expect(folded.split('\r\n ').join('')).toBe(`DESCRIPTION:${'é'.repeat(80)}`);
  });
});
