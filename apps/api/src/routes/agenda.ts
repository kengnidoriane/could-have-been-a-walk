import { agendaHeuristic, buildCheckpoints, normalizeAgenda, type AgendaSegment } from '@cbaw/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { JsonLlm } from '../llm/ollama';
import { AGENDA_SYSTEM, agendaUserPrompt } from '../llm/prompts';
import { LatLonSchema } from './loop';

const AgendaBody = z.object({
  meeting: z.object({
    title: z.string().max(500),
    description: z.string().max(10_000).default(''),
    durationMin: z
      .number()
      .min(0)
      .max(24 * 60),
    attendeeCount: z.number().int().min(0).max(100_000),
  }),
  loop: z.object({
    distanceM: z.number().positive(),
    durationMin: z.number().positive(),
    speedKmh: z.number().positive(),
    landmarks: z
      .array(
        z.object({
          name: z.string().max(200),
          along: z.number().min(0),
          minute: z.number().min(0),
          point: LatLonSchema,
        }),
      )
      .max(20),
    farthest: z.object({
      along: z.number().min(0),
      distanceM: z.number().min(0),
      point: LatLonSchema,
    }),
  }),
});

export const AgendaAnswer = z.object({
  segments: z
    .array(
      z.object({
        topic: z.string().min(2).max(60),
        prompt: z.string().max(120),
        weight: z.number().int().min(1).max(3),
      }),
    )
    .min(2)
    .max(4),
});

export interface AgendaResult {
  segments: AgendaSegment[];
  source: 'gemma' | 'heuristic';
  model?: string;
  ms?: number;
}

export function registerAgendaRoutes(app: FastifyInstance, deps: { llm: JsonLlm }) {
  app.post('/api/agenda', async (request, reply): Promise<AgendaResult | undefined> => {
    const parsed = AgendaBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: z.prettifyError(parsed.error) });
    }
    const { meeting, loop } = parsed.data;
    const checkpoints = buildCheckpoints(loop);

    try {
      const { data, model, ms } = await deps.llm.chatJson({
        system: AGENDA_SYSTEM,
        user: agendaUserPrompt(meeting, loop),
        schema: AgendaAnswer,
        temperature: 0.3,
      });
      const segments = normalizeAgenda(data.segments, checkpoints);
      if (segments.length === 0) throw new Error('empty agenda');
      request.log.info({ model, ms, segments: segments.length }, 'agenda planned');
      return { segments, source: 'gemma', model, ms };
    } catch (err) {
      request.log.warn({ err: (err as Error).message }, 'agenda fell back to heuristics');
      return { segments: agendaHeuristic(meeting, checkpoints), source: 'heuristic' };
    }
  });
}
