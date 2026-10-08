import { findLoop, NoLoopError, RouterUnavailableError, type WalkRouter } from '@cbaw/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export const LatLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const LoopBody = z.object({
  start: LatLonSchema,
  minutes: z.number().min(10).max(240),
  bufferMin: z.number().min(0).max(30).optional(),
  speedKmh: z.number().min(2).max(7).optional(),
  seed: z.number().int().optional(),
});

export function registerLoopRoutes(app: FastifyInstance, deps: { router: WalkRouter }) {
  app.post('/api/loop', async (request, reply) => {
    const parsed = LoopBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: z.prettifyError(parsed.error) });
    }

    const startedAt = performance.now();
    try {
      const loop = await findLoop(deps.router, parsed.data);
      const elapsedMs = Math.round(performance.now() - startedAt);
      request.log.info(
        {
          routingCalls: loop.routingCalls,
          error: loop.error,
          overlap: loop.overlapRatio,
          elapsedMs,
        },
        'loop found',
      );
      return { ...loop, elapsedMs };
    } catch (err) {
      if (err instanceof NoLoopError) {
        return reply.code(422).send({ error: 'no_loop', message: err.message });
      }
      if (!(err instanceof RouterUnavailableError)) throw err;
      request.log.warn(err.message);
      return reply.code(502).send({
        error: 'routing_unavailable',
        message: "The walking-route service didn't answer. Check the connection and try again.",
      });
    }
  });
}
