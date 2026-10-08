import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { FakeLlm } from './fakeLlm';

describe('GET /api/health', () => {
  it('answers ok', async () => {
    const app = buildApp({ llm: new FakeLlm(null) });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });
});
