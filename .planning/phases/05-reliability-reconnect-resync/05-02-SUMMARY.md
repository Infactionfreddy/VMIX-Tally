---
phase: "05-reliability-reconnect-resync"
plan: "02"
subsystem: "atem"
tags: ["reconnect", "backoff", "reliability", "eventemitter", "tdd"]
dependency_graph:
  requires: ["04-01", "04-02"]
  provides: ["ATEM-04", "atem_resynced"]
  affects: ["src/atem/AtemConnector.ts", "src/server.ts"]
tech_stack:
  added: []
  patterns: ["EventEmitter subclass", "exponential backoff with jitter", "needsResync flag", "TDD RED/GREEN"]
key_files:
  created: []
  modified:
    - "src/atem/AtemConnector.ts"
    - "src/atem/AtemConnector.test.ts"
    - "src/server.ts"
decisions:
  - "AtemConnector extends EventEmitter — deferred from Phase 4, now required for 'ready' event"
  - "needsResync flag set BEFORE emit('ready') so 'ready' listener's applyState() triggers reset"
  - "scheduleReconnect() called only from 'disconnected' handler (single-timer invariant)"
  - "destroy() cancels retryTimer and tears down atem instance"
  - "server.ts uses orchestrator.currentDesiredState() not .currentState (Phase 3 getter name)"
metrics:
  duration: "276s"
  completed: "2026-07-01"
  tasks_completed: 2
  tasks_total: 3
  files_modified: 3
---

# Phase 05 Plan 02: ATEM Reconnect Backoff + Ready Event Summary

**One-liner:** AtemConnector extended with exponential backoff reconnect loop and 'ready' event; server.ts re-asserts tally state on every ATEM reconnect via needsResync + reconciler.reset().

## What Was Built

### Task 1 (TDD RED): ATEM-04 Test Suite

Added a 10-test `"ATEM reconnect + resync — ATEM-04"` describe block to `AtemConnector.test.ts`:

- T1: 'disconnected' sets isHydrated=false
- T2: 'disconnected' schedules exactly one reconnect timer
- T3: 'connected' after reconnect sets isHydrated=true
- T4: 'ready' event emitted after hydration
- T5: reconciler.reset() called before applyState() on reconnect (via private reconciler spy)
- T6: applyState() issues command even with identical pre-disconnect state
- T7: No 'ready' event without subsequent 'connected'
- T8: destroy() cancels pending retry timer
- T9: backoff at attempt=0 returns ~1000ms (Math.random pinned to 0.5)
- T10: attempt counter resets to 0 after successful hydration

All Phase 4 tests (8) remained green; T2, T4, T7, T8, T9, T10 failed as expected (RED).

**Commit:** `bbe3af3` — `test(05-02): add failing ATEM-04 reconnect+resync tests for AtemConnector`

### Task 2 (TDD GREEN): AtemConnector + server.ts Implementation

**AtemConnector.ts changes:**

1. Added `extends EventEmitter` + `import { EventEmitter } from "node:events"` + `super()` call
2. Added private fields: `attempt=0`, `retryTimer=null`, `destroyed=false`, `needsResync=false`
3. `handleConnected()`: resets `attempt=0`, sets `needsResync=true` before `emit('ready')`
4. `handleDisconnected()`: sets `isHydrated=false`, calls `scheduleReconnect()` (removes old `reconciler.reset()` from here — moved to `_dispatch()` via needsResync)
5. `backoffDelay()`: `min(1000*2^attempt, 30000) * (0.75 + Math.random()*0.5)`
6. `scheduleReconnect()`: destroyed guard + setTimeout calling `atem.connect(host, port)`
7. `_dispatch()`: checks `needsResync` flag; if true calls `reconciler.reset()` then clears flag
8. `destroy()`: sets `destroyed=true`, clears `retryTimer`, calls `atem.destroy()`

**server.ts change:**

Added immediately after the `orchestrator.on('stateChanged', ...)` wiring:
```typescript
atem.on("ready", () => {
  const state = orchestrator.currentDesiredState();
  if (state !== null) {
    atem.applyState(state, Date.now());
    logger.info({ event: "atem_resynced" }, "ATEM ready — re-asserted current desired state");
  }
});
```

**Commit:** `3c539a4` — `feat(05-02): add ATEM reconnect backoff + ready event; wire re-assert in server.ts`

### Task 3: Cable-pull verification checkpoint

**Status:** CHECKPOINT — requires manual hardware verification. Tasks 1 and 2 are fully committed.

## Verification

```
npx vitest run src/atem/AtemConnector.test.ts  → 18 tests passed
npx vitest run                                  → 161 tests passed (10 files)
npx tsc --noEmit                                → exit 0 (clean)
grep "atem_resynced" src/server.ts              → found (line 121)
grep "scheduleReconnect\|backoffDelay\|needsResync" src/atem/AtemConnector.ts → found (all 3)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] scheduleReconnect called atem.connect(host) without port**
- **Found during:** Task 2 (GREEN phase) — T2 failed because test asserted `toHaveBeenCalledWith("192.168.1.100", expect.any(Number))`
- **Issue:** Pattern in 05-PATTERNS.md only showed `atem.connect(this.host)` with one arg, but the constructor stores `this.port` and it should be passed consistently
- **Fix:** Changed to `atem.connect(this.host, this.port)`
- **Files modified:** `src/atem/AtemConnector.ts`
- **Commit:** included in `3c539a4`

**2. [Rule 3 - Blocking] orchestrator.currentState does not exist**
- **Found during:** Task 2 — plan specified `orchestrator.currentState` but TallyOrchestrator exports `currentDesiredState()` (Phase 3 D-15 naming)
- **Fix:** Changed `orchestrator.currentState` → `orchestrator.currentDesiredState()`
- **Files modified:** `src/server.ts`
- **Commit:** included in `3c539a4`

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The `'ready'` event path is internal EventEmitter — no external trust boundary crossed. T-05-04 through T-05-07 mitigations from plan threat model are all implemented:

- T-05-04 (DoS backoff loop): `destroyed` flag halts, max delay 30s, single-timer invariant
- T-05-05 (needsResync tampering): set only in hydration handler, cleared immediately after first submit
- T-05-06 (re-assert privilege): `isHydrated` gate from Phase 4 still required; LAN-only tool
- T-05-07 (null state guard): `orchestrator.currentDesiredState() !== null` check present

## Known Stubs

None — all wiring is live code with real behavior.

## TDD Gate Compliance

- RED commit: `bbe3af3` — `test(05-02): ...` (RED gate passed)
- GREEN commit: `3c539a4` — `feat(05-02): ...` (GREEN gate passed)

## Self-Check

### Files Created/Modified

- [x] `src/atem/AtemConnector.ts` — modified (implements reconnect + ready event)
- [x] `src/atem/AtemConnector.test.ts` — modified (10 new ATEM-04 tests)
- [x] `src/server.ts` — modified (ready listener + null guard)

### Commits

- [x] `bbe3af3` — test(05-02): add failing ATEM-04 reconnect+resync tests
- [x] `3c539a4` — feat(05-02): add ATEM reconnect backoff + ready event

## Self-Check: PASSED
