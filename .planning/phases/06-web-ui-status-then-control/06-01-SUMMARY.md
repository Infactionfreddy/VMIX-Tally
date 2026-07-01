---
phase: 06-web-ui-status-then-control
plan: "01"
subsystem: frontend-build-setup
tags: [tsconfig, vite, svelte, schema, devDeps, wave0]
dependency_graph:
  requires: []
  provides:
    - tsconfig-split-nodext-vs-bundler
    - vite-build-pipeline
    - schema-overrides-field
    - wave0-test-stubs
  affects:
    - src/config/schema.ts
    - tsconfig.json
    - package.json
tech_stack:
  added:
    - svelte@5.56.4
    - "@sveltejs/vite-plugin-svelte@7.1.2"
    - vite@8.1.2
    - "@types/ws@8.18.1"
    - vitest@4.1.9 (upgrade from ^3)
  patterns:
    - tsconfig-extend-and-override-exclude
    - vite-root-relative-outDir
    - zod-optional-record-field
key_files:
  created:
    - src/frontend/tsconfig.json
    - vite.config.ts
    - src/frontend/index.html
    - src/frontend/main.ts
    - src/routes/overrides.test.ts
    - src/routes/settings.test.ts
  modified:
    - tsconfig.json (exclude added)
    - src/config/schema.ts (overrides field + PersistedOverrides type)
    - src/config/schema.test.ts (5 new overrides tests)
    - src/server.test.ts (10 new it.todo stubs appended)
    - package.json (devDependencies updated)
decisions:
  - "vitest ^3 to ^4 upgrade: vite@8 peer dep conflict required upgrade; v4 supports vite ^6|^7|^8; 169 existing tests unaffected"
  - "src/frontend/tsconfig.json adds exclude: [] to override inherited src/frontend exclusion from root tsconfig"
  - "src/server.test.ts appended (not replaced) because file already existed with Phase 4 walk-test tests"
metrics:
  duration: ~30m execution
  completed: 2026-07-01
  tasks_completed: 2
  files_created: 6
  files_modified: 5
---

# Phase 6 Plan 01: TypeScript Config Split + Vite Setup + Schema Overrides Summary

**One-liner:** Split NodeNext/bundler tsconfig contexts, install Svelte+Vite devDeps, extend schema with optional overrides field (z.record enum), add Wave 0 test stubs across 3 files.

## What Was Implemented

### Task 1: TypeScript Config Split + Vite Build Setup + npm install

**tsconfig.json — exclude added:**
Root tsconfig now excludes src/frontend so NodeNext module resolution never processes browser-targeted code.

**src/frontend/tsconfig.json — new frontend config:**
Extends root tsconfig but overrides conflicting settings for Vite/Svelte:
- "moduleResolution": "bundler" (required by Vite isolated-module transpilation)
- "isolatedModules": true (required by @sveltejs/vite-plugin-svelte)
- "lib": ["ES2022", "DOM", "DOM.Iterable"] (browser target)
- "noEmit": true (Vite handles bundling, not tsc emit)
- "exclude": [] (overrides the inherited src/frontend exclusion from root)

**vite.config.ts — project root:**
Svelte 5 plugin, root: src/frontend, build.outDir: ../../dist, dev proxy for /overrides /config /test /vmix /ws.

**devDependencies installed:**
- svelte ^5.56.4
- @sveltejs/vite-plugin-svelte ^7.1.2
- vite ^8.1.2
- @types/ws ^8.18.1
- vitest ^4.1.9 (upgrade from ^3 — see Deviations)

**src/frontend/index.html:** Minimal Vite SPA entry point.
**src/frontend/main.ts:** Stub (export {}) — Plan 03 replaces with full Svelte mount.

### Task 2: ConfigStore Schema Extension (D-13) + Wave 0 Test Stubs

**src/config/schema.ts — overrides field added:**
overrides: z.record(z.string(), z.enum(['program', 'preview'])).optional()
Added after mapping line. Backward-compatible (absent = no overrides). Null values rejected.

**PersistedOverrides type exported:**
export type PersistedOverrides = NonNullable<PersistedConfig['overrides']>;

**src/config/schema.test.ts — 5 new overrides tests (all GREEN):**
- absent overrides is valid (backward-compat)
- 'program' value accepted
- 'preview' value accepted
- invalid value rejected
- null value rejected

**Wave 0 test stubs (all it.todo — not failures):**
- src/server.test.ts: 10 stubs appended (WS broadcast + CSRF)
- src/routes/overrides.test.ts: 5 stubs (PUT /overrides/:cameraId)
- src/routes/settings.test.ts: 6 stubs (GET+PUT /config/settings and /config/mapping)

## Final Test Count

vitest run v4.1.9

Test Files  10 passed | 2 skipped (12)
     Tests  174 passed | 21 todo (195)
   Duration  ~357ms

- 169 original tests: all green (zero regressions)
- 5 new overrides schema tests: all green
- 21 it.todo stubs: shown as "todo", not failures
- 0 failures

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest ^3 upgraded to ^4 to resolve vite@8 peer dependency conflict**
- Found during: Task 1 npm install
- Issue: @sveltejs/vite-plugin-svelte@7.1.2 requires vite@^8. vitest@^3 internally resolves vite@^5|^6|^7. npm ERESOLVE error.
- Fix: Upgraded vitest from ^3.2.6 to ^4.1.9. vitest v4 supports vite@^6|^7|^8. All 169 existing tests pass unchanged.
- Files modified: package.json, package-lock.json
- Commit: 3cf375a

**2. [Rule 1 - Bug] src/frontend/tsconfig.json requires "exclude": [] to clear inherited exclusion**
- Found during: Task 1 npx tsc --noEmit -p src/frontend/tsconfig.json
- Issue: Frontend tsconfig extends root which has "exclude": ["src/frontend"]. TypeScript inherited this exclusion, excluding all frontend files. Error: TS18003: No inputs were found.
- Fix: Added "exclude": [] to frontend tsconfig to explicitly clear the inherited exclusion.
- Files modified: src/frontend/tsconfig.json
- Commit: 3cf375a

**3. [Rule 3 - Blocking] src/server.test.ts already existed — appended stubs instead of creating**
- Found during: Pre-execution check
- Issue: File already existed with 3 passing Phase 4 walk-test tests. Plan constraint: add only, don't remove.
- Fix: Appended 10 new it.todo stubs as additional describe blocks. Existing 3 tests intact and passing.
- Files modified: src/server.test.ts
- Commit: c37a1a8

## Verification Commands

| Command | Result |
|---------|--------|
| npx tsc --noEmit | PASS |
| npx tsc --noEmit -p src/frontend/tsconfig.json | PASS |
| npx vite build --logLevel error | PASS (exit 0) |
| npm test | PASS (174 passed, 21 todo) |
| grep -c "overrides" src/config/schema.ts | 4 |
| grep -c "bundler" src/frontend/tsconfig.json | 1 |
| grep -c "src/frontend" tsconfig.json | 1 |

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | c37a1a8 | Present — 2 failing schema tests + 21 todos |
| GREEN | 3cf375a | Present — all tests green |
| REFACTOR | n/a | Not required |

## Known Stubs

| File | Content | Reason |
|------|---------|--------|
| src/frontend/main.ts | export {}; | Plan 03 replaces with Svelte mount |
| src/frontend/index.html | Minimal HTML | Plan 03 adds component entry point |

## Commits

| Hash | Type | Message |
|------|------|---------|
| c37a1a8 | test | test(06-01): Wave 0 test stubs + schema overrides tests RED |
| 3cf375a | feat | feat(06-01): tsconfig split + Vite setup + schema overrides extension |

## Self-Check: PASSED

- tsconfig.json has "exclude": ["src/frontend"] — VERIFIED
- src/frontend/tsconfig.json exists with "moduleResolution": "bundler" — VERIFIED
- vite.config.ts at project root with svelte plugin — VERIFIED
- src/config/schema.ts has overrides field + PersistedOverrides type — VERIFIED
- schema.test.ts has 5 new overrides tests all green — VERIFIED
- src/server.test.ts has 10 new it.todo stubs (3 existing intact) — VERIFIED
- src/routes/overrides.test.ts exists with 5 it.todo stubs — VERIFIED
- src/routes/settings.test.ts exists with 6 it.todo stubs — VERIFIED
- Both commits exist: c37a1a8 (RED), 3cf375a (GREEN) — VERIFIED
- npm test exits 0: 174 passed, 21 todo, 0 failures — VERIFIED
- npx vite build exits 0 — VERIFIED
