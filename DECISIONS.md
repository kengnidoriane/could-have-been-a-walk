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
- Thinking stays **off**: we want short, structured JSON fast. Correction (2026-10-09, after pulling
  `gemma4:e2b`): in Ollama, Gemma 4 thinks **by default** (`ollama show`: thinking, default true),
  so every request now sends `think: false`. Measured on the voice memo: 445 output tokens (378 of
  them hidden reasoning, 62 s) with thinking, 67 tokens (9 s) without. Gemma 3 accepts the flag too.
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

## D-004 · Loop geometry: a square inscribed in a circle _through_ the start (2026-10-08)

The brief says "3 waypoints on a circle around the start". A circle **centred** on the start makes the
walk go out along a radius and come back along another, which retraces steps near the office.
Instead, the circle passes **through** the start: its centre is `r` metres away at a random bearing,
and the start plus the 3 waypoints are the corners of an inscribed square. The walk heads out one way
and comes back from the other side. Initial radius: target / (4·√2 × 1.3 street-detour factor).

## D-005 · Loop search tuned on real Monrovia streets (2026-10-08)

Live runs against OSRM showed two things the unit tests could not:

1. **Short dead ends.** Waypoints snap into alleys, so the route walks in and back out. Out-and-back
   detours of ≤150 m round trip are cut (`removeSpurs`). Longer ones stay ("to the beach and back"):
   in a sparse network they are what makes a loop the right length. Cutting _all_ spurs made distance
   jump around with the radius and broke the search (−38% misses).
2. **Water.** Monrovia sits between the Atlantic and the Mesurado River. Half of any circle can be
   water, and waypoints snap onto the coast road. OSRM reports each waypoint's snapping distance;
   if one jumps more than max(60 m, r/2), that bearing is abandoned after one probe. Bearings are
   tried opposite-first (θ, θ+180°, θ+90°, …), up to 6, with 4 probes each and 12 calls in total.

Scoring: any loop within ±5% beats any loop outside it; among those, the one that retraces the least
wins. The search stops early once a loop is within ±5% and retraces at most 25%.

## D-006 · Being polite to the public routing server (2026-10-08)

`routing.openstreetmap.de` is run by FOSSGIS volunteers. The API sends a descriptive User-Agent,
queues requests at most one per 1.1 s, rounds coordinates to 5 decimals (≈1 m) and caches every
answer in memory and on disk (`apps/api/.cache/osrm`). `OSRM_BASE_URL` points to any OSRM-compatible
server: the `WalkRouter` interface in `packages/core` is all the loop search needs.

## D-007 · Gemma reads, a formula weighs (2026-10-08)

First version: Gemma returned `{score, reason}` directly. On the sample week, Gemma 3 4B gave
"Q4 budget decision with Kofi" (2 people) **3/10** and a mentoring call 6/10 with the reason
"1:1 mentoring, no screen needed". Putting `reason` before `score` (the schema's key order is
enforced by the grammar) and adding calibration examples made it _worse_: an 8-person stand-up got
8/10 and mentoring got 1/10.

Small models are good readers and bad judges of numbers. So Gemma now **classifies**: `kind`
(one_on_one, mentoring, decision, review, presentation…), `needsScreen`, and a one-line `reason`.
`scoreFromSignals` in `packages/core` turns that into 0–10 with one visible formula (kind base,
screen cap, headcount, length, remote attendees). The keyword fallback produces the same signals
and goes through the same formula. Result on the sample week: every score matches intuition.
Gemma's added value is reading free text (any language, any phrasing), not doing arithmetic.

Same lesson for agendas. Asked to choose which checkpoint ends each topic, Gemma gave the main
decision 3 minutes and the wrap-up 20. Now Gemma writes the topics, opening questions and a
weight (1 short, 2 medium, 3 long). Code places the boundaries on the route's checkpoints in
proportion to the weights.

## D-008 · Structured output: JSON schema in Ollama's `format` (2026-10-08)

Measured on this laptop with the real scoring prompt (3 meetings each): JSON-schema `format`
16.6–17.2 s, `format: "json"` 19.4–28.2 s, no format 19.1–25.7 s (which also wraps answers in
markdown fences). The constrained grammar is the fastest _and_ the safest. Answers are still
validated with zod; one retry feeds the validation error back; then the deterministic fallback.

## D-009 · Default model: gemma4:e2b (supersedes part of D-002) (2026-10-08)

`ollama ps` shows **100% CPU**: Intel i5-8265U (4 cores, 2018), Intel UHD 620, no usable GPU.
With Gemma 3 4B, one meeting takes 15–20 s: ~270 prompt tokens read at ~25 tok/s, ~35 tokens
written at ~4 tok/s. Ollama did not reuse the cached prompt prefix between calls, so the system
prompt was cut to the essentials.
E2B has half the effective parameters of a 4B model, about twice as fast on CPU, and is a smaller
download on an unstable connection. Default `OLLAMA_MODEL=gemma4:e2b`; fallbacks: gemma4:e4b,
then gemma3:4b. To pull: `ollama pull gemma4:e2b` (optionally `ollama pull gemma4:e4b` to compare
with `pnpm --filter @cbaw/api try-score`).

## D-010 · Background scoring yields to the meeting being planned (2026-10-08)

Ollama answers one request at a time. The Plan page scores meetings one by one (earliest first) so
the list fills in progressively. The Route page pauses that queue after the current meeting, so
its agenda request doesn't wait behind the rest of the week.

## D-011 · TURN BACK NOW at the last responsible moment (2026-10-08)

Read literally, "ETA_loop > end − 2 min and the direct return fits" fires as soon as the full loop
looks too long. For a slow walker that's after 90 seconds: the loop doesn't fit, but going back
does. That's useless advice. The rule as built:

- **ON_TRACK** while the loop fits (ETA by the loop ≤ end − 2 min).
- When it doesn't (by more than a minute, to start with), and the shortest way back is meaningfully
  quicker than finishing the loop, the walkers can **keep going** while the way back still leaves
  more than a minute of slack ("The full loop won't fit. We'll tell you when to turn back").
- **TURN_BACK_NOW** when that slack drops under a minute. Shortest way back = straight line × 1.3,
  replaced by one OSRM route from the phone once it starts to matter (again after moving 150 m).
- **SUGGEST_EXTENSION** when the loop leaves 6+ minutes spare after 40% of the walk.
- Debounced: a decision must hold 15 s (immediately if even the way back is already late).
  TURN_BACK is sticky until arrival. Leaving it needs a clear recovery held for a minute.
- Once heading back, the agenda jumps to the last segment: turning back means wrapping up.

## D-012 · Pace: least-squares slope over moving time (2026-10-08)

The browser replay showed the "won't fit" hint blinking and "back at" jumping ±2 minutes with 6 m
of GPS noise. Fix, in order of effect: (1) the pace is the least-squares slope of progress over
the last two minutes, with 30-second chunks spent standing still cut out (the clock already counts
the stop); (2) it only replaces the planned pace after a minute of walking, and fully after two;
(3) it is smoothed from fix to fix (α = 0.25); (4) the hint has hysteresis and a 30 s hold.
A test now asserts zero blinks for an on-pace walker with 12 m noise and junk fixes.

## D-013 · Demo mode: a scripted walk, and recorded walks replayed (2026-10-08, 2026-10-09)

Two replays at 10×. **Recorded:** every real GPS walk is kept on the phone (last 3, keyed by the
walk link, never sent anywhere) and the start screen offers "Replay my recorded walk at 10×", which
feeds the real fixes through the same engine; "Forget it" deletes it. **Scripted** (always there,
for filming TURN BACK NOW): the demo walker is (`demoWalkLegs`): normal pace for 30% of the loop, a 6-minute chat, then 90% pace. It runs
out of time reliably, so TURN BACK NOW always happens on camera (around minute 28 of a 45-minute
meeting, ~2.8 minutes of real time at 10×). After "We're heading back", the virtual walkers take
the OSRM way back. Fixes get 4 m of jitter. The same `VirtualWalker` drives the unit tests.

## D-014 · Recap: on the laptop, Gemma's own ears, typed notes as the fallback (2026-10-08)

- **Where:** the phone has no model, and the audio must not leave the device. So the recap
  happens back at the desk, on the laptop that runs Gemma: the browser records, converts to 16 kHz
  mono WAV in pieces of at most 30 s (Gemma's audio window), and posts only to `127.0.0.1`. The
  audio is never written to disk, on either side.
- **Speech to text:** Gemma 4 E2B/E4B have an audio encoder, and Ollama (≥ 0.33.3, here 0.35.1)
  takes audio through the same field as images. That keeps the whole pipeline on one open model,
  so whisper.cpp isn't needed. Gemma 3 4B (the only model pulled when this was built) can't hear:
  the API answers 501 with "Pull gemma4:e2b, or type your notes". Verified on 2026-10-09 with
  `gemma4:e2b` (`ollama show` lists the audio capability): a 21-second spoken memo was transcribed
  word for word, through the API and through the browser's own WAV conversion.
- **Typed notes** go through the same summarizer, so the recap works with any model.
- **Consent is enforced by the API** (`consent: true` or 400), not only by the checkbox.

## D-015 · Grounded action items (2026-10-08)

First live recap (Gemma 3 4B): summary, decisions and the 3 real action items were right, then it
padded the list to 8 with invented tasks ("Monitor Q3 spend", "Prepare January laptop purchase
plan"). Fixes: the prompt says most walks produce 0–4 items and an empty list is fine, the schema
allows 6 at most, and `groundedActions` drops items whose owner, due date or most of whose words
don't appear in what was said. Second run: exactly the 3 real items, in 44 s.

## D-016 · Weather and the weekly stat (2026-10-08)

- **Rain:** the Route page asks Open-Meteo (free, no key, CC BY 4.0) for the hourly forecast at
  the start point, rounded to 2 decimals (~1 km): enough for weather, and the service doesn't
  learn the exact office. Warning when the meeting's hours reach ≥ 60% chance or ≥ 2 mm. The
  fix offered is a **shorter loop** (60% of the meeting, at least 15 min): walk the important
  part, finish at the desk. The phone's "back by" moves earlier to match.
- **Weekly stat:** walks are saved where they happen (the phone's localStorage), so the stat
  shows on the phone's start and arrival screens, and on the laptop for walks run there. Demo
  replays count but are labelled. Records use real time, not the replay's simulated clock.

## D-017 · Final audit against the brief (2026-10-09)

- Gemma 4 E2B (the default) checked live on every AI step: scoring the sample week gives the same
  classifications as Gemma 3 4B in ~9–10 s per meeting instead of 15–20 s; agendas in ~12–16 s
  instead of ~40 s; voice recap verified (D-014).
- Two bugs found by running it, both fixed with tests: time-mark checkpoints could all land in the
  first half of an unnamed loop (main topic squeezed to 4 minutes); Gemma 4 wrote agenda topics as
  questions.
- Two literal gaps closed: the loop now also comes as GeoJSON (the brief asks loop.ts for it), and
  demo mode can replay a really recorded GPS track (D-013).
