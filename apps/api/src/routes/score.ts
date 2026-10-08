import {
  MEETING_KINDS,
  scoreFromSignals,
  scoreWalkabilityHeuristic,
  type WalkabilityScore,
} from '@cbaw/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { JsonLlm } from '../llm/ollama';
import { SCORE_SYSTEM, scoreUserPrompt } from '../llm/prompts';

const MeetingSchema = z.object({
  id: z.string().min(1).max(500),
  title: z.string().max(500),
  description: z.string().max(10_000).default(''),
  location: z.string().max(1000).default(''),
  durationMin: z
    .number()
    .min(0)
    .max(24 * 60),
  attendeeCount: z.number().int().min(0).max(100_000),
  hasVideoLink: z.boolean().default(false),
});

const ScoreBody = z.object({ meetings: z.array(MeetingSchema).min(1).max(20) });

/** Gemma classifies and explains; `scoreFromSignals` turns that into the 0–10 score. */
export const SignalsAnswer = z.object({
  kind: z.enum(MEETING_KINDS),
  needsScreen: z.boolean(),
  reason: z.string().min(3).max(120),
});

export interface ScoreResult extends WalkabilityScore {
  id: string;
  source: 'gemma' | 'heuristic';
  model?: string;
  ms?: number;
}

export function registerScoreRoutes(app: FastifyInstance, deps: { llm: JsonLlm }) {
  app.post('/api/score', async (request, reply) => {
    const parsed = ScoreBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: z.prettifyError(parsed.error) });
    }

    // One meeting per model call: small models judge one thing at a time much better.
    const scores: ScoreResult[] = [];
    for (const meeting of parsed.data.meetings) {
      try {
        const { data, model, ms, stats } = await deps.llm.chatJson({
          system: SCORE_SYSTEM,
          user: scoreUserPrompt(meeting),
          schema: SignalsAnswer,
        });
        const score = scoreFromSignals(data, meeting);
        request.log.info({ model, ms, stats, kind: data.kind, score }, 'scored');
        scores.push({
          id: meeting.id,
          kind: data.kind,
          needsScreen: data.needsScreen,
          score,
          reason: data.reason.trim(),
          source: 'gemma',
          model,
          ms,
        });
      } catch (err) {
        request.log.warn({ err: (err as Error).message }, 'scoring fell back to heuristics');
        scores.push({ id: meeting.id, ...scoreWalkabilityHeuristic(meeting), source: 'heuristic' });
      }
    }
    return { scores };
  });
}
