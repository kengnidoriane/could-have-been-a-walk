import type { Meeting } from './ics';

/**
 * What kind of meeting this is. Gemma (or the fallback rules) only has to classify; the score
 * is then computed by one transparent formula. Small models read well but calibrate numbers
 * badly: asked for a 0–10 score directly, Gemma 3 4B gave a two-person budget decision 2/10
 * with a reason that argued for a walk.
 */
export const MEETING_KINDS = [
  'one_on_one',
  'mentoring',
  'check_in',
  'decision',
  'brainstorm',
  'social',
  'planning',
  'status_update',
  'other',
  'interview',
  'review',
  'presentation',
  'workshop',
] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

export interface MeetingSignals {
  kind: MeetingKind;
  /** People must look at a screen, slides, code, designs or a document together. */
  needsScreen: boolean;
}

/** What the scorer says about one meeting. */
export interface WalkabilityScore extends MeetingSignals {
  /** 0 = needs a screen and a room, 10 = perfect walk. */
  score: number;
  /** One line, e.g. "1:1, no screen needed, strategic topic". */
  reason: string;
}

/** The fields a scorer needs; everything else stays on the device. */
export type MeetingForScoring = Pick<
  Meeting,
  'title' | 'description' | 'location' | 'durationMin' | 'attendeeCount' | 'hasVideoLink'
>;

const KIND_BASE: Record<MeetingKind, number> = {
  one_on_one: 9,
  mentoring: 9,
  check_in: 8,
  decision: 8,
  brainstorm: 8,
  social: 8,
  planning: 6,
  status_update: 5,
  other: 5,
  interview: 2,
  review: 2,
  presentation: 1,
  workshop: 1,
};

/** The one formula: kind, screen, headcount, length. */
export function scoreFromSignals(
  signals: MeetingSignals,
  meeting: Pick<MeetingForScoring, 'attendeeCount' | 'durationMin' | 'hasVideoLink'>,
): number {
  let score = KIND_BASE[signals.kind];
  if (signals.needsScreen) score = Math.min(score, 2);

  const people = meeting.attendeeCount;
  if (people === 2) score += 1;
  else if (people >= 4 && people <= 5) score -= 2;
  else if (people >= 6 && people <= 8) score -= 4;
  else if (people > 8) score -= 6;

  if (meeting.durationMin < 15 || meeting.durationMin > 90) score -= 2;
  if (meeting.hasVideoLink && people > 2) score -= 1;
  return Math.max(0, Math.min(10, score));
}

const NO_SCREEN = /\b(no|without)\s+(slides?|screens?|decks?|laptops?)\b/i;

const NEEDS_SCREEN: [RegExp, string][] = [
  [
    /\b(code|pr|pull request|merge request)\b[^.]*\breview\b|\breview\b[^.]*\b(code|pr|pull request)\b/i,
    'code review needs a screen',
  ],
  [/\b(figma|mock-?ups?|prototypes?|wireframes?)\b/i, 'design work needs a screen'],
  [/\b(slides?|decks?|presentations?|keynote|powerpoint)\b/i, 'slides need a screen'],
  [/\b(demo|screen ?shar\w*|share (my|your|the) screen)\b/i, 'screen sharing'],
  [/\b(spreadsheets?|excel|dashboards?)\b/i, 'numbers on a screen'],
];

const KIND_PATTERNS: [RegExp, MeetingKind, string][] = [
  [/\b(1:1|1-1|1 on 1|one[- ]on[- ]one)\b/i, 'one_on_one', '1:1 conversation'],
  [/\binterview\b/i, 'interview', 'interview'],
  [/\b(workshop|training|webinar|hands-on)\b/i, 'workshop', 'hands-on session'],
  [/\b(all[- ]hands|town ?hall|demo|presentation|keynote)\b/i, 'presentation', 'presentation'],
  [/\breview\b/i, 'review', 'review'],
  [/\b(mentor\w*|coaching|career)\b/i, 'mentoring', 'mentoring talk'],
  [/\b(decide|decision)\b/i, 'decision', 'a decision to talk through'],
  [/\b(brainstorm\w*|ideas?|strategy|vision)\b/i, 'brainstorm', 'open discussion'],
  [/\b(check-?in|catch-?up|coffee|chat)\b/i, 'check_in', 'catch-up'],
  [/\b(stand-?up|daily|weekly sync|status)\b/i, 'status_update', 'status round'],
  [/\b(planning|roadmap|prioriti[sz]\w*)\b/i, 'planning', 'planning'],
  [/\b(lunch|celebration|social|team bonding)\b/i, 'social', 'social time'],
];

/**
 * Keyword rules (English only): the fallback when the local model is unavailable or answers
 * badly, so a badge is never empty.
 */
export function scoreWalkabilityHeuristic(meeting: MeetingForScoring): WalkabilityScore {
  const text = `${meeting.title}\n${meeting.description}\n${meeting.location}`;
  const screenText = text.replace(new RegExp(NO_SCREEN.source, 'gi'), '');
  const screen = NEEDS_SCREEN.find(([re]) => re.test(screenText));
  const kindMatch = KIND_PATTERNS.find(([re]) => re.test(text));
  const signals: MeetingSignals = { kind: kindMatch?.[1] ?? 'other', needsScreen: !!screen };

  const people = meeting.attendeeCount;
  const labels = [
    screen?.[1],
    kindMatch?.[2],
    people === 2 ? 'just 2 people' : people > 5 ? `${people} people` : undefined,
    meeting.durationMin < 15 ? 'too short for a loop' : undefined,
    meeting.durationMin > 90 ? 'very long' : undefined,
    !screen && NO_SCREEN.test(text) ? 'no screen needed' : undefined,
  ].filter((l): l is string => !!l);
  const reason = labels.slice(0, 2).join(', ') || 'nothing stands out either way';

  return {
    ...signals,
    score: scoreFromSignals(signals, meeting),
    reason: reason.charAt(0).toUpperCase() + reason.slice(1),
  };
}
