# Phase 4: ATEM Output + Walk-Test (end-to-end MVP slice) - Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 3 new files
**Analogs found:** 3 / 3

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/atem/AtemConnector.ts` | service | request-response + event-driven | `src/core/tallyState.ts` (EventEmitter class) + Phase 3 `VmixConnector.ts` plan (network I/O module with pino injection) | role-match (no existing network connector; plan analog used) |
| `src/server.ts` | entry-point / bootstrap | event-driven wiring | `src/core/tallyState.ts` constructor pattern; Phase 3 `tallyOrchestrator.ts` plan (wiring hub) | partial-match |
| `src/atem/AtemConnector.test.ts` | test | — | `src/core/tallyState.test.ts` | exact |
| `src/server.test.ts` | test | — | `src/core/tallyState.test.ts` + `src/config/schema.test.ts` | role-match |

---

## Pattern Assignments

### `src/atem/AtemConnector.ts` (service, event-driven + request-response)

**Analog:** `src/core/tallyState.ts` (EventEmitter class structure, private state, copy semantics)
**Network pattern analog:** Phase 3 `src/vmix/VmixConnector.ts` plan (pino injection, `void asyncMethod()` event listener wiring, fail-open lifecycle)

**Imports pattern** — copy from `src/core/tallyState.ts` lines 1-11 and extend:
```typescript
// 1. Node builtins
import { EventEmitter } from "node:events";

// 2. Third-party
import { Atem } from "atem-connection";
import type { Logger } from "pino";

// 3. Local core (type-only — verbatimModuleSyntax)
import { TallyStateReconciler } from "../core/tallyState.js";
import type { ResolverOutput } from "../core/events.js";
import type { MappingEntry } from "../core/resolver.js";
```

**Class skeleton pattern** — copy from `src/core/tallyState.ts` lines 50-57:
```typescript
// src/core/tallyState.ts lines 50-57
export class TallyStateReconciler extends EventEmitter {
  private lastSent: DesiredAtemBusState;

  constructor() {
    super();
    this.lastSent = { program: null, preview: null };
  }
```
Apply to `AtemConnector` as:
```typescript
export class AtemConnector {
  private atem: Atem;
  private reconciler = new TallyStateReconciler();
  private isHydrated = false;
  private pendingState: ResolverOutput | null = null;
  private logger: Logger;

  constructor(private host: string, private port: number, logger: Logger) {
    this.logger = logger;
    this.atem = new Atem();
    // register all listeners here in constructor body
  }
```

**Event listener registration pattern** — copy from Phase 3 `VmixConnector.ts` plan (03-02-PLAN.md lines 255-261). Use `void this.asyncMethod()` for async handlers; synchronous handlers inline:
```typescript
// Async handler: DO NOT use `async () =>` directly on the listener
this.atem.on('connected', () => { void this.handleConnected(); });
// Sync handler: inline arrow is fine
this.atem.on('disconnected', () => {
  this.logger.warn({ event: 'atem_disconnected' }, 'ATEM disconnected');
  this.isHydrated = false;
  this.reconciler.reset();
});
this.atem.on('stateChanged', (_state, paths) => {
  this.logger.debug({ event: 'atem_state_changed', paths }, 'ATEM state changed');
});
```

**Hydration gate pattern** — CRITICAL: use `'connected'` event, NOT first `'stateChanged'`
(verified from installed `node_modules/atem-connection/dist/atem.js` lines 175-181 — `stateChanged`
is suppressed during `InitCompleteCommand` batch; `connected` fires at `_onInitComplete()` when
`atem.state` is fully populated):
```typescript
private handleConnected(): void {
  this.logger.info({ event: 'atem_connected', host: this.host }, 'ATEM connected');
  this.isHydrated = true;
  if (this.pendingState !== null) {
    this.logger.info({ event: 'atem_pending_flush' }, 'Flushing pending state after hydration');
    this._dispatch(this.pendingState);
    this.pendingState = null;
  }
}
```

**Fail-open connect pattern** — copy from Phase 3 `VmixConnector.ts` plan (03-02-PLAN.md lines 240-244). Never block; log errors; keep running (D-02):
```typescript
connect(): void {
  this.logger.info({ event: 'atem_connect_attempt', host: this.host }, 'Connecting to ATEM');
  void this.atem.connect(this.host, this.port);  // D-02: fail-open — no await, no throw
}
```

**applyState + reconciler diff pattern** — uses `TallyStateReconciler.submit()` from
`src/core/tallyState.ts` lines 71-97. Read those lines for the exact return shape (`ChangeReport`):
```typescript
applyState(newState: ResolverOutput, tallyReceivedAt: number): void {
  if (!this.isHydrated) {
    this.pendingState = newState;   // supersedes any earlier pending; latest wins
    return;
  }
  this._dispatch(newState, tallyReceivedAt);
}

private _dispatch(state: ResolverOutput, tallyReceivedAt?: number): void {
  const report = this.reconciler.submit(state.bus);
  if (!report.changed) return;     // SC4 no-op-on-unchanged from TallyStateReconciler

  // Log BEFORE await — captures time from tally receipt to command SEND, not ACK
  if (tallyReceivedAt !== undefined) {
    this.logger.info({
      event: 'atem_command_sent',
      latencyMs: Date.now() - tallyReceivedAt,  // REL-01 proof field
      program: state.bus.program,
      preview: state.bus.preview,
    }, 'ATEM bus updated');
  }

  // Guard null before calling — changeProgramInput(input: number) does not accept null
  if (report.program && state.bus.program !== null) {
    void this.atem.changeProgramInput(state.bus.program, 0)
      .catch(err => this.logger.error({ err }, 'changeProgramInput failed'));
  }
  if (report.preview && state.bus.preview !== null) {
    void this.atem.changePreviewInput(state.bus.preview, 0)
      .catch(err => this.logger.error({ err }, 'changePreviewInput failed'));
  }
}
```

**Walk-test method pattern** — sequential async loop with per-step pino logging (D-06, D-07):
```typescript
async walkTest(mapping: MappingEntry[], logger: Logger): Promise<void> {
  logger.info({ event: 'walk_test_started', cameras: mapping.length }, 'Walk-test starting');
  for (const entry of mapping) {
    logger.info({ event: 'walk_program', cameraId: entry.cameraId, atemSource: entry.atemSource });
    await this.atem.changeProgramInput(entry.atemSource, 0);
    await new Promise<void>(res => setTimeout(res, 2000));

    logger.info({ event: 'walk_preview', cameraId: entry.cameraId, atemSource: entry.atemSource });
    await this.atem.changePreviewInput(entry.atemSource, 0);
    await new Promise<void>(res => setTimeout(res, 2000));
  }
  logger.info({ event: 'walk_test_complete' }, 'Walk-test complete');
}
```

**ESM import of atem-connection (CJS package)** — copy from Phase 3 research on node-vmix CJS
interop (03-RESEARCH.md line 277 pattern). `atem-connection` has no `"type":"module"` and no
`"exports"` field — Node 22 NodeNext allows named imports via the `main` field. No `createRequire`
workaround needed. Named import `{ Atem }` is a value (class), satisfying `verbatimModuleSyntax`.

---

### `src/server.ts` (entry-point, event-driven wiring)

**Analog:** Phase 3 `src/vmix/tallyOrchestrator.ts` plan (03-03-PLAN.md lines 213-246) — the
module that wires EventEmitter sources to downstream consumers.

**Imports pattern** — follow the import order established by `src/core/tallyState.ts` lines 10-11
and the Phase 3 orchestrator plan (03-03-PLAN.md lines 199-211):
```typescript
// 1. Third-party
import pino from 'pino';

// 2. Local config
import { ConfigStore } from './config/configStore.js';

// 3. Local vmix (Phase 3 modules — server.ts is the ONLY file that imports from BOTH vmix/ and atem/)
import { VmixConnector } from './vmix/VmixConnector.js';
import { TallyOrchestrator } from './vmix/tallyOrchestrator.js';

// 4. Local atem
import { AtemConnector } from './atem/AtemConnector.js';
```

**Module-level bootstrap pattern** — top-level await in ESM (`"type":"module"` in package.json
line 5). Fail-open: start everything, log errors, keep running (D-02):
```typescript
const logger = pino();
const config = new ConfigStore();
await config.init();   // load from disk; DEFAULTS on missing file
const cfg = await config.read();   // exact method name TBD — planner must verify ConfigStore API from 02-02-PLAN.md
```

**Event wiring pattern** — D-01 constraint: this is the ONLY file that imports both `vmix/` and
`atem/`. AtemConnector does NOT hold a reference to TallyOrchestrator:
```typescript
// D-01 wiring seam — copy this exact pattern
orchestrator.on('stateChanged', ({ newState, tallyReceivedAt }) => {
  atem.applyState(newState, tallyReceivedAt);
});
```

**Fastify bootstrap pattern** — Fastify 5 with pino logger. Port from env with fallback:
```typescript
import Fastify from 'fastify';

const app = Fastify({ logger });   // reuse root pino logger

await app.listen({ port: Number(process.env['PORT'] ?? 3000), host: '0.0.0.0' });
logger.info({ event: 'server_started', port: process.env['PORT'] ?? 3000 }, 'Server listening');
```

**Walk-test route pattern** — Fastify 5 async handler, 202/409, fire-and-forget background task.
CRITICAL: always `return reply` after `reply.code(N).send(...)` — Fastify 5 serializes the
async handler return value; implicit `undefined` return causes a double-response conflict
(04-RESEARCH.md Pitfall 4):
```typescript
let isWalkRunning = false;

app.get('/walk-test', async (_req, reply) => {
  if (isWalkRunning) {
    return reply.code(409).send({ error: 'walk-test already running' });
  }
  isWalkRunning = true;
  void (async () => {
    try {
      const mapping = cfg.mapping;   // PersistedMappingEntry[] — planner verify exact accessor
      await atem.walkTest(mapping as MappingEntry[], logger);
    } finally {
      isWalkRunning = false;
    }
  })();
  return reply.code(202).send({ status: 'walk-test started' });
});
```

---

### `src/atem/AtemConnector.test.ts` (test, unit)

**Analog:** `src/core/tallyState.test.ts` — exact match for vitest idiom, file structure, and
EventEmitter spy pattern.

**File header pattern** — copy from `src/core/tallyState.test.ts` lines 1-8:
```typescript
// Test suite for AtemConnector (src/atem/AtemConnector.ts).
// Proves: connect() calls atem.connect(host, port); hydration gate sets isHydrated on
// 'connected' event; pendingState flushed on hydration; applyState dispatches
// changeProgramInput/changePreviewInput only for changed fields (CORE-03 via reconciler);
// latencyMs present in pino log on command dispatch (REL-01).
// Run: npx vitest run src/atem/AtemConnector.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AtemConnector } from "./AtemConnector.js";
```

**vi.fn() event spy pattern** — copy from `src/core/tallyState.test.ts` lines 19-32:
```typescript
// tallyState.test.ts lines 19-27 — exact pattern for event listener assertions
const listener = vi.fn();
reconciler.on("change", listener);
// ...
expect(listener).toHaveBeenCalledTimes(1);
expect(listener).toHaveBeenCalledWith({ state: ..., report: ... });
```
Apply to AtemConnector by spying on `atem.changeProgramInput` and `atem.changePreviewInput`.

**Atem mock strategy** — `atem-connection` is a CJS package. Preferred mock approach: constructor
injection. Accept an optional `_atem?: Atem` parameter (or factory function) in the constructor
for test injection. Alternatively `vi.mock('atem-connection')` with module-level hoisting.
The mock `Atem` must:
- Capture listeners registered via `.on(event, handler)`
- Expose a helper to trigger events: `mockAtem.emit('connected')`
- Track `changeProgramInput` and `changePreviewInput` via `vi.fn()` returning `Promise.resolve()`
- Track `connect` via `vi.fn()` returning `Promise.resolve()`

**describe/it label style** — copy from `src/core/tallyState.test.ts` lines 9-16:
```typescript
describe("AtemConnector", () => {
  describe("ATEM-01 — connect and hydration gate", () => {
    it("ATEM-01: connect() calls atem.connect(host, port)", () => { ... });
    it("ATEM-01: 'connected' event sets isHydrated to true", () => { ... });
    it("ATEM-01: pendingState flushed immediately on hydration", () => { ... });
  });
  describe("ATEM-02/03 — applyState command dispatch", () => {
    it("ATEM-02: applyState calls changeProgramInput(src, 0) not cut()", () => { ... });
    it("ATEM-03: applyState calls changePreviewInput(src, 0)", () => { ... });
    it("CORE-03: no command sent when state unchanged (reconciler no-op)", () => { ... });
    it("ATEM-02: null bus.program does not call changeProgramInput", () => { ... });
  });
  describe("REL-01 — latency logging", () => {
    it("REL-01: latencyMs field present in pino log on command dispatch", () => { ... });
  });
});
```

**Logger mock pattern** — inject a pino mock logger. Copy the injected-logger pattern from
Phase 3 orchestrator plan (03-03-PLAN.md lines 220-222):
```typescript
// Minimal mock logger satisfying pino Logger interface for tests
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;
```

---

### `src/server.test.ts` (test, integration-lite)

**Analog:** `src/core/tallyState.test.ts` (file structure) + Fastify inject pattern from
04-RESEARCH.md Validation Architecture section.

**File header pattern** — copy from `src/core/tallyState.test.ts` lines 1-8. Adapt:
```typescript
// Test suite for server walk-test route (src/server.ts).
// Proves: GET /walk-test returns 202 on first call; returns 409 when already running;
// walk-test loop calls changeProgramInput + changePreviewInput per camera (VERIFY-01).
// Run: npx vitest run src/server.test.ts

import { describe, it, expect, vi } from "vitest";
```

**Fastify inject pattern** — from 04-RESEARCH.md Validation Architecture section:
```typescript
// Fastify 5 test injection — no real port opened
const response = await fastify.inject({ method: 'GET', url: '/walk-test' });
expect(response.statusCode).toBe(202);
```

**409 concurrent-guard test** — call inject twice without awaiting the walk to complete;
second call must return 409:
```typescript
it("VERIFY-01: returns 409 when walk-test already running", async () => {
  // First call starts walk (202)
  const first = await fastify.inject({ method: 'GET', url: '/walk-test' });
  expect(first.statusCode).toBe(202);
  // Second call while flag is set (409)
  const second = await fastify.inject({ method: 'GET', url: '/walk-test' });
  expect(second.statusCode).toBe(409);
  expect(JSON.parse(second.body)).toEqual({ error: 'walk-test already running' });
});
```

---

## Shared Patterns

### Constructor Logger Injection (all I/O modules)

**Source:** Phase 3 `VmixConnector.ts` plan (03-02-PLAN.md lines 240-244) and established in
`TallyOrchestrator` plan (03-03-PLAN.md lines 220-222).
**Apply to:** `AtemConnector` constructor
```typescript
// Pattern: accept Logger, do NOT default to pino() inside the constructor of I/O modules.
// The root logger is created ONCE in server.ts and injected downward.
constructor(private host: string, private port: number, logger: Logger) {
  this.logger = logger;
  // ...
}
```

### Pino Structured Log Fields

**Source:** Established by Phase 3 for all I/O modules; `src/core/tallyState.ts` has no logging
(pure module). All pino calls use an object first argument with an `event` string field:
```typescript
// Pattern from Phase 3 VmixConnector plan (03-02-PLAN.md lines 261-265)
this.logger.info({ event: 'atem_connected', host, port }, 'ATEM connected');
this.logger.warn({ event: 'atem_disconnected' }, 'ATEM disconnected');
this.logger.error({ err, event: 'atem_command_failed' }, 'ATEM command failed');
// REL-01 specific field — latencyMs must be a top-level pino field (not nested)
this.logger.info({ event: 'atem_command_sent', latencyMs: number, program: n, preview: n }, '...');
```

### ESM `.js` Extension on All Local Imports

**Source:** `src/core/tallyState.ts` lines 11, `src/config/schema.ts` line 5, `src/core/events.ts`
line 1. `tsconfig.json` has `"module": "NodeNext"` and `"verbatimModuleSyntax": true`.
**Apply to:** every local import in AtemConnector.ts and server.ts
```typescript
import { TallyStateReconciler } from "../core/tallyState.js";  // .js — always
import type { ResolverOutput } from "../core/events.js";        // type-only → import type
import { AtemConnector } from "./atem/AtemConnector.js";        // .js — always
```

### `import type` for Type-Only Imports

**Source:** `src/core/tallyState.ts` line 11, `src/core/resolver.ts` lines 6-13.
`"verbatimModuleSyntax": true` in tsconfig — type-only imports MUST use `import type`.
**Apply to:** all interface/type imports in AtemConnector.ts and server.ts
```typescript
import type { Logger } from "pino";              // type-only → import type
import type { ResolverOutput } from "../core/events.js";
import type { MappingEntry } from "../core/resolver.js";
```

### `noUncheckedIndexedAccess` Array Guard

**Source:** `tsconfig.json` `"noUncheckedIndexedAccess": true`. Used throughout `src/core/`.
**Apply to:** Any array index access in AtemConnector.ts (e.g. iterating `mapping` entries).
Use `for...of` to avoid indexed access, or guard with `?? defaultValue`.

### Void-Wrapped Async in Sync Context

**Source:** Phase 3 `VmixConnector.ts` plan (03-02-PLAN.md line 255):
> `void this.handleConnect()` — note: void return from async; do NOT use async arrow directly
**Apply to:** `AtemConnector` constructor event listeners calling async private methods:
```typescript
this.atem.on('connected', () => { void this.handleConnected(); });
// NOT: this.atem.on('connected', async () => { await this.handleConnected(); })
// Reason: EventEmitter ignores the returned Promise; unhandled rejection risk
```

### TallyStateReconciler.submit() Return Contract

**Source:** `src/core/tallyState.ts` lines 19-23, 71-97.
**Apply to:** `AtemConnector._dispatch()`. The `submit()` call returns a `ChangeReport`:
```typescript
// src/core/tallyState.ts lines 19-23
export interface ChangeReport {
  changed: boolean;   // true if either field changed
  program: boolean;   // true if program field changed
  preview: boolean;   // true if preview field changed
}
// Usage: if (!report.changed) return;   ← early exit for no-op
// then: if (report.program) { ... }     ← field-level gate
// and:  if (report.preview) { ... }     ← field-level gate
```

### reset() After Disconnect

**Source:** `src/core/tallyState.ts` lines 115-119 (`reset()` docs):
> "Intended for Phase 5 resync: after an ATEM reconnection the connector calls reset() so
> that the very next submit() will always report changed:true"
**Apply to:** `AtemConnector`'s `'disconnected'` handler:
```typescript
this.atem.on('disconnected', () => {
  this.isHydrated = false;
  this.reconciler.reset();   // Phase 5 resync seam — next applyState after reconnect re-asserts full state
});
```

---

## Module Boundary Constraints

These are not patterns to copy but hard constraints the planner must enforce in every action:

| Rule | Source | Enforcement |
|---|---|---|
| `core/` must not import from `vmix/` or `atem/` | Phase 3 plan 03-03 line 26 | grep check in acceptance criteria |
| `atem/` must not import from `vmix/` | Phase 3 CONTEXT.md D-09 | grep check |
| `server.ts` is the ONLY file that imports from BOTH `vmix/` and `atem/` | 04-CONTEXT.md D-01 | grep check |
| `vmix/tallyOrchestrator.ts` is the only `vmix/` file that imports from `core/` | Phase 3 plan 03-03 line 27 | grep check |

---

## No Analog Found

No files in Phase 4 are fully without analog — the closest-match strategy above covers all three
new files. The table below documents where plan-described patterns (from 04-RESEARCH.md) were
used instead of a codebase file analog:

| File | Pattern Gap | Resolution |
|---|---|---|
| `src/atem/AtemConnector.ts` | No existing network connector in codebase (Phase 3 not yet executed) | Used Phase 3 `VmixConnector.ts` plan action sections (03-02-PLAN.md) as the network I/O pattern source — same architecture, same pino injection, same void-async-listener idiom |
| `src/server.ts` | No existing server entry point | Used Phase 3 `tallyOrchestrator.ts` plan (03-03-PLAN.md) for wiring pattern; Fastify pattern from 04-RESEARCH.md Code Examples (verified against Fastify 5 docs) |
| `src/config/configStore.ts` | Not yet implemented (Phase 2 plan 02-02 written but not executed) | Planner must verify exact `ConfigStore` public API (init/load method name; mapping accessor) against 02-02-PLAN.md before writing `server.ts` — use `config.init()` + `config.read()` or `config.getMapping()` per that plan's Task 2 action |

---

## Metadata

**Analog search scope:** `src/core/`, `src/config/`, `.planning/phases/02-*/`, `.planning/phases/03-*/`
**Files scanned:** `src/core/tallyState.ts`, `src/core/tallyState.test.ts`, `src/core/events.ts`,
`src/core/resolver.ts`, `src/core/resolver.test.ts` (lines 1-54), `src/config/schema.ts`,
`src/config/schema.test.ts` (lines 1-50), `.planning/phases/03-vmix-live-ingest/03-02-PLAN.md`,
`.planning/phases/03-vmix-live-ingest/03-03-PLAN.md`, `.planning/phases/02-config-persistence-mapping-model/02-02-PLAN.md`,
`package.json`
**Phase 3 execution status:** Plans written (committed 4e9ac1a); `src/vmix/` does NOT yet exist —
planner must note that `VmixConnector`, `TallyOrchestrator` filenames and exact exports are
per-plan definitions, not verified codebase facts. See 03-02-PLAN.md + 03-03-PLAN.md for
canonical contracts.
**Pattern extraction date:** 2026-07-01
