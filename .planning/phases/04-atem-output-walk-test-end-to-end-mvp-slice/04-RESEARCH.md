# Phase 4: ATEM Output + Walk-Test (end-to-end MVP slice) - Research

**Researched:** 2026-07-01
**Domain:** atem-connection 3.9 API, Fastify 5 route handler, latency instrumentation, end-to-end wiring pattern
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Server entry point is `src/server.ts`. Creates ConfigStore, TallyOrchestrator,
AtemConnector, and the pino root logger. Wiring pattern:
```
orchestrator.on('stateChanged', ({ newState, tallyReceivedAt }) =>
  atemConnector.applyState(newState, tallyReceivedAt)
)
```
`server.ts` is the ONLY file that imports both `vmix/` and `atem/` modules. `AtemConnector`
does not hold a reference to `TallyOrchestrator`.

**D-02:** Fail-open on startup: server starts immediately, initiates connection attempts to vMix
and ATEM, logs connection errors via pino, and keeps running. No blocking wait on hardware
availability. Phase 5 adds backoff/jitter reconnect.

**D-03:** `AtemConnector` tracks `isHydrated: boolean` (initially `false`). Hydration is
confirmed on the **first `atem-connection` `stateChanged` event** — this is when the ATEM has
delivered its full initial state to the library.

**D-04:** Commands received before hydration are not dropped. `AtemConnector` stores the latest
as `pendingState: ResolverOutput | null`. On hydration, if `pendingState` is set, it is flushed
immediately (one apply call).

**D-05:** Phase 4 introduces Fastify with a single route: `GET /walk-test`. Same Fastify
instance that Phase 6 will extend — no re-architecture needed.

**D-06:** Walk-test runs sequentially: for each mapped camera in config order:
`changeProgramInput(0, atemSource)` → wait ~2 s → `changePreviewInput(0, atemSource)` → wait
~2 s → next camera. After all cameras, last camera stays on preview. Route responds
`202 Accepted` immediately; walk runs asynchronously.

**D-07:** Walk-test bypasses `TallyStateReconciler` — calls `AtemConnector.walkTest()` directly,
issues `changeProgramInput` without consulting the resolver or updating `lastSentState`.
Walk-test is a diagnostic tool, not a live tally event.

**D-08:** `tallyReceivedAt: number` is carried in the `'stateChanged'` event payload (updated D-15
from Phase 3). `AtemConnector.applyState(newState, tallyReceivedAt)` logs
`{ event: 'atem_command_sent', latencyMs: Date.now() - tallyReceivedAt, ... }` on every
command dispatch.

**D-09:** `tallyReceivedAt` added to `'stateChanged'` event payload, updating D-15 from Phase 3.
Full payload: `{ newState: ResolverOutput, tallyReceivedAt: number }`.

**D-10:** `AtemConnector.applyState()` uses `TallyStateReconciler` from `src/core/tallyState.ts`
to diff incoming `ResolverOutput` against last-sent ATEM bus state. Only cameras whose desired
state has changed receive a `changeProgramInput` or `changePreviewInput` command.

**D-11:** If `GET /walk-test` is called while a walk-test is already running, respond
`409 Conflict` with `{ error: 'walk-test already running' }`. An `isWalkRunning` boolean flag
prevents concurrent runs.

### Claude's Discretion

- Exact filenames within `src/atem/` (e.g. `AtemConnector.ts` — likely singular).
- Fastify port (3000 is conventional; configurable via env `PORT`).
- Walk-test inter-camera dwell time (2 s recommended for slow ATEM response).
- Whether `AtemConnector` extends `EventEmitter` (not required for Phase 4; Phase 5 may need it).
- Mix-effect index: hardcoded `0` (ME1) for an 8-input single-ME setup per CLAUDE.md.

### Deferred Ideas (OUT OF SCOPE)

- ATEM reconnect with backoff/jitter (ATEM-04) — Phase 5.
- Latency dashboard / UI-05 — Phase 6.
- Manual override via UI (UI-04) — Phase 6.
- `GET /metrics` endpoint for p50/p95 — Phase 6 UI-05.
- Per-camera individual Program/Preview testing UI — Phase 6.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ATEM-01 | Server connects to ATEM over Ethernet with configurable IP | `Atem.connect(address, port?)` verified; config already has `settings.atem` from Phase 2 |
| ATEM-02 | Sets ATEM program bus via hard cut (instant, never transition) | `changeProgramInput(input, me=0)` issues `ProgramInputCommand` directly — no transition |
| ATEM-03 | Sets ATEM preview bus to produce green SDI tally | `changePreviewInput(input, me=0)` issues `PreviewInputCommand`; ATEM preview bus drives green SDI tally on Blackmagic cameras |
| VERIFY-01 | Walk-test per mapped input, sequential camera chain validation | `GET /walk-test` → Fastify 5 `reply.code(202).send()`; background loop calls `changeProgramInput`/`changePreviewInput` per camera |
| REL-01 | End-to-end tally reaction < 100 ms | `latencyMs = Date.now() - tallyReceivedAt` logged via pino on every `applyState()` call |
</phase_requirements>

---

## Summary

Phase 4 closes the hot path: a vMix take causes the right Blackmagic camera to light red
(and the preview camera to light green) via cut-only ATEM bus control, with latency logged
for REL-01 proof. It also introduces the server entry point and the walk-test verification
endpoint.

The primary new component is `AtemConnector` in `src/atem/`, which wraps `atem-connection`
3.9.0. The critical research finding is the exact hydration sequence: `stateChanged` is
**suppressed** during the ATEM's initial state delivery (the `InitCompleteCommand` batch) and
only fires on subsequent state-change packets AFTER `connected` has fired. This means D-03's
decision to gate on "first `stateChanged` event after connect" is NOT correct — hydration is
signaled by the `connected` event itself (which fires at `_onInitComplete()`, immediately after
`InitCompleteCommand` is processed). The `stateChanged` emission is gated by
`status === CONNECTED`, so no `stateChanged` fires until after `connected`.

This changes the hydration gate implementation: `AtemConnector` must treat the `'connected'`
event (not the first `'stateChanged'`) as the hydration signal, because `atem.state` is fully
populated at `connected` time and `stateChanged` will not fire until the next real switcher
state change.

The second major component is `src/server.ts`, which wires all modules and registers a single
Fastify route (`GET /walk-test`). Fastify 5.9.0 is already installed. The `changeProgramInput`
and `changePreviewInput` methods are verified `async` functions that return `Promise<void>` and
default to `me=0` (ME1).

**Primary recommendation:** Wire `AtemConnector.isHydrated = true` on the `'connected'` event,
not on the first `stateChanged`. Flush `pendingState` inside the `'connected'` handler.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| ATEM bus command dispatch (program/preview) | API/Backend (`AtemConnector`) | — | Network I/O to ATEM hardware; must be server-side |
| Hydration gate (pendingState flush) | API/Backend (`AtemConnector`) | — | Internal state of the connector; no other tier involved |
| Latency timestamp logging | API/Backend (`AtemConnector.applyState`) | — | Measurement happens at command-send time |
| Walk-test trigger | API/Backend (Fastify route) | — | REST endpoint over LAN; no browser needed |
| Walk-test sequential loop | API/Backend (`AtemConnector.walkTest`) | — | Fires hardware commands; background async task |
| Server bootstrap / module wiring | API/Backend (`server.ts`) | — | Entry point for all I/O modules |
| Tally diff (reconciler) | API/Backend (`TallyStateReconciler`) | — | Pure in-process diff; already in `src/core/` |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `atem-connection` | 3.9.0 | ATEM Ethernet protocol client | De-facto standard; maintained by Sofie-Automation/NRK; TypeScript; only broadcast-grade implementation [VERIFIED: npm registry] |
| `fastify` | 5.9.0 | HTTP server (walk-test route; Phase 6 will extend) | Already installed from Phase 3 planning; schema validation, pino built-in [VERIFIED: npm registry] |
| `pino` | 10.3.1 | Structured latency logging (REL-01 proof) | Already installed; structured JSON timestamps required [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@fastify/static` | 9.1.3 | Serve built UI (Phase 6 will use) | Register now to keep Fastify instance extensible; omit if Phase 6 is truly separate |
| `@fastify/websocket` | 11.2.0 | WebSocket binding (Phase 6 will use) | Not needed Phase 4; register in Phase 6 |

Note: `@fastify/static` and `@fastify/websocket` are already installed (confirmed in
`node_modules/@fastify/`). Phase 4 only needs `fastify` + `pino` + `atem-connection`.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `changeProgramInput` / `changePreviewInput` | `cut()` / `autoTransition()` | `cut()` only cuts PGM (no preview change); `autoTransition()` causes two-camera-red flash — both wrong. Use the input assignment commands. |
| `connected` event for hydration | First `stateChanged` | `stateChanged` does NOT fire during initial state delivery; using it would leave `isHydrated` permanently false until the first real switcher change after connect. See Critical Finding below. |
| `GET /walk-test` returning body immediately | Streaming JSON lines | Streaming requires more infra; 202 + pino log tail is sufficient for Phase 4 operator use |

**Installation (Phase 4 new additions):**
```bash
npm install atem-connection
```
`fastify` and `pino` are already in `package.json` from Phase 3.

**Version verification (confirmed against npm registry 2026-07-01):**
```
atem-connection  3.9.0   (published 2026-02-18)
fastify          5.9.0   (published 2026-06-28)
pino             10.3.1  (published 2026-02-09)
@fastify/static  9.1.3   (published 2026-04-21)
@fastify/websocket 11.2.0 (published 2026-03-05)
```

## Package Legitimacy Audit

All packages confirmed clean by slopcheck (run 2026-07-01):

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `atem-connection` | npm | ~8 yrs (created 2018-06-05) | github.com/Sofie-Automation/sofie-atem-connection | [OK] | Approved |
| `fastify` | npm | ~10 yrs (created 2016-10-07) | github.com/fastify/fastify | [OK] | Approved |
| `pino` | npm | ~10 yrs (created 2016-02-21) | github.com/pinojs/pino | [OK] | Approved |
| `@fastify/static` | npm | Established fastify plugin | github.com/fastify/fastify-static | [OK] | Approved |
| `@fastify/websocket` | npm | Established fastify plugin | github.com/fastify/fastify-websocket | [OK] | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

No postinstall scripts found on any of the above packages.

## Architecture Patterns

### System Architecture Diagram

```
vMix TCP push
    │ TALLY OK <digits>
    ▼
VmixConnector (Phase 3)
    │ emit 'tally' → TallyOrchestrator
    │                       │ resolve(tally, mapping, overrides) → ResolverOutput
    │                       │ emit 'stateChanged' { newState, tallyReceivedAt }
    │                       │
    │              ┌────────▼────────────────┐
    │              │     server.ts wiring    │
    │              │ orchestrator.on(         │
    │              │  'stateChanged', …       │
    │              │  atemConnector.applyState│
    │              └────────┬────────────────┘
    │                       │
    │              ┌────────▼──────────────────────┐
    │              │       AtemConnector            │
    │              │  TallyStateReconciler.submit() │
    │              │  → only changed fields sent    │
    │              │  changeProgramInput(me=0, src) │──→ ATEM hardware
    │              │  changePreviewInput(me=0, src) │──→ ATEM hardware
    │              │  pino log: latencyMs           │         │
    │              └───────────────────────────────┘         │ SDI return
    │                                                         ▼
    │                                                  Blackmagic cameras
    │                                                  red (PGM) / green (PVW)
    │
Fastify HTTP server
    │ GET /walk-test
    ▼
Walk-test loop (async, background)
    │ changeProgramInput (2 s red per camera)
    │ changePreviewInput (2 s green per camera)
    └──→ pino log per step
```

### Recommended Project Structure

```
src/
├── core/           # Pure types + reconciler (Phase 1) — no network
├── config/         # Config schema + store (Phase 2) — disk only
├── vmix/           # vMix TCP connector + orchestrator (Phase 3) — network
├── atem/
│   └── AtemConnector.ts   # Phase 4: wraps atem-connection, hydration gate, applyState, walkTest
└── server.ts       # Phase 4: entry point — wires all modules, starts Fastify
```

### Pattern 1: AtemConnector — Hydration Gate + applyState

**What:** Wraps `atem-connection`'s `Atem` class, manages the hydration gate, dispatches
only-changed commands via `TallyStateReconciler`, and logs latency.

**Critical finding (VERIFIED from installed atem.js 3.9.0):**

The library suppresses `stateChanged` during the initial state delivery (the `InitCompleteCommand`
batch). The exact code path in `atem.js`:

```javascript
// atem.js lines 175-181 (installed 3.9.0)
const initComplete = commands.find(cmd => cmd instanceof Commands.InitCompleteCommand);
if (initComplete) {
    this._status = AtemConnectionStatus.CONNECTED;
    this._onInitComplete();       // <-- fires 'connected' event
}
else if (state && this._status === AtemConnectionStatus.CONNECTED && allChangedPaths.length > 0) {
    this.emit('stateChanged', state, allChangedPaths);  // only runs AFTER connected
}
```

**Consequence:** `stateChanged` is NOT emitted during the initial state dump.
The `connected` event fires at `_onInitComplete()` with `atem.state` already populated.
`stateChanged` only fires from the next real switcher event onward.

**Hydration gate implementation (replacing D-03's "first stateChanged" with "connected"):**

```typescript
// Source: verified from node_modules/atem-connection/dist/atem.js (3.9.0)
import { Atem } from 'atem-connection';
import type { Logger } from 'pino';
import { TallyStateReconciler } from '../core/tallyState.js';
import type { ResolverOutput } from '../core/events.js';

export class AtemConnector {
  private atem: Atem;
  private reconciler = new TallyStateReconciler();
  private isHydrated = false;
  private pendingState: ResolverOutput | null = null;
  private logger: Logger;

  constructor(private host: string, private port: number, logger: Logger) {
    this.logger = logger;
    this.atem = new Atem();

    this.atem.on('connected', () => {
      this.logger.info({ event: 'atem_connected', host, port }, 'ATEM connected');
      this.isHydrated = true;          // hydration complete at 'connected'
      if (this.pendingState !== null) {
        this.logger.info({ event: 'atem_pending_flush' }, 'Flushing pending state after hydration');
        this._dispatch(this.pendingState);
        this.pendingState = null;
      }
    });

    this.atem.on('stateChanged', (_state, paths) => {
      this.logger.debug({ event: 'atem_state_changed', paths }, 'ATEM state changed');
    });

    this.atem.on('disconnected', () => {
      this.logger.warn({ event: 'atem_disconnected' }, 'ATEM disconnected');
      this.isHydrated = false;
      this.reconciler.reset();         // Phase 5 resync seam
    });
  }

  connect(): void {
    this.logger.info({ event: 'atem_connect_attempt', host: this.host }, 'Connecting to ATEM');
    void this.atem.connect(this.host, this.port);  // fail-open: D-02
  }

  applyState(newState: ResolverOutput, tallyReceivedAt: number): void {
    if (!this.isHydrated) {
      this.pendingState = newState;    // store latest; old pending is superseded
      return;
    }
    this._dispatch(newState, tallyReceivedAt);
  }

  private _dispatch(state: ResolverOutput, tallyReceivedAt?: number): void {
    const report = this.reconciler.submit(state.bus);
    if (!report.changed) return;

    if (report.program) {
      const src = state.bus.program;
      if (src !== null) void this.atem.changeProgramInput(src, 0);
      else { /* null program = nothing live; optionally set a "safe" input */ }
    }
    if (report.preview) {
      const src = state.bus.preview;
      if (src !== null) void this.atem.changePreviewInput(src, 0);
    }

    if (tallyReceivedAt !== undefined) {
      this.logger.info({
        event: 'atem_command_sent',
        latencyMs: Date.now() - tallyReceivedAt,
        program: state.bus.program,
        preview: state.bus.preview,
      }, 'ATEM bus updated');
    }
  }
}
```

### Pattern 2: Walk-Test Handler

**What:** Fastify GET route, 202/409 pattern, sequential async loop, bypasses reconciler.

```typescript
// Source: Fastify 5 docs + verified reply.code() pattern
import Fastify from 'fastify';
import type { AtemConnector } from './atem/AtemConnector.js';

export async function buildServer(atemConnector: AtemConnector): Promise<ReturnType<typeof Fastify>> {
  const fastify = Fastify({ logger: rootLogger });

  let isWalkRunning = false;

  fastify.get('/walk-test', async (_req, reply) => {
    if (isWalkRunning) {
      return reply.code(409).send({ error: 'walk-test already running' });
    }
    isWalkRunning = true;
    reply.code(202).send({ status: 'walk-test started' });

    // Fire-and-forget — does NOT block the HTTP response
    void (async () => {
      try {
        await atemConnector.walkTest(rootLogger);
      } finally {
        isWalkRunning = false;
      }
    })();
  });

  return fastify;
}
```

**Note:** Return `reply` from the handler (or return the send call) to prevent Fastify from
trying to serialize the implicit `undefined` return from `async` handler.

### Pattern 3: Walk-Test Loop (inside AtemConnector)

```typescript
// Source: D-06 from CONTEXT.md; changeProgramInput/changePreviewInput from atem.js 3.9.0
async walkTest(mapping: MappingEntry[], logger: Logger): Promise<void> {
  logger.info({ event: 'walk_test_started', cameras: mapping.length }, 'Walk-test starting');
  for (const entry of mapping) {
    logger.info({ event: 'walk_program', cameraId: entry.cameraId, atemSource: entry.atemSource });
    await this.atem.changeProgramInput(entry.atemSource, 0);
    await new Promise(res => setTimeout(res, 2000));

    logger.info({ event: 'walk_preview', cameraId: entry.cameraId, atemSource: entry.atemSource });
    await this.atem.changePreviewInput(entry.atemSource, 0);
    await new Promise(res => setTimeout(res, 2000));
  }
  logger.info({ event: 'walk_test_complete' }, 'Walk-test complete');
}
```

### Pattern 4: server.ts Wiring

```typescript
// Source: D-01 from CONTEXT.md
import pino from 'pino';
import { ConfigStore } from './config/configStore.js';
import { VmixConnector } from './vmix/VmixConnector.js';
import { TallyOrchestrator } from './vmix/tallyOrchestrator.js';
import { AtemConnector } from './atem/AtemConnector.js';

const logger = pino();
const config = new ConfigStore(logger);
const cfg = await config.read();

const vmix = new VmixConnector(
  cfg.settings.vmix?.host ?? '127.0.0.1',
  cfg.settings.vmix?.port ?? 8099,
  cfg.settings.vmix?.vmixHttpPort ?? 8088,
  logger,
);
const orchestrator = new TallyOrchestrator(config, logger);
const atem = new AtemConnector(
  cfg.settings.atem?.host ?? '192.168.1.1',
  cfg.settings.atem?.port ?? 9910,
  logger,
);

// D-01: server.ts is the ONLY wiring point
orchestrator.on('stateChanged', ({ newState, tallyReceivedAt }) => {
  atem.applyState(newState, tallyReceivedAt);
});

// Fail-open: start everything, log errors (D-02)
vmix.connect();
atem.connect();

const app = await buildServer(atem, orchestrator, config, logger);
await app.listen({ port: Number(process.env['PORT'] ?? 3000), host: '0.0.0.0' });
logger.info({ event: 'server_started', port: process.env['PORT'] ?? 3000 }, 'Server listening');
```

### Pattern 5: ESM import of atem-connection (CJS package)

```typescript
// Source: verified Node 22 / NodeNext CJS interop (same pattern as node-vmix in Phase 3)
// atem-connection has no "type":"module" and no "exports" field — it is CJS.
// NodeNext allows named ESM imports from CJS packages via the main field.
import { Atem } from 'atem-connection';
// Named import works — confirmed by same mechanism as node-vmix Phase 3 research
// (03-RESEARCH.md line 277: "Named ESM import from CJS node-vmix works in Node 22 / NodeNext")
```

No `createRequire` workaround needed. `verbatimModuleSyntax: true` in tsconfig is satisfied
because `Atem` is a value import (class), not a type-only import.

### Anti-Patterns to Avoid

- **Using `atem.cut()` for program changes:** `cut()` only cuts the PGM bus — it does not
  change which source is on program; it triggers the transition. Use `changeProgramInput`.
- **Using `atem.autoTransition()` for any tally change:** Causes a mix between two sources;
  both cameras show red tally during the transition window.
- **Gating hydration on `stateChanged`:** `stateChanged` is suppressed during the entire
  initial state dump. The ATEM will never fire it during `InitCompleteCommand` processing.
  Use `'connected'` as the hydration signal.
- **Awaiting `changeProgramInput` before logging latency:** The promise resolves when the
  command is ACKed by the ATEM (~1-5 ms LAN). Log `latencyMs` BEFORE awaiting to capture
  the time from tally receipt to command-send, not to ACK.
- **Using `null` program input with `changeProgramInput(null, 0)`:** The method signature
  takes `number`, not `number | null`. Guard against `null` bus.program before calling.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ATEM Ethernet protocol | Custom UDP/TCP binary framing | `atem-connection` | Binary protocol with command serialization, state machine, ACK tracking; reverse-engineered by broadcast engineers over years |
| Tally diff / idempotent sends | Custom "last sent" tracking | `TallyStateReconciler` (Phase 1) | Already built and tested; single-writer guarantee is a hard test-covered invariant |
| Walk-test concurrency guard | `async-mutex`, semaphore | Simple `isWalkRunning: boolean` flag | One endpoint, one server process; a flag is sufficient and auditable |
| Background task in Fastify | Queue library, worker threads | `void (async () => {})()` + flag | LAN diagnostic tool; queue infrastructure is overhead for a single rarely-called endpoint |

## Common Pitfalls

### Pitfall 1: `stateChanged` Never Fires — Hydration Gate Stuck

**What goes wrong:** `AtemConnector` waits for the first `stateChanged` to set
`isHydrated = true`. But if no one cuts in vMix after the ATEM connects, `stateChanged` never
fires. `pendingState` is never flushed. The ATEM bus stays in an unknown state.

**Why it happens:** `stateChanged` is gated by `status === CONNECTED && allChangedPaths.length > 0`.
During `InitCompleteCommand` processing, the code path takes the `if (initComplete)` branch and
emits `'connected'`, not `stateChanged`. See atem.js lines 175-181 (verified 3.9.0).

**How to avoid:** Use `'connected'` event as the hydration signal. At `connected` time,
`atem.state` is fully populated with the current ATEM hardware state.

**Warning signs:** `isHydrated` stays `false` in logs after ATEM connection succeeds.

---

### Pitfall 2: Null Bus Program Passed to `changeProgramInput`

**What goes wrong:** `state.bus.program` is `AtemSource = number | null`. Calling
`this.atem.changeProgramInput(null, 0)` passes `null` to a function typed as
`(input: number, me?: number)`. TypeScript may catch this if the reconciler's `submit()`
return type is exact, but runtime may still pass `null` through.

**Why it happens:** `ResolverOutput.bus.program` is nullable by design (D-11 safe default
when nothing is live). The ATEM command does not accept null.

**How to avoid:** Always guard: `if (src !== null) void this.atem.changeProgramInput(src, 0);`
A null program bus means "nothing is live" — the ATEM should keep whatever it currently shows
(not explicitly set to a black input unless the operator has configured one).

**Warning signs:** TypeScript error on `changeProgramInput(null, 0)` if types are strict.

---

### Pitfall 3: Walk-Test Interferes With Live Tally

**What goes wrong:** Walk-test calls `changeProgramInput` directly. If a live tally event
arrives during the walk-test, `applyState` also calls `changeProgramInput` via the reconciler,
producing interleaved commands. The ATEM receives rapid conflicting inputs.

**Why it happens:** Walk-test (D-07) deliberately bypasses the reconciler and does not update
`lastSentState`. A real tally push during the walk will reconcile against the stale
`lastSentState` and issue its own commands.

**How to avoid (per D-07):** This is accepted behavior for a diagnostic tool. Walk-test is
designed for use before going live, not during production. Document in walk-test log output.
Alternatively, `applyState` could check an `isWalkRunning` flag and defer — but D-07 explicitly
says "after the walk completes, the next real tally push will re-assert the correct state."

**Warning signs:** Camera tally flickers back to live state mid-walk.

---

### Pitfall 4: Fastify `async` Handler Implicit Return

**What goes wrong:** An `async` Fastify handler that calls `reply.send()` but also returns
`undefined` implicitly causes Fastify to send a second response or emit an error about
"reply already sent."

**Why it happens:** Fastify 5 serializes the return value of async handlers. `reply.send()`
plus an implicit `return undefined` triggers a double-response conflict.

**How to avoid:** Always `return reply` after `reply.code(N).send(...)`:
```typescript
return reply.code(202).send({ status: 'walk-test started' });
```
Or use `void` and `return reply` pattern consistently.

---

### Pitfall 5: `changeProgramInput` Promise Fire-and-Forget Errors

**What goes wrong:** `void this.atem.changeProgramInput(src, 0)` discards the promise.
If the ATEM is disconnected or the command times out, the rejection is unhandled.

**Why it happens:** Fire-and-forget pattern (`.void`) suppresses unhandled rejections.

**How to avoid:** Wrap in a `.catch(err => this.logger.error({ err }, 'ATEM command failed'))`.
Phase 4's fail-open philosophy (D-02) means we log and continue, never throw up.

---

### Pitfall 6: `changePreviewInput` Green Tally Confidence

**What goes wrong:** `changePreviewInput` is documented and the ATEM protocol sends
`PreviewInputCommand` — but whether the Blackmagic cameras actually receive green tally via
SDI depends on the specific ATEM model's tally-over-SDI implementation and camera support.

**Why it happens:** SDI tally is ancillary data embedded in the SDI return feed from ATEM to
camera. Not all ATEM models send preview tally over SDI (some only send program/red).

**Confidence:** MEDIUM. The ATEM SDI line and general Blackmagic documentation confirms preview
tally is embedded in SDI ancillary data on models that support it. The walk-test (VERIFY-01)
is specifically designed to validate this chain end-to-end on the real hardware — green tally
behavior cannot be proven without a real ATEM + Blackmagic camera combination.

**How to handle:** The walk-test is the validation mechanism. If green SDI tally does not
appear during the walk-test, it indicates an ATEM model or camera firmware limitation, not
a code bug.

## Code Examples

### Connecting to ATEM and listening for events

```typescript
// Source: verified from node_modules/atem-connection/dist/atem.d.ts + atem.js (3.9.0)
import { Atem } from 'atem-connection';

const atem = new Atem();              // AtemOptions all optional
await atem.connect('192.168.1.100'); // port defaults to 9910

atem.on('connected', () => {
  // atem.state is fully populated here (InitCompleteCommand already processed)
  console.log('ATEM hydrated — state:', atem.state?.info.model);
});

atem.on('stateChanged', (state, paths) => {
  // Only fires AFTER 'connected', and only when ATEM state actually changes
  console.log('ATEM state changed at paths:', paths);
});

atem.on('disconnected', () => {
  console.log('ATEM disconnected');
});
```

### Hard-cutting program and setting preview (ME1)

```typescript
// Source: verified from node_modules/atem-connection/dist/atem.js (3.9.0)
// changeProgramInput(input: number, me?: number): Promise<void>
// changePreviewInput(input: number, me?: number): Promise<void>

// Set camera on ATEM source 3 as program (red tally)
await atem.changeProgramInput(3, 0);  // me=0 = ME1

// Set camera on ATEM source 2 as preview (green tally)
await atem.changePreviewInput(2, 0);

// Important: these are INSTANT (hard cut) — no transition involved
// Do NOT call atem.autoTransition() or atem.cut() for tally purposes
```

### Fastify 5 route with 202/409 pattern

```typescript
// Source: Fastify 5 docs (fastify.dev/docs/latest/Reference/Routes)
import Fastify from 'fastify';

const fastify = Fastify({ logger: pinoInstance });

let isWalkRunning = false;

fastify.get('/walk-test', async (_req, reply) => {
  if (isWalkRunning) {
    return reply.code(409).send({ error: 'walk-test already running' });
  }
  isWalkRunning = true;
  // Background task: do NOT await here
  void (async () => {
    try { await runWalkTest(); }
    finally { isWalkRunning = false; }
  })();
  return reply.code(202).send({ status: 'walk-test started' });
});

await fastify.listen({ port: 3000, host: '0.0.0.0' });
```

### Latency logging pattern (REL-01)

```typescript
// Source: D-08 from CONTEXT.md; Date.now() native JS
// tallyReceivedAt = Date.now() from TallyOrchestrator at TCP push receipt
applyState(newState: ResolverOutput, tallyReceivedAt: number): void {
  if (!this.isHydrated) {
    this.pendingState = newState;
    return;
  }
  const report = this.reconciler.submit(newState.bus);
  if (!report.changed) return;

  // Log BEFORE awaiting — captures time from tally receipt to command send
  this.logger.info({
    event: 'atem_command_sent',
    latencyMs: Date.now() - tallyReceivedAt,
    program: newState.bus.program,
    preview: newState.bus.preview,
    changed: report,
  }, 'ATEM bus updated');

  if (report.program && newState.bus.program !== null) {
    void this.atem.changeProgramInput(newState.bus.program, 0)
      .catch(err => this.logger.error({ err }, 'changeProgramInput failed'));
  }
  if (report.preview && newState.bus.preview !== null) {
    void this.atem.changePreviewInput(newState.bus.preview, 0)
      .catch(err => this.logger.error({ err }, 'changePreviewInput failed'));
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling ATEM state for tally | Direct `changeProgramInput`/`changePreviewInput` commands | atem-connection 1.x | Commands are instant; no polling lag |
| Waiting for `stateChanged` to confirm hydration | `connected` event signals full hydration | Verified in 3.9.0 source | `stateChanged` is suppressed during init dump; `connected` is the correct signal |
| `cut()` for program switching | `changeProgramInput()` | Architecture decision | `cut()` is a transition trigger, not a source assignment |

**Deprecated/outdated:**
- `pkg` for Node.js packaging: last release 2024-02, no longer maintained. Use Node SEA (out of Phase 4 scope).
- Early ATEM libraries (`nrkno/tv-automation-atem-connection`): archived fork; use `Sofie-Automation/sofie-atem-connection` only.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `changePreviewInput` reliably produces green SDI tally on the specific Blackmagic camera model in use | Architecture Patterns, Pitfall 6 | Walk-test shows no green tally; must verify on real hardware |
| A2 | ATEM default TCP port is 9910 | Pattern 4 (server.ts wiring) | Connection fails at startup; operator must configure correct port via ConfigStore |
| A3 | Phase 3's `TallyOrchestrator` is named `tallyOrchestrator.ts` and exports `TallyOrchestrator` class | Pattern 4 | Import path in server.ts fails; planner must verify against Phase 3 plan output |

**If this table is empty:** All claims in this research were verified or cited.
(A1 is the primary unresolvable assumption without real hardware.)

## Open Questions

1. **Phase 3 TallyOrchestrator exact filename/export**
   - What we know: Phase 3 CONTEXT.md D-11 says "e.g. `src/vmix/tallyOrchestrator.ts`
     or similar — naming at Claude's discretion."
   - What's unclear: The actual filename won't be decided until Phase 3 plans are executed.
   - Recommendation: Phase 4 planner should reference Phase 3 plans for the exact filename.
     If Phase 3 is not yet executed, the Phase 4 plan should use a placeholder or check
     Phase 3 plan output before writing `server.ts`.

2. **`null` program bus ATEM behavior**
   - What we know: When no input is live, `state.bus.program = null`. We should NOT call
     `changeProgramInput(null, 0)`.
   - What's unclear: Should we set a "black" or "bars" input when program goes null?
     Or simply leave the ATEM on its last PGM input?
   - Recommendation: Leave ATEM unchanged on null program. The walk-test post-state
     (last camera on preview) makes this acceptable. Phase 5 resync will re-assert.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `atem-connection` | AtemConnector | ✓ (in node_modules) | 3.9.0 | — |
| `fastify` | Fastify HTTP server | ✓ (in node_modules) | 5.9.0 | — |
| `pino` | Structured logging | ✓ (in node_modules) | 10.3.1 | — |
| `@fastify/static` | Phase 6 UI serving | ✓ (in node_modules) | 9.1.3 | — |
| `@fastify/websocket` | Phase 6 WebSocket | ✓ (in node_modules) | 11.2.0 | — |
| Node.js 22 LTS | Runtime | ✓ (engines: ">=22") | per project | — |
| Real ATEM hardware | VERIFY-01 walk-test | Unknown | — | Dry-run mode (log only, no real hardware calls) |
| Real Blackmagic cameras | ATEM-03 green tally proof | Unknown | — | Visual inspection on walk-test |

**Missing dependencies with no fallback:** None — all npm packages are already installed.

**Missing dependencies with fallback:**
- Real ATEM hardware: Phase 4 unit tests mock `atem-connection` and test command dispatch
  logic without hardware. Walk-test requires real hardware for VERIFY-01 manual sign-off.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` (exists — `src/**/*.test.ts`, `environment: 'node'`) |
| Quick run command | `npx vitest run src/atem/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ATEM-01 | `AtemConnector.connect()` calls `atem.connect(host, port)` | unit (mock Atem) | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ Wave 0 |
| ATEM-01 | Hydration gate: `'connected'` event sets `isHydrated = true` | unit (mock Atem) | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ Wave 0 |
| ATEM-01 | Pending state flushed on hydration | unit (mock Atem) | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ Wave 0 |
| ATEM-02 | `applyState` calls `changeProgramInput(src, 0)` not `cut()` | unit (mock Atem) | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ Wave 0 |
| ATEM-03 | `applyState` calls `changePreviewInput(src, 0)` | unit (mock Atem) | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ Wave 0 |
| ATEM-02/03 | No command sent when state unchanged (reconciler no-op) | unit | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ Wave 0 |
| ATEM-02/03 | Null bus.program → no `changeProgramInput` call | unit | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ Wave 0 |
| VERIFY-01 | Walk-test `GET /walk-test` returns 202 | unit (mock Fastify inject) | `npx vitest run src/server.test.ts` | ❌ Wave 0 |
| VERIFY-01 | Walk-test returns 409 when already running | unit | `npx vitest run src/server.test.ts` | ❌ Wave 0 |
| VERIFY-01 | Walk-test calls changeProgramInput + changePreviewInput per camera | unit (mock AtemConnector) | `npx vitest run src/server.test.ts` | ❌ Wave 0 |
| REL-01 | `latencyMs` field present in pino log on command dispatch | unit (mock logger) | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/atem/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/atem/AtemConnector.test.ts` — covers ATEM-01, ATEM-02, ATEM-03, REL-01
- [ ] `src/server.test.ts` — covers VERIFY-01 (Fastify inject pattern)
- [ ] Mock for `atem-connection`'s `Atem` class — needed in both test files
  (`vi.mock('atem-connection', ...)` or constructor injection of mock)

**Fastify inject pattern for walk-test testing:**
```typescript
// Source: Fastify 5 docs — fastify.inject() for testing without opening a port
const response = await fastify.inject({ method: 'GET', url: '/walk-test' });
expect(response.statusCode).toBe(202);
```

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | LAN-only tool; REQUIREMENTS.md explicitly out-of-scope |
| V3 Session Management | no | No session concept; stateless GET endpoint |
| V4 Access Control | no | Co-located LAN; all users trusted (per REQUIREMENTS.md out-of-scope) |
| V5 Input Validation | yes | Walk-test takes no user input — no validation needed for Phase 4 endpoint |
| V6 Cryptography | no | No secrets transmitted |

### Known Threat Patterns for walk-test endpoint

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Walk-test triggered during live production (accidental or intentional) | Tampering | Operator procedure: only run walk-test before production. 409 prevents concurrent runs. Phase 6 could add a "confirm" gate in UI. |
| ATEM IP spoofed on LAN | Spoofing | Acceptable per REQUIREMENTS.md (LAN trust model). No mitigation required for Phase 4. |
| Walk-test endpoint exposed beyond LAN | Information Disclosure | Fastify listens on `0.0.0.0:3000`; firewall/router responsibility. No auth added per REQUIREMENTS.md explicit out-of-scope decision. |

**Security finding:** The walk-test endpoint issues real ATEM hardware commands. The primary
risk is accidental triggering during live production. The `isWalkRunning` flag (D-11) prevents
stacking but does not prevent a first trigger. This is explicitly accepted per the project's
LAN-trust model.

## Sources

### Primary (HIGH confidence)
- `node_modules/atem-connection/dist/atem.js` (3.9.0, installed) — `_mutateState`,
  `_onInitComplete`, `connected` event ordering, `InitCompleteCommand` branch,
  `changeProgramInput`/`changePreviewInput` implementations [VERIFIED: installed package source]
- `node_modules/atem-connection/dist/atem.d.ts` (3.9.0, installed) — `AtemEvents` type,
  `changeProgramInput(input: number, me?: number): Promise<void>` signature [VERIFIED: installed package source]
- `src/core/tallyState.ts` (project codebase) — `TallyStateReconciler` exact API:
  `submit(desired: DesiredAtemBusState): ChangeReport`, `reset(): void`, `current(): DesiredAtemBusState` [VERIFIED: codebase]
- `src/core/events.ts` (project codebase) — `ResolverOutput`, `DesiredAtemBusState`,
  `AtemSource = number | null` [VERIFIED: codebase]
- Fastify 5 docs (fastify.dev/docs/latest/Reference/Routes) — `reply.code(N).send()`,
  async handler return pattern [VERIFIED: official docs]
- slopcheck 2026-07-01 — all 5 packages [OK] [VERIFIED: slopcheck]

### Secondary (MEDIUM confidence)
- ATEM SDI tally general documentation (Blackmagic Design) — preview bus embeds green tally
  in SDI ancillary data for compatible camera models [CITED: bhphotovideo.com ATEM GPI & Tally listing]
- `src/atem.ts` from NRK archive (nrkno/tv-automation-atem-connection) — historical confirmation
  of `changeProgramInput(input, me=0)` pattern [MEDIUM — older fork, same architecture]

### Tertiary (LOW confidence)
- General SDI preview tally behavior for Blackmagic cameras — not confirmed on specific models;
  requires VERIFY-01 hardware walk-test to prove [LOW — requires hardware validation]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in installed node_modules
- Architecture: HIGH — hydration sequence verified from installed source; command signatures verified
- `changePreviewInput` green tally: MEDIUM — protocol-level correct; hardware behavior requires walk-test
- Pitfalls: HIGH — all derived from verified source code analysis

**Research date:** 2026-07-01
**Valid until:** 2026-08-01 (atem-connection is stable; Fastify 5 is current)
