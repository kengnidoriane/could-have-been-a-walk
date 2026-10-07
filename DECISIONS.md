# Decisions

Short, dated log of choices made while building. Newest last.

## D-001 · New folder, new repo (2026-10-07)

The session started inside an unrelated repo (`CleanCity-AI`) with uncommitted work. The challenge
requires a **new** project, so this lives in its own folder and git history:
`Documents/Dev challenge/could-have-been-a-walk`.

## D-002 · Model: Gemma 4 E4B by default, Gemma 3 4B until it is pulled (2026-10-07)

- Machine: 16 GB RAM, Ollama 0.35.1. Models of 12B and up are ruled out (too heavy next to the dev tools).
- The Ollama library has the Gemma 4 "effective" sizes: `gemma4:e2b` (~4.6 GB, q4_K_M) and
  `gemma4:e4b` (~6.6 GB, q4_K_M, also `gemma4:latest`). E4B is the largest variant that fits
  comfortably, so it is the default: `ollama pull gemma4:e4b`.
- Lighter fallback if RAM gets tight while screen-recording: `ollama pull gemma4:e2b`.
- Already installed and tested: `gemma3:4b`. The API asks Ollama which models are installed and uses
  the first available of `OLLAMA_MODEL`, `gemma4:e4b`, `gemma4:e2b`, `gemma3:4b`. Nothing breaks
  before the pull.
- Thinking stays **off** (no `<|think|>` token in the system prompt): we want short, structured JSON
  fast. E2B/E4B emit no empty thought block when thinking is off.
- Audio: the model card says E2B/E4B accept audio, and a mirrored Ollama release note (v0.33.3) describes
  Gemma 4 audio input via the API. To verify on this machine in M7 before relying on it.

## D-003 · Toolchain versions (2026-10-07)

- TypeScript pinned to **6.0.x**: TypeScript 7 (native) is out, but `typescript-eslint` 8 supports `<6.1`.
- `@types/node` pinned to 20.x to match the Node 20.19 runtime (Vitest 5 prints a peer warning
  asking for 22+; tests run fine on 20).
- Vite 8, Vitest 5, ESLint 10 (flat config), React 19, Fastify 5, Zod 4 (built-in JSON Schema export,
  which we pass straight to Ollama's `format`).
- The API runs TypeScript directly with `tsx` (no build step: it is a local tool, not a deployed service).
- `packages/core` is consumed as TypeScript source through `exports`, so Vite and tsx compile it
  in place. No build or watch step between packages.
