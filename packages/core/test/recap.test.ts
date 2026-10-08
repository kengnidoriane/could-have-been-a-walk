import { describe, expect, it } from 'vitest';
import { recapHeuristic, recapToText } from '../src/recap';

const memo = `We looked at the Q3 spend, it came in under budget. We decided to fund the community
program instead of new laptops. Kofi will draft the program budget by Friday. Amara to call the
youth centre next week. Nice walk by the way.`;

describe('recapHeuristic', () => {
  const recap = recapHeuristic(memo);

  it('finds the decision', () => {
    expect(recap.decisions).toEqual([
      'We decided to fund the community program instead of new laptops.',
    ]);
  });

  it('finds action items with owners and due dates', () => {
    expect(recap.actions).toEqual([
      { task: 'Kofi will draft the program budget by Friday', owner: 'Kofi', due: 'Friday' },
      { task: 'Amara to call the youth centre next week', owner: 'Amara', due: '' },
    ]);
  });

  it('never invents anything from small talk', () => {
    expect(recapHeuristic('Nice walk. Great weather.')).toMatchObject({
      decisions: [],
      actions: [],
    });
  });
});

describe('recapToText', () => {
  it('formats a recap for chat or email', () => {
    const text = recapToText('Q4 budget decision', {
      summary: 'Under budget; community program funded.',
      decisions: ['Fund the community program'],
      actions: [{ task: 'Draft the program budget', owner: 'Kofi', due: 'Friday' }],
    });
    expect(text).toBe(
      [
        'Walking meeting recap: Q4 budget decision',
        '',
        'Under budget; community program funded.',
        '',
        'Decisions:',
        '- Fund the community program',
        '',
        'Action items:',
        '- Draft the program budget (Kofi, Friday)',
      ].join('\n'),
    );
  });
});
