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

## M1 · Calendar in, calendar out (2026-10-08)

- `packages/core/ics.ts` reads a real-world `.ics`: time zones (a Paris meeting lands at the right
  UTC minute), weekly recurrences with a skipped day and a moved occurrence, all-day and cancelled
  events dropped, meeting rooms not counted as people, Zoom/Meet/Teams links flagged.
- The walking invite we generate is parsed back by ical.js in the tests (round-trip), folded to 75
  octets and CRLF, as RFC 5545 asks. Calendar apps are picky, so the tests check that.
- `geo.ts` gotcha worth a sentence: on a **loop**, the start and the finish are the same point. "Where
  am I on the route?" has two right answers at the office. The projection takes a search window, and
  ties go to the start. This matters a lot for TURN BACK NOW later.
- 30 unit tests at the end of M1.

## M2 · A loop that lasts exactly one meeting (2026-10-08)

- `findLoop` places 3 waypoints on a circle that passes through the office (an inscribed square),
  then adjusts the radius with a bounded search: proportional steps, then regula falsi once the
  target is bracketed. Several directions are tried and the best loop wins.
- **The unit tests were green, and the first live run was still bad.** Real numbers from Monrovia,
  30-minute meeting → 27-minute target (2.03 km at 4.5 km/h):
  - v1: within ±5%, but the "loops" retraced 26–40% of their length (dead-end alleys).
  - v2 (cut every dead end): −38% misses. Clean loop lengths are _quantized_ by the street network:
    1.26 km, 1.92 km, then 4.2 km, and 2 m of radius can jump from one to the next.
  - v3 (cut only short spurs, skip directions where waypoints snap far into water, opposite
    directions first): downtown **+0.2%, +4.7%, +4.6%, 0% retraced**; Sinkor grid **−2.6%, −0.1%,
    −3.3%, ~23% retraced**. 7–12 routing calls, 8–13 s at the volunteer server's 1 request/second.
- Story line: **Monrovia is squeezed between the Atlantic and the Mesurado River.** Half of any
  circle you draw is water. OSRM tells you how far it had to move each waypoint to find a path:
  that number is a free "this is the ocean" detector.
- Honest limit: in a cul-de-sac neighbourhood (Lakpazee) there are no loops, only out-and-backs.
  The app says so instead of pretending.
- `pnpm --filter @cbaw/api try-loop <lat> <lon> <minutes> <runs>` reproduces these numbers.

### Screenshots to take

- (none yet)
