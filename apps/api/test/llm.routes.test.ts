import type { WalkRouter } from '@cbaw/core';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { FakeLlm } from './fakeLlm';

const noRouter: WalkRouter = {
  async route() {
    throw new Error('not used');
  },
};

async function call(llm: FakeLlm, method: 'GET' | 'POST', url: string, payload?: object) {
  const app = buildApp({ router: noRouter, llm });
  const res = await app.inject({ method, url, payload });
  await app.close();
  return res;
}

const amara = {
  id: 'one-on-one-amara',
  title: '1:1 with Amara - career check-in',
  description: 'Monthly check-in. Growth goals for Q1.',
  location: '',
  durationMin: 30,
  attendeeCount: 2,
  hasVideoLink: false,
};

const codeReview = {
  ...amara,
  id: 'code-review',
  title: 'Code review: payments refactor',
  description: "I'll share my screen.",
  attendeeCount: 4,
};

describe('GET /api/health', () => {
  it('reports which local model answers', async () => {
    const res = await call(new FakeLlm(() => ({})), 'GET', '/api/health');
    expect(res.json()).toMatchObject({ ok: true, llm: { model: 'gemma-test', available: true } });
  });

  it('says so when no model is available', async () => {
    const res = await call(new FakeLlm(null), 'GET', '/api/health');
    expect(res.json()).toMatchObject({ ok: true, llm: { model: null, available: false } });
  });
});

describe('POST /api/score', () => {
  it("turns Gemma's classification into a score, one model call per meeting", async () => {
    const llm = new FakeLlm(() => ({
      kind: 'one_on_one',
      needsScreen: false,
      reason: '1:1 career talk, nothing to look at',
    }));
    const res = await call(llm, 'POST', '/api/score', { meetings: [amara, codeReview] });

    expect(res.statusCode).toBe(200);
    expect(res.json().scores[0]).toEqual({
      id: 'one-on-one-amara',
      kind: 'one_on_one',
      needsScreen: false,
      score: 10,
      reason: '1:1 career talk, nothing to look at',
      source: 'gemma',
      model: 'gemma-test',
      ms: 12,
    });
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[0]!.user).toContain('People: 2 (organizer included)');
    expect(llm.requests[0]!.user).toContain('"""\nMonthly check-in.');
  });

  it('lets the formula, not the model, weigh headcount and screens', async () => {
    const llm = new FakeLlm(() => ({ kind: 'decision', needsScreen: true, reason: 'Spreadsheet' }));
    const res = await call(llm, 'POST', '/api/score', { meetings: [codeReview] });
    // decision (8) capped at 2 by the screen, minus 2 for 4 people, minus 1 for remote = 0
    expect(res.json().scores[0]).toMatchObject({ source: 'gemma', score: 0 });
  });

  it('falls back to the heuristic when the model is unavailable', async () => {
    const res = await call(new FakeLlm(null), 'POST', '/api/score', { meetings: [codeReview] });
    expect(res.json().scores[0]).toMatchObject({
      id: 'code-review',
      source: 'heuristic',
      score: 0,
      kind: 'review',
    });
  });

  it('falls back when the model invents a category', async () => {
    const llm = new FakeLlm(() => ({ kind: 'nap', needsScreen: false, reason: 'zzz' }));
    const res = await call(llm, 'POST', '/api/score', { meetings: [amara] });
    expect(res.json().scores[0].source).toBe('heuristic');
  });

  it('rejects malformed requests', async () => {
    const res = await call(new FakeLlm(null), 'POST', '/api/score', { meetings: [] });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/agenda', () => {
  const point = { lat: 6.31, lon: -10.8 };
  const body = {
    meeting: {
      title: 'Q4 budget decision with Kofi',
      description: 'Agenda:\n1. Status of Q3 spend\n2. Decide: program or laptops\n3. Next steps',
      durationMin: 45,
      attendeeCount: 2,
    },
    loop: {
      distanceM: 3075,
      durationMin: 41,
      speedKmh: 4.5,
      farthest: { along: 1500, distanceM: 900, point },
      landmarks: [
        { name: 'Benson Street', along: 450, minute: 6, point },
        { name: 'Broad Street', along: 1450, minute: 19.3, point },
        { name: 'Lynch Street', along: 2325, minute: 31, point },
      ],
    },
  };

  it("lays Gemma's weighted topics out along the route's checkpoints", async () => {
    const llm = new FakeLlm(() => ({
      segments: [
        { topic: 'Q3 spend', prompt: 'Where did we land?', weight: 1 },
        { topic: 'The decision', prompt: 'Program or laptops?', weight: 3 },
        { topic: 'Owners', prompt: 'Who does what?', weight: 1 },
      ],
    }));
    const res = await call(llm, 'POST', '/api/agenda', body);

    expect(res.json().source).toBe('gemma');
    expect(res.json().segments.map((s: { untilLabel: string }) => s.untilLabel)).toEqual([
      'Benson Street',
      'Lynch Street',
      'back at the start',
    ]);
    expect(llm.requests[0]!.user).toContain('Walk: 41 minutes.');
  });

  it('falls back to the description when the answer is invalid', async () => {
    const llm = new FakeLlm(() => ({ segments: [{ topic: 'Only one', prompt: '', weight: 9 }] }));
    const res = await call(llm, 'POST', '/api/agenda', body);
    expect(res.json().source).toBe('heuristic');
    expect(res.json().segments.map((s: { topic: string }) => s.topic)).toEqual([
      'Status of Q3 spend',
      'Decide: program or laptops',
      'Next steps',
    ]);
  });
});
