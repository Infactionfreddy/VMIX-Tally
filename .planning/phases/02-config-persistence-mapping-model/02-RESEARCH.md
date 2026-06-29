# Phase 2: Config Persistence + Mapping Model - Research

**Researched:** 2026-06-29
**Domain:** Local config persistence (typed JSON file + atomic write) and schema/invariant validation for a Node.js ESM service
**Confidence:** HIGH (lowdb/steno atomicity verified against source; zod 4 error API verified against official docs; resolver contract read directly from source)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Each mapping entry anchors on the **vMix input Key (GUID)** as the single source of truth. The Key never changes; the Number shifts on reorder/add/delete. (Serves Phase 3 SC4.)
- **D-02:** The persisted entry **also carries the vMix Number and Title as human-readable hints** for the Phase 6 editor — but they are NOT the match key. Matching is by Key.
- **D-03 (KEYSTONE — researched below):** The resolver's current `MappingEntry` (`src/core/resolver.ts:31`) uses `vmixInput: number`, treated positionally against the tally array. The persisted Key-anchored model must reconcile with this contract without silently breaking the 62-test resolver suite. Evaluate: (a) persisted model carries `vmixKey`, Phase 3 ingest translates positional TALLY → Key → positional `vmixInput`; vs (b) evolve the resolver to consume Key.
- **D-04:** Use **lowdb 7 + zod**. lowdb gives a typed JSON file with atomic writes via `steno`. zod validates on load and before every save.
- **D-05 (researched below):** Confirm lowdb's adapter write is genuinely atomic (write-temp + rename, not in-place truncate) on the target OS (Windows). SC4 non-negotiable. Wrap with explicit atomic adapter if default does not guarantee it.
- **D-06:** lowdb 7 is ESM-only — fine, project is already `"type": "module"`. Factor ESM-only into later SEA/packaging notes.
- **D-07:** Enforce **uniqueness on all three keys**: no duplicate vMix Key, no duplicate ATEM source number, no duplicate cameraId.
- **D-08:** **Partial / incremental mappings are allowed** — fewer than 8 entries is valid; entries can be added one at a time.
- **D-09:** The **≤8 cap is on entry count (cameras)**, NOT on `atemSource`. `atemSource` validated only as a **positive integer** (matching the resolver's `atemSource > 0` guard).
- **D-10:** On any constraint violation, **reject the whole save atomically** (file never touched) and return a **structured, field-level error** the Phase 6 UI can surface. No partial document is ever persisted.
- **D-11:** **Missing file (first run):** start with safe **empty defaults** (no mapping, empty/unset settings) and write a fresh valid config file.
- **D-12:** **Corrupt / malformed file:** **quarantine** it (rename aside, e.g. `config.json.bak-corrupt`), **log loudly**, boot on empty defaults. Never silently overwrite the bad file.

### Claude's Discretion
- Exact zod schema layout, file/module names within `src/config/` (`configStore.ts`, `schema.ts` per ARCHITECTURE.md), precise CRUD surface shape (whole-document replace vs per-entry mutators) — as long as D-01..D-12 hold.
- Config file **path/location** (default to ARCHITECTURE.md's `config.json` at project root unless research surfaces a packaging reason to relocate).
- Whether to include a **schema `version` field** for future migrations (sensible to add cheaply, optional).
- Connection-settings validation depth (IP/host format, port range) beyond "well-formed string + valid port int" — researcher may recommend a sane standard.

### Deferred Ideas (OUT OF SCOPE)
- **Mapping import/export** (OPS-02, v2).
- **Live config hot-reload into running connections** (Phase 3/4/6).
- **Schema migration framework** (deferred until a real schema change exists, even if a `version` field is added now).
- **Connection-settings UI / mapping-editor UI** (Phase 6). Phase 2 exposes only the programmatic surface.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CFG-01 | vMix/ATEM connection settings (IP/port) persist across server restarts | lowdb 7 `JSONFilePreset`/`Low` + `JSONFile` adapter persists a typed `settings` object; zod validates host/port on load+save. See Standard Stack + Architecture Patterns. |
| CFG-02 | The input mapping persists across server restarts | Same store persists a `mapping` array; round-trip + reorder-survives-by-Key tests in Validation Architecture prove SC1/SC3. |
| MAP-01 | User can map each vMix input to an ATEM input/camera (≤8) | zod `mapping` array schema with `.max(8)` on entry count (D-09), three uniqueness invariants via `.superRefine` (D-07), partial allowed (D-08). CRUD surface exposes replace/mutate + structured validation errors (D-10). |
</phase_requirements>

## Summary

Phase 2 is the **single disk-touching layer**. It persists a `{ settings, mapping }` document via **lowdb 7** (a typed JSON file) and validates that document with **zod 4** on both load and save. The two genuinely hard questions — both flagged in CONTEXT — have clean, verified answers:

1. **Atomicity (D-05) is a confirmed library freebie, not an assumption.** lowdb 7 writes through **steno 4.0.2**, whose source writes to a temp file `.{name}.tmp` and then `fs.rename()`s it over the target — never an in-place truncate. This satisfies SC4's "crash mid-save never corrupts." The one caveat: `fs.rename` over an existing file is atomic on POSIX and *effectively* atomic on Windows/NTFS (via `MoveFileEx` semantics) but is **not crash-durable without `fsync`**, and steno does not `fsync`. For this tool's threat model (operator config edits, not high-frequency writes) that is acceptable — but the phase should still *test* atomicity rather than trust it, per CONTEXT §Specifics.

2. **The resolver seam (D-03) resolves decisively to approach (a): keep the persisted model and the resolver model distinct, bridged by a translation step that lives in the Phase 3 ingest layer — NOT in Phase 2 and NOT inside the resolver.** Evolving the resolver to consume Key (approach b) would rewrite the meaning of `vmixInput`, break the positional tally-indexing logic at `resolver.ts:197`, and churn the 62-test contract for zero Phase-2 benefit. Phase 2's persisted `MappingEntry` carries `vmixKey` (+ Number/Title hints) and `atemSource` + `cameraId`; it does **not** carry the resolver's positional `vmixInput`. Phase 3 owns the `vmixKey → current Number → positional vmixInput` projection at runtime. Phase 2 must NOT import or modify `src/core/resolver.ts`.

**Primary recommendation:** Build `src/config/schema.ts` (zod 4 schema + a derived `PersistedMappingEntry` type that is deliberately *different* from the resolver's `MappingEntry`) and `src/config/configStore.ts` (lowdb `Low`+`JSONFile`, defensive boot per D-11/D-12, validate-before-write per D-10 returning a structured `ConfigValidationError`). Reuse zod's `z.flattenError`/`z.treeifyError` to shape D-10 field-level errors for the Phase 6 UI. Do not let any `node:fs` import leak into `core/`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Persist `{settings, mapping}` to disk | `config/` (persistence) | — | ARCHITECTURE.md: `config/` is the ONLY disk-touching module. |
| Atomic write (temp+rename) | `config/` via lowdb→steno | — | Library-provided; store just calls `db.write()`. |
| Schema + invariant validation | `config/schema.ts` | — | Validation co-located with the persisted shape it guards. |
| Boot recovery (missing/corrupt) | `config/configStore.ts` | — | Total-function stance mirrors the resolver; degrade to defaults, never crash. |
| Translate vMix Key → positional tally index | **Phase 3 ingest** (NOT this phase) | — | D-03: Phase 2 defines the Key-anchored model; resolution is Phase 3's job. |
| Consume the in-memory mapping for tally resolution | `core/resolver.ts` (Phase 1) | — | Pure, positional; unchanged by this phase. |
| Edit mapping/settings via UI | Phase 6 web layer | `config/` CRUD surface | Phase 6 calls the programmatic surface this phase exposes. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `lowdb` | 7.0.1 | Typed JSON file store (load on boot, atomic write on change) | Project-locked (D-04, CLAUDE.md). ESM-only, zero native build step, hand-inspectable JSON — ideal for a ≤8-entry config. Writes atomically via steno. `[VERIFIED: npm registry — 7.0.1, slopcheck OK]` |
| `steno` | 4.0.2 (transitive dep of lowdb) | Atomic async file writer (temp + rename) | lowdb's write engine. **This is what delivers SC4.** Pulled in automatically by lowdb `^4.0.2`. `[VERIFIED: npm registry + source review]` |
| `zod` | 4.4.3 | Validate the persisted document on load + before every save; express the three uniqueness invariants and the ≤8 cap | Project-locked (D-04, CLAUDE.md). v4 ships `z.flattenError`/`z.treeifyError` for structured field-level errors (D-10). `[VERIFIED: npm registry — 4.4.3, slopcheck OK]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:fs` / `node:fs/promises` | built-in | Quarantine rename (D-12), existence checks | Only inside `config/configStore.ts`. Use `fs.rename()` for the corrupt-file aside. |
| `node:path` | built-in | Resolve the config file path | Compute `config.json` path relative to cwd / app root. |
| (logging) | — | "Log loudly" on quarantine (D-12) | CLAUDE.md lists `pino` for the eventual server. Phase 2 has no server yet — a `console.error` / injectable logger callback is sufficient and keeps the store dependency-free. Recommend an **injected logger function** so tests can assert the loud-log without a real logger. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| lowdb 7 | `better-sqlite3` 12.x | Native addon → harder Windows packaging; relational engine for one tiny JSON doc is overkill. Locked out by D-04 + CLAUDE.md "What NOT to Use". |
| lowdb default write | hand-rolled `write-file-atomic` | Unnecessary — lowdb already routes through steno (temp+rename). Adding `write-file-atomic` would duplicate the mechanism. Only consider if you need `fsync` durability (see Pitfall 2). |
| zod | hand-written validators | The resolver's `coerceMapping` is a hand validator and is fine for the *runtime hot path*, but the *persistence boundary* needs structured, field-pathed errors for the UI (D-10) — exactly zod's strength. Use both, at their own layers (see "Schema/type alignment" below). |

**Installation:**
```bash
npm install lowdb zod
```
(`steno` arrives transitively with lowdb; do not install it directly.)

**Version verification (run 2026-06-29):**
- `npm view lowdb version` → `7.0.1`; `dependencies` → `{ steno: '^4.0.2' }` `[VERIFIED]`
- `npm view steno version` → `4.0.2`; repo `github.com/typicode/steno` `[VERIFIED]`
- `npm view zod version` → `4.4.3` `[VERIFIED]`
- Node `v22.23.0` present, satisfies lowdb 7 ESM + project `engines.node >=22` `[VERIFIED]`

## Package Legitimacy Audit

slopcheck ran successfully (`slopcheck install lowdb zod`) and reported both clean. (Note: slopcheck performed a real `npm install` as a side effect; the resulting `node_modules`/`package-lock.json` were removed and `package.json` was restored to its committed state — the working tree is clean.)

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `lowdb` | npm | created 2014-04, modified 2025-03 | github.com/typicode/lowdb | [OK] | Approved (project-locked) |
| `zod` | npm | created 2020-03 | github.com/colinhacks/zod | [OK] | Approved (project-locked) |
| `steno` | npm | 4.0.2 | github.com/typicode/steno | [OK] (transitive) | Approved (lowdb dep) |

**Postinstall check:** `npm view {lowdb,zod,steno} scripts.postinstall` → none. No suspicious install scripts.
**Packages removed due to [SLOP]:** none.
**Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────┐
   boot ──────────▶  │  configStore.load()                         │
                     │  ┌───────────────────────────────────────┐  │
                     │  │ JSONFile.read()                        │  │
                     │  │   file missing? ──▶ null ──▶ DEFAULTS  │  │ (D-11)
                     │  │   JSON.parse SyntaxError? ──┐          │  │
                     │  └─────────────────────────────┼──────────┘  │
                     │           │ parsed object      │ (corrupt)   │
                     │           ▼                     ▼             │
                     │   schema.safeParse()     quarantine():       │ (D-12)
                     │     valid? ──▶ data       fs.rename → .bak    │
                     │     invalid? ──▶ quarantine + DEFAULTS + LOG  │
                     └───────────┬─────────────────────────────────┘
                                 │ in-memory { settings, mapping }
        ┌────────────────────────┼──────────────────────────────────┐
        │ (Phase 3 ingest)       │ (read-only consumers)            │
        ▼                        ▼                                  │
  vmixKey → Number → posIdx   resolver(tally, mapping*, overrides)  │
  *projected to resolver's MappingEntry shape — NOT persisted shape │
        └──────────────────────────────────────────────────────────┘

  UI edit (Phase 6) ─▶ configStore.save(candidate)
                          │
                          ▼
                  schema.safeParse(candidate)
                    invalid? ──▶ return ConfigValidationError (D-10) — DISK UNTOUCHED
                    valid?   ──▶ db.data = candidate; db.write()
                                   └─ steno: write .config.json.tmp ──▶ fs.rename ──▶ config.json  (SC4 atomic)
```

### Recommended Project Structure
```
src/
└── config/
    ├── schema.ts          # zod schema + PersistedConfig/PersistedMappingEntry types + invariant superRefine + ConfigValidationError
    ├── configStore.ts     # Low+JSONFile wrapper: load (D-11/D-12), save (D-10), CRUD surface
    ├── schema.test.ts     # invariant + boundary tests (uniqueness, ≤8, partial, atemSource>0)
    └── configStore.test.ts# round-trip, reorder-survives-by-Key, missing-file, corrupt-file, atomic-write tests
config.json                # persisted document (gitignored; created on first boot)
```
> `core/` is untouched. No `node:fs` import may appear under `src/core/`.

### Pattern 1: lowdb load with defensive boot (D-11 / D-12)
**What:** Wrap `db.read()` so a missing file yields defaults (clean) and a corrupt file is quarantined then defaulted (loud).
**When to use:** Always, on boot — this is the total-function stance carried from the resolver.
**Verified facts driving this pattern:**
- `JSONFile.read()` returns `null` when the file is **missing** (ENOENT caught in steno's `TextFile.read`) — so `db.data` becomes the constructor default. `[CITED: github.com/typicode/lowdb TextFile.ts]`
- `JSONFile.read()` **propagates `SyntaxError`** when the file exists but is invalid JSON (the `JSON.parse` is not guarded). So a corrupt file *throws* out of `db.read()` and must be caught. `[CITED: lowdb JSONFile/TextFile source]`

```typescript
// configStore.ts (illustrative; ASSUMED exact lowdb call shapes verified against README)
import { Low } from "lowdb";           // [CITED: lowdb v7 README]
import { JSONFile } from "lowdb/node"; // [CITED: lowdb v7 README — ESM 'lowdb/node' subpath]
import { rename } from "node:fs/promises";
import { schema, type PersistedConfig } from "./schema.js";

const DEFAULTS: PersistedConfig = { settings: { vmix: null, atem: null }, mapping: [] };

export async function loadConfig(path: string, log: (msg: string) => void) {
  const db = new Low<unknown>(new JSONFile(path), structuredClone(DEFAULTS));
  let raw: unknown;
  try {
    await db.read();          // null on missing → db.data stays DEFAULTS (D-11)
    raw = db.data;
  } catch (err) {             // SyntaxError on corrupt JSON (D-12)
    await rename(path, `${path}.bak-corrupt`).catch(() => {});
    log(`[config] CORRUPT config at ${path}; quarantined to ${path}.bak-corrupt; booting on defaults. ${String(err)}`);
    return { db: rebindWithDefaults(path), data: structuredClone(DEFAULTS) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {      // structurally-valid JSON but schema-invalid → also quarantine (D-12)
    await rename(path, `${path}.bak-corrupt`).catch(() => {});
    log(`[config] INVALID config at ${path}; quarantined; booting on defaults.`);
    return { db: rebindWithDefaults(path), data: structuredClone(DEFAULTS) };
  }
  return { db, data: parsed.data };
}
```
> Note: when the missing-file path produces defaults, the store should **write a fresh valid file** (D-11) — call `db.write()` once after establishing defaults so the operator sees a `config.json`.

### Pattern 2: validate-before-write atomic save (D-10)
**What:** Never assign `db.data` from an unvalidated candidate. `safeParse` first; on failure return a structured error and leave disk untouched; on success assign and `db.write()`.
**When to use:** Every save/CRUD mutation.
```typescript
export async function saveConfig(db: Low<PersistedConfig>, candidate: unknown):
  Promise<{ ok: true } | { ok: false; error: ConfigValidationError }> {
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: toConfigValidationError(parsed.error) }; // D-10: disk untouched
  }
  db.data = parsed.data;
  await db.write();   // steno: temp + rename = atomic (SC4)
  return { ok: true };
}
```

### Pattern 3: zod schema with three uniqueness invariants + ≤8 cap (D-07/D-09)
**What:** Per-entry validation via object schema; cross-entry uniqueness via `.superRefine` that pushes issues at the *offending element's path* so the UI can highlight the exact row/field.
**When to use:** The schema definition.
```typescript
// schema.ts
import { z } from "zod";  // [CITED: zod v4 — top-level z.* error helpers]

const mappingEntry = z.object({
  vmixKey:    z.string().min(1),                 // D-01 GUID — match key
  vmixNumber: z.number().int().positive().optional(),  // D-02 hint, not match key
  vmixTitle:  z.string().optional(),                   // D-02 hint
  atemSource: z.number().int().positive(),       // D-09: positive int only, NOT capped at 8
  cameraId:   z.string().min(1),                 // aligns with resolver's non-empty cameraId guard
});

const connection = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
}).nullable();   // D-11: unset is valid on first boot

export const schema = z.object({
  version: z.literal(1).optional(),              // Claude's discretion: cheap future-migration anchor
  settings: z.object({ vmix: connection, atem: connection }),
  mapping: z.array(mappingEntry).max(8),         // D-09: ≤8 ENTRIES (cameras), D-08: fewer is valid
}).superRefine((cfg, ctx) => {
  // D-07: three uniqueness checks, each reporting the duplicate element's path
  const dupCheck = (key: "vmixKey" | "atemSource" | "cameraId") => {
    const seen = new Map<unknown, number>();
    cfg.mapping.forEach((e, i) => {
      const v = e[key];
      if (seen.has(v)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate ${key}: ${String(v)}`,
          path: ["mapping", i, key],            // [VERIFIED: zod v4 array path = ['mapping', <index>, <field>]]
        });
      } else seen.set(v, i);
    });
  };
  dupCheck("vmixKey");
  dupCheck("atemSource");
  dupCheck("cameraId");
});

export type PersistedConfig = z.infer<typeof schema>;
export type PersistedMappingEntry = z.infer<typeof mappingEntry>;
```
> `ctx.addIssue({ code: "custom", path: [...] })` with a numeric array index is the verified v4 mechanism for element-scoped errors. `[CITED: zod.dev/error-customization + error-formatting (path shape ['mapping', 2, 'cameraId'])]`

### Pattern 4: structured field-level error for the Phase 6 UI (D-10)
**What:** Convert a `ZodError` into a stable, UI-consumable shape. zod v4 deprecated `error.format()`/`error.flatten()` in favor of **top-level** `z.flattenError(err)` (flat schemas) and `z.treeifyError(err)` (nested). For a mapping *array*, the tree form preserves per-index paths.
```typescript
import { z } from "zod";
export interface ConfigValidationError {
  kind: "config-validation";
  issues: Array<{ path: (string | number)[]; message: string; code: string }>;
  tree: ReturnType<typeof z.treeifyError>;  // structured for nested array rendering
}
function toConfigValidationError(err: z.ZodError): ConfigValidationError {
  return {
    kind: "config-validation",
    issues: err.issues.map((i) => ({ path: i.path, message: i.message, code: i.code })),
    tree: z.treeifyError(err),
  };
}
```
> Design the error with the Phase 6 editor as the consumer (CONTEXT §Specifics): `issues[].path` lets the UI map an error to a specific row+field (e.g. `["mapping", 2, "atemSource"]` → row 3, ATEM-source field). `[CITED: zod.dev/error-formatting — treeifyError/flattenError; .format/.flatten deprecated in v4]`

### Anti-Patterns to Avoid
- **Importing or editing `src/core/resolver.ts` from `config/`** — violates the disk/pure boundary and the D-03 decision. The persisted shape must NOT replace the resolver's `MappingEntry`.
- **Persisting the resolver's positional `vmixInput`** — it is volatile (shifts on vMix reorder), which is exactly what D-01 exists to avoid. Persist `vmixKey`; let Phase 3 derive the position.
- **Assigning `db.data` before validating** — defeats D-10 (a half-valid doc could reach `db.write()`).
- **Catching the corrupt-file error and overwriting silently** — D-12 requires quarantine + loud log so the operator can recover.
- **Adding `write-file-atomic` on top of lowdb** — duplicates steno's temp+rename; only justified if you specifically need `fsync` durability (Pitfall 2).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Atomic file write (no torn writes) | Custom `writeFile` + manual `.tmp` + rename | lowdb → steno (built-in) | steno already does temp-write + `fs.rename`, plus write-coalescing. Re-implementing risks subtle ordering bugs. |
| JSON load with missing-file tolerance | `try/catch existsSync` dance | lowdb `JSONFile.read()` → `null` on ENOENT | Library returns `null` cleanly; you only add the corrupt-JSON catch (D-12). |
| Field-level validation errors for a UI | Manual error-path bookkeeping | zod `safeParse` + `z.treeifyError` | zod tracks `path` per issue including array indices — exactly the D-10 shape. |
| Uniqueness / range invariants | Imperative loops scattered in the store | zod `.superRefine` + `.max(8)` | Co-locates all invariants with the schema; one validation entry point. |

**Key insight:** Every "hard" part of this phase (atomicity, missing/corrupt tolerance, structured errors) is already provided by the locked stack. The phase's real work is **wiring + the D-03 boundary decision + tests that prove the freebies**, not building infrastructure.

## D-03 Resolver Reconciliation Seam (KEYSTONE — full analysis)

**Decision: approach (a). Keep two distinct models; translate in Phase 3.**

### The mismatch
- Resolver `MappingEntry` (`src/core/resolver.ts:31`): `{ vmixInput: number; atemSource: number; cameraId: string }`. `vmixInput` is used **positionally**: `safeTally[entry.vmixInput - 1]` (`resolver.ts:197`). It is an index into the live tally array.
- Persisted entry (D-01): anchored on `vmixKey` (GUID, stable) + Number/Title hints (D-02). It deliberately does **not** know a runtime tally position — the position only exists when a live vMix roster is present (Phase 3).

### Approach (a) — persisted carries `vmixKey`; Phase 3 ingest translates  ✅ RECOMMENDED
- **Persisted model:** `{ vmixKey, vmixNumber?, vmixTitle?, atemSource, cameraId }`.
- **Runtime translation (Phase 3, NOT this phase):** vMix's live state gives `Key → current Number`. Phase 3 projects each persisted entry to a resolver `MappingEntry` by resolving `vmixKey → current Number → positional vmixInput`, then calls `resolve(tally, projectedMapping, overrides)`.
- **Impact on the 62-test resolver contract:** **ZERO.** `resolver.ts` and its tests are untouched. The resolver keeps consuming positional `vmixInput`; Phase 3 feeds it the projection.
- **Where translation lives:** the Phase 3 ingest/connector boundary (a small `projectMapping(persisted, vmixRoster) → Mapping` mapper). Phase 2 only defines the persisted shape and exports it.

### Approach (b) — evolve the resolver to consume Key  ❌ REJECTED
- Would require `MappingEntry.vmixInput: number` to become `vmixKey: string`, and the positional lookup at `resolver.ts:197` to be re-architected (the resolver would need the live Key→position map, dragging roster knowledge into the pure core).
- **Impact on the 62-test contract:** **large** — every test constructs mappings with `vmixInput` integers and asserts positional tally behavior (e.g. `resolver.test.ts` builds `{ vmixInput: 1, atemSource: 1, ... }`). Changing the field breaks construction and the positional semantics across the suite.
- Pulls vMix-roster concerns into `core/`, violating "core knows nothing about sockets/protocol."
- **No Phase-2 benefit:** persistence works identically either way.

### Consequence for Phase 2
- The Phase 2 persisted `MappingEntry` is **intentionally a different type** from the resolver's `MappingEntry`. Name it distinctly (e.g. `PersistedMappingEntry`) to prevent accidental conflation. They overlap on `atemSource` and `cameraId` but differ on the vMix anchor (`vmixKey` vs `vmixInput`).
- Phase 2 must not import `resolver.ts`. The shared invariants it *does* mirror (`atemSource` positive int, non-empty `cameraId`) are re-expressed in zod — see next section.

## Schema/Type Alignment With the Resolver (avoid drift)

The resolver's `coerceMapping` (`resolver.ts:79–91`) enforces, at the runtime hot path: `vmixInput` safe non-neg int, `atemSource` safe int **> 0**, `cameraId` non-empty string. These are a **defensive last line** and must stay (D-13 total-function stance).

The Phase 2 zod schema is the **upstream gate** at the persistence boundary. Recommended alignment without coupling:
- **Shared invariants to mirror in zod:** `atemSource` = `z.number().int().positive()` (matches `atemSource > 0`); `cameraId` = `z.string().min(1)` (matches non-empty). Document in a comment that these mirror `coerceMapping` so a reader knows the two layers are intentionally redundant, not accidentally duplicated.
- **Do NOT try to derive zod from the resolver types** (they describe different fields — `vmixKey` vs `vmixInput`). A shared TS type would force one model onto the other, re-introducing the D-03 problem. Keep them separate; keep the overlap honest via a comment + a small alignment test.
- **Alignment test (recommended):** a unit test asserting that any `PersistedMappingEntry` accepted by the zod schema, once projected to the resolver shape (atemSource/cameraId carried through), passes `coerceMapping` (i.e. the persistence gate is at least as strict as the runtime gate on the shared fields). This catches drift if either side loosens.

## Runtime State Inventory

> This is a greenfield persistence phase (no rename/refactor). Inventory included only to confirm there is no hidden runtime state to migrate.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `config.json` does not yet exist (created on first boot, D-11). No prior schema to migrate. | none |
| Live service config | None — no vMix/ATEM connection exists yet (Phase 3/4). | none |
| OS-registered state | None — no service/scheduler registration in this phase (PKG-01 is v2). | none |
| Secrets/env vars | None — config holds plain IP/port; no auth (REQUIREMENTS "Out of Scope"). | none |
| Build artifacts | None — no build/dist step; pure source + vitest (CLAUDE.md). | none |

**Nothing found in any category — verified against project state (no `config.json` present, no Phase 3/4 connectors yet).**

## Common Pitfalls

### Pitfall 1: Assuming `fs.rename` over an existing file is crash-DURABLE
**What goes wrong:** `fs.rename` is *atomic with respect to readers* (a reader sees old-or-new, never a torn file) but does **not** guarantee the new data is flushed to physical disk before the rename if no `fsync` is issued. steno does temp-write + rename but does **not** `fsync` the temp file or the directory.
**Why it happens:** Atomicity (no torn file) and durability (survives power loss) are different guarantees. SC4 says "crash mid-save never corrupts" — temp+rename satisfies the *corruption* requirement (you keep the old valid file if the new write is incomplete). It does NOT guarantee the *newest* write survives a power loss.
**How to avoid:** For this tool's threat model (operator edits config occasionally; a lost last-edit on a power cut is recoverable by re-editing) the default is acceptable — document this explicitly. If stronger durability is ever required, wrap with `write-file-atomic` (which fsyncs) — but that is **not** needed for SC4 as worded.
**Warning signs:** Conflating "atomic" with "durable" in the plan's success-criteria wording.

### Pitfall 2: Windows `fs.rename` overwrite semantics
**What goes wrong:** On POSIX, `rename()` over an existing target is atomic and well-defined. On Windows, an overwriting rename historically required `ReplaceFile`/`MoveFileEx`; bare `rename` could fail if the target exists. Node's libuv maps `fs.rename` to the Windows API that **does** overwrite, and it is effectively atomic on NTFS — but transient `EPERM`/`EBUSY` can occur if the target is held open (e.g. antivirus, another reader).
**Why it happens:** Windows is the production OS (vMix is Windows-only). steno relies on Node's `fs.rename` overwrite behavior.
**How to avoid:** Don't keep the config file handle open for reading across a write. lowdb reads fully then closes, so this is satisfied by default. If `EPERM`/`EBUSY` surfaces under AV, a short retry on `db.write()` is the standard mitigation — note for Phase 5/packaging, not required for Phase 2 correctness.
**Warning signs:** Intermittent write failures only on the Windows production box, never in dev/CI on macOS/Linux.

### Pitfall 3: Quarantining only on JSON-syntax errors, missing schema-invalid files
**What goes wrong:** A file that is *valid JSON* but *schema-invalid* (e.g. hand-edited to have a duplicate cameraId, or `atemSource: -1`) does NOT throw from `db.read()` — it parses fine. If you only catch `SyntaxError`, such a file silently passes through.
**Why it happens:** lowdb's `JSON.parse` only throws on malformed JSON, not on schema violations.
**How to avoid:** Run `schema.safeParse` after `db.read()` and treat `!success` the **same as corrupt** (quarantine + defaults + loud log) — see Pattern 1. "Corrupt" in D-12 means "not a valid config," which includes schema-invalid.
**Warning signs:** Boot succeeds on a clearly-broken hand-edited file.

### Pitfall 4: Persisting volatile vMix Number as the anchor
**What goes wrong:** Using `vmixNumber` (or the resolver's `vmixInput`) as the match key means a vMix reorder/add/delete re-points the mapping to the wrong camera — the exact failure D-01 exists to prevent (Phase 3 SC4).
**How to avoid:** Anchor on `vmixKey` (GUID); carry Number/Title as display-only hints (D-02). The reorder-survives-by-Key test (below) guards this.
**Warning signs:** A test that reorders vMix Numbers and finds the mapping now resolves to a different camera.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| zod `error.format()` / `error.flatten()` (instance methods) | Top-level `z.treeifyError(err)` / `z.flattenError(err)` | zod v4 (2025) | Use the top-level helpers; the instance methods are deprecated in v4. Affects D-10 error shaping. |
| lowdb v1–v2 sync `db.get(...).write()` (lodash chain) | lowdb v3+ plain `db.data` + `await db.write()`; v7 ESM-only, `lowdb/node` subpath for `JSONFile` | v7 (current) | Import `JSONFile` from `lowdb/node`, not `lowdb`. ESM-only — fine here (`"type": "module"`). |

**Deprecated/outdated:**
- `ZodError.prototype.format/flatten` → prefer `z.treeifyError` / `z.flattenError`.
- Any lowdb tutorial using `db.get('x').push().write()` lodash syntax — that's pre-v3 and does not apply.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact lowdb v7 call shapes (`new Low(new JSONFile(path), defaults)`, `db.read()`, `db.write()`, `lowdb/node` subpath) match README; minor signature drift possible | Standard Stack / Pattern 1 | Low — verified against v7 README; a wrong import path is caught immediately by `tsc`/first run. |
| A2 | `fs.rename` overwrite is effectively atomic on Windows/NTFS via libuv; transient EPERM under AV is the only realistic failure | Pitfall 2 | Low-Med — well-documented; if AV interference is common on the prod box, a retry wrapper may be needed (Phase 5 concern). |
| A3 | steno does not `fsync` (durability gap), based on source review showing only writeFile+rename | Pitfall 1 | Low — read from steno source; even if wrong, erring toward "test atomicity explicitly" is safe. |
| A4 | `console.error`/injected-logger is sufficient for D-12 "log loudly" (no `pino` yet in Phase 2) | Supporting libs | Low — Claude's-discretion area; an injected logger keeps the store testable and dependency-free. |
| A5 | Adding an optional `version: 1` field now is harmless and future-proofs migrations | Pattern 3 | Low — explicitly Claude's discretion (D); `.optional()` means old files without it still validate. |

## Open Questions (RESOLVED)

1. **Config file location** (Claude's discretion in CONTEXT)
   - What we know: ARCHITECTURE.md specifies `config.json` at project root (cwd).
   - What's unclear: Whether Windows-service packaging (PKG-01, v2) will need an app-data dir (cwd of a service is unpredictable).
   - Recommendation: Default to a configurable path with `config.json` (cwd) as the default for Phase 2; make the path a constructor argument so Phase 5/packaging can relocate it without a code change. Add `config.json` and `config.json.bak-corrupt` to `.gitignore`.

2. **Whether `db.update()` or explicit `db.data = …; db.write()` is the CRUD primitive**
   - What we know: lowdb offers both; `db.update(fn)` mutates+writes in one call.
   - What's unclear: Whether the validate-before-write gate (D-10) is cleaner with explicit assignment.
   - Recommendation: Use explicit `safeParse → db.data = parsed.data → db.write()` (Pattern 2), NOT `db.update()`, because D-10 requires validating a *candidate* and rejecting without touching `db.data`. `db.update()` mutates before you can reject.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime + ESM + `node:fs` | ✓ | v22.23.0 | — |
| npm | install lowdb/zod | ✓ | (bundled with Node 22) | — |
| `lowdb` | persistence | ✗ (not yet installed) | target 7.0.1 | none — must `npm install lowdb` |
| `zod` | validation | ✗ (not yet installed) | target 4.4.3 | none — must `npm install zod` |
| `vitest` | tests | ✓ (devDep `^3`) | per package.json | — |
| `tsc` | typecheck | ✓ (devDep `^5`) | per package.json | — |

**Missing dependencies with no fallback:** `lowdb`, `zod` — both project-locked (D-04); install via `npm install lowdb zod`. Confirmed legitimate (slopcheck OK) and version-verified on npm.
**Missing dependencies with fallback:** none.

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest `^3` (already configured; Phase 1 has 40 `it()` blocks in resolver.test.ts alone, 62 across the suite) |
| Config file | none separate — vitest default; tests live as `src/**/*.test.ts` (CLAUDE.md: vitest scoped to `src/`) |
| Quick run command | `npm run test` (`vitest run`) |
| Full suite command | `npm run test` + `npm run typecheck` (`tsc --noEmit`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CFG-01 | settings survive a save→reload round-trip | integration | `npx vitest run src/config/configStore.test.ts -t "settings round-trip"` | ❌ Wave 0 |
| CFG-02 | mapping survives a save→reload round-trip intact | integration | `npx vitest run src/config/configStore.test.ts -t "mapping round-trip"` | ❌ Wave 0 |
| MAP-01 | ≤8 entries accepted; 9th rejected (entry count cap, D-09) | unit | `npx vitest run src/config/schema.test.ts -t "max 8 entries"` | ❌ Wave 0 |
| MAP-01 | `atemSource` may exceed 8 (positive int only, D-09) | unit | `npx vitest run src/config/schema.test.ts -t "atemSource > 8 allowed"` | ❌ Wave 0 |
| D-07 | duplicate vMix Key / ATEM source / cameraId each rejected with element-pathed error | unit | `npx vitest run src/config/schema.test.ts -t "uniqueness"` | ❌ Wave 0 |
| D-08 | partial mapping (<8 entries, even 0) is valid | unit | `npx vitest run src/config/schema.test.ts -t "partial mapping"` | ❌ Wave 0 |
| D-10 | invalid save returns structured field-level error AND disk is untouched | integration | `npx vitest run src/config/configStore.test.ts -t "reject-whole-save"` | ❌ Wave 0 |
| D-11 | missing file → defaults + fresh file written, no throw | integration | `npx vitest run src/config/configStore.test.ts -t "missing file"` | ❌ Wave 0 |
| D-12 | corrupt JSON AND schema-invalid file → quarantined + defaults + loud log, no throw | integration | `npx vitest run src/config/configStore.test.ts -t "corrupt file quarantine"` | ❌ Wave 0 |
| SC1/SC4 | reorder vMix Number; entry still resolves to same camera by Key | integration | `npx vitest run src/config/configStore.test.ts -t "reorder survives by Key"` | ❌ Wave 0 |
| SC4 | crash-mid-save never corrupts: existing file remains valid if write interrupted | integration | `npx vitest run src/config/configStore.test.ts -t "atomic write"` | ❌ Wave 0 |
| (drift) | persistence gate ≥ as strict as resolver `coerceMapping` on shared fields | unit | `npx vitest run src/config/schema.test.ts -t "alignment with coerceMapping"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/config/` (the new config tests only)
- **Per wave merge:** `npm run test` (full suite — confirms the 62 resolver tests still green; D-03 guarantees they are untouched)
- **Phase gate:** `npm run test && npm run typecheck` green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/config/schema.test.ts` — invariants (uniqueness D-07, ≤8 cap D-09, partial D-08, atemSource>0, alignment with coerceMapping)
- [ ] `src/config/configStore.test.ts` — round-trip (CFG-01/02), reorder-by-Key (SC1), missing-file (D-11), corrupt+schema-invalid quarantine (D-12), reject-whole-save (D-10), atomic-write (SC4). Use a temp dir (e.g. `node:os.tmpdir()` + unique subdir) per test; never touch the real `config.json`.
- [ ] Framework install: none (vitest present). **Dependency install required:** `npm install lowdb zod` before tests can run.

**Atomic-write test approach:** Write a valid config; begin a save with deliberately oversized data; assert that the temp file path (`.config.json.tmp`) is the write target and that interrupting before rename leaves the original `config.json` byte-identical and still schema-valid. Simplest robust assertion: after a normal `db.write()`, verify no `.tmp` residue remains and the file parses+validates; for the crash simulation, assert the pre-write file content is preserved when a write is aborted (mock/stub the rename step to throw and confirm the original is intact).

## Security Domain

> `security_enforcement` not present in config.json → treated as enabled. This phase has a narrow surface (local file I/O, no network, no auth — auth is explicitly Out of Scope in REQUIREMENTS).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — co-located LAN tool, no accounts (REQUIREMENTS Out of Scope). |
| V3 Session Management | no | N/A — no sessions in this phase. |
| V4 Access Control | no | N/A — local file, no multi-user. |
| V5 Input Validation | **yes** | zod schema validates the persisted document on load AND save (D-10). Hand-edited/corrupt files are rejected, not trusted. |
| V6 Cryptography | no | Config holds plain IP/port; no secrets stored (no auth). No crypto to hand-roll. |
| V12 File & Resources | **yes** | Config path is a fixed/configured location, not user-supplied at runtime; quarantine rename writes a sibling `.bak-corrupt` (no path traversal from external input). |

### Known Threat Patterns for {Node ESM local-file config}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/corrupt config crashes the process | Denial of Service | Total-function boot (D-11/D-12): catch + quarantine + defaults, never throw out of boot. |
| Hand-edited config injects invalid invariants (dup cameraId, negative atemSource) | Tampering | zod `safeParse` on load (Pitfall 3) — schema-invalid treated as corrupt. |
| Torn write corrupts config on crash | Tampering / Availability | steno temp+rename atomic write (SC4); verified, not assumed. |
| Path traversal via config location | Tampering | Path is code-controlled (cwd default / injected), not derived from external untrusted input. |

## Sources

### Primary (HIGH confidence)
- lowdb v7 README (github.com/typicode/lowdb) — `JSONFilePreset`, `Low`+`JSONFile`, `lowdb/node` subpath, `db.read()`/`db.write()` async, default-data arg, `null` on missing file. `[CITED]`
- lowdb/steno `TextFile.ts` + `index.ts` source (github.com/typicode/steno) — temp-file `.{name}.tmp` write + `fs.rename`, no fsync, write-coalescing, ENOENT→null, SyntaxError propagation. `[VERIFIED: source review]`
- zod v4 docs — `zod.dev/error-formatting` (treeifyError/flattenError, deprecation of .format/.flatten, array path shape `['mapping', 2, 'cameraId']`) and `zod.dev/error-customization` (ctx.addIssue custom path). `[CITED]`
- npm registry — `lowdb 7.0.1` (deps steno ^4.0.2), `steno 4.0.2`, `zod 4.4.3`; no postinstall scripts. `[VERIFIED: npm view]`
- slopcheck — `lowdb`, `zod` both `[OK]`. `[VERIFIED]`
- `src/core/resolver.ts` + `src/core/events.ts` (read directly) — `MappingEntry`/`coerceMapping` shape, positional `vmixInput` indexing at line 197, `atemSource > 0` + non-empty cameraId guards. `[VERIFIED: source]`
- `tsconfig.json` (read) — strict, NodeNext, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. `[VERIFIED]`
- ARCHITECTURE.md §Config Store / §Recommended Project Structure — disk boundary, `config/` layout, atomic write. `[VERIFIED: project doc]`

### Secondary (MEDIUM confidence)
- WebSearch (Node `fs.rename` Windows ReplaceFile/MoveFileEx vs POSIX atomicity; node-fs-extra #835 "overwriting rename is not atomic"; HN threads) — cross-verified the Windows-atomicity + durability caveats (Pitfalls 1 & 2). `[MEDIUM — multiple sources agree on temp+rename atomicity-not-durability]`

### Tertiary (LOW confidence)
- None relied upon for load-bearing claims.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all three packages version-verified on npm, slopcheck-clean, project-locked.
- Atomicity (D-05): HIGH — read from steno source (temp+rename confirmed), durability caveat documented honestly.
- D-03 seam: HIGH — derived from reading the actual resolver source + its 62-test usage; approach (a) is unambiguous.
- zod error shaping (D-10): HIGH — verified against zod v4 official docs.
- Boot recovery (D-11/D-12): HIGH — lowdb missing→null and corrupt→throw confirmed from source.
- Windows rename caveats: MEDIUM — WebSearch-sourced, multiple agreeing references; not a blocker for SC4 as worded.

**Research date:** 2026-06-29
**Valid until:** ~2026-07-29 (stable stack; zod 4.x and lowdb 7.x are current major lines — re-verify versions if planning slips a month).
