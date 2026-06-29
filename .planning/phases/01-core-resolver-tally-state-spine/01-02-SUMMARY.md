---
phase: 01-core-resolver-tally-state-spine
plan: "02"
subsystem: core
tags: [typescript, vitest, pure-function, resolver, tally, override, tdd]

requires:
  - "01-01: typed output contract (ResolverOutput, CameraTallyMap, DesiredAtemBusState, ContendedInput)"
provides:
  - "Pure resolve() function: (VmixTally, Mapping, Overrides) → ResolverOutput implementing the full override-program→live-program→preview→off precedence chain"
  - "Input types: VmixTally, MappingEntry, Mapping, OverrideEntry, Overrides — exported from src/core/resolver.ts"
  - "Exhaustive test suite: 38 tests in src/core/resolver.test.ts covering D-04..D-13, SC1-3, SC5"
affects:
  - "03-vmix-connector (will pass vMix tally array into resolve())"
  - "04-atem-connector (will consume ResolverOutput.bus for changeProgramInput/changePreviewInput)"
  - "06-web-ui (will consume ResolverOutput.cameras and contended for live status display)"

tech-stack:
  added: []
  patterns:
    - "Pure function pattern: resolve() has zero I/O imports; all inputs are readonly; no argument mutation"
    - "Defensive coercion pattern: non-array/null/NaN/out-of-range inputs coerced to safe values at function entry — never throw (D-13)"
    - "Mapping-bounded output: iteration for output building is bounded by mapping length (≤8), not by potentially 1000-entry tally array (T-02-01 DoS mitigation)"
    - "Tiered arbitration: override-program tier evaluated before live-program tier; within each tier, lowest atemSource wins deterministically"

key-files:
  created:
    - "src/core/resolver.ts"
    - "src/core/resolver.test.ts"
  modified: []

key-decisions:
  - "Mapping-bounded output iteration (T-02-01): The resolver iterates the mapping (≤8 entries) for output, not the tally array — an oversized 1000-padded tally string cannot cause unbounded output work or DoS the hot path"
  - "atemSource=0 excluded from mapping: zero is not a valid ATEM source id; coercion drops entries with atemSource <= 0 to prevent null-equivalent bus values passing as real sources"
  - "force-preview+live-preview deduplication: when a camera has a force-preview override AND is live-preview, the resolver includes it only once in preview candidates to avoid duplicate atemSource picking"
  - "Unmapped live-preview inputs flagged as contended: D-10 is implemented symmetrically for both program and preview live states (live-preview with no mapping also goes to contended unmapped)"

patterns-established:
  - "Pattern: Defensive coercion at entry point — validate all external inputs at the top of a function; never trust array indices or object fields from outside the module"
  - "Pattern: Readonly param types as mutation guard — VmixTally/Mapping/Overrides are readonly[] which TypeScript enforces, replacing the need for defensive cloning"

requirements-completed: [CORE-01, CORE-02, CORE-04]

duration: 7min
completed: "2026-06-29"
---

# Phase 01 Plan 02: Pure Resolver — Full Precedence Chain + Exhaustive Tests Summary

**Pure total-function resolver: (VmixTally, Mapping, Overrides) → ResolverOutput with override-program→live-program→preview→off precedence, lowest-atemSource arbitration at every tier, defensive D-13 coercion, and 38-test exhaustive suite proving every decision (D-04..D-13), live-never-mutated (SC2), and the off|program|preview invariant (SC5)**

## Performance

- **Duration:** 7 min
- **Started:** 2026-06-29T16:39:38Z
- **Completed:** 2026-06-29T16:46:43Z
- **Tasks:** 2 (Task 1: resolver implementation TDD; Task 2: exhaustive test suite)
- **Files modified:** 2

## Accomplishments

- `src/core/resolver.ts` (346 non-blank lines) exports the pure `resolve()` function and five input types (VmixTally, MappingEntry, Mapping, OverrideEntry, Overrides) — zero I/O imports, zero argument mutation
- Full precedence chain implemented: override-program → live-program → preview → off, each tier arbitrated by lowest atemSource number
- All 10 decisions D-04..D-13 implemented and individually tested; CORE-01, CORE-02, CORE-04 satisfied
- Threat mitigation T-02-01 (DoS via oversized tally): output iteration bounded by mapping (≤8 entries), not by the 1000-padded tally array length
- Threat mitigation T-02-02 (live mutation): readonly param types + SC2 test prove live state is never mutated — clearing an override instantly reveals live
- 38 tests in `src/core/resolver.test.ts`; 9 pre-existing events.test.ts tests; 47/47 pass under vitest; tsc --noEmit exits 0

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add failing RED gate test for resolver** - `5faeb75` (test)
2. **Task 1 GREEN: Implement pure resolver with full precedence chain** - `2352cdf` (feat)
3. **Task 2: Exhaustive resolver test suite** - `6f0f88e` (test)

## Files Created/Modified

- `src/core/resolver.ts` — Pure resolver: 5 exported input types + `resolve()` function; 346 non-blank lines; full override-program→live-program→preview→off chain; D-13 defensive coercion at entry; mapping-bounded output iteration
- `src/core/resolver.test.ts` — 38 tests across 9 describe blocks: SC1 (3), SC2 (2), SC3/CORE-04/D-04..D-06 (3), D-07 (5), D-08 (2), D-09 (2), D-10 (3), D-11 (5), D-12 (3), D-13 (8 not.toThrow), SC5 (2)

## Decisions Made

- **Mapping-bounded output iteration:** T-02-01 threat (adversarial oversized tally) mitigated by iterating the mapping for output, not the tally array. A 1000-entry vMix tally cannot cause 1000-entry output work. Verified by D-13 oversized-tally test.
- **atemSource=0 excluded:** Zero is not a valid ATEM source id (u16 input numbers start at 1). Coercion drops mapping entries with atemSource <= 0. Prevents a misconfigured mapping from placing null-equivalent source on the bus.
- **force-preview+live-preview deduplication:** When a camera appears in both the force-preview set and the live-preview entries, the resolver includes it only once in preview candidates (force-preview takes precedence so live-preview for same camera is skipped).
- **D-10 symmetric for program+preview:** Unmapped live inputs are flagged in contended regardless of whether they are state=1 (program) or state=2 (preview). Gives Phase 6 visibility into both unmapped program and unmapped preview inputs.

## Deviations from Plan

None — plan executed exactly as written. The TDD flow (RED gate commit → GREEN implementation commit → full test suite commit) matched the plan's `tdd="true"` tasks exactly.

## TDD Gate Compliance

- **RED gate:** `test(01-02)` commit `5faeb75` — tsc fails TS2307 (resolver.ts does not exist), confirming the test imports a non-existent module
- **GREEN gate:** `feat(01-02)` commit `2352cdf` — tsc exits 0, SC1 test passes; all 38 final tests pass after Task 2
- **No REFACTOR gate needed:** Implementation is clean as written; no cleanup pass required

## Threat Model Coverage

| Threat | Disposition | Verification |
|--------|-------------|--------------|
| T-02-01 (DoS via oversized tally) | Mitigated | Mapping-bounded output; D-13 oversized-tally test passes |
| T-02-02 (live state mutation) | Mitigated | Readonly param types; SC2 structuredClone test passes |
| T-02-03 (info disclosure) | Accepted | Zero I/O imports verified by grep gate returning 0 |
| T-02-SC (npm install) | Accepted | No new dependencies introduced |

## Known Stubs

None — `resolve()` is a complete, fully-wired pure function producing real ResolverOutput values from real inputs. No hardcoded empty returns or placeholder behavior.

## Threat Flags

None — `resolver.ts` introduces no network endpoints, no file access, no auth paths, and no schema changes. The only trust boundary (downstream caller → resolve() inputs) is fully documented in the plan's threat model and mitigated by D-13 defensive coercion.

## Issues Encountered

None.

## Next Phase Readiness

- `resolve()` is ready for Phase 3 (vMix connector will pass parsed VmixTally arrays) and Phase 2 (config store will supply Mapping) and Phase 6 (override panel will supply Overrides)
- Exported input types (MappingEntry, OverrideEntry) provide stable contracts for Phase 2 mapping schema design
- 47/47 tests green; no blockers

## Self-Check: PASSED

- src/core/resolver.ts: FOUND
- src/core/resolver.test.ts: FOUND
- commit 5faeb75 (RED gate): FOUND
- commit 2352cdf (GREEN implementation): FOUND
- commit 6f0f88e (exhaustive tests): FOUND
- tsc --noEmit exits 0: PASSED
- 47/47 vitest tests pass: PASSED

---
*Phase: 01-core-resolver-tally-state-spine*
*Completed: 2026-06-29*
