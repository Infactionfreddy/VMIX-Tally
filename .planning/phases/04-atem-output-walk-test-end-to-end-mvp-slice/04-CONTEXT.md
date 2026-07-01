# Phase 4: ATEM Output + Walk-Test (end-to-end MVP slice) - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

First code that talks to real hardware. Closes the hot path:
`TallyOrchestrator 'stateChanged'` → `AtemConnector` → `changeProgramInput` /
`changePreviewInput` → real SDI tally on Blackmagic cameras.

Also introduces the server entry point (`src/server.ts`) that wires all modules
together, brings in Fastify for the walk-test endpoint, and proves p95 latency
< 100 ms via pino-structured timestamps.

**In scope:** `src/atem/AtemConnector.ts` (wraps `atem-connection`, hydration gate,
command dispatch, latency logging); `src/server.ts` (bootstrap, module wiring,
Fastify server with `GET /walk-test`); walk-test handler (sequential per-camera
program assignment, direct ATEM bypass); latency proof via `latencyMs` field in
pino logs (REL-01).

**Out of scope (other phases):** ATEM reconnect with backoff/jitter (Phase 5), vMix
reconnect (Phase 5), web UI / WebSocket push (Phase 6), manual override UI (Phase 6),
latency dashboard (Phase 6 UI-05).

</domain>

<decisions>
## Implementation Decisions

### Server Entry Point + Module Wiring

- **D-01:** The server entry point is **`src/server.ts`**. It creates ConfigStore,
  TallyOrchestrator, AtemConnector, and the pino root logger. Wiring pattern:
  ```
  orchestrator.on('stateChanged', ({ newState, tallyReceivedAt }) =>
    atemConnector.applyState(newState, tallyReceivedAt)
  )
  ```
  `server.ts` is the ONLY file that imports both `vmix/` and `atem/` modules.
  `AtemConnector` does not hold a reference to `TallyOrchestrator`.

- **D-02:** **Fail-open on startup:** server starts immediately, initiates
  connection attempts to vMix and ATEM, logs connection errors via pino, and
  keeps running. No blocking wait on hardware availability. Phase 5 adds
  backoff/jitter reconnect.

### ATEM Hydration Gate

- **D-03:** `AtemConnector` tracks `isHydrated: boolean` (initially `false`).
  Hydration is confirmed on the **first `atem-connection` `stateChanged` event** —
  this is when the ATEM has delivered its full initial state to the library.
  No fixed timeout, no internal state field probing.

- **D-04:** Commands received from `TallyOrchestrator` **before hydration** are
  not dropped. `AtemConnector` stores the latest as `pendingState: ResolverOutput |
  null`. On hydration, if `pendingState` is set, it is flushed immediately (one
  apply call). This prevents a startup window where the server is running but the
  ATEM bus is in an unknown state.

### Walk-Test (VERIFY-01)

- **D-05:** Phase 4 **introduces Fastify** with a single route: `GET /walk-test`.
  Phase 6 expands Fastify with the full UI, WebSocket server, and REST API. The
  Phase 4 Fastify instance is the same one Phase 6 will extend — no re-architecture
  needed.

- **D-06:** The walk-test runs **sequentially**: for each mapped camera in config
  order: `changeProgramInput(0, atemSource)` → wait ~2 s (red) →
  `changePreviewInput(0, atemSource)` → wait ~2 s (green) → next camera. After
  all cameras, the last camera stays on preview (operator resets manually in vMix).
  The route handler responds `202 Accepted` immediately; the walk runs
  asynchronously while the server logs each step via pino.

- **D-11:** If `GET /walk-test` is called while a walk-test is already running,
  the server responds **`409 Conflict`** with `{ error: 'walk-test already running' }`.
  An `isWalkRunning` boolean flag in the handler prevents concurrent runs and
  parallel ATEM command conflicts.

- **D-07:** The walk-test **bypasses the `TallyStateReconciler`** — it calls
  `AtemConnector.walkTest()` directly, which issues `changeProgramInput` without
  consulting the resolver or updating `lastSentState`. Walk-test is a diagnostic
  tool, not a live tally event. After the walk completes, the next real tally push
  will re-assert the correct state via the normal path.

### Latency Measurement (REL-01)

- **D-08:** `TallyOrchestrator`'s `'stateChanged'` event carries
  `tallyReceivedAt: number` (`Date.now()` at the moment the raw TCP tally push
  arrived). `AtemConnector.applyState(newState, tallyReceivedAt)` logs:
  `{ event: 'atem_command_sent', latencyMs: Date.now() - tallyReceivedAt, ... }`
  via pino for every command dispatch. Scanning logs proves p95 < 100 ms under
  real switching conditions (REL-01).

- **D-09:** `tallyReceivedAt` is added to the `'stateChanged'` event payload,
  updating D-15 from Phase 3: the full payload is
  `{ newState: ResolverOutput, tallyReceivedAt: number }`. (Phase 3 CONTEXT.md D-15
  has been updated accordingly.)

### TallyStateReconciler Integration

- **D-10:** `AtemConnector.applyState()` uses the **`TallyStateReconciler`** from
  `src/core/tallyState.ts` (Phase 1, Plan 03) to diff the incoming `ResolverOutput`
  against the last-sent ATEM bus state. Only cameras whose desired state has changed
  receive a `changeProgramInput` or `changePreviewInput` command. This preserves
  the single-writer idempotent-diff guarantee from Phase 1 (CORE-03).

### Claude's Discretion

- Exact filenames within `src/atem/` (e.g. `AtemConnector.ts` — likely singular).
- Fastify port (3000 is conventional; configurable via env `PORT`).
- Walk-test inter-camera dwell time (1–2 s; 2 s recommended for slow ATEM response).
- Whether `AtemConnector` extends `EventEmitter` (not required for Phase 4 — Phase 5
  may need it for reconnect events; defer).
- Mix-effect index: hardcoded `0` (ME1) for an 8-input single-ME setup per CLAUDE.md.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap (this phase)

- `.planning/REQUIREMENTS.md` — ATEM-01 (connect, hydration gate), ATEM-02
  (changeProgramInput hard cut, never transition), ATEM-03 (changePreviewInput green
  tally), VERIFY-01 (walk-test per mapped input), REL-01 (p95 < 100 ms).
- `.planning/ROADMAP.md` §"Phase 4" — goal + 5 success criteria; depends on Phase 3.

### Phase 3 interface contracts (what Phase 4 consumes)

- `.planning/phases/03-vmix-live-ingest/03-CONTEXT.md` — D-15 (updated): `'stateChanged'`
  payload `{ newState: ResolverOutput, tallyReceivedAt: number }`; D-16: pino optional
  constructor param; D-09: `VmixConnector` module boundary (vmix/ must not import atem/).

### Phase 1 reconciler + type contracts

- `src/core/tallyState.ts` — `TallyStateReconciler` (single-writer diff, idempotent,
  CORE-03). Phase 4's `AtemConnector.applyState()` calls this before sending ATEM commands.
- `src/core/events.ts` — `ResolverOutput`, `DesiredAtemBusState`, `CameraTallyMap`
  (the types `AtemConnector` receives and acts on).
- `src/core/resolver.ts` — `MappingEntry` (atemSource field Phase 4 uses for ATEM input ID).

### Stack decisions

- `CLAUDE.md` §"Recommended Stack" — `atem-connection` 3.9.0 rationale, Sofie-Automation
  maintainership; `fastify` 5.9.0 + `@fastify/static` + `@fastify/websocket`; mix-effect
  index 0 (ME1) for single-ME ATEM.
- `CLAUDE.md` §"Key API Shapes" — `changeProgramInput`/`changePreviewInput` promise semantics,
  `stateChanged` timing relative to connect, mix-effect parameter.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/core/tallyState.ts` — `TallyStateReconciler` is the exact diff engine Phase 4
  needs. `AtemConnector.applyState()` feeds it `ResolverOutput` and executes the
  returned command list via `atem-connection`.
- `src/core/events.ts` — `ResolverOutput` is the type flowing from `TallyOrchestrator`
  to `AtemConnector`. `DesiredAtemBusState` maps to program/preview ATEM bus inputs.
- `src/config/schema.ts` — `PersistedConfig.settings.atem` (host, nullable) is what
  `src/server.ts` reads to connect `atem-connection`. Phase 4 extends it with nothing
  new (atem connection schema is already there from Phase 2).

### Established Patterns

- Strict-TS ESM project (`"type": "module"`), vitest, no build/dist step.
- Optional constructor logger injection: `constructor(config, logger = pino())` —
  established by Phase 3 for all I/O modules. Phase 4 continues this pattern for
  `AtemConnector`.
- Fail-open + pino error logging established by Phase 3's node-vmix usage — same
  pattern applies to `atem-connection` lifecycle.
- `vmix/` module is the only network-touching module so far. Phase 4 adds `atem/`
  as the second network-touching module. `core/` must still not import from either.

### Integration Points

- **Consumes:** `TallyOrchestrator` (Phase 3) via `'stateChanged'` event and
  `currentState` getter; `ConfigStore` (Phase 2) via `src/server.ts` for ATEM host.
- **Produces:** ATEM bus commands (hardware side-effect); `latencyMs` pino log field
  (REL-01 proof); `GET /walk-test` Fastify route (VERIFY-01 trigger).
- **D-15 seam:** `TallyOrchestrator.'stateChanged'` payload includes `tallyReceivedAt`
  — Phase 4 is the consumer that closes this latency measurement loop.

</code_context>

<specifics>
## Specific Ideas

- **`atem-connection` `changePreviewInput` green-tally behavior is MEDIUM confidence
  (flagged in STATE.md)** — research agent MUST verify against the installed library
  and known ATEM model behavior before planning. Specifically: does `changePreviewInput`
  reliably produce green SDI tally on the target ATEM model? Any caveats?
- **Mix-effect 0 (ME1)** is hardcoded for the 8-input single-ME setup. Researcher
  confirms this is correct for `atem-connection` 3.9.x API (`changeProgramInput(0, src)`).
- Walk-test `GET /walk-test` should return a streaming response or structured JSON
  listing which cameras were tested and their atemSource — useful for the operator
  reading curl output in the terminal.
- `TallyStateReconciler` from Phase 1 needs to be inspected by the planner to confirm
  its exact API surface before designing `AtemConnector.applyState()`.

</specifics>

<deferred>
## Deferred Ideas

- **ATEM reconnect with backoff/jitter (ATEM-04)** — Phase 5. Phase 4 ships basic
  connect-and-go; reconnect behavior is Phase 5's domain.
- **Latency dashboard / UI-05** — Phase 6. Phase 4 proves latency via pino logs only;
  the web dashboard comes later.
- **Manual override via UI (UI-04)** — Phase 6. Walk-test is Phase 4's only manual
  control surface.
- **`GET /metrics` endpoint for p50/p95** — nice-to-have, deferred. Phase 4 scans
  logs manually; Phase 6 UI-05 may expose this.
- **Per-camera UI menu for individual Program/Preview testing** — user-requested in
  discussion: a web UI where the operator picks a specific camera and switches it to
  Program or Preview individually for verification. Belongs in Phase 6 (requires UI
  interaction beyond a simple REST endpoint). Note for Phase 6 planning.

None of the above is in Phase 4 scope — discussion stayed within the ATEM output +
walk-test boundary.

</deferred>

---

*Phase: 4-atem-output-walk-test-end-to-end-mvp-slice*
*Context gathered: 2026-07-01*
