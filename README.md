# Could've Been a Walk

> This meeting could have been a walk. So I built an AI that turns it into one.

Drop your calendar export into the app. A **Gemma model running on your own machine** reads your
upcoming meetings and tells you which ones could be a walk. Pick one, and the app draws a walking
loop that starts and ends at your office and lasts **exactly as long as the meeting**. It pins each
agenda item to a spot along the way. Your phone then keeps you on time with a **"TURN BACK NOW"**
alert, so you're back at your desk when the meeting ends.

Built for the DEV Hacktoberfest Open-Source AI Challenge, Week 1: _Touch Grass_.

> **Status:** v0.1.0: the full loop works (plan → score → route → agenda → invite → walk → TURN BACK NOW).

## How it works

1. **Plan** (laptop): drop a `.ics` export. No account, no OAuth, nothing uploaded.
2. **Score**: local Gemma rates each meeting's _walkability_ from 0 to 10 and gives a one-line reason.
3. **Route**: OpenStreetMap routing builds a walking loop that fits the meeting, minus a 3-minute buffer.
4. **Agenda on the map**: Gemma splits the agenda into segments pinned along the route.
5. **Invite**: export a new `.ics` invite with the route link and the agenda by segment.
6. **Walk** (phone): scan a QR code. Live GPS and your real pace decide when to **turn back now**.

## Quick start

You need Node 20.19+, pnpm 10 and [Ollama](https://ollama.com).

```bash
git clone https://github.com/kengnidoriane/could-have-been-a-walk.git && cd could-have-been-a-walk
pnpm install
ollama pull gemma4:e2b
pnpm dev
```

Open http://localhost:5173 and click **Try a sample week** (fake meetings), or drop your own `.ics`.
No Gemma model yet? The app still works with its fallback rules and tells you so in the header.

**On a phone:** GPS only works on HTTPS pages. Either deploy the static walk page and set
`VITE_PUBLIC_WALK_URL`, or run `pnpm dev:phone` and open the app through the network address Vite
prints (accept the self-signed certificate). On the walk page, **Demo: replay a walk at 10×** shows
TURN BACK NOW without leaving your chair.

## Configuration

| Variable               | Default                                        | What it does                                          |
| ---------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `OLLAMA_MODEL`         | `gemma4:e2b`                                   | Gemma model used by the local API (via Ollama)        |
| `OLLAMA_HOST`          | `http://127.0.0.1:11434`                       | Where Ollama listens                                  |
| `OSRM_BASE_URL`        | `https://routing.openstreetmap.de/routed-foot` | Any OSRM-compatible server with a foot profile        |
| `API_PORT`             | `8787`                                         | Local API port                                        |
| `VITE_PUBLIC_WALK_URL` | _(empty)_                                      | HTTPS URL of the deployed Walk page, used in QR codes |

## Privacy

- Your calendar is parsed in your browser and scored by a model **on your machine**. It is never uploaded.
- The local API listens on `127.0.0.1` only.
- The only network calls are map tiles (OpenStreetMap), walking routes (OSRM) and the rain forecast
  (Open-Meteo, with the start point rounded to ~1 km).
- No analytics, no accounts, no cookies.

## Credits

This project stands on open-source shoulders:

- **[Gemma](https://ai.google.dev/gemma)** by Google DeepMind: the open-weight model behind scoring, agendas and recaps.
- **[Ollama](https://ollama.com)** (MIT): runs Gemma locally.
- **[OpenStreetMap](https://www.openstreetmap.org/copyright)** contributors: map data © OpenStreetMap contributors, ODbL.
- **[OSRM](https://project-osrm.org)** (BSD-2-Clause) and the **[FOSSGIS](https://fossgis.de) routing server** at `routing.openstreetmap.de`: walking routes.
- **[ical.js](https://github.com/kewisch/ical.js)** (MPL-2.0): calendar parsing.
- **[Open-Meteo](https://open-meteo.com)** (data CC BY 4.0): the rain forecast.
- **[Leaflet](https://leafletjs.com)** (BSD-2-Clause): the maps.
- **[node-qrcode](https://github.com/soldair/node-qrcode)** (MIT): the QR handoff.
- **[Fraunces](https://fonts.google.com/specimen/Fraunces)** (SIL OFL 1.1, via Fontsource): the display font.
- **[Fastify](https://fastify.dev)** (MIT), **[React](https://react.dev)** (MIT), **[Vite](https://vite.dev)** (MIT), **[Zod](https://zod.dev)** (MIT), **[Vitest](https://vitest.dev)** (MIT).

## License

[MIT](./LICENSE) © 2026 Doriane Fosso

## Post-deadline commits

_None yet._
