import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIcs } from '../src/ics';
import { scoreFromSignals, scoreWalkabilityHeuristic } from '../src/walkability';

const sample = readFileSync(
  new URL('../../../fixtures/sample-calendar.ics', import.meta.url),
  'utf8',
);
const meetings = parseIcs(sample, { from: Date.UTC(2026, 9, 12), to: Date.UTC(2026, 9, 17) });
const score = (title: string) =>
  scoreWalkabilityHeuristic(meetings.find((m) => m.title === title)!);

describe('scoreWalkabilityHeuristic', () => {
  it('loves 1:1 conversations and decisions between two people', () => {
    expect(score('1:1 with Amara - career check-in').score).toBeGreaterThanOrEqual(8);
    expect(score('Q4 budget decision with Kofi').score).toBeGreaterThanOrEqual(8);
    expect(score('Mentoring session with Joseph').score).toBeGreaterThanOrEqual(8);
  });

  it('keeps screen-bound and crowded meetings at the bottom', () => {
    expect(score('Code review: payments refactor').score).toBe(0);
    expect(score('Code review: payments refactor').reason).toMatch(/code review/i);
    expect(score('Design review - onboarding screens').score).toBeLessThanOrEqual(2);
    expect(score('Quarterly all-hands').score).toBe(0);
    expect(score('Weekly team stand-up').score).toBeLessThanOrEqual(3);
  });

  it('understands "no slides" as a good sign, not a screen', () => {
    const brainstorm = score('Brainstorm: neighbourhood clean-up campaign');
    expect(brainstorm.score).toBeGreaterThanOrEqual(7);
    expect(brainstorm.reason).not.toMatch(/slides need/i);
  });

  it('always explains itself in one capitalised line', () => {
    for (const m of meetings) {
      const { score: s, reason } = scoreWalkabilityHeuristic(m);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(10);
      expect(reason).toMatch(/^[A-Z0-9]/);
      expect(reason.length).toBeLessThanOrEqual(90);
    }
  });
});

describe('scoreFromSignals', () => {
  const base = { attendeeCount: 2, durationMin: 30, hasVideoLink: false };

  it('rewards conversations between two people', () => {
    expect(scoreFromSignals({ kind: 'one_on_one', needsScreen: false }, base)).toBe(10);
    expect(scoreFromSignals({ kind: 'decision', needsScreen: false }, base)).toBe(9);
  });

  it('caps anything that needs a screen', () => {
    expect(scoreFromSignals({ kind: 'one_on_one', needsScreen: true }, base)).toBe(3);
  });

  it('takes points off for crowds, very short or long meetings, and remote attendees', () => {
    const talk = { kind: 'brainstorm', needsScreen: false } as const;
    expect(scoreFromSignals(talk, { ...base, attendeeCount: 3 })).toBe(8);
    expect(scoreFromSignals(talk, { ...base, attendeeCount: 7 })).toBe(4);
    expect(scoreFromSignals(talk, { ...base, attendeeCount: 12 })).toBe(2);
    expect(scoreFromSignals(talk, { ...base, durationMin: 10 })).toBe(7);
    expect(scoreFromSignals(talk, { ...base, attendeeCount: 3, hasVideoLink: true })).toBe(7);
  });

  it('stays within 0..10', () => {
    expect(
      scoreFromSignals(
        { kind: 'workshop', needsScreen: true },
        { attendeeCount: 40, durationMin: 240, hasVideoLink: true },
      ),
    ).toBe(0);
  });
});
