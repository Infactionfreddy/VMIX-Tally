# Phase 2: Config Persistence + Mapping Model - Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** 4 (all new — `schema.ts`, `configStore.ts`, `schema.test.ts`, `configStore.test.ts`)
**Analogs found:** 4 / 4 (all role-match against `src/core/`; no exact disk-touching analog exists — this is the first `config/` module)

> **Greenfield note.** The repo contains exactly one source module today: `src/core/`
> (`resolver.ts`, `events.ts`, `tallyState.ts` + their `.test.ts`). There is NO
> existing disk-touching code, no `config/`, no lowdb/zod usage. So no analog has
> the *exact* role (persistence). The analogs below are matched on the patterns that
> DO transfer: the type-declaration idiom, the defensive total-function validation
> stance (`coerceMapping`), the strict-TS ESM conventions, and the vitest test
> structure. Library wiring (lowdb/zod/fs) has no in-repo analog — use RESEARCH.md
> Patterns 1–4 for those (see "No Analog Found").

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/config/schema.ts` | model / validator (types + zod schema + `ConfigValidationError`) | transform (validate `unknown` → typed) | `src/core/resolver.ts` (type decls + `coerceMapping` defensive validator) | role-match (validation shape), library wiring = no analog |
| `src/config/configStore.ts` | store / persistence (lowdb load/save + boot recovery + CRUD) | file-I/O + CRUD | `src/core/tallyState.ts` (stateful module idiom + I/O-boundary doc-comment) | partial (module idiom only; fs/lowdb wiring has no analog) |
| `src/config/schema.test.ts` | test (unit — invariants) | request-response (input → assert) | `src/core/resolver.test.ts` | role-match (test idiom exact) |
| `src/config/configStore.test.ts` | test (integration — round-trip, boot, atomicity) | file-I/O | `src/core/resolver.test.ts` (idiom) + temp-dir setup = no analog | role-match (idiom) / partial (temp-dir) |

## Pattern Assignments

### `src/config/schema.ts` (model/validator, transform)

**Analog:** `src/core/resolver.ts` — for the type-declaration + JSDoc + defensive-validation idiom. The new zod schema is the **upstream gate** that mirrors (but does not import) the resolver's runtime `coerceMapping` guards on the shared fields.

**Module-header / I/O-boundary comment idiom** (copy this convention — `resolver.ts:1-4`):
```typescript
// Pure desired-state resolver: (vMixTally, mapping, overrides) → ResolverOutput.
// Zero I/O — no imports of node: builtins, sockets, or HTTP.
// Total function (D-13): malformed/empty/out-of-range inputs are coerced to a safe
// all-off ResolverOutput; this function never throws on adversarial input.
```
> For `schema.ts`, write the equivalent header: "zod schema + invariants for the
> persisted config. Validates `unknown` → typed `PersistedConfig`. No fs/network —
> the schema is pure; only `configStore.ts` touches disk." This keeps the
> `core/`-purity convention visible at the new persistence boundary.

**Exported-type + JSDoc idiom** (copy this style — `resolver.ts:27-41`). Note the
`PersistedMappingEntry` must be a DISTINCT type from the resolver's `MappingEntry`
(D-03 / RESEARCH §"D-03 Resolver Reconciliation Seam"): it carries `vmixKey` (GUID),
NOT the resolver's positional `vmixInput`:
```typescript
/**
 * One entry in the vMix-input → ATEM-input → camera mapping.
 * The three-way chain: vmixInput ↔ atemSource ↔ cameraId (D-02, PITFALLS Pitfall 1).
 */
export interface MappingEntry {
  /** The vMix input number (1-based, matches the tally array index). */
  vmixInput: number;
  /** The ATEM source id (u16, mixEffect 0). */
  atemSource: number;
  /** The camera identity label (decoupled from both vMix and ATEM numbers). */
  cameraId: CameraId;
}
```

**Defensive-validation pattern to MIRROR in zod** (the runtime guard at `resolver.ts:79-91`).
The zod schema's shared-field rules must be **at least as strict** as these (RESEARCH
§"Schema/Type Alignment" — alignment test required):
```typescript
function coerceMapping(raw: Mapping | null | undefined): MappingEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is MappingEntry =>
      e !== null &&
      typeof e === "object" &&
      isSafeNonNegInt(e.vmixInput) &&
      isSafeNonNegInt(e.atemSource) &&
      e.atemSource > 0 &&                       // → zod: z.number().int().positive()
      typeof e.cameraId === "string" &&
      e.cameraId.length > 0,                    // → zod: z.string().min(1)
  );
}
```
Mapping of the two guards onto zod (add a comment in `schema.ts` noting this is
intentional redundancy, not accidental duplication):
- `e.atemSource > 0` + `isSafeNonNegInt` → `atemSource: z.number().int().positive()` (D-09: positive int, NOT capped at 8)
- `e.cameraId.length > 0` → `cameraId: z.string().min(1)`

**zod schema + invariants + error shape** — NO in-repo analog. Use RESEARCH.md
verbatim: Pattern 3 (`schema.ts` with three `.superRefine` uniqueness checks at
element paths + `.max(8)` entry cap), Pattern 4 (`ConfigValidationError` via
`z.treeifyError`/top-level helpers — NOT the deprecated `error.format()`/`.flatten()`).

---

### `src/config/configStore.ts` (store/persistence, file-I/O + CRUD)

**Analog:** `src/core/tallyState.ts` — for the **stateful-module + I/O-boundary
doc-comment** idiom only. The actual lowdb/fs/quarantine wiring has no in-repo analog.

**I/O-boundary header idiom** (`tallyState.ts:1-8`) — invert it for the store (this is
the module that DOES touch disk; document that boundary explicitly):
```typescript
// Single-writer diff reconciler for the desired ATEM bus state.
// ...
// This module performs ZERO network/disk/log I/O — it holds in-process state
// and emits in-process events only.

import { EventEmitter } from "node:events";
import type { DesiredAtemBusState } from "./events.js";
```
> For `configStore.ts` the header should state the opposite and the constraint:
> "The ONLY module in the codebase that touches disk (lowdb/steno + `node:fs`).
> `core/` stays pure — no fs import may appear under `src/core/`. Total-function boot
> (D-11/D-12): missing/corrupt config degrades to safe defaults, never throws out of
> boot — mirrors the resolver's total-function stance."

**ESM import-extension convention** (load-bearing — `tsconfig` has `verbatimModuleSyntax`
+ NodeNext): intra-repo imports use the **`.js` extension** and `import type` for
type-only imports, exactly as `tallyState.ts:11` (`from "./events.js"`). So
`configStore.ts` imports `from "./schema.js"`; library imports use subpaths
(`from "lowdb"`, `from "lowdb/node"`, `from "node:fs/promises"`).

**Total-function boot, save-gate, CRUD** — NO in-repo analog (first persistence code).
Use RESEARCH.md verbatim: Pattern 1 (`loadConfig` — missing→defaults D-11,
corrupt/schema-invalid→quarantine+loud-log+defaults D-12), Pattern 2 (`saveConfig` —
`safeParse` FIRST, reject without touching `db.data` on failure D-10, `db.data =
parsed.data; await db.write()` on success → steno temp+rename SC4). The total-function
*stance* is the transferable pattern from `core/`; the lowdb mechanics are research-sourced.

---

### `src/config/schema.test.ts` (test, unit)

**Analog:** `src/core/resolver.test.ts` — exact test idiom.

**Imports + describe/it/expect structure** (`resolver.test.ts:1-18`):
```typescript
// Exhaustive resolver test suite: one test per precedence tier and edge case.
// Run: npx vitest run src/core/resolver.test.ts
import { describe, it, expect } from "vitest";
import { resolve } from "./resolver.js";
import type { MappingEntry, OverrideEntry } from "./resolver.js";

const baseMapping: MappingEntry[] = [
  { vmixInput: 1, atemSource: 1, cameraId: "camA" },
  { vmixInput: 2, atemSource: 2, cameraId: "camB" },
  ...
];
```
**Conventions to copy:**
- File-top comment naming the suite + the `npx vitest run <path>` command.
- `import ... from "vitest"`; named-export imports from the SUT with the `.js` extension; `import type` for types.
- Top-of-file shared fixtures (e.g. a `baseMapping`-style valid `PersistedConfig` to mutate per test).
- One `describe` per requirement/decision, one `it` per case, named with the ID prefix (`"D-07: duplicate vmixKey rejected with element path"`, `"MAP-01: 9th entry rejected"`) — matches the `"SC1: ..."` / `"SC2: ..."` naming in `resolver.test.ts:28,61`.
- Whole-object assertions with `expect(result).toEqual({...})` (`resolver.test.ts:30-34`) — for schema tests, assert on `safeParse` `.success` and on `issues[].path` arrays.

**Required cases** (RESEARCH §Validation Architecture): uniqueness D-07 (×3 keys, each
asserting `["mapping", <i>, <field>]` path), ≤8 cap D-09, `atemSource>8` allowed D-09,
partial/empty mapping D-08, alignment-with-`coerceMapping` drift test.

---

### `src/config/configStore.test.ts` (test, integration — file-I/O)

**Analog:** `src/core/resolver.test.ts` for the vitest idiom (same imports, naming,
`toEqual` shape). The **temp-dir filesystem setup** has NO in-repo analog (the existing
suite is pure, zero I/O).

**Idiom to copy** — same as `schema.test.ts` above (vitest imports, ID-prefixed `it`
names, file-top run command, `structuredClone` for before/after snapshots as in
`resolver.test.ts:70-79`).

**No analog for:** per-test temp directory (`node:os.tmpdir()` + unique subdir,
cleanup in `afterEach`), so the real `config.json` is never touched. Use RESEARCH
§Validation Architecture "Wave 0 Gaps" + "Atomic-write test approach". Required cases:
round-trip CFG-01/02, reorder-survives-by-Key SC1, missing-file D-11, corrupt +
schema-invalid quarantine D-12 (assert the loud-log via an injected logger spy),
reject-whole-save D-10 (assert disk byte-identical after rejected save), atomic-write SC4.

## Shared Patterns

### Strict-TS ESM module conventions
**Source:** `tsconfig.json` + every file in `src/core/`
**Apply to:** all four new files
- `tsconfig`: `strict`, `module: NodeNext`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noImplicitOverride`. `rootDir: src`.
- Intra-repo imports carry the **`.js` extension** (`from "./schema.js"`) — required by NodeNext + `verbatimModuleSyntax`.
- Type-only imports use `import type { ... }` (e.g. `resolver.test.ts:7`, `tallyState.ts:11`) — `verbatimModuleSyntax` enforces this.
- `noUncheckedIndexedAccess` means array/record index access is `T | undefined` — handle the `undefined` branch explicitly (the resolver does this at `resolver.ts:197-198`). Relevant when the store reads `db.data` fields.
- Package is `"type": "module"`, `engines.node >= 22` — lowdb 7 ESM-only fits cleanly (D-06).

### Total-function / defensive stance (carried from Phase 1)
**Source:** `src/core/resolver.ts:1-4` (header), `:79-91` (`coerceMapping`)
**Apply to:** `schema.ts` (validate-don't-trust) and `configStore.ts` (boot never throws)
Bad/missing/adversarial input is coerced to a safe default, never throws. The store's
D-11/D-12 boot behavior is the persistence-layer expression of this same stance
(degrade to empty defaults + quarantine, never crash the process).

### `core/` purity boundary (MUST NOT violate)
**Source:** ARCHITECTURE.md §"Structure Rationale" + RESEARCH §"Anti-Patterns to Avoid"
**Apply to:** `configStore.ts`, `schema.ts`
- `config/` is the ONLY module that touches disk. **No `node:fs` import may appear under `src/core/`.**
- `config/` MUST NOT import or modify `src/core/resolver.ts` (D-03). The `PersistedMappingEntry` is intentionally a different type from the resolver's `MappingEntry`; they overlap only on `atemSource`/`cameraId`.
- The vMix `Key → positional vmixInput` translation belongs to Phase 3 ingest, NOT here.

### vitest test idiom
**Source:** `src/core/resolver.test.ts:1-18`; tests live as `src/**/*.test.ts`
**Apply to:** both new test files
File-top suite comment + run command; `import { describe, it, expect } from "vitest"`;
SUT imports with `.js`; top-of-file shared fixtures; ID-prefixed `it` names; whole-object
`toEqual` assertions; `structuredClone` for mutation/no-mutation checks.

## No Analog Found

These have no in-repo precedent (greenfield persistence layer) — planner/executor must
use RESEARCH.md, not a codebase copy-source:

| Concern | File | Source to use instead |
|---------|------|-----------------------|
| lowdb `Low`+`JSONFile` load/write wiring | `configStore.ts` | RESEARCH Pattern 1 + §Standard Stack (`lowdb/node` subpath, `db.read()`/`db.write()`) |
| Missing→defaults / corrupt→quarantine boot | `configStore.ts` | RESEARCH Pattern 1 + Pitfall 3 (schema-invalid treated as corrupt) |
| Validate-before-write atomic save | `configStore.ts` | RESEARCH Pattern 2 (`safeParse` before `db.data` assignment) |
| zod schema + 3× `.superRefine` uniqueness + `.max(8)` | `schema.ts` | RESEARCH Pattern 3 (element-pathed issues `["mapping", i, field]`) |
| `ConfigValidationError` via `z.treeifyError` | `schema.ts` | RESEARCH Pattern 4 (top-level helpers; `.format()`/`.flatten()` deprecated in zod 4) |
| Quarantine rename (`node:fs/promises` `rename` → `.bak-corrupt`) | `configStore.ts` | RESEARCH §Supporting libs + Pattern 1 |
| Injected logger for "log loudly" (D-12) | `configStore.ts` | RESEARCH §Supporting libs (A4 — injected `(msg) => void`, testable) |
| Per-test temp-dir filesystem setup | `configStore.test.ts` | RESEARCH §Validation Architecture "Wave 0 Gaps" (`os.tmpdir()` + unique subdir) |
| Atomic-write crash simulation | `configStore.test.ts` | RESEARCH §"Atomic-write test approach" (stub rename to throw; assert original intact) |

## Metadata

**Analog search scope:** entire `src/` tree (only `src/core/` exists), `tsconfig.json`, `package.json`, `.gitignore`, ARCHITECTURE.md, CONTEXT.md, RESEARCH.md.
**Files scanned:** `src/core/resolver.ts`, `src/core/resolver.test.ts`, `src/core/events.ts`, `src/core/tallyState.ts` (header), plus config/build files.
**Pattern extraction date:** 2026-06-29
**Note:** `lowdb`/`zod` are NOT yet installed (devDeps only show vitest/typescript/@types-node). Planner must include `npm install lowdb zod` as a setup step before tests run.
