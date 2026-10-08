import { recapHeuristic, type Recap } from '@cbaw/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AudioUnsupportedError, type JsonLlm } from '../llm/ollama';
import { RECAP_SYSTEM, recapUserPrompt } from '../llm/prompts';

const RecapBody = z
  .object({
    // Recording people needs their yes. The server refuses without it, whatever the UI does.
    consent: z.literal(true, { error: 'Everyone on the walk must agree to the recap.' }),
    title: z.string().max(300),
    notes: z.string().max(20_000).optional(),
    /** Base64 WAV, at most 30 s each, at most 6 minutes in total. */
    audio: z.array(z.string().max(1_500_000)).max(12).optional(),
    language: z.string().max(40).default('English'),
  })
  .refine((b) => (b.notes?.trim().length ?? 0) > 0 || (b.audio?.length ?? 0) > 0, {
    message: 'Send a recording or some notes.',
  });

export const RecapAnswer = z.object({
  summary: z.string().max(400),
  decisions: z.array(z.string().max(200)).max(5),
  actions: z
    .array(
      z.object({ task: z.string().max(200), owner: z.string().max(60), due: z.string().max(60) }),
    )
    .max(6),
});

const words = (text: string) => text.toLowerCase().match(/[a-z0-9']{4,}/g) ?? [];

/**
 * Small models pad lists ("Monitor Q3 spend", which nobody said). Keep an action item only if
 * it is anchored in what was said: its owner or due date appears in the text, or most of its
 * words do.
 */
export function groundedActions(recap: Recap, transcript: string): Recap {
  const said = new Set(words(transcript));
  const text = transcript.toLowerCase();
  const actions = recap.actions.filter((a) => {
    if (a.owner !== 'unassigned' && text.includes(a.owner.toLowerCase())) return true;
    if (a.due && text.includes(a.due.toLowerCase())) return true;
    const w = words(a.task);
    return w.length > 0 && w.filter((x) => said.has(x)).length / w.length >= 0.6;
  });
  return { ...recap, actions };
}

export interface RecapResult {
  transcript: string;
  recap: Recap;
  source: 'gemma' | 'heuristic';
  model?: string;
  transcribedBy?: string;
}

export function registerRecapRoutes(app: FastifyInstance, deps: { llm: JsonLlm }) {
  app.post('/api/recap', { bodyLimit: 16 * 1024 * 1024 }, async (request, reply) => {
    const parsed = RecapBody.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'invalid_request', message: z.prettifyError(parsed.error) });
    }
    const { title, notes, audio, language } = parsed.data;

    // 1. Speech to text, on this machine. The audio is not written anywhere.
    let transcript = notes?.trim() ?? '';
    let transcribedBy: string | undefined;
    if (audio && audio.length > 0) {
      if (!deps.llm.transcribe) {
        return reply
          .code(501)
          .send({ error: 'audio_unsupported', message: 'No model can listen.' });
      }
      try {
        const heard = await deps.llm.transcribe(audio, language);
        transcript = [heard.text, transcript].filter(Boolean).join('\n\n');
        transcribedBy = heard.model;
        request.log.info({ model: heard.model, ms: heard.ms, chunks: audio.length }, 'transcribed');
      } catch (err) {
        if (err instanceof AudioUnsupportedError) {
          return reply.code(501).send({ error: 'audio_unsupported', message: err.message });
        }
        throw err;
      }
    }

    // 2. Decisions, action items, owners.
    try {
      const { data, model, ms } = await deps.llm.chatJson({
        system: RECAP_SYSTEM,
        user: recapUserPrompt(title, transcript),
        schema: RecapAnswer,
        timeoutMs: 240_000,
      });
      const recap = groundedActions(data, transcript);
      request.log.info(
        { model, ms, dropped: data.actions.length - recap.actions.length },
        'recap written',
      );
      return {
        transcript,
        recap,
        source: 'gemma',
        model,
        transcribedBy,
      } satisfies RecapResult;
    } catch (err) {
      request.log.warn({ err: (err as Error).message }, 'recap fell back to heuristics');
      return {
        transcript,
        recap: recapHeuristic(transcript),
        source: 'heuristic',
        transcribedBy,
      } satisfies RecapResult;
    }
  });
}
