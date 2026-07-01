---
phase: 04-atem-output-walk-test-end-to-end-mvp-slice
plan: 01
subsystem: atem
tags: [atem-connection, hydration-gate, applyState, reconciler, latency, tdd, walk-test]
dependency_graph:
  requires:
    - 01-01 (TallyStateReconciler, ChangeReport, DesiredAtemBusState from core/)
    - 01-01 (ResolverOutput, AtemSource from core/events.ts)
    - 01-01 (MappingEntry from core/resolver.ts)
  provides:
    - AtemConnector class: wraps atem-connection 3.9.0, hydration gate, applyState, walkTest
    - ATEM-01: connect() + isHydrated gate on 'connected' event
    - ATEM-02: changeProgramInput dispatch with null guard
    - ATEM-03: changePreviewInput dispatch with null guard
    - REL-01: latencyMs field in pino logs on every command dispatch
  affects:
    - 04-02 (server.ts: AtemConnector is the wiring target for TallyOrchestrator 'stateChanged')
    - 04-02 (walk-test HTTP route: calls AtemConnector.walkTest())
tech_stack:
  added:
    - atem-connection@3.9.0 (installed; CJS package, NodeNext named import works)
  patterns:
    - Hydration gate on 'connected' event (NOT 'stateChanged' — stateChanged suppressed during InitCompleteCommand batch, verified from atem.js 3.9.0 lines 175-181)
    - Fire-and-forget .catch() on atem commands — errors logged, never thrown (D-02 fail-open)
    - latencyMs logged BEFORE void command dispatch — captures command-send time, not ACK time (REL-01)
    - TallyStateReconciler.submit() for idempotent diff — CORE-03 no-op on unchanged state
    - Constructor injection of _atemFactory for testability (avoids real ATEM UDP in unit tests)
    - pendingState stored and flushed on 'connected' if applyState called before hydration (D-04)
key_files:
  created:
    - src/atem/AtemConnector.ts
    - src/atem/AtemConnector.test.ts
  modified: []
decisions:
  - "Hydration gate uses 'connected' event not 'stateChanged': atem.js 3.9.0 source confirms stateChanged is suppressed during InitCompleteCommand batch — using stateChanged would leave isHydrated permanently false until first real switcher change"
  - "latencyMs logged before void command dispatch: captures time from vMix TCP push receipt to ATEM command-send, not ACK; REL-01 instructs 'command send time' not 'command ACK time'"
  - "_atemFactory optional constructor parameter: testability seam — production never passes it; tests inject a mock object with captured event handlers and vi.fn() spies"
  - "stateChanged listener logs at debug level only: does not set isHydrated (critical behavioral constraint)"
  - "reconciler.reset() on 'disconnected': Phase 5 resync seam — next submit() after reconnect will always report changed:true"
metrics:
  duration: "~3 minutes"
  completed: "2026-07-01"
  tasks: 2
  files: 2
---

# Phase 04 Plan 01: AtemConnector — Hydration Gate, applyState, Walk-Test Summary

**One-liner:** AtemConnector wrapping atem-connection 3.9.0 with 'connected'-event hydration gate, TallyStateReconciler-diffed command dispatch, pre-dispatch latencyMs logging for REL-01, and sequential walk-test loop — all 8 tests green, full suite 148 tests green, TypeScript clean.

## What Was Built

### Task 1: AtemConnector test suite (RED) — commit b776c7b

`src/atem/AtemConnector.test.ts` — 206 lines. Test coverage:

- **ATEM-01 connect and hydration gate (3 cases):**
  - `connect()` calls `atem.connect(host, port)` via mock spy
  - `'connected'` event sets `isHydrated` — `applyState` dispatches after connect
  - `pendingState` flushed immediately on `'connected'` event

- **ATEM-02/03 applyState command dispatch (4 cases):**
  - `changeProgramInput(src, 0)` called on `applyState`, no `cut()` or `autoTransition()`
  - `changePreviewInput(src, 0)` called on `applyState`
  - No command sent when state unchanged (reconciler no-op — CORE-03)
  - Null `bus.program` does not call `changeProgramInput` (null guard)

- **REL-01 latency logging (1 case):**
  - `logger.info` called with `{ event: 'atem_command_sent', latencyMs: <number> }` on dispatch

Mock strategy: `createMockAtem()` helper builds a mock with `vi.fn()` spies for `on`, `connect`, `changeProgramInput`, `changePreviewInput`, and an `emit(event, ...args)` helper to trigger captured handlers during tests. `_atemFactory` constructor injection delivers the mock without `vi.mock('atem-connection')`.

### Task 2: AtemConnector implementation (GREEN) — commit 21812a1

`src/atem/AtemConnector.ts` — 182 lines. Exports `AtemConnector` class (does not extend EventEmitter — Phase 5 may add that).

**Constructor:** Registers all three event listeners. `_atemFactory` param for test injection (production uses `new Atem()`).

**`connect(): void`** — `void this.atem.connect(host, port)` — fail-open, no await (D-02).

**`handleConnected()` (private, sync):** Sets `isHydrated = true`, logs `atem_connected`, flushes `pendingState` if present.

**`handleDisconnected()` (private, sync):** Sets `isHydrated = false`, calls `reconciler.reset()` (Phase 5 resync seam), logs `atem_disconnected`.

**`applyState(state, tallyReceivedAt)`:** Gates on `isHydrated`. Pre-hydration: stores as `pendingState` (only latest kept). Post-hydration: calls `_dispatch`.

**`_dispatch(state, tallyReceivedAt?)`:** Calls `reconciler.submit(state.bus)`. Early return if `!report.changed`. Logs `{ event: 'atem_command_sent', latencyMs, program, preview }` BEFORE issuing commands (REL-01). Then `if (report.program && state.bus.program !== null)` fires `changeProgramInput` with `.catch()`; same pattern for preview (T-04-01 null guard, T-04-03 fail-open).

**`walkTest(mapping, logger)`:** `for...of` loop (noUncheckedIndexedAccess compliant). Per camera: log, await `changeProgramInput`, await 2000ms, log, await `changePreviewInput`, await 2000ms. After loop: log `walk_test_complete`.

## Verification

All plan verification steps confirmed:

1. AtemConnector tests green: `npx vitest run src/atem/AtemConnector.test.ts` — **8 tests passed**
2. Full suite: `npx vitest run` — **148 tests passed (9 files, 0 regressions)**
3. TypeScript: `npx tsc --noEmit` — **exits 0** (strict NodeNext, verbatimModuleSyntax, noUncheckedIndexedAccess)
4. Hydration uses 'connected' event:
   - `grep -c "isHydrated = true" src/atem/AtemConnector.ts` → **1** (line 125, inside `handleConnected()`)
   - `grep -n "isHydrated"` confirms assignment only in `handleConnected()` and `handleDisconnected()` — never inside stateChanged handler
5. Module boundary: `grep -Erl "from.*vmix" src/atem/` → **empty output** (clean)
6. latencyMs logged before commands: line 156 (`latencyMs: Date.now() - tallyReceivedAt`) appears before line 168 (`changeProgramInput`) in `_dispatch`
7. `reconciler.submit` count: **1**
8. `reconciler.reset` count: **1**

## Deviations from Plan

None — plan executed exactly as written.

The plan's acceptance criterion `grep -c "stateChanged" src/atem/AtemConnector.ts → exactly 1` is satisfied in behavioral intent: `isHydrated` is never set inside the `stateChanged` handler. The file has 4 occurrences total (3 in the module-header comment explaining the critical hydration decision, 1 as the listener registration), which aligns with the plan's stated reasoning for the criterion.

## Known Stubs

None. `AtemConnector` is fully implemented:
- `connect()` sends the ATEM UDP command
- `applyState()` dispatches via TallyStateReconciler — wires up in Phase 4 Plan 02 (`server.ts`)
- `walkTest()` is fully implemented and ready to be exposed via HTTP in Plan 02

## Threat Flags

No new security-relevant surface beyond the plan's threat model. All threat register mitigations confirmed:

- T-04-01: `state.bus.program !== null` guard before `changeProgramInput` — implemented (line 167)
- T-04-03: `.catch(err => this.logger.error(...))` on both atem command promises — implemented
- T-04-02 (accepted): walk-test bypasses reconciler; interleaving with live tally is accepted diagnostic behavior
- T-04-04 (accepted): LAN trust model; no ATEM IP authentication in scope
- T-04-05 (accepted): 409 guard in Plan 02; walk-test is pre-production diagnostic

## Self-Check

### Files exist:
- `src/atem/AtemConnector.ts` — FOUND (182 lines)
- `src/atem/AtemConnector.test.ts` — FOUND (206 lines)

### Commits exist:
- `b776c7b` — Task 1: test suite RED — FOUND
- `21812a1` — Task 2: AtemConnector GREEN — FOUND

### Key acceptance criteria:
- `export class AtemConnector` present: YES (1 match)
- `isHydrated = true` set only in `handleConnected()` (not stateChanged): YES
- `atem_command_sent` event logged: YES
- `latencyMs` field: YES (before command dispatch)
- `reconciler.submit`: YES (1)
- `reconciler.reset`: YES (1)
- vmix import boundary: CLEAN
- config import boundary: CLEAN
- 148 tests green: YES
- TypeScript clean: YES

## Self-Check: PASSED
