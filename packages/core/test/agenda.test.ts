import { describe, expect, it } from 'vitest';
import {
  agendaHeuristic,
  buildCheckpoints,
  distributeTopics,
  extractAgendaItems,
  normalizeAgenda,
  type LoopForAgenda,
} from '../src/agenda';

const point = { lat: 6.31, lon: -10.8 };
// 41-minute loop, 3075 m at 4.5 km/h (75 m per minute).
const loop: LoopForAgenda = {
  distanceM: 3075,
  durationMin: 41,
  speedKmh: 4.5,
  farthest: { along: 1500, point, distanceM: 900 },
  landmarks: [
    { name: 'Benson Street', along: 450, point, minute: 6 },
    { name: 'Broad Street', along: 1450, point, minute: 19.33 },
    { name: 'Lynch Street', along: 2325, point, minute: 31 },
  ],
};

describe('buildCheckpoints', () => {
  it('orders streets, merges the turnaround into a nearby street, ends at the finish', () => {
    const cps = buildCheckpoints(loop);
    expect(cps.map((c) => c.label)).toEqual([
      'Benson Street',
      'Broad Street',
      'Lynch Street',
      'back at the start',
    ]);
    expect(cps.at(-1)).toMatchObject({ id: 'finish', minute: 41, along: 3075 });
  });

  it('falls back to time marks when streets have no names', () => {
    const cps = buildCheckpoints({ ...loop, landmarks: [] });
    expect(cps.map((c) => c.label)).toEqual([
      'minute 10',
      'the turnaround point',
      'minute 31',
      'back at the start',
    ]);
  });

  it('covers the whole walk when the only checkpoint is early (found live with Gemma 4 E2B)', () => {
    // 44-minute loop, no street names, farthest point reached at minute 18. Before the fix the
    // time marks all landed in the first half and the main topic got 4 minutes.
    const unnamed: LoopForAgenda = {
      ...loop,
      distanceM: 3300,
      durationMin: 44,
      landmarks: [],
      farthest: { along: 1350, point, distanceM: 900 },
    };
    const cps = buildCheckpoints(unnamed);
    expect(cps.map((c) => c.label)).toEqual([
      'minute 11',
      'the turnaround point',
      'minute 33',
      'back at the start',
    ]);
    const segments = normalizeAgenda(
      [
        { topic: 'Q3 spend', prompt: '', weight: 2 },
        { topic: 'The decision', prompt: '', weight: 3 },
        { topic: 'Next steps', prompt: '', weight: 1 },
      ],
      cps,
    );
    expect(segments.map((s) => [s.topic, Math.round(s.startMin), Math.round(s.endMin)])).toEqual([
      ['Q3 spend', 0, 18],
      ['The decision', 18, 33],
      ['Next steps', 33, 44],
    ]);
  });
});

describe('normalizeAgenda', () => {
  const cps = buildCheckpoints(loop);

  it('gives each topic a share of the walk in proportion to its weight', () => {
    const segments = normalizeAgenda(
      [
        { topic: 'Q3 spend', prompt: 'Where did we land?', weight: 1 },
        { topic: 'Decide: program or laptops', prompt: 'Which one, and why?', weight: 3 },
        { topic: 'Next steps', prompt: 'Who does what?', weight: 1 },
      ],
      cps,
    );
    // Ideal boundaries at 8.2 and 32.8 min: Benson Street (6) and Lynch Street (31).
    expect(segments.map((s) => [s.topic, s.startMin, Math.round(s.endMin), s.untilLabel])).toEqual([
      ['Q3 spend', 0, 6, 'Benson Street'],
      ['Decide: program or laptops', 6, 31, 'Lynch Street'],
      ['Next steps', 31, 41, 'back at the start'],
    ]);
  });

  it('chains the segments without gaps and always ends at the finish', () => {
    const segments = normalizeAgenda(
      ['Status', 'Budget', 'Owners'].map((topic) => ({ topic, prompt: '', weight: 2 })),
      cps,
    );
    expect(segments.map((s) => s.topic)).toEqual(['Status', 'Budget', 'Owners']);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.startMin).toBe(segments[i - 1]!.endMin);
      expect(segments[i]!.startMin).toBeGreaterThan(segments[i - 1]!.startMin);
    }
    expect(segments.at(-1)).toMatchObject({ endMin: 41, untilLabel: 'back at the start' });
  });

  it('drops empty topics and returns nothing for an empty proposal', () => {
    expect(normalizeAgenda([{ topic: '  ', prompt: '' }], cps)).toEqual([]);
    expect(normalizeAgenda([], cps)).toEqual([]);
  });
});

describe('distributeTopics', () => {
  it('snaps equal weights to the checkpoints closest to an even split', () => {
    const cps = buildCheckpoints(loop);
    const segments = distributeTopics(
      [1, 2, 3].map((i) => ({ topic: `T${i}`, prompt: '' })),
      cps,
    );
    // Ideal boundaries at 13.7 and 27.3 min: Broad Street (19.3) and Lynch Street (31).
    expect(segments.map((s) => s.untilLabel)).toEqual([
      'Broad Street',
      'Lynch Street',
      'back at the start',
    ]);
  });
});

describe('agenda from the description', () => {
  it('reads numbered items', () => {
    expect(
      extractAgendaItems(
        'Agenda:\n1. Status of Q3 spend\n2. Decide: community program or new laptops\n3. Next steps and owners',
      ),
    ).toEqual([
      'Status of Q3 spend',
      'Decide: community program or new laptops',
      'Next steps and owners',
    ]);
  });

  it('falls back to sentences, ignoring links', () => {
    expect(
      extractAgendaItems(
        'Monthly check-in. How is the new role going? Join: https://meet.example.org/x',
      ),
    ).toEqual(['Monthly check-in', 'How is the new role going?']);
  });

  it('adds a wrap-up on the way back unless the agenda already ends with one', () => {
    const cps = buildCheckpoints(loop);
    const withItems = agendaHeuristic(
      { title: 'Budget', description: '1. Status\n2. Decision\n3. Next steps and owners' },
      cps,
    );
    expect(withItems.map((s) => s.topic)).toEqual(['Status', 'Decision', 'Next steps and owners']);

    const bare = agendaHeuristic({ title: 'Sync with Amara', description: '' }, cps);
    expect(bare.map((s) => s.topic)).toEqual([
      'Check-in',
      'Sync with Amara',
      'Decisions & next steps',
    ]);
    expect(bare.at(-1)!.untilLabel).toBe('back at the start');
  });
});
