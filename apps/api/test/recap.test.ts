import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { groundedActions } from '../src/routes/recap';
import { AudioUnsupportedError } from '../src/llm/ollama';
import { FakeLlm } from './fakeLlm';

const notes = 'We decided to fund the community program. Kofi will draft the budget by Friday.';

async function post(llm: FakeLlm, payload: object) {
  const app = buildApp({ llm, router: { route: async () => Promise.reject(new Error('unused')) } });
  const res = await app.inject({ method: 'POST', url: '/api/recap', payload });
  await app.close();
  return res;
}

describe('POST /api/recap', () => {
  it("refuses to process anything without everyone's consent", async () => {
    const res = await post(new FakeLlm(() => ({})), { title: 'Budget', notes });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/agree/);
  });

  it('turns typed notes into decisions and action items with Gemma', async () => {
    const llm = new FakeLlm(() => ({
      summary: 'Community program funded.',
      decisions: ['Fund the community program'],
      actions: [{ task: 'Draft the budget', owner: 'Kofi', due: 'Friday' }],
    }));
    const res = await post(llm, { consent: true, title: 'Budget', notes });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      source: 'gemma',
      transcript: notes,
      recap: { actions: [{ owner: 'Kofi', due: 'Friday' }] },
    });
    expect(llm.requests[0]!.user).toContain('Kofi will draft the budget');
  });

  it('falls back to the keyword recap when the model is down', async () => {
    const res = await post(new FakeLlm(null), { consent: true, title: 'Budget', notes });
    expect(res.json()).toMatchObject({
      source: 'heuristic',
      recap: { decisions: ['We decided to fund the community program.'] },
    });
  });

  it('transcribes audio first when the model can hear', async () => {
    const llm = new FakeLlm(() => ({ summary: 's', decisions: [], actions: [] }));
    llm.heard = 'Amara will call the youth centre.';
    const res = await post(llm, { consent: true, title: 'Budget', audio: ['UklGRg=='] });
    expect(res.json()).toMatchObject({
      transcript: 'Amara will call the youth centre.',
      transcribedBy: 'gemma-test',
    });
  });

  it('says clearly when the model cannot listen', async () => {
    const llm = new FakeLlm(() => ({}));
    llm.heard = new AudioUnsupportedError("gemma3:4b can't listen to audio. Pull gemma4:e2b.");
    const res = await post(llm, { consent: true, title: 'Budget', audio: ['UklGRg=='] });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ error: 'audio_unsupported' });
  });

  it('needs a recording or notes', async () => {
    const res = await post(new FakeLlm(null), { consent: true, title: 'Budget', notes: '  ' });
    expect(res.statusCode).toBe(400);
  });
});

describe('groundedActions', () => {
  const said =
    'Kofi is going to draft the program budget by Friday. Amara will call the youth centre. I will tell finance tomorrow.';

  it('keeps commitments that were said and drops padding', () => {
    const recap = groundedActions(
      {
        summary: '',
        decisions: [],
        actions: [
          { task: 'Draft the program budget', owner: 'Kofi', due: 'Friday' },
          { task: 'Call the youth centre', owner: 'Amara', due: '' },
          { task: 'Tell finance', owner: 'unassigned', due: 'tomorrow' },
          { task: 'Monitor Q3 spend', owner: 'unassigned', due: '' },
          { task: 'Prepare January laptop purchase plan', owner: 'unassigned', due: '' },
          { task: 'Update budget allocation', owner: 'unassigned', due: '' },
        ],
      },
      said,
    );
    expect(recap.actions.map((a) => a.task)).toEqual([
      'Draft the program budget',
      'Call the youth centre',
      'Tell finance',
    ]);
  });
});
