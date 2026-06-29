---
phase: 01-core-resolver-tally-state-spine
plan: "03"
subsystem: core
tags: [typescript, vitest, diff-reconciler, tally-state, eventEmitter, no-op]

requires:
  - "01-01 (src/core/events.ts — DesiredAtemBusState type)"
provides:
  - "src/core/tallyState.ts — TallyStateReconciler: single-writer diff reconciler with ChangeReport + ChangeEventPayload"
  - "13-test suite proving emit-on-diff, no-op-on-unchanged (SC4/CORE-03), per-field reporting, null transitions, ownership invariants, reset re-assert"
affects:
  - "04-atem-connector (imports TallyStateReconciler, listens 'change' event, calls changeProgramInput/changePreviewInput per report)"
  - "05-reconnect-resync (calls reconciler.reset() before resync to force re-assert)"

tech-stack:
  added:
    - "node:events (EventEmitter — built-in, no new dependency)"
  patterns:
    - "Single-writer diff reconciler: holds last-sent DesiredAtemBusState, compares field-by-field on submit(), emits only on diff"
    - "EventEmitter for in-process desired-state signalling (matches atem-simulator/src/state.js idiom)"
    - "Per-field ChangeReport (program:boolean, preview:boolean) decoupled from the composite bus state — matches changeProgramInput/changePreviewInput split"
    - "Defensive copy discipline: submit() stores { ...desired }, current() returns { ...lastSent } — single-writer ownership (T-03-01)"
    - "reset() no-emit contract: setup step for Phase 5 resync; does not trigger downstream handlers"

key-files:
  created:
    - "src/core/tallyState.ts"
    - "src/core/tallyState.test.ts"
  modified: []

key-decisions:
  - "Per-field ChangeReport over per-bus boolean: Phase 4 calls changeProgramInput and changePreviewInput as separate ATEM commands; per-field report lets Phase 4 issue only the needed call(s) without re-deriving which field changed"
  - "reset() emits nothing: intent is to prepare the reconciler for a re-assert after reconnect; emitting on reset would trigger a spurious Phase 4 command for the null/null cleared state before the real desired state is re-submitted"
  - "ChangeEventPayload carries both state and report: downstream handlers need both the new state (what to set) and the report (which fields to set) simultaneously; two-field payload avoids two separate events"

requirements-completed: [CORE-03]

duration: 4min
completed: "2026-06-29"
---

# Phase 01 Plan 03: Single-Writer Diff Reconciler (tallyState.ts) Summary

**TallyStateReconciler holding last-sent DesiredAtemBusState: emits + reports per-field change only on real diff, no-op-on-unchanged is SC4-tested, null is a first-class state, defensive copy discipline enforces D-03 single-writer ownership**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-29T18:40:00Z
- **Completed:** 2026-06-29T16:43:54Z
- **Tasks:** 2 (Task 1: implementation; Task 2: test suite)
- **Files modified:** 2

## Accomplishments

- `src/core/tallyState.ts` exports `TallyStateReconciler` (class extends EventEmitter) and `ChangeReport` / `ChangeEventPayload` interfaces — 106 non-blank lines, zero I/O imports beyond `node:events`
- Single-writer reconciler holds `DesiredAtemBusState` in private `lastSent`, initialized to `{ program: null, preview: null }` (D-11 safe default)
- `submit(desired)` performs strict `===` field comparison; no-op path returns `{ changed:false, … }` and emits nothing (SC4); diff path stores a defensive copy, emits `"change"` with payload, returns per-field `ChangeReport`
- `current()` returns `{ ...lastSent }` — no reference leak
- `reset()` restores to `null/null` without emitting — Phase 5 resync hook
- 13-test vitest suite covering all specified behaviors: initial state, first submit, no-op (SC4), per-field reports (program-only, preview-only), null→value, value→null, null→null no-op, `current()` copy guarantee, submit no-reference-capture, change event payload shape, `reset()` no-emit, `reset()` re-assert
- All 22 project tests pass (9 from Plan 01-01 + 13 new); `tsc --noEmit` exits 0

## Task Commits

1. **Task 1: Implement TallyStateReconciler** — `8c72093` (feat)
2. **Task 2: Add reconciler test suite** — `b670ec2` (test)

## Files Created/Modified

- `src/core/tallyState.ts` — TallyStateReconciler + ChangeReport + ChangeEventPayload (106 non-blank lines; single-writer diff reconciler; no I/O)
- `src/core/tallyState.test.ts` — 13 vitest tests (all passing) covering SC4, CORE-03, per-field reporting, null transitions, ownership

## Decisions Made

- **Per-field ChangeReport:** chose per-field `{ program: boolean; preview: boolean }` over a single bus-level boolean so Phase 4 can issue only `changeProgramInput` or only `changePreviewInput` as needed — no redundant ATEM commands (CORE-03/Pitfall 7).
- **reset() no-emit:** reset is a preparation step for Phase 5 resync; emitting on reset would create a spurious `null/null` desired-state event before the real state is re-submitted. No-emit is the correct contract.
- **ChangeEventPayload carries both state and report:** handlers need both simultaneously; splitting into two events or requiring handlers to re-read `current()` would introduce a race window.

## Deviations from Plan

None — plan executed exactly as written. Implementation follows the exact action spec (composite `{program,preview}` held state, per-field ChangeReport, EventEmitter, defensive copies, `reset()` no-emit) and the test suite covers all eight behaviors listed in the plan's `<behavior>` block plus the emitted event payload.

## Threat Mitigations Applied

- **T-03-01 (Tampering — last-sent ownership):** `submit()` stores `{ program: desired.program, preview: desired.preview }` (never the caller's object reference); `current()` returns `{ ...this.lastSent }`. Verified by two ownership tests.
- **T-03-02 (DoS — command thrash):** no-op path short-circuits before any emit when both fields are unchanged. Verified by SC4 test asserting `not.toHaveBeenCalled()`.
- **T-03-03 (Information Disclosure):** zero network/disk/log I/O; in-process EventEmitter only. Confirmed by grep gate returning 0.

## Known Stubs

None — this is a pure in-process module with no external dependencies or placeholder data.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Self-Check

All verification gates passed:
- `tsc --noEmit` exits 0
- `npx vitest run src/core/tallyState.test.ts` — 13 tests pass
- No I/O imports (grep gate: 0)
- SC4 no-op test present (3 `not.toHaveBeenCalled` assertions)
- Ownership tests present (6 mutate/copy/reference mentions)
- Both commits exist: `8c72093` (feat) and `b670ec2` (test)

## Self-Check: PASSED

---
*Phase: 01-core-resolver-tally-state-spine*
*Completed: 2026-06-29*
