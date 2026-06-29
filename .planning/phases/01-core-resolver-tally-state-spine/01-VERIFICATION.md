---
phase: 01-core-resolver-tally-state-spine
verified: 2026-06-29T19:55:30Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "CR-01: contended sidecar self-contradiction — live-program loser simultaneously force-preview winner appeared as both cameras[camB]='preview' AND contended reason:'lost-bus'"
  gaps_remaining: []
  regressions: []
---

# Phase 1: Core Resolver + Tally State Spine — Verification Report

**Phase Goal:** A pure, fully-tested desired-state engine that owns canonical per-camera tally and resolves the single correct ATEM bus state with no external I/O.
**Verified:** 2026-06-29T19:55:30Z
**Status:** PASSED
**Re-verification:** Yes — after CR-01 gap closure (commit 6c9ab4e)

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Given a vMix tally array, a mapping, and an override, the resolver returns exactly one desired {program, preview} ATEM bus state (verified by unit tests). | VERIFIED | CR-01 fix (commit 6c9ab4e) adds Step 5 reconciliation at the return site. `PendingContended` carries an internal `cameraId`; the filter drops any `lost-bus` row whose camera is non-`"off"` in the final map. The fix is structurally correct: cameras map is fully composed in Step 4 before `reconciledContended` is built in Step 5. Independent probe (4 tests, exit 0) confirms no contradiction on the trigger scenario and its variants. Test count rose from 60 to 62 (two new CR-01 regression tests). |
| 2 | Resolution precedence is observably live → mapping → override last: an active override wins over live, and clearing it instantly reveals current live state (live never mutated). | VERIFIED | Unchanged. SC2 tests with `structuredClone` confirm inputs unchanged. Two-call test confirms live state not mutated. Override-program beats live-program (D-08) confirmed. No regressions: 62/62 pass. |
| 3 | Only the main PGM/PVW input drives tally; overlay/PiP/multi-program states are mirrored per-input with program-wins precedence, never collapsed to one input. | VERIFIED | Unchanged. D-04/D-05/D-06 tests prove lowest-ATEM-# arbitration. Losers appear in `contended`. The fix preserves this: the regression test ("pure live multi-program, no override — camB IS lost-bus") explicitly confirms the loser path still emits `lost-bus` when there is no preview recovery. |
| 4 | The reconciler emits an ATEM command only when desired differs from last-sent (idempotent diff), proven by a no-op-on-unchanged test. | VERIFIED | Unchanged. tallyState.test.ts: 3 `not.toHaveBeenCalled` assertions covering identical-submit no-op (SC4/CORE-03), null→null no-op, reset()-no-emit. All 13 tallyState tests pass. |
| 5 | Canonical state models every camera as exactly one of off / program / preview. | VERIFIED | Unchanged. `CameraTallyState` type is the exact union; SC5 tests confirm all `cameras`-map values stay in `{off, program, preview}`. The CR-01 fix does not touch Step 4 (cameras map composition); SC5 invariant is unaffected. |

**Score:** 5/5 truths verified

---

## CR-01 Gap Closure — Independent Verification

### Mechanism (resolver.ts)

The fix introduces two changes to `resolver.ts`:

1. **`PendingContended` internal type** (line 128): `ContendedInput & { cameraId?: CameraId }`. Each `lost-bus` row pushed during Steps 2 and 3 now carries the originating `cameraId` as an internal field invisible to the public contract.

2. **Step 5 reconciliation filter** (lines 397-404): After the `cameras` map is fully composed in Step 4, `reconciledContended` is built by filtering `contended`:
   ```
   keep if: reason !== "lost-bus"  OR  cameraId === undefined  OR  cameras[cameraId] === "off"
   ```
   The `.map()` strips `cameraId` before returning, so the public `ContendedInput[]` has no cameraId field — the internal tracking is invisible to callers. `"unmapped"` rows (no cameraId, D-10) are unconditionally preserved.

This is structurally sound: the reconciliation happens at the single return site, after all bus-winner and per-camera assignment decisions are final. There is no ordering hazard.

### Independent Probe Results

Four independent probes were written and run via vitest outside `resolver.test.ts` (then removed to keep the tree clean):

| Probe | Input | Expected | Result |
|-------|-------|----------|--------|
| CR-01 PRIMARY: live-program loser + force-preview winner | tally=[1,1,0,0], override camB force-preview | camB="preview", bus.preview=2, camB NOT in contended lost-bus, contended=[] | PASS |
| CR-01 REGRESSION: pure live multi-program (no override) | tally=[1,1,0,0], overrides=[] | camA="program", camB="off", camB IS in contended lost-bus | PASS |
| CROSS-FIELD: force-program winner + force-preview winner combo | tally=[1,1,0,0], camA force-program, camB force-preview | camA="program", camB="preview", no non-off camera in lost-bus | PASS |
| CROSS-FIELD: three-way — two live-program losers, one recovers preview | tally=[1,1,1,0], camB force-preview | camA="program", camB="preview", camC="off" AND lost-bus, camB NOT lost-bus | PASS |

All 4 probes exit 0.

### Regression Test Coverage in resolver.test.ts

The fix ships two new tests in the `"CR-01/D-06 — contended never lists a camera that has tally in the final map"` describe block (lines 142-197):

- **`CR-01: live-program loser that wins the preview bus is NOT reported as lost-bus`** — the exact trigger scenario from the BLOCKER. Asserts `cameras["camB"] === "preview"`, `bus.preview === 2`, `contended` contains no `{reason:"lost-bus", atemSource:2}`, and `contended` is entirely empty.

- **`CR-01 invariant: no camera that is non-off in cameras appears as lost-bus in contended`** — a parametric invariant test over 4 distinct scenarios including the forced-program + forced-preview cross-override case from the required combined probe. For each scenario it iterates every `contended` row and asserts that if `reason === "lost-bus"` then `cameras[cameraId] === "off"`.

The `describe` block comment (lines 135-141) explicitly names this as the regression for the verification BLOCKER.

---

## Full Test Suite

| Suite | Count | Result |
|-------|-------|--------|
| `src/core/events.test.ts` | 9 | PASS |
| `src/core/tallyState.test.ts` | 13 | PASS |
| `src/core/resolver.test.ts` | 40 | PASS |
| **Total** | **62** | **PASS** |

Previous count was 60 (before CR-01 fix). The 2-test increase is entirely the two new CR-01 regression tests. No existing tests were modified.

`tsc --noEmit`: exit 0, no output. `PendingContended` typing is strict-compatible — `cameraId` is optional on the type, so existing push sites that omit it compile cleanly, and the new push sites that include it also compile cleanly.

---

## Required Artifacts

All artifacts verified in the prior run; only changes relevant to the fix are noted.

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/core/events.ts` | Types-only output contract; exports 8 types/interfaces | VERIFIED | Unchanged. 0 runtime constructs. |
| `src/core/resolver.ts` | Pure resolve() + PendingContended type; Step 5 reconciliation | VERIFIED | `PendingContended` at line 128; Step 5 filter at lines 397-404; return site at lines 407-411. All three levels: exists, substantive, wired. |
| `src/core/resolver.test.ts` | CR-01 regression tests present; >= 14 tests total | VERIFIED | 40 tests; CR-01 describe block at lines 142-197; both regression tests confirmed present and passing. |
| `src/core/tallyState.ts` | TallyStateReconciler + ChangeReport; no I/O | VERIFIED | Unchanged. 13 tallyState tests pass. |

---

## Key Link Verification

All links verified in prior run. Unchanged — the fix touched only resolver.ts and resolver.test.ts; no new import edges.

| From | To | Via | Status |
|------|----|-----|--------|
| `resolver.ts` | `events.ts` | `import type ContendedInput, CameraId, ...` | VERIFIED |
| `resolver.test.ts` | `resolver.ts` | `import { resolve }` | VERIFIED |
| All others | | | VERIFIED (unchanged) |

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| CORE-01 | Kanonisches Soll-Tally-Zustandsmodell pro Kamera (off/program/preview) | SATISFIED | `CameraTallyState` type + `CameraTallyMap`; `cameras` field in `ResolverOutput`. |
| CORE-02 | Vorrang live → mapping → manueller Override | SATISFIED | Full precedence chain in `resolver.ts`; SC2 tests prove override → live → clear sequence. |
| CORE-03 | ATEM-Befehl nur bei Abweichung Soll↔Ist (Single-Writer-Reconciler) | SATISFIED | `TallyStateReconciler`; `submit()` no-op path; 3 `not.toHaveBeenCalled` assertions. |
| CORE-04 | Nur Haupt-PGM/PVW — Overlay/PiP ignoriert | SATISFIED (deferred) | Phase 3 ingest scope; multi-program arbitration (lowest-# wins, losers to contended) is correct Phase 1 behavior. |

No orphaned requirements.

---

## Anti-Patterns

No new anti-patterns introduced by the fix. The two pre-existing items from the initial verification remain:

| File | Line | Pattern | Severity |
|------|------|---------|----------|
| `resolver.ts` | 140 | Comment says "non-aliased copies" but `coerceTally` returns caller's array by reference (WR-02) | Warning — no behavioral impact; foot-gun for future edits |
| `tallyState.ts` | 89 | Comment says payload uses "the copy already stored in lastSent" but code spreads `lastSent` again (IN-02) | Info — doc/code mismatch only; behavior correct |

No `TBD`, `FIXME`, or `XXX` markers. No unreferenced debt markers. No stubs.

---

## Human Verification Required

None. This phase contains no UI, no network connections, no external services, and no real-time behavior. All behaviors are fully verified by `tsc --noEmit` and `vitest run`.

---

## Summary

The CR-01 BLOCKER is closed. The fix is mechanically correct: `PendingContended` carries the internal `cameraId` through the arbitration steps; Step 5 filters any `lost-bus` row whose camera is non-`"off"` in the final composed map before returning. The reconciliation is at the single return site, after all decisions are final. The public `ContendedInput[]` contract is preserved — `cameraId` is stripped by the `.map()` before return.

Two regression tests in `resolver.test.ts` permanently guard the invariant: one for the exact trigger scenario (live-program loser + force-preview winner), one parametric invariant over four cross-override scenarios. Independent probes confirm the fix on the trigger scenario, the pure-loser regression path, and two combined program-winner + preview-winner scenarios required by the re-verification brief.

62/62 tests pass. `tsc --noEmit` exits 0. No regressions introduced. Phase goal achieved.

---

_Verified: 2026-06-29T19:55:30Z_
_Verifier: Claude (gsd-verifier)_
_Phase: 01-core-resolver-tally-state-spine_
_Re-verification after: commit 6c9ab4e (fix CR-01)_
