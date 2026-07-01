# Phase 5: Reliability — Reconnect + Resync - Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 3 modified files (no new files in Phase 5)
**Analogs found:** 3 / 3

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/vmix/VmixConnector.ts` | service (EventEmitter) | event-driven | `src/core/tallyState.ts` — `TallyStateReconciler extends EventEmitter` (private state + lifecycle) | role-match (EventEmitter subclass, private instance fields, lifecycle management) |
| `src/atem/AtemConnector.ts` | service (EventEmitter) | event-driven | `src/core/tallyState.ts` — `TallyStateReconciler extends EventEmitter` (identical class shape; Phase 4 adds `'disconnected'` seam that Phase 5 fills) | role-match (EventEmitter subclass, isHydrated/pendingState private fields, emit pattern) |
| `src/server.ts` | orchestrator / entry point | request-response + event-driven | Phase 4 research Pattern 4 — `server.ts` wiring (`orchestrator.on('stateChanged', ...)`) | exact (one new `.on('ready', ...)` listener added to the existing wiring block) |

---

## Pattern Assignments

### `src/vmix/VmixConnector.ts` (service, event-driven) — TCP transport replacement

**Context:** Phase 5 replaces `ConnectionTCP` from `node-vmix` with a raw `node:net` Socket and
adds a self-managed backoff loop. The public interface (`'tally'`, `'rosterUpdated'` events,
`roster()`, `shutdown()`) is completely unchanged. Only internal TCP machinery changes.

**Analog:** `src/core/tallyState.ts` — private instance field pattern + EventEmitter subclass
structure. The backoff state fields (`attempt`, `retryTimer`, `destroyed`) follow the same
private-field-per-lifecycle-concern pattern as `lastSent` in `TallyStateReconciler`.

**Private instance field pattern** (`src/core/tallyState.ts` lines 50–57):
```typescript
export class TallyStateReconciler extends EventEmitter {
  private lastSent: DesiredAtemBusState;

  constructor() {
    super();
    this.lastSent = { program: null, preview: null };
  }
```
Apply same: add backoff-related private fields to the existing `VmixConnector` class body:
```typescript
// New private fields — add alongside existing rosterMap, currentRosterLength:
private socket: Socket | null = null;
private attempt = 0;
private retryTimer: ReturnType<typeof setTimeout> | null = null;
private destroyed = false;
private lineBuffer = '';
```

**EventEmitter subclass import pattern** (`src/core/tallyState.ts` lines 10–11):
```typescript
import { EventEmitter } from "node:events";
import type { DesiredAtemBusState } from "./events.js";
```
VmixConnector adds `node:net` to the existing node builtin import block:
```typescript
import { EventEmitter } from "node:events";
import { createConnection } from "node:net";
import type { Socket } from "node:net";
// Remove: import { ConnectionTCP } from "node-vmix";
```

**Core backoff pattern** (05-RESEARCH.md Pattern 1, lines 263–311):
```typescript
private backoffDelay(): number {
  // D-03: 1s initial, 30s max, ±25% jitter
  const base = Math.min(1000 * Math.pow(2, this.attempt), 30_000);
  return base * (0.75 + Math.random() * 0.5);
}

private scheduleReconnect(): void {
  if (this.destroyed) return;
  const delay = this.backoffDelay();
  this.attempt++;
  this.logger.info({ attempt: this.attempt, delayMs: Math.round(delay) }, 'vmix TCP reconnecting');
  this.retryTimer = setTimeout(() => this.createSocket(), delay);
}

private createSocket(): void {
  this.retryTimer = null;
  if (this.destroyed) return;

  const sock = createConnection({ host: this.host, port: this.tcpPort });
  this.socket = sock;

  sock.on('connect', () => {
    this.attempt = 0;          // reset on successful connect
    this.lineBuffer = '';      // clear stale bytes from previous session
    sock.write('SUBSCRIBE TALLY\r\n');
    void this.fetchAndEmitRoster();
    this.logger.info({ host: this.host, port: this.tcpPort }, 'vmix TCP connected');
  });

  sock.on('data', (chunk: Buffer) => {
    this.lineBuffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = this.lineBuffer.indexOf('\r\n')) !== -1) {
      const line = this.lineBuffer.slice(0, idx);
      this.lineBuffer = this.lineBuffer.slice(idx + 2);
      this.handleLine(line);
    }
  });

  sock.on('error', (err: Error) => {
    this.logger.warn({ err }, 'vmix TCP error');
    sock.destroy();  // must destroy before retry — 'close' fires next
  });

  sock.on('close', () => {
    // 'close' always fires after 'error' — trigger reconnect only here (never from 'error')
    this.logger.info({ host: this.host }, 'vmix TCP closed — scheduling reconnect');
    this.scheduleReconnect();
  });
}
```

**Shutdown/destroy pattern** — replace existing `shutdown()`:
```typescript
// Replace: shutdown(): void { this.tcp.shutdown(); }
// With:
destroy(): void {
  this.destroyed = true;
  if (this.retryTimer !== null) clearTimeout(this.retryTimer);
  this.socket?.destroy();
}
```

**Line dispatch pattern** (`handleLine` replaces former `handleTally` — same logic, new name to
reflect that the raw socket may receive lines other than TALLY):
```typescript
private handleLine(line: string): void {
  if (line.startsWith('TALLY OK ')) {
    const digits = line.slice('TALLY OK '.length);
    this.handleTally(digits);  // existing handleTally(tallyString: string) unchanged
  }
  // SUBSCRIBE TALLY acknowledgement line is silently ignored
}
```

**Pino log pattern** (`src/core/tallyState.ts` has no logging, but established by Phase 3 VmixConnector;
from 03-PATTERNS.md Shared Patterns section):
```typescript
// Structured object first arg, human message second — pino convention:
this.logger.info({ attempt: this.attempt, delayMs: Math.round(delay) }, 'vmix TCP reconnecting');
this.logger.info({ host: this.host, port: this.tcpPort }, 'vmix TCP connected');
this.logger.warn({ err }, 'vmix TCP error');
```

---

### `src/atem/AtemConnector.ts` (service, event-driven) — reconnect + 'ready' event

**Context:** Phase 5 adds three capabilities to the Phase 4 `AtemConnector`:
1. `'disconnected'` handler sets `isHydrated = false` and starts backoff loop (D-01)
2. `'ready'` event emitted when `isHydrated` flips to `true` (D-02)
3. Backoff loop around `atem.connect()` — same parameters as VmixConnector (D-03)

The Phase 4 research (04-RESEARCH.md Pattern 1, lines 286–355) already shows that the Phase 4
plan includes a `'disconnected'` handler stub (`this.isHydrated = false; this.reconciler.reset()`).
Phase 5 extends this stub into a full backoff loop and adds `this.emit('ready')`.

**Analog:** `src/core/tallyState.ts` — EventEmitter subclass, private fields, `emit()` pattern.
The `isHydrated` + `pendingState` pattern from Phase 4 is the closest within-project analog.
`emit('ready')` follows the same typed-event emit pattern as `emit('change', payload)` in
`TallyStateReconciler`.

**Private backoff fields to add** (follow `lastSent` field pattern at `tallyState.ts` line 51):
```typescript
// Add alongside existing isHydrated, pendingState, reconciler:
private attempt = 0;
private retryTimer: ReturnType<typeof setTimeout> | null = null;
private destroyed = false;
```

**Updated 'disconnected' handler** (extends the Phase 4 stub at 04-RESEARCH.md lines 312–316):
```typescript
// Phase 4 stub:
this.atem.on('disconnected', () => {
  this.logger.warn({ event: 'atem_disconnected' }, 'ATEM disconnected');
  this.isHydrated = false;
  this.reconciler.reset();     // Phase 5 resync seam (already in Phase 4 plan)
});

// Phase 5 replacement — add scheduleReconnect() call:
this.atem.on('disconnected', () => {
  this.isHydrated = false;
  this.logger.warn({ event: 'atem_disconnected' }, 'ATEM disconnected — scheduling reconnect');
  this.scheduleReconnect();    // D-01: backoff starts on every disconnect
});
```

**Updated 'connected' handler** (extends the Phase 4 pattern at 04-RESEARCH.md lines 298–306):
```typescript
// Phase 4:
this.atem.on('connected', () => {
  this.logger.info({ event: 'atem_connected', host, port }, 'ATEM connected');
  this.isHydrated = true;
  if (this.pendingState !== null) {
    this._dispatch(this.pendingState);
    this.pendingState = null;
  }
});

// Phase 5 replacement — add attempt reset + emit('ready'):
this.atem.on('connected', () => {
  this.isHydrated = true;
  this.attempt = 0;             // reset on successful connect
  this.logger.info({ event: 'atem_hydrated', host: this.host }, 'ATEM hydrated');
  if (this.pendingState !== null) {
    const s = this.pendingState;
    this.pendingState = null;
    void this.applyState(s, Date.now());
  }
  this.emit('ready');           // D-02: triggers server.ts re-assert
});
```

**Backoff methods** (identical formula to VmixConnector — D-03 same parameters both links):
```typescript
private backoffDelay(): number {
  const base = Math.min(1000 * Math.pow(2, this.attempt), 30_000);
  return base * (0.75 + Math.random() * 0.5);
}

private scheduleReconnect(): void {
  if (this.destroyed) return;
  const delay = this.backoffDelay();
  this.attempt++;
  this.logger.info({ attempt: this.attempt, delayMs: Math.round(delay) }, 'ATEM reconnecting');
  this.retryTimer = setTimeout(() => {
    this.retryTimer = null;
    if (!this.destroyed) {
      void this.atem.connect(this.host).catch((err: unknown) => {
        this.logger.warn({ err }, 'ATEM connect() rejected');
      });
    }
  }, delay);
}
```

**emit('ready') pattern** — follows `emit('change', payload)` in `tallyState.ts` lines 93–94,
but `'ready'` carries no payload (it is a signal, not a data event):
```typescript
// src/core/tallyState.ts lines 93-94 (analog):
this.emit("change", payload);

// AtemConnector Phase 5:
this.emit('ready');  // no payload — server.ts reads orchestrator.currentState directly
```

**EventEmitter extension** — Phase 4 deferred whether `AtemConnector extends EventEmitter`.
Phase 5 requires it for `emit('ready')`. Follow `TallyStateReconciler` pattern exactly:
```typescript
// src/core/tallyState.ts lines 10, 50:
import { EventEmitter } from "node:events";
export class TallyStateReconciler extends EventEmitter {
  constructor() { super(); }

// AtemConnector:
import { EventEmitter } from "node:events";
export class AtemConnector extends EventEmitter {
  constructor(private host: string, private port: number, logger: Logger) {
    super();
    // ...
  }
```

**reconciler.reset() in applyState()** — the Phase 5 resync invariant requires that the ATEM
always receives the command after reconnect even if desired state didn't change. The cleanest
approach (Option B from 05-RESEARCH.md Pattern 4): `applyState()` always calls
`reconciler.reset()` before dispatching on reconnect. The Phase 1 tests at
`src/core/tallyState.test.ts` lines 180–192 prove `reset()` + `submit()` always reports
`changed: true`. Implement via a `needsResync` flag set when `'ready'` fires:
```typescript
private needsResync = false;

// In 'connected' handler — set BEFORE emit('ready'):
this.needsResync = true;
this.emit('ready');

// In _dispatch() — prepend reset when flagged:
private _dispatch(state: ResolverOutput, tallyReceivedAt?: number): void {
  if (this.needsResync) {
    this.reconciler.reset();   // forces changed:true on next submit regardless of prior state
    this.needsResync = false;
  }
  const report = this.reconciler.submit(state.bus);
  // ... rest of Phase 4 dispatch unchanged
}
```

**destroy() method** — add alongside existing `connect()`:
```typescript
destroy(): void {
  this.destroyed = true;
  if (this.retryTimer !== null) clearTimeout(this.retryTimer);
  void this.atem.destroy();
}
```

---

### `src/server.ts` (entry point, event-driven wiring) — 'ready' listener

**Context:** Phase 5 adds exactly one listener to the existing wiring block in `server.ts`. The
`'stateChanged'` wiring established in Phase 4 (D-01) is the direct analog.

**Analog:** Phase 4 research Pattern 4 (`server.ts` wiring block, 04-RESEARCH.md lines 417–453).
The `'ready'` listener follows the same `.on(event, callback)` pattern as the `'stateChanged'`
listener established in Phase 4.

**Existing wiring pattern** (04-RESEARCH.md lines 443–445):
```typescript
// Phase 4 — D-01 wiring (existing):
orchestrator.on('stateChanged', ({ newState, tallyReceivedAt }) => {
  atem.applyState(newState, tallyReceivedAt);
});
```

**Phase 5 addition** (05-RESEARCH.md Pattern 3, lines 410–417) — add immediately after the
`'stateChanged'` listener:
```typescript
// Phase 5 — D-02 re-assert on ATEM reconnect:
atemConnector.on('ready', () => {
  const state = orchestrator.currentState;
  if (state !== null) {
    atemConnector.applyState(state, Date.now());
    logger.info({ event: 'atem_resynced' }, 'ATEM ready — re-asserted current desired state');
  }
  // state === null: no vMix tally received yet; re-assert is a no-op (correct behavior)
});
```

**Null guard rationale:** `orchestrator.currentState` returns `ResolverOutput | null` (Phase 3
D-15). `null` means no vMix tally has arrived yet. If ATEM reconnects before any vMix tally,
the re-assert is intentionally skipped — the normal tally path will push state when vMix
delivers its next event.

**Import additions** — no new imports needed. `atemConnector` is already in scope from Phase 4.
`logger` and `orchestrator` are already in scope from Phase 4.

---

## Shared Patterns

### Backoff formula (both connectors)
**Source:** `src/core/tallyState.ts` (D-03 backoff, same parameters; verified from 05-RESEARCH.md)
**Apply to:** `src/vmix/VmixConnector.ts`, `src/atem/AtemConnector.ts`

Inline in each connector as `private backoffDelay(): number` — do NOT extract to a shared
utility (two call sites; surrounding context differs per connector per 05-RESEARCH.md
"Don't Hand-Roll" section):
```typescript
private backoffDelay(): number {
  // D-03: initial 1s, max 30s, ±25% jitter
  const base = Math.min(1000 * Math.pow(2, this.attempt), 30_000);
  return base * (0.75 + Math.random() * 0.5);
}
// Examples (Math.random() → 0.5, i.e. ±0% jitter):
// attempt=0 → 1000 ms, attempt=1 → 2000, attempt=2 → 4000, attempt=5 → 30000 (capped)
```

For unit tests, spy on `Math.random` to pin jitter:
```typescript
vi.spyOn(Math, 'random').mockReturnValue(0.5);
// Now backoffDelay() returns exact base: 1000, 2000, 4000, 8000, 16000, 30000
```

### Private state field + destroyed guard
**Source:** `src/core/tallyState.ts` lines 50–56 (private field initialization in constructor)
**Apply to:** `src/vmix/VmixConnector.ts`, `src/atem/AtemConnector.ts`

```typescript
// Pattern: private fields initialized at declaration (not in constructor body):
private attempt = 0;
private retryTimer: ReturnType<typeof setTimeout> | null = null;
private destroyed = false;

// destroyed guard — first line of every deferred callback:
private scheduleReconnect(): void {
  if (this.destroyed) return;
  // ...
}
```

### EventEmitter extension + 'ready' emit
**Source:** `src/core/tallyState.ts` lines 50, 93–94 (EventEmitter subclass + typed emit)
**Apply to:** `src/atem/AtemConnector.ts`

```typescript
import { EventEmitter } from "node:events";
export class AtemConnector extends EventEmitter {
  constructor(...) { super(); }
  // ...
  this.emit('ready');  // zero-payload signal event — consumers read state via orchestrator
}
```

### reconciler.reset() re-assert invariant
**Source:** `src/core/tallyState.ts` lines 115–118 + `src/core/tallyState.test.ts` lines 180–192
**Apply to:** `src/atem/AtemConnector.ts` `_dispatch()` method

```typescript
// tallyState.ts reset() (lines 115-118):
reset(): void {
  this.lastSent = { program: null, preview: null };
}
// tallyState.test.ts lines 180-192 proves:
// reset() + submit(same-state) → changed:true, event emitted (re-assert guaranteed)
```

The `needsResync` flag set in the `'connected'` handler and cleared in `_dispatch()` ensures
`reconciler.reset()` is called exactly once per reconnect, before the first `submit()`.

### ESM + NodeNext `.js` extensions
**Source:** All existing `src/` files (`tsconfig.json` `"module": "NodeNext"`)
**Apply to:** All modified files — no change needed (already established in Phase 3/4)

Node built-in imports use `node:` prefix:
```typescript
import { createConnection } from "node:net";
import type { Socket } from "node:net";
import { EventEmitter } from "node:events";
```

### Pino structured logging
**Source:** Phase 4 AtemConnector pattern (04-RESEARCH.md lines 299–353), Phase 3 VmixConnector
**Apply to:** `src/vmix/VmixConnector.ts`, `src/atem/AtemConnector.ts`

Structured object first, human message second. Include `attempt` and `delayMs` on reconnect
log entries so log tailing during cable-pull test shows the backoff sequence clearly:
```typescript
this.logger.info({ attempt: this.attempt, delayMs: Math.round(delay) }, 'vmix TCP reconnecting');
this.logger.info({ event: 'atem_hydrated', host: this.host }, 'ATEM hydrated');
this.logger.info({ event: 'atem_resynced' }, 'ATEM ready — re-asserted current desired state');
```

---

## No Analog Found

No files in this phase lack an analog. All three modified files have direct structural analogs
in the existing codebase. The backoff loop pattern itself is new code, but the structural
context (private method on an EventEmitter subclass with constructor-injected logger) maps
exactly to `TallyStateReconciler`.

---

## Anti-Patterns (sourced from 05-RESEARCH.md — flag for planner)

| Anti-Pattern | Where | Correct Pattern |
|---|---|---|
| Call `scheduleReconnect()` from both `'error'` and `'close'` | VmixConnector raw socket | Only trigger from `'close'`; `'error'` calls `sock.destroy()` only |
| Reuse socket object after `'close'` | VmixConnector | Always `createConnection()` fresh — never call `socket.connect()` on a closed socket |
| Forget `lineBuffer = ''` in `'connect'` handler | VmixConnector | Clear in `'connect'` handler before `SUBSCRIBE TALLY` write |
| Not reset `attempt` on successful connect/hydration | Both connectors | Reset `this.attempt = 0` in `'connect'` handler (vmix) and in `'connected'` handler (atem) |
| Call `applyState()` after reconnect without `reconciler.reset()` | AtemConnector | Set `needsResync = true` in `'connected'` handler; `_dispatch()` calls `reset()` when flagged |
| Call `atem.disconnect()` before `atem.connect()` in `'disconnected'` handler | AtemConnector | Call `atem.connect()` directly — `_isDisconnecting` flag is not set on unexpected drops |

---

## Metadata

**Analog search scope:** `src/core/` (4 files), `src/config/` (2 files), Phase 3/4 plan files
**Files scanned:** 8 existing source files + Phase 3 PATTERNS.md + Phase 4 RESEARCH.md
**Pattern extraction date:** 2026-07-01
