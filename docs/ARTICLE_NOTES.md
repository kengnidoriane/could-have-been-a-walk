# Article notes (running log for the DEV post)

Raw material for the write-up. Numbers, decisions, moments, and screenshots to take.

## Hook ideas

- "This meeting could have been an email" → "…could have been a walk". The joke everyone already knows.
- The hard part isn't the AI, it's the clock. A walking meeting fails when you're 12 minutes from the
  office and the meeting ends in 5. Hence **TURN BACK NOW**.
- Monrovia, Liberia: connectivity drops. The model runs on the laptop and the walk page runs on the
  phone with no server. Both keep working when the network doesn't.

## M0 · Scaffold (2026-10-07)

- pnpm monorepo: `apps/web` (Vite + React), `apps/api` (Fastify), `packages/core` (pure logic + tests).
- Found **Gemma 4** in the Ollama library: E2B (~4.6 GB) and E4B (~6.6 GB). Picked E4B for a 16 GB
  laptop. Until it's pulled, the app falls back to the `gemma3:4b` already on the machine.
- Toolchain surprise: TypeScript 7 (native Go compiler) was "latest", but typescript-eslint doesn't
  support it yet. Pinned 6.0. A small reminder that the newest isn't always the right choice in a 4-day sprint.

### Screenshots to take

- (none yet)
