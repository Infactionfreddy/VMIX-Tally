# Phase 6: Web UI — Status then Control - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

The operator's trust surface. Two layers built in order:

1. **Status** — Real-time dashboard: which camera is red/green, are both links healthy,
   what is the latency. Pushed live over WebSocket from `TallyOrchestrator`.
2. **Control** — Connection setup (vMix/ATEM IP/port → ConfigStore), mapping editor
   (3-way chain with live vMix roster), per-camera manual override (sticky,
   visually distinct, routed through the Core resolver).

**In scope:** Svelte 5 frontend built with Vite, served by `@fastify/static`; WebSocket
server via `@fastify/websocket`; full Fastify API expansion (config CRUD, override
endpoints, vMix roster endpoint); ConfigStore schema extension for `overrides` field;
`TallyOrchestrator` reads overrides from ConfigStore (per D-13 pattern).

**Out of scope (v2):** Multi-switcher support, event log, import/export config,
Windows service packaging, latency p50/p95 metrics endpoint (noted but deferred).

**UI hint:** After context, run `/gsd-ui-phase 6` for the full UI design contract
(UI-SPEC.md) before planning implementation.

</domain>

<decisions>
## Implementation Decisions

### Frontend Framework

- **D-01:** Frontend is **Svelte 5** — compiled away, no runtime overhead, excellent
  reactive live-status primitives (`$state`, `$derived`). CLAUDE.md first recommendation
  for reactive live-status UIs.

- **D-02:** Build pipeline: **Vite** builds the Svelte app to `dist/`. Fastify serves
  `dist/` via `@fastify/static` on the same port as the API and WebSocket. One process,
  one port. Dev: `vite dev` on port 5173 + Fastify on port 3000 (proxied or separate
  terminal — development convenience only, production is always `dist/` + Fastify).

### WebSocket — Message Format + Push Triggers

- **D-03:** WebSocket uses a **single snapshot message type**:
  ```json
  {
    "type": "state",
    "cameras": [
      { "cameraId": "cam1", "name": "Camera 1", "tally": "program" },
      { "cameraId": "cam2", "name": "Camera 2", "tally": "off" }
    ],
    "connections": { "vmix": "connected", "atem": "connected" },
    "latencyMs": 23,
    "overrides": { "cam1": null, "cam2": "program" }
  }
  ```
  `tally` values: `"program"` | `"preview"` | `"off"`.
  `connections` values: `"connected"` | `"disconnected"` | `"connecting"`.
  `overrides` map: `cameraId → null | "program" | "preview"` (null = no override).

- **D-04:** Server pushes the snapshot on **three triggers**:
  1. `TallyOrchestrator` `'stateChanged'` event (live tally change)
  2. `VmixConnector` or `AtemConnector` connect/disconnect/ready events (same snapshot,
     updated `connections` field)
  3. New WebSocket client connects (immediate snapshot so the browser never starts blank)

  No delta logic. Full snapshot on every push — ≤8 cameras on LAN, bandwidth is trivial.

### Manual Override (UI-04)

- **D-05:** Overrides are **persisted in ConfigStore** as a new optional `overrides`
  field in the JSON schema:
  ```typescript
  overrides: z.record(z.string(), z.enum(['program', 'preview'])).optional()
  ```
  A persisted override survives server restarts. On startup, the UI immediately shows
  active overrides prominently (orange visual treatment) so the operator can clear any
  forgotten overrides.

- **D-06:** `TallyOrchestrator` reads overrides from ConfigStore on every `'tally'`
  event, same pattern as D-13 (Phase 3 — reads mapping per event). Both mapping and
  overrides are live-read from ConfigStore; a REST PUT immediately takes effect on the
  next tally push.

- **D-07:** Override REST endpoint:
  ```
  PUT /overrides/:cameraId   body: { state: "program" | "preview" | null }
  ```
  `null` clears the override for that camera. Fastify validates the body with Zod.
  Response: `200 OK` with current overrides map. This triggers a WS snapshot push
  immediately (overrides changed → push to all clients).

- **D-08:** Override UI: **toggle-button trio per camera card** in the status grid:
  `[OFF] [PROG] [PREV]`. Active override button visually distinct (orange border).
  Clears with one click on the active button (toggles back to null). Override state
  is shown in the same grid as live tally — no separate override section.

### Mapping Editor

- **D-09:** The mapping editor shows the **live vMix roster** when vMix is connected.
  Frontend fetches `GET /vmix/roster` when the editor is opened (one-shot REST call,
  not continuous polling). Returns:
  ```json
  { "inputs": [{ "key": "guid-1", "number": 1, "title": "Camera 1" }, ...] }
  ```
  Backed by `VmixConnector.roster()` (the in-memory Map from Phase 3's `fetchRoster`).

- **D-10:** If vMix is offline when the editor opens, `GET /vmix/roster` returns an
  empty `inputs` array. The editor falls back to **manual input** (user types vmixKey
  as a GUID string). The stored vmixNumber/vmixTitle fields remain editable as display
  hints.

- **D-11:** Mapping edits go through existing ConfigStore CRUD surface (from Phase 2)
  via REST:
  ```
  GET  /config/mapping          → current PersistedMappingEntry[]
  PUT  /config/mapping          → replace full mapping array (zod-validated)
  GET  /config/settings         → current connection settings
  PUT  /config/settings         → replace settings (zod-validated)
  ```
  Fastify validates all payloads with zod (reusing Phase 2 schema).

### Per-Camera Test UI (deferred from Phase 4 walk-test)

- **D-12:** Phase 6 includes a **per-camera test control** on each camera card:
  `[Test: PROG]` / `[Test: PREV]` buttons that issue a temporary direct ATEM command
  for that camera. Backed by a new endpoint:
  ```
  POST /test/:cameraId   body: { action: "program" | "preview" | "clear" }
  ```
  This is the Phase 4 walk-test deferred feature — individual camera testing with
  UI-driven control instead of the sequential `GET /walk-test` endpoint.

### ConfigStore Schema Extension

- **D-13:** Phase 6 extends `src/config/schema.ts` with the `overrides` field (D-05).
  This is a backward-compatible addition (optional field). Existing stored configs
  without `overrides` parse as valid (empty/no overrides active).

### Claude's Discretion

- Svelte component structure (single-page vs multi-section layout, component split).
- Exact CSS approach (CSS modules, scoped Svelte styles, or a utility framework).
- Whether the Phase 4 `GET /walk-test` endpoint is kept or superseded by `POST /test/:cameraId`.
- Fastify port default (3000), configurable via `PORT` env var.
- Whether `@fastify/websocket` or a standalone `ws` instance is used (CLAUDE.md
  recommends `@fastify/websocket` to keep WS on the same port/lifecycle as Fastify).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap (this phase)

- `.planning/REQUIREMENTS.md` — UI-01 (connection config), UI-02 (connection health),
  UI-03 (real-time dashboard), UI-04 (manual override, sticky, releasable), UI-05
  (latency indicator).
- `.planning/ROADMAP.md` §"Phase 6" — goal + 5 success criteria; depends on Phase 2,
  Phase 4, Phase 5. `ui_hint: yes`.

### Phase 2 config schema (Phase 6 extends + calls)

- `.planning/phases/02-config-persistence-mapping-model/02-CONTEXT.md` — ConfigStore
  CRUD API surface Phase 6 calls; schema shape for settings + mapping; D-10 (reject
  on validation failure — Phase 6 REST must propagate errors).
- `src/config/schema.ts` — Phase 6 adds `overrides` field (D-13). Must remain
  backward-compatible.

### Phase 3-4 interfaces consumed by the UI backend

- `.planning/phases/03-vmix-live-ingest/03-CONTEXT.md` — D-15: `'stateChanged'`
  payload `{ newState: ResolverOutput, tallyReceivedAt: number }` (WS snapshot source);
  D-09: `VmixConnector.roster()` returns `Map<string,number>` (D-09 endpoint source).
- `.planning/phases/04-atem-output-walk-test-end-to-end-mvp-slice/04-CONTEXT.md` —
  D-05 (Fastify bootstrapped in Phase 4 — Phase 6 expands it); D-08 `latencyMs` in
  pino logs (UI-05 latency indicator source).

### Stack decisions

- `CLAUDE.md` §"Recommended Stack" — Svelte 5 / Preact (chose Svelte), Vite 8.1,
  `@fastify/static`, `@fastify/websocket`, `ws` 8.21.
- `CLAUDE.md` §"Frontend" — "Svelte (compiles away, tiny runtime, great for
  live-status reactivity)".

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/core/events.ts` — `ResolverOutput`, `CameraTallyMap` — source for WS snapshot
  cameras array; `CameraTallyState` values (`"program"`, `"preview"`, `"off"`) map
  directly to WS message tally field.
- `src/config/schema.ts` — existing zod schema for settings + mapping; Phase 6 adds
  `overrides` field; REST routes reuse the same validators.
- `src/vmix/VmixConnector.ts` (Phase 3) — `.roster()` method returns
  `Map<vmixKey, vmixNumber>` for `GET /vmix/roster`. Also has vmixTitle available
  (from `parseRosterXml`).

### Established Patterns

- Fastify + pino already bootstrapped in Phase 4 (`src/server.ts`). Phase 6 registers
  additional plugins: `@fastify/static`, `@fastify/websocket`.
- ConfigStore live-read per tally event (D-13, Phase 3) — Phase 6 adds overrides to
  the same read, zero new plumbing.
- Optional pino constructor injection (D-16, Phase 3) — all new Fastify route handlers
  can use Fastify's built-in pino logger (`request.log`).

### Integration Points

- **WS broadcast:** `server.ts` gets a `broadcast(snapshot)` helper that sends to all
  active WS connections. Triggered by: orchestrator `'stateChanged'`, connector
  connect/disconnect events, and after any override PUT.
- **Override path:** `PUT /overrides/:cameraId` → ConfigStore.write(overrides) →
  next tally event picks up via D-06 → orchestrator resolves with new override →
  `'stateChanged'` fires → WS broadcast.

</code_context>

<specifics>
## Specific Ideas

- **Latency indicator (UI-05):** The WS snapshot includes `latencyMs` — the last
  measured value from Phase 4's pino log. `server.ts` maintains `lastLatencyMs`
  in memory (updated on each `'stateChanged'` event) and includes it in the snapshot.
  Simple, no DB required.
- **"DISCONNECTED" prominent state (SC2):** When `connections.vmix` or
  `connections.atem` is `"disconnected"`, the UI shows a loud overlay/banner — not
  just a subtle indicator. The operator in a live production must immediately notice
  a link drop.
- **Override visual treatment:** Orange border/background for overridden cameras in
  the grid. On startup, if any override is active, show a dismissible warning banner:
  "⚠ X camera(s) have active manual overrides".
- **`/gsd-ui-phase 6` recommended** before planning — generates UI-SPEC.md with
  detailed layout, component spec, and color system. Run after this context is
  committed.

</specifics>

<deferred>
## Deferred Ideas

- **`GET /metrics` for p50/p95 latency** — Phase 6 UI-05 shows the last latency
  value; a full metrics endpoint with percentile calculation is v2.
- **Event log (OPS-01)** — v2. Activity log of tally changes is explicitly a v2
  requirement.
- **Import/export config (OPS-02)** — v2.
- **Windows service packaging (PKG-01)** — v2. NSSM/SEA are post-v1.
- **Multi-switcher support (MULTI-01)** — v2 out of scope per PROJECT.md.

</deferred>

---

*Phase: 6-web-ui-status-then-control*
*Context gathered: 2026-07-01*
