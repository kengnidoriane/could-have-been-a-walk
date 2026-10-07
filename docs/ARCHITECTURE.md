# Architecture

```mermaid
flowchart LR
  subgraph Laptop
    ICS[".ics export"] --> WEB["apps/web<br/>Plan · Route"]
    WEB -- "meetings (localhost only)" --> API["apps/api<br/>Fastify :8787"]
    API -- "JSON-schema prompts" --> OLLAMA["Ollama<br/>Gemma 4 (local)"]
  end
  API -- "foot routes" --> OSRM["OSRM foot<br/>routing.openstreetmap.de"]
  WEB -- "QR code: route + agenda<br/>in the URL hash" --> PHONE["Phone<br/>Walk page (static)"]
  PHONE -- "tiles" --> OSM["OpenStreetMap tiles"]
  PHONE -. "one call: shortest way back" .-> OSRM
```

## Packages

| Package         | Role                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `packages/core` | Pure TypeScript, unit-tested: `.ics` parsing and generation, geo math, loop search, turn-back logic |
| `apps/api`      | Local Fastify server. Wraps Ollama (structured JSON + zod) and the routing provider                 |
| `apps/web`      | Vite + React PWA. Plan and Route pages on the laptop, Walk page on the phone                        |

## Data flow

_Filled in as milestones land._
