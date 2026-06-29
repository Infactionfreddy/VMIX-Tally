---
phase: 01-core-resolver-tally-state-spine
plan: "01"
subsystem: core
tags: [typescript, vitest, esm, types, contract]

requires: []
provides:
  - "Strict-mode TypeScript ESM project (package.json, tsconfig.json, vitest.config.ts)"
  - "Typed output contract: CameraTallyState, CameraId, AtemSource, DesiredAtemBusState, CameraTallyMap, ContendedReason, ContendedInput, ResolverOutput exported from src/core/events.ts"
  - "9-test suite in src/core/events.test.ts proving contract shapes compile and round-trip"
affects:
  - "02-config-store"
  - "03-vmix-connector"
  - "04-atem-connector"
  - "06-web-ui"

tech-stack:
  added:
    - "typescript@^5 (strict, NodeNext, noUncheckedIndexedAccess)"
    - "vitest@^3 (test runner, scoped to src/**/*.test.ts)"
    - "@types/node@^22"
  patterns:
    - "ESM-first: type:module, import/export throughout"
    - "verbatimModuleSyntax: import type for type-only imports, .js extension in paths"
    - "File-header responsibility comment on every module (house style)"
    - "Types-only module pattern: events.ts has zero runtime constructs"
    - "AtemSource = number | null (null for absent, not undefined — JSON-serializable)"

key-files:
  created:
    - "package.json"
    - "tsconfig.json"
    - "vitest.config.ts"
    - ".gitignore"
    - "src/core/events.ts"
    - "src/core/events.test.ts"
  modified: []

key-decisions:
  - "null over undefined for AtemSource 'nothing live' (D-11): null serializes cleanly to JSON over WebSocket; ARCHITECTURE.md sketch used undefined but null is the correct choice for Phase 6 wire format"
  - "noUncheckedIndexedAccess: true — required because the resolver will index tally arrays and mapping records by untrusted numbers; compiler forces undefined-checks at every index access (D-13)"
  - "verbatimModuleSyntax: true — all type-only imports use import type; all paths use .js extension for NodeNext ESM compatibility"
  - "ContendedInput carries atemSource: AtemSource (nullable) — richer than just the reason, allows Phase 6 to name which ATEM source lost arbitration"

patterns-established:
  - "Pattern: File-header responsibility comment — every src/ module opens with a comment stating its single responsibility and key design constraints"
  - "Pattern: Types-only modules — events.ts has zero runtime constructs; verified by grep gate returning 0"
  - "Pattern: TDD RED gate = tsc failure on missing module, GREEN gate = tsc + vitest both pass"

requirements-completed: [CORE-01]

duration: 4min
completed: "2026-06-29"
---

# Phase 01 Plan 01: Project Foundation + Output Contract Summary

**Strict-mode TypeScript ESM project with typed per-camera off|program|preview tally contract, ATEM null-safe bus state, and contended/dropped sidecar — all downstream phases build against this fixed interface**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-29T16:28:52Z
- **Completed:** 2026-06-29T16:32:30Z
- **Tasks:** 2 (Task 1: project foundation; Task 2: output contract TDD)
- **Files modified:** 6

## Accomplishments

- Greenfield TypeScript ESM project compiles cleanly: strict mode, NodeNext module resolution, noUncheckedIndexedAccess, verbatimModuleSyntax — all enforced
- `src/core/events.ts` exports 8 types/interfaces covering all three contract requirements from D-01/D-02/D-06/D-10/D-11: per-camera off|program|preview map keyed by camera id, single {program, preview} ATEM bus state with explicit null for "nothing live", and contended/dropped sidecar with lost-bus + unmapped reasons
- 9 contract round-trip tests in `src/core/events.test.ts` prove every shape compiles and round-trips at runtime; all pass under vitest

## Task Commits

Each task was committed atomically:

1. **Task 1: Provision TypeScript ESM project foundation** - `397352e` (chore)
2. **Task 2 RED: Add failing contract round-trip tests** - `055e37e` (test)
3. **Task 2 GREEN: Implement typed output contract events.ts** - `05caf69` (feat)

## Files Created/Modified

- `package.json` — ESM ("type":"module"), engines.node>=22, scripts: typecheck/test/test:watch, devDeps: typescript@^5, vitest@^3, @types/node@^22
- `tsconfig.json` — strict, NodeNext, noUncheckedIndexedAccess, verbatimModuleSyntax, rootDir: src
- `vitest.config.ts` — test discovery restricted to src/**/*.test.ts, environment: node
- `.gitignore` — node_modules/, dist/, coverage/
- `src/core/events.ts` — types-only output contract (88 lines, zero runtime constructs)
- `src/core/events.test.ts` — 9 round-trip tests covering all contract shapes

## Decisions Made

- **null over undefined for AtemSource**: ARCHITECTURE.md sketch uses `undefined` for absent program/preview. Changed to `null` because `undefined` is dropped by `JSON.stringify` — null serializes cleanly to `"null"` over the WebSocket pipe to the browser SPA (Phase 6). Deviation documented inline in events.ts.
- **noUncheckedIndexedAccess required**: This compiler flag forces explicit undefined-checks at every array/Record index access. Required because the resolver (Plan 02/03) will index vMix tally arrays and mapping records by untrusted numbers — D-13 total-function safety depends on the compiler catching unsafe index reads.
- **ContendedInput carries atemSource**: Chose richer object shape (includes which ATEM source lost arbitration, nullable when unmapped) per CONTEXT.md "Claude's discretion" note on the contended sidecar. Gives Phase 6 enough context to generate specific warnings.

## Deviations from Plan

None — plan executed exactly as written. The null-vs-undefined deviation from ARCHITECTURE.md is documented as an intentional design decision, not an unplanned fix (ARCHITECTURE.md sketch is superseded by D-11's "explicit absent" requirement + JSON serialization need).

## TDD Gate Compliance

- RED gate: `test(01-01)` commit `055e37e` — tsc fails TS2307 (module not found), tests pass at runtime (import type has no runtime artifact — expected for type-only contract tests)
- GREEN gate: `feat(01-01)` commit `05caf69` — tsc exits 0, 9/9 tests pass

## Issues Encountered

- tsc --noEmit returned TS18003 ("no inputs") on an empty src/ before any source files existed. Expected for greenfield setup; Task 1 commit precedes src/ creation. tsc verification runs cleanly once events.ts exists (Task 2).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 8 contract types exported from `src/core/events.ts` are ready for Plans 02 and 03 to import
- vitest runner wired and passing — Plans 02/03 add tests without tooling changes
- tsc strict mode + noUncheckedIndexedAccess active — Plans 02/03 resolver logic gets full compiler safety
- Blockers: none

---
*Phase: 01-core-resolver-tally-state-spine*
*Completed: 2026-06-29*
