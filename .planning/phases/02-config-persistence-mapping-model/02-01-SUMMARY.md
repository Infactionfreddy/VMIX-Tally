---
phase: 02-config-persistence-mapping-model
plan: "01"
subsystem: config
tags: [zod, lowdb, schema, persistence, validation, tdd]
dependency_graph:
  requires: []
  provides:
    - src/config/schema.ts (PersistedConfig, PersistedMappingEntry, ConfigValidationError, toConfigValidationError, schema)
  affects:
    - plan 02-02 (configStore.ts implements against this schema contract)
    - plan 02-03 (boot recovery uses schema.safeParse for quarantine decision)
tech_stack:
  added:
    - lowdb@7.0.1
    - zod@4.4.3
    - steno@4.0.2 (transitive dep of lowdb)
  patterns:
    - zod superRefine for cross-entry uniqueness with element-scoped issue paths
    - z.treeifyError for Phase 6 field-level UI error rendering (zod v4 top-level helpers)
    - TDD RED/GREEN cycle (schema.test.ts committed before schema.ts)
    - Intentional resolver mirror (atemSource/cameraId guards in zod, not imported)
key_files:
  created:
    - src/config/schema.ts
    - src/config/schema.test.ts
  modified:
    - package.json
    - package-lock.json
    - .gitignore
decisions:
  - "lowdb + zod installed as production deps (project-locked D-04); steno arrives transitively — not installed directly"
  - "config.json and config.json.bak-corrupt added to .gitignore per RESEARCH Open Question 1"
  - "PersistedMappingEntry is intentionally distinct from resolver MappingEntry (D-03 seam) — vmixKey vs vmixInput"
  - "atemSource and cameraId guards expressed in zod independently of resolver (D-03 no import) with comment noting intentional redundancy"
  - "z.treeifyError used (zod v4 top-level helper); deprecated .format()/.flatten() instance methods absent"
  - "issue.path cast from PropertyKey[] to (string | number)[] — runtime safe, zod always emits string|number paths"
  - "vmixNumber: 0 test passes unknown to safeParse instead of typed PersistedConfig (avoids @ts-expect-error; zod accepts unknown)"
metrics:
  duration_minutes: 5
  completed_date: "2026-06-30"
  tasks_completed: 2
  files_changed: 5
---

# Phase 2 Plan 1: Schema + Dependency Setup Summary

**One-liner:** zod 4 schema for vMix-Key-anchored persisted config with three cross-entry uniqueness superRefines, ≤8 entry cap, nullable connection settings, and a `z.treeifyError`-based `ConfigValidationError` for Phase 6 field-level UI rendering.

## What Was Built

**Task 1 — Install lowdb + zod; gitignore config files:**
- `npm install lowdb zod` → lowdb@7.0.1, zod@4.4.3, steno@4.0.2 (transitive)
- Both ESM-importable; `lowdb/node` subpath verified
- `.gitignore` extended with `config.json` and `config.json.bak-corrupt`

**Task 2 — Schema, types, invariants, ConfigValidationError (TDD):**
- `src/config/schema.ts`: zod schema with connection sub-schema (nullable, D-11), mappingEntry sub-schema (vmixKey GUID anchor D-01, vmixNumber/vmixTitle hints D-02, atemSource positive int D-09, cameraId non-empty), top-level schema with `.max(8)` entry cap (D-09/MAP-01) and `.superRefine` for three uniqueness checks (D-07)
- `ConfigValidationError` interface and `toConfigValidationError` function using `z.treeifyError` (zod v4, not deprecated v3 methods)
- `PersistedConfig` and `PersistedMappingEntry` types derived from schema (distinct from resolver's `MappingEntry` — D-03 seam)
- `src/config/schema.test.ts`: 27 tests covering all invariants, boundaries, and coerceMapping alignment drift guard

## Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| src/config/schema.test.ts | 27 | PASS |
| src/core/resolver.test.ts | 40 | PASS (untouched — D-03) |
| src/core/events.test.ts | 9 | PASS |
| src/core/tallyState.test.ts | 13 | PASS |
| **Total** | **89** | **PASS** |

`npx tsc --noEmit` — clean.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| b6e55da | chore | Install lowdb + zod; gitignore config files |
| eb8d664 | test | Add failing schema invariant tests (RED) |
| 7b45c56 | feat | Define zod schema, PersistedConfig types, and ConfigValidationError (GREEN) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed PropertyKey[] vs (string | number)[] type mismatch in toConfigValidationError**
- **Found during:** Task 2, tsc --noEmit after GREEN implementation
- **Issue:** zod's `ZodIssue.path` type is `PropertyKey[]` (includes `symbol`) but the `ConfigValidationError.issues[].path` interface was typed `(string | number)[]`. tsc error TS2322.
- **Fix:** Cast `issue.path as (string | number)[]` in `toConfigValidationError` with a comment explaining the runtime safety (zod always emits string|number paths, symbol is only a TS type artifact).
- **Files modified:** `src/config/schema.ts` (line 148)
- **Commit:** 7b45c56

**2. [Rule 1 - Bug] Removed invalid @ts-expect-error in schema.test.ts**
- **Found during:** Task 2, tsc --noEmit (TS2578 unused directive)
- **Issue:** `@ts-expect-error` on the `vmixNumber: 0` test was unnecessary — `schema.safeParse` accepts `unknown`, so TS doesn't error on typed assignments.
- **Fix:** Changed the test to pass an `unknown` literal directly to `schema.safeParse` instead of assigning to the typed `PersistedConfig` variable.
- **Files modified:** `src/config/schema.test.ts` (vmixNumber non-positive test)
- **Commit:** 7b45c56

**3. [Rule 2 - Comment accuracy] Removed deprecated API names from doc comments**
- **Found during:** Task 2, acceptance criteria check for `grep -Eq "format\(\)|flatten\(\)"` returning NO match
- **Issue:** Two doc comments mentioned `error.format()` / `error.flatten()` as examples of what NOT to use, causing the acceptance grep to report a false positive.
- **Fix:** Reworded comments to describe the deprecated methods without using the parenthesized call syntax that the acceptance criterion greps for.
- **Files modified:** `src/config/schema.ts`
- **Commit:** 7b45c56

## Known Stubs

None. `schema.ts` is a pure validation module with no data-fetching, rendering, or UI stubs.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundary changes introduced. This plan is purely local schema/type definition + npm installs. The threat model T-02-01 through T-02-SC from the plan's `<threat_model>` are all addressed by the schema implementation:
- T-02-01 (input tampering): mitigated by zod `safeParse` with positive-int + non-empty + 3x uniqueness superRefine
- T-02-02 (DoS unbounded array): mitigated by `.max(8)` entry cap
- T-02-03 (prototype pollution): mitigated by zod `safeParse` producing a fresh typed object
- T-02-SC (npm installs): accepted per slopcheck — all packages verified legitimate

## Self-Check: PASSED

- [x] `src/config/schema.ts` exists and exports `schema`, `PersistedConfig`, `PersistedMappingEntry`, `ConfigValidationError`, `toConfigValidationError`
- [x] `src/config/schema.test.ts` exists with 27 tests
- [x] Commits b6e55da, eb8d664, 7b45c56 present in git log
- [x] `npx vitest run` — 89 tests pass
- [x] `npx tsc --noEmit` — clean
- [x] No resolver imports in schema.ts (D-03 boundary intact)
- [x] `treeifyError` present; `format()` / `flatten()` call patterns absent
- [x] `config.json` and `config.json.bak-corrupt` in .gitignore
- [x] `npm ls steno` shows steno@4.0.2 as transitive dep
