---
phase: 03-vmix-live-ingest
plan: 01
subsystem: vmix
tags: [pure-functions, parser, tally, roster, schema, key-anchor, tdd]
dependency_graph:
  requires:
    - 02-01 (schema.ts PersistedMappingEntry type)
    - 01-01 (MappingEntry, VmixTally types from core/resolver.ts)
  provides:
    - parseTallyString (VMIX-03 positional indexing contract)
    - parseRosterXml + fetchRoster (roster XML parsing, HTTP fetch)
    - buildRuntimeMapping (D-03 Key-anchor seam resolver)
    - vmixHttpPort schema extension (D-08 backward-compatible)
  affects:
    - 03-02 (VmixConnector uses parseTallyString, fetchRoster)
    - 03-03 (tallyOrchestrator uses buildRuntimeMapping)
    - 04-xx (ATEM phase: buildRuntimeMapping output feeds resolver)
tech_stack:
  added: []
  patterns:
    - Pure functions with zero I/O — no imports except type-only cross-module types
    - Two-pass regex attribute extraction for XML attribute order safety (Assumption A2)
    - D-04 silent-drop via `continue` in for...of loop
    - AbortSignal.timeout(5000) for fetch timeout (T-03-05)
    - Optional schema field without .default() — consumer applies default at read time (D-08)
key_files:
  created:
    - src/vmix/parseTallyString.ts
    - src/vmix/parseTallyString.test.ts
    - src/vmix/parseRosterXml.ts
    - src/vmix/parseRosterXml.test.ts
    - src/vmix/buildRuntimeMapping.ts
    - src/vmix/buildRuntimeMapping.test.ts
  modified:
    - src/config/schema.ts (vmixConnection sub-schema + vmixHttpPort field)
    - src/config/schema.test.ts (5 new D-08 backward-compat tests)
decisions:
  - "Two-pass regex (per-element extraction) instead of single-pass matchAll: guarantees attribute-order independence (Assumption A2)"
  - "vmixHttpPort kept optional with no .default() in zod — consumer applies ?? 8088 at read time to keep stored JSON clean (D-08)"
  - "buildRuntimeMapping is a pure function (not a method): testable in isolation without any EventEmitter or network mock"
metrics:
  duration: "~15 minutes"
  completed: "2026-07-01"
  tasks: 2
  files: 8
---

# Phase 03 Plan 01: Pure vMix Ingest Contracts Summary

**One-liner:** Positional tally string parser, two-pass XML roster parser, and Key-anchor runtime mapping bridge — all pure functions with 64 tests proving the VMIX-03 indexing contract and SC4 Key-reorder invariant.

## What Was Built

### Task 1: parseTallyString + parseRosterXml (commit: fdff989)

**`src/vmix/parseTallyString.ts`** — pure function, zero imports. Parses the vMix TCP TALLY digit string into a positional `number[]` where `array[i]` = state of vMix input `(i+1)`. Guards: empty string → `[]` (Pitfall 4), non-0/1/2 chars coerce to 0 (D-13 total-function stance).

**`src/vmix/parseRosterXml.ts`** — pure XML parser + fetch wrapper. Uses two-pass per-element regex extraction: matches `<input>` elements first, then extracts `key=` and `number=` independently from each element's attribute string. This safely handles any attribute ordering (Assumption A2). `fetchRoster` uses native Node 22 `fetch` with `AbortSignal.timeout(5000)` (T-03-05), degrades to empty `Map` on any error.

**11 parseTallyString tests + 12 parseRosterXml tests** covering: empty roster, positional indexing contract, defensive coercion, reversed attribute order (A2), malformed XML, non-OK HTTP response, network error.

### Task 2: buildRuntimeMapping + schema vmixHttpPort extension (commit: 36fa665)

**`src/vmix/buildRuntimeMapping.ts`** — pure function, type-only cross-module imports. The D-03 seam: iterates persisted entries, looks up current `vmixNumber` from the live roster by stable `vmixKey` GUID. `roster.get(entry.vmixKey) === undefined` → `continue` (D-04 silent drop). Returns `MappingEntry[]` for the resolver.

**`src/config/schema.ts`** — added `vmixConnection` sub-schema with optional `vmixHttpPort: z.number().int().min(1).max(65535).optional()`. Updated `settings.vmix` to use `vmixConnection`; `settings.atem` keeps the original `connection` sub-schema unchanged. No `.default(8088)` — consumer applies at read time.

**9 buildRuntimeMapping tests** proving SC4 Key-reorder (same GUID, new position → updated `vmixInput`) and D-04 silent drop (absent GUID → entry dropped, others unaffected).

**5 new schema tests** proving D-08 backward-compat (no vmixHttpPort → success, `undefined`), explicit 8088 accepted, out-of-range values rejected.

## Verification

All plan verification steps confirmed:

1. Full vmix pure-function suite: 32 tests green (parseTallyString + parseRosterXml + buildRuntimeMapping)
2. Full config suite: 32 tests green (no regressions + 5 new D-08 tests)
3. TypeScript: `npx tsc --noEmit` exits 0
4. SC4 Key-reorder test present and passing — `reorderedRoster` produces `camA.vmixInput=2`, `camB.vmixInput=1`
5. parseRosterXml includes `numberBeforeKeyXml` fixture (A2 risk mitigation) — passing
6. Total tests across full suite: **126 tests green** (including pre-existing core/ tests)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Two-pass regex for XML attribute order**

- **Found during:** Task 1 — implementing parseRosterXml
- **Issue:** The plan's suggested single-regex `/<input\b[^>]*\bkey="([^"]+)"[^>]*\bnumber="(\d+)"/g` only matches elements where `key=` appears before `number=`. It silently misses elements with reversed attribute order (Assumption A2).
- **Fix:** Used two-pass extraction — match entire `<input>` element first, then run independent regex for `key=` and `number=` on each element's attribute string. This correctly handles any attribute order.
- **Files modified:** `src/vmix/parseRosterXml.ts`
- **Test added:** `numberBeforeKeyXml` fixture in `parseRosterXml.test.ts` (the A2 safety check the plan required)
- **Commit:** fdff989 (included in Task 1 commit)

## Known Stubs

None. All functions are fully implemented with no placeholders. The `src/vmix/` module creates no UI-facing or data-sourcing stubs.

## Threat Flags

No new security-relevant surface introduced beyond the plan's threat model. All T-03-xx mitigations confirmed implemented:
- T-03-01: Non-0/1/2 chars → coerce to 0 (parseTallyString, test: `"X" → [0]`)
- T-03-03: Regex does not evaluate XML entities; returns empty Map on parse failure
- T-03-05: `AbortSignal.timeout(5000)` on every fetchRoster call; catch returns empty Map

## Self-Check

### Files exist:
- src/vmix/parseTallyString.ts — FOUND
- src/vmix/parseTallyString.test.ts — FOUND
- src/vmix/parseRosterXml.ts — FOUND
- src/vmix/parseRosterXml.test.ts — FOUND
- src/vmix/buildRuntimeMapping.ts — FOUND
- src/vmix/buildRuntimeMapping.test.ts — FOUND
- src/config/schema.ts (modified) — FOUND
- src/config/schema.test.ts (modified) — FOUND

### Commits exist:
- fdff989 — Task 1 (parseTallyString + parseRosterXml) — FOUND
- 36fa665 — Task 2 (buildRuntimeMapping + schema extension) — FOUND

## Self-Check: PASSED
