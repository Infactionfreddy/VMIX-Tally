# Phase 6: Web UI — Status then Control - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 06-web-ui-status-then-control
**Areas discussed:** Frontend Framework, WebSocket Format, Manual Override (UI-04), Mapping-Editor Live Roster

---

## Frontend Framework

### Framework choice

| Option | Description | Selected |
|--------|-------------|----------|
| Svelte 5 | Compiled away, reactive $state/$derived, great for live-status UI. | ✓ |
| Preact + htm | 3KB React clone, no build step possible. | |
| Vanilla JS | No framework. DOM manipulation. Maximum control, no build needed. | |

### Build + delivery

| Option | Description | Selected |
|--------|-------------|----------|
| Vite + @fastify/static | Vite builds to dist/, Fastify serves on same port. | ✓ |
| Separate dev server | Vite on 5173, Fastify on 3000. Dev-only convenience. | |

**Decision captured:** D-01, D-02 in CONTEXT.md

---

## WebSocket Nachrichten-Format

### Message format

| Option | Description | Selected |
|--------|-------------|----------|
| Full-state snapshot | Single message type with cameras + connections + latencyMs + overrides. | ✓ |
| Deltas | Only changed fields. Less bandwidth, but client must merge. No advantage on LAN. | |

### Push triggers

| Option | Description | Selected |
|--------|-------------|----------|
| stateChanged + new client | Push on tally change, and immediately to new connections. | ✓ (extended) |

**Follow-up:** Connection status changes also trigger a push (same snapshot, updated connections field).

**Decision captured:** D-03, D-04 in CONTEXT.md

---

## Manual Override (UI-04)

### Override storage

| Option | Description | Selected |
|--------|-------------|----------|
| Persistent in ConfigStore | Survives restarts; UI shows active overrides prominently on load. | ✓ |
| In-Memory only | Lost on restart — safer but user wanted persistence. | |

### Startup behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Visible in UI sofort nach Start | Active overrides shown prominently (orange) with clear-all option. | ✓ |
| Auto-delete on restart | Would negate persistence. | |

### UI interaction

| Option | Description | Selected |
|--------|-------------|----------|
| Toggle-button per Kamera: Off/Program/Preview | Per-camera 3-button toggle, orange active state, one click to clear. | ✓ |
| Globaler Override-Bereich separat | Separate page/section for override management. | |

### REST endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| PUT /overrides/:cameraId { state: null|'program'|'preview' } | null = clear. RESTful, zod-validated. | ✓ |
| POST + DELETE | More REST-pure, more code for same result. | |

### Override wire-up

| Option | Description | Selected |
|--------|-------------|----------|
| TallyOrchestrator reads overrides from ConfigStore (per D-13) | Consistent with mapping read pattern. | ✓ |
| server.ts hält Override-Map in-memory | Extra layer, less consistent. | |

**Decision captured:** D-05, D-06, D-07, D-08 in CONTEXT.md

---

## Mapping-Editor: Live vMix-Roster

### Input source

| Option | Description | Selected |
|--------|-------------|----------|
| Live vMix-Roster wenn verbunden | GET /vmix/roster from VmixConnector.roster(). Fallback: manual if offline. | ✓ |
| Immer manuelle Eingabe | Error-prone GUID entry. | |

### Roster delivery

| Option | Description | Selected |
|--------|-------------|----------|
| GET /vmix/roster REST-Endpoint | Frontend fetches on editor open. Lean, no WS overhead. | ✓ |
| Roster über WS mitliefern | WS snapshots grow larger for an infrequently-needed dataset. | |

**Decision captured:** D-09, D-10 in CONTEXT.md

---

## Claude's Discretion

- Svelte component structure
- CSS approach (scoped Svelte styles recommended)
- Whether Phase 4 GET /walk-test is kept or replaced by POST /test/:cameraId
- Fastify port (3000 default, env PORT)
- @fastify/websocket vs standalone ws instance

## Deferred Ideas

- GET /metrics for p50/p95 latency — v2
- Event log (OPS-01) — v2
- Import/export config (OPS-02) — v2
- Windows service packaging (PKG-01) — v2
- Multi-switcher (MULTI-01) — v2 out of scope
