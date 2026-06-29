---
phase: 01-core-resolver-tally-state-spine
verified: 2026-06-29T18:59:46Z
status: gaps_found
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Given a vMix tally array, a mapping, and an override, the resolver returns exactly one desired {program, preview} ATEM bus state (verified by unit tests)."
    status: partial
    reason: >
      The ResolverOutput.contended sidecar is internally self-contradictory with
      ResolverOutput.cameras when a live-program loser is simultaneously the
      force-preview winner: the camera appears as "preview" in the cameras map
      (green tally) AND as reason:"lost-bus" in contended (meaning "absent from
      the clean tally map"). The events.ts contract documents "lost-bus" as "a
      program-flagged input that lost lowest-ATEM-# arbitration" and "absent from
      the clean per-camera tally map." A "preview" camera is not absent. The
      inconsistency is confirmed by direct probe execution (see CR-01 section).
      The test suite does not cover the cross-field consistency invariant, so the
      defect is undetected by the 60 green tests.
    artifacts:
      - path: "src/core/resolver.ts"
        issue: >
          Lines 277-298: the live-program loser path pushes a camera into
          contended["lost-bus"] before the preview path at lines 311-329 picks
          the same camera as preview winner. The two paths never reconcile.
          coerceTally (line 72) returns the caller's array by reference, not a
          copy — misleading "non-aliased copies" comment at line 140.
      - path: "src/core/resolver.test.ts"
        issue: >
          No test asserts the cross-field invariant: that every camera in
          contended with reason:"lost-bus" also has cameras[cameraId] === "off".
          The CR-01 scenario (live-program loser + force-preview winner) is not
          a test case.
    missing:
      - "Filter contended after cameras map is final: only emit lost-bus for a
         camera if cameras[cameraId] === 'off' (see REVIEW CR-01 fix sketch,
         resolver.ts line 377 return site)."
      - "Add a regression test: live-program loser that wins preview bus is NOT
         in contended with reason:'lost-bus'."
---

# Phase 1: Core Resolver + Tally State Spine — Verification Report

**Phase Goal:** A pure, fully-tested desired-state engine that owns canonical per-camera tally and resolves the single correct ATEM bus state with no external I/O.
**Verified:** 2026-06-29T18:59:46Z
**Status:** GAPS_FOUND
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Given a vMix tally array, a mapping, and an override, the resolver returns exactly one desired {program, preview} ATEM bus state (verified by unit tests). | PARTIAL | resolve() returns a well-formed ResolverOutput; 38 tests pass. However the `contended` field is internally inconsistent with `cameras` in the live-program-loser + force-preview-winner scenario (CR-01, confirmed by probe). The "one desired output" is self-contradictory — `cameras[camB]="preview"` while `contended` says `reason:"lost-bus"` for the same camera. |
| 2 | Resolution precedence is observably live → mapping → override last: an active override wins over live, and clearing it instantly reveals current live state (live never mutated). | VERIFIED | SC2 tests with structuredClone confirm inputs unchanged. Two-call test (with override / without override) confirms live state is not mutated. Override-program beats live-program (D-08) confirmed. |
| 3 | Only the main PGM/PVW input drives tally; overlay/PiP/multi-program states are mirrored per-input with program-wins precedence, never collapsed to one input. | VERIFIED | D-04/D-05/D-06 tests prove lowest-ATEM-# arbitration; losers appear in contended. The plan explicitly defers main-vs-overlay distinction to Phase 3 ingest (CORE-04 scope note in 01-02-PLAN.md); the tally array has no structural way to distinguish overlay from main at this layer. |
| 4 | The reconciler emits an ATEM command only when desired differs from last-sent (idempotent diff), proven by a no-op-on-unchanged test. | VERIFIED | tallyState.test.ts has 3 `not.toHaveBeenCalled` assertions covering: identical-submit no-op (SC4/CORE-03), null→null no-op, reset() no-emit. All pass. |
| 5 | Canonical state models every camera as exactly one of off / program / preview. | VERIFIED | CameraTallyState type is the exact union; events.ts is types-only (grep gate returns 0); SC5 tests confirm every cameras-map value is in {off, program, preview}. Note: SC5 tests only assert camera MAP values — they do not assert cross-field consistency between cameras and contended. |

**Score:** 4/5 truths verified (SC1 is PARTIAL — blocker)

---

## Blocker: CR-01 — `contended` Sidecar Contradicts `cameras` Map

### Confirmed by direct probe execution

The code review (01-REVIEW.md) flagged CR-01. Independent probe executed against the live codebase:

**Input:**
```
tally   = [1, 1, 0, 0]          // camA=live-program, camB=live-program
mapping = baseMapping (atemSource 1/2/3/4)
overrides = [{ cameraId: "camB", force: "preview" }]
```

**Actual output:**
```json
{
  "cameras": { "camA": "program", "camB": "preview", "camC": "off", "camD": "off" },
  "bus": { "program": 1, "preview": 2 },
  "contended": [{ "vmixInputNumber": 2, "reason": "lost-bus", "atemSource": 2 }]
}
```

**The contradiction:** `cameras["camB"] = "preview"` (camB has green tally) AND `contended[0].reason = "lost-bus"` (which the events.ts contract defines as "absent from the clean per-camera tally map"). camB is not absent — it has tally.

**Root cause in resolver.ts:**
- Lines 277-285 (live-program loser path): camB loses live-program arbitration to camA and is pushed into `contended` as `"lost-bus"`.
- Lines 311-329 (preview path): camB has a `force: "preview"` override, is eligible (not the program winner, not force-off), and wins `bus.preview`. `cameras["camB"]` is set to `"preview"`.
- The two paths execute independently; neither checks the other's output.

**Phase 6 impact (correctness defect, not cosmetic):** A Phase 6 UI consumer of `contended` rendering "overlaid source X gets no tally" would display a false warning about camB — a camera visibly showing green tally. In a live production environment where red/green correctness is the project's stated core value, this is a safety-relevant output error.

**Does this violate SC5?** SC5 ("canonical state models every camera as exactly one of off/program/preview") is about the `cameras` map values. Those values are always valid — SC5 itself passes. The violation is in the `ResolverOutput` output contract's documented invariant for the `contended` field. SC1 requires the resolver to "return exactly one desired" output — the output is self-inconsistent, making SC1 partial.

**Does this violate CORE-01?** CORE-01 ("Server hält ein kanonisches Soll-Tally-Zustandsmodell pro Kamera — off/program/preview") concerns the per-camera canonical model. The cameras map itself is canonical. CORE-01 is satisfied for the cameras field. The defect is in the sidecar, which is part of the output contract but not the canonical model per-se.

**Verdict: BLOCKER.** The phase goal requires the engine to be "fully-tested." The test suite does not cover the cross-field consistency invariant and does not catch this defect. Phase 6 would consume a broken `contended` sidecar. Must be resolved before downstream phases build on this contract.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | ESM manifest with `"type":"module"`, scripts, devDeps | VERIFIED | `"type":"module"` on line 5; scripts: typecheck/test/test:watch; devDeps: typescript@^5, vitest@^3, @types/node@^22 |
| `tsconfig.json` | strict mode, NodeNext, noUncheckedIndexedAccess | VERIFIED | `"strict":true` and `"noUncheckedIndexedAccess":true` both present |
| `vitest.config.ts` | test discovery restricted to src/**/*.test.ts | VERIFIED | `include: ["src/**/*.test.ts"]` confirmed |
| `src/core/events.ts` | Types-only output contract; exports 8 types/interfaces; >= 30 lines | VERIFIED | 89 lines; 8 exports confirmed; grep gate for runtime constructs returns 0 |
| `src/core/events.test.ts` | 9 round-trip tests | VERIFIED | 9 tests, all pass |
| `src/core/resolver.ts` | Pure resolve() + 5 input types; >= 80 non-blank lines; zero I/O | VERIFIED | 346 non-blank lines; 6 exports (`export (function|type|interface)` = 6); I/O grep returns 0 |
| `src/core/resolver.test.ts` | Exhaustive D-04..D-13 + SC1/2/3/5; >= 14 tests | VERIFIED | 38 tests; all decision IDs referenced (each >= 3 occurrences); structuredClone SC2 test present; 8 `not.toThrow` assertions |
| `src/core/tallyState.ts` | TallyStateReconciler + ChangeReport; >= 40 non-blank lines; no I/O | VERIFIED | 2 class/interface exports; 106 non-blank lines; I/O grep returns 0 |
| `src/core/tallyState.test.ts` | >= 7 tests; SC4 no-op; null transitions; ownership | VERIFIED | 13 tests; 3 `not.toHaveBeenCalled` assertions; SC4 referenced 4x; CORE-03 referenced 4x; ownership patterns (6 mutat/copy/reference mentions) |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/core/events.test.ts` | `src/core/events.ts` | `import type` | VERIFIED | `from "./events.js"` present line 8 |
| `src/core/resolver.ts` | `src/core/events.ts` | `import type ResolverOutput, DesiredAtemBusState, CameraTallyMap` | VERIFIED | `import type { CameraId, CameraTallyState, CameraTallyMap, DesiredAtemBusState, ContendedInput, ResolverOutput } from "./events.js"` lines 6-13 |
| `src/core/resolver.test.ts` | `src/core/resolver.ts` | `import resolve` | VERIFIED | `import { resolve } from "./resolver.js"` and `import type { MappingEntry, OverrideEntry }` lines 6-7 |
| `src/core/tallyState.ts` | `src/core/events.ts` | `import type DesiredAtemBusState` | VERIFIED | `import type { DesiredAtemBusState } from "./events.js"` line 11 |
| `src/core/tallyState.test.ts` | `src/core/tallyState.ts` | `import TallyStateReconciler` | VERIFIED | `import { TallyStateReconciler } from "./tallyState.js"` line 7 |
| `vitest.config.ts` | `src/**/*.test.ts` | include glob | VERIFIED | `include: ["src/**/*.test.ts"]` |

---

## Data-Flow Trace (Level 4)

Not applicable — this phase contains zero dynamic data-rendering artifacts. All artifacts are pure functions, types, or a stateful in-process class (TallyStateReconciler). There is no fetch/query/render chain to trace.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| tsc --noEmit exits 0 | `npx tsc --noEmit` | exit 0, no output | PASS |
| All 60 vitest tests pass | `npx vitest run` | 60 passed (3 files) in 216ms | PASS |
| events.ts has zero runtime constructs | grep gate (function/=>/class/const/let) | 0 | PASS |
| resolver.ts has zero I/O imports | grep gate (require/net/http/fs) | 0 | PASS |
| tallyState.ts has zero I/O imports (except node:events) | grep gate (net/http/fs) | 0 | PASS |
| resolver.ts >= 80 non-blank lines | grep -vcE '^\s*$' | 346 | PASS |
| tallyState.ts >= 40 non-blank lines | grep -vcE '^\s*$' | 106 | PASS |
| Each D-04..D-13 and CORE-04 referenced in resolver.test.ts | per-ID grep | All >= 3 | PASS |
| SC2 structuredClone test present | grep -Ec 'structuredClone\|unchanged' | 5 | PASS |
| D-13 not.toThrow tests present | grep -c 'not.toThrow' | 8 | PASS |
| SC4 and CORE-03 in tallyState.test.ts | grep -c 'SC4', grep -c 'CORE-03' | 4, 4 | PASS |
| **CR-01 cross-field consistency** | **Probe: live-program loser + force-preview winner** | **contradiction: `cameras[camB]="preview"` AND `contended[reason="lost-bus"]`** | **FAIL** |

---

## Probe Execution

No formal probe scripts exist for this phase (`scripts/*/tests/probe-*.sh` — not applicable for a pure-logic phase). The CR-01 behavioral probe was run as an in-tree vitest test:

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| CR-01: live-program loser wins preview bus | vitest test in-tree (cr01_probe.test.ts, removed after) | `camB is simultaneously "preview" AND "lost-bus"` — assertion failure | FAILED |
| Pure live multi-program (no overrides) | same file, second test | No contradiction — camB="off" when only live, no override | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CORE-01 | 01-01, 01-02 | Kanonisches Soll-Tally-Zustandsmodell pro Kamera (off/program/preview) | SATISFIED | CameraTallyState type + CameraTallyMap; events.ts; per-camera map in ResolverOutput.cameras |
| CORE-02 | 01-02 | Vorrang live → mapping → manueller Override | SATISFIED | Full precedence chain in resolver.ts; SC2 tests prove override → live → clear sequence |
| CORE-03 | 01-03 | ATEM-Befehl nur bei Abweichung Soll↔Ist (Single-Writer-Reconciler) | SATISFIED | TallyStateReconciler; submit() no-op path; 3 not.toHaveBeenCalled assertions |
| CORE-04 | 01-02 | Nur Haupt-PGM/PVW — Overlay/PiP ignoriert | SATISFIED (deferred) | At this pure-tally layer there is no structural way to distinguish main vs overlay from the positional tally array alone. The plan's scope note explicitly defers overlay distinction to Phase 3 ingest. Multi-program arbitration (lowest-# wins, losers to contended) is the correct Phase 1 behavior. |

**Orphaned requirements:** None. All four Phase 1 requirements (CORE-01..CORE-04) are claimed and covered.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/core/resolver.ts` | 140 | Comment says "non-aliased copies" but `coerceTally` returns the caller's array by reference (line 72: `return raw;`) | Warning | SC2 purity is not currently broken (safeTally is never written), but the misleading comment is a foot-gun for future edits; flagged in REVIEW WR-02 |
| `src/core/resolver.ts` | 89 | Comment says event payload `state` is "the copy already stored in lastSent" but the code spreads lastSent again (two separate objects) | Info | Behavior is correct; doc/code mismatch only (REVIEW IN-02) |

No `TBD`, `FIXME`, or `XXX` markers in any modified file. No unreferenced debt markers. No placeholder/coming-soon patterns. The `return []` instances in coerceTally/coerceMapping/coerceOverrides are defensive coercions on invalid input, not stubs — each function has real logic on the next line.

---

## Human Verification Required

None — this phase contains no UI, no network connections, no external services, and no real-time behavior. All behaviors are verifiable by `tsc --noEmit` and `vitest run`.

---

## Gaps Summary

**One blocker gap.** The CR-01 contradiction — independently confirmed by probe — means the `ResolverOutput.contended` array is internally inconsistent with `ResolverOutput.cameras` in the scenario where a live-program loser simultaneously wins the preview bus via a force-preview override. The events.ts contract documents "lost-bus" as "absent from the clean per-camera tally map," but a camera with `cameras[id] = "preview"` is not absent.

The gap has two components that must both be closed:

1. **Implementation fix (resolver.ts):** Filter the `contended` array after the cameras map is final. Emit `reason:"lost-bus"` only for cameras whose `cameras[cameraId] === "off"`. The REVIEW CR-01 section provides a concrete filter pattern at the return site (line 377).

2. **Test coverage gap (resolver.test.ts):** Add a regression test asserting that a live-program loser which subsequently wins the preview bus does NOT appear in contended with `reason:"lost-bus"`. The existing 38 tests do not cover this cross-field invariant.

The phase goal ("fully-tested desired-state engine") is not achieved until this defect is fixed and the regression test is in place.

---

## Re-verification Checklist (for next run)

When the gap plan is executed, re-verify:
- [ ] `resolve([1, 1, 0, 0], baseMapping, [{ cameraId: "camB", force: "preview" }])` — camB NOT in contended lost-bus
- [ ] `resolve([1, 1, 0, 0], baseMapping, [])` — camB IS in contended lost-bus (pure live loser path still works)
- [ ] All 60 existing tests still pass after the filter change
- [ ] New regression test (described above) passes
- [ ] `tsc --noEmit` still exits 0

---

_Verified: 2026-06-29T18:59:46Z_
_Verifier: Claude (gsd-verifier)_
_Phase: 01-core-resolver-tally-state-spine_
