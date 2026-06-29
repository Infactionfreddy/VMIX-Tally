# Phase 2: Config Persistence + Mapping Model - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

The single disk-touching layer. It persists two things across server restarts:

1. **Connection settings** — vMix host/port and ATEM IP/port (CFG-01).
2. **The input mapping** — each vMix input → ATEM input → camera identity, up to 8
   entries (MAP-01, CFG-02), anchored to a **stable vMix identity** rather than the
   volatile positional string offset (SC1).

It owns the config store: load on boot, validate, atomic write on change. `core/`
stays pure and never touches disk — the resolver consumes the in-memory mapping the
store produces.

**In scope:** the persisted config schema (settings + mapping), the lowdb-backed
store with atomic writes, zod validation + mapping invariants on save, defensive
boot behavior (missing/corrupt file), and a programmatic mapping/settings CRUD
surface the Phase 6 UI will later call.

**Out of scope (other phases):** the mapping-editor / connection-setup **UI**
(Phase 6), actually connecting to vMix (Phase 3) or ATEM (Phase 4), live config
reload semantics into a running connection (Phase 3/4/6), reconnect/resync
(Phase 5). This phase delivers the model + store + validation, not the network use
of them.

</domain>

<decisions>
## Implementation Decisions

### Identity Anchor (SC1 — the keystone)
- **D-01:** Each mapping entry anchors on the **vMix input Key (GUID)** as the
  single source of truth. The Key never changes for an input; the Number shifts on
  reorder/add/delete. This is what makes the mapping survive a vMix roster change
  and directly serves **Phase 3 SC4** ("add/delete a vMix input mid-session does
  not shift tally to the wrong camera").
- **D-02:** The persisted entry **also carries the vMix Number and Title as
  human-readable hints** (for display in the Phase 6 editor) — but they are NOT the
  match key. Matching is by Key.
- **D-03 (seam — flag for research):** The resolver's current `MappingEntry`
  ([src/core/resolver.ts:31](src/core/resolver.ts#L31)) uses `vmixInput: number`,
  which it treats positionally against the tally array. The persisted Key-anchored
  model must be reconciled with this contract. Two candidate approaches for the
  researcher/planner to evaluate: (a) persisted model carries `vmixKey`, and the
  Phase 3 ingest layer translates positional TALLY → Key → the resolver's
  positional `vmixInput` at runtime; or (b) evolve the resolver contract to consume
  Key. Do NOT silently break the existing 62-test resolver contract.

### Persistence Stack
- **D-04:** Use **lowdb 7 + zod**. lowdb gives a typed JSON file with atomic writes
  out of the box (via `steno`, write-temp-then-rename), satisfying SC4. zod
  validates the document on load and before every save.
- **D-05 (flag for research):** Confirm lowdb's adapter write is genuinely atomic
  (write-temp + rename, not in-place truncate) on the target OS. SC4 is
  non-negotiable — a crash mid-save must never corrupt the file. If lowdb's default
  adapter does not guarantee this, wrap it with an explicit atomic-write adapter.
- **D-06:** lowdb 7 is ESM-only — fine, the project is already `"type": "module"`
  (see [package.json](package.json)). Factor lowdb's ESM-only nature into any later
  SEA/packaging decisions (a STACK.md note).

### Mapping Invariants (validated on save)
- **D-07:** Enforce **uniqueness on all three keys**: no duplicate vMix Key, no
  duplicate ATEM source number, no duplicate cameraId. (Duplicate cameraId would
  collide in the resolver's per-camera state map; duplicate ATEM source would light
  the wrong/both cameras; one vMix input can't drive two cameras.)
- **D-08:** **Partial / incremental mappings are allowed** — fewer than 8 entries is
  valid, and entries can be added one at a time. The resolver already handles
  unmapped live inputs defensively (Phase 1 D-10). Not all 8 need to exist at once.
- **D-09:** The **≤8 cap is on entry count (cameras)**, NOT on the `atemSource`
  value. ATEM physical input numbers can exceed 8; `atemSource` is validated only as
  a **positive integer** (matching the resolver's existing `atemSource > 0` guard).
- **D-10:** On any constraint violation (duplicate, >8 entries, out-of-range value,
  malformed entry), **reject the whole save atomically** — the on-disk file is never
  touched — and return a **structured, field-level error** the Phase 6 UI can
  surface. No partial or half-valid document is ever persisted.

### Corrupt / Missing Recovery (boot behavior)
- **D-11:** **Missing file (first run):** start with safe **empty defaults** (no
  mapping, empty/unset connection settings) and write a fresh valid config file.
- **D-12:** **Corrupt / malformed file:** **quarantine** it — rename the bad file
  aside (e.g. `config.json.bak-corrupt`), **log loudly**, and boot on empty
  defaults. Never silently overwrite the bad file, so the operator can recover it.
  Mirrors the resolver's defensive total-function stance (never crash the process on
  bad data).

### Claude's Discretion
- Exact zod schema layout, file/module names within `src/config/`
  (`configStore.ts`, `schema.ts` per ARCHITECTURE.md), and the precise shape of the
  CRUD surface (whole-document replace vs per-entry mutators) — planner/executor
  decide, as long as D-01..D-12 hold.
- Config file **path/location** (cwd `config.json` per ARCHITECTURE.md, vs an app
  data dir) — not discussed; default to ARCHITECTURE.md's `config.json` at project
  root unless research surfaces a packaging reason to relocate.
- Whether to include a **schema `version` field** for future migrations — sensible
  to add cheaply now, but optional; planner's call.
- Connection-settings validation depth (IP/host format, port range) beyond
  "well-formed string + valid port int" — researcher may recommend a sane standard.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap (this phase)
- `.planning/REQUIREMENTS.md` — CFG-01 (connection settings persist across
  restarts), CFG-02 (mapping persists across restarts), MAP-01 (map each vMix input
  to an ATEM input/camera, ≤8).
- `.planning/ROADMAP.md` §"Phase 2" — goal + 4 success criteria (identity-anchored
  mapping, settings survive restart, mapping survives restart intact, atomic writes).

### Architecture & Stack (directly shape the store design)
- `.planning/research/ARCHITECTURE.md` §"Config Store" (single JSON file, atomic
  write-temp-then-rename), §"Recommended Project Structure" (`src/config/configStore.ts`
  + `schema.ts` as the only disk-touching module), §"Override is a layer" /
  "Config / Override → Core Flow" (how the store feeds the Core).
- `CLAUDE.md` / STACK.md §"Recommended Stack" — lowdb 7.0.1 (ESM-only, atomic JSON)
  and zod 4.x (config/mapping validation) recommendations; the lean-dependency
  "Stack Patterns by Variant" notes relevant to Windows packaging.

### Phase 1 contract this phase must serialize to
- `src/core/resolver.ts` §`MappingEntry` (lines ~28-41) and `coerceMapping` (lines
  ~77-110) — the in-memory `{vmixInput, atemSource, cameraId}` shape the resolver
  consumes, and its existing defensive validation (`atemSource > 0`, non-empty
  string cameraId). The persisted model serializes to / reconciles with this (D-03).
- `.planning/phases/01-core-resolver-tally-state-spine/01-CONTEXT.md` §`<decisions>`
  D-02 (camera identity decoupled from vMix/ATEM numbers), D-10 (unmapped input
  handling) — the persisted model must stay consistent with these.

### Project-level context
- `.planning/PROJECT.md` §"Key Decisions" — read-only vMix, cut-only ATEM,
  ≤8 cameras scale constraint.

No additional external ADRs/specs.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/resolver.ts` — defines `MappingEntry`, `Mapping`, `CameraId`, and a
  `coerceMapping` defensive validator. The Phase 2 zod schema should align with (and
  ideally be the upstream source of truth for) this shape so the two validation
  layers don't drift. Consider deriving / cross-checking against the resolver types.

### Established Patterns
- ARCHITECTURE.md: `config/` is the ONLY module that touches disk; `core/` stays
  pure. Phase 2 must honor this boundary — no fs imports leak into `core/`.
- Defensive total-function stance from Phase 1 carries into the store: bad/missing
  config never crashes the process (D-11/D-12), it degrades to safe defaults.
- Project is strict-TS ESM, `node:test`-free (uses vitest), no build/dist step
  (pure source + vitest). lowdb 7 ESM-only fits cleanly.

### Integration Points
- **Produces:** an in-memory mapping + connection settings object consumed by the
  resolver (Phase 1) and, later, by the vMix connector (Phase 3) and ATEM connector
  (Phase 4).
- **Consumed-by (future):** the Phase 6 web UI calls the CRUD/validation surface to
  edit mapping and connection settings; structured validation errors (D-10) surface
  there.
- Phase 3 ingest is the layer that resolves positional TALLY → vMix Key (D-01/D-03);
  Phase 2 only defines the Key-anchored persisted model, not the resolution itself.

</code_context>

<specifics>
## Specific Ideas

- The whole reason for Key-anchoring (D-01) is to satisfy a *later* phase's success
  criterion (Phase 3 SC4). Worth a dedicated round-trip test in Phase 2: persist a
  mapping, simulate a vMix Number reorder, and assert the entry still resolves to the
  same camera by Key.
- Atomicity (SC4) is a first-class testable behavior, not an assumed library freebie
  — verify it (D-05), don't just trust lowdb.
- Reject-whole-save (D-10) should return errors shaped for direct field-level display
  in the Phase 6 editor — design the error type with that consumer in mind.

</specifics>

<deferred>
## Deferred Ideas

- **Mapping import/export** (OPS-02, v2) — explicitly a v2 requirement; not this
  phase.
- **Live config hot-reload into running connections** — how a saved mapping/settings
  change propagates into an active vMix/ATEM connection belongs with Phase 3/4/6,
  not the pure persistence layer.
- **Schema migration framework** — if a `version` field is added now (Claude's
  discretion), a full migration runner is still deferred until a real schema change
  exists.
- **Connection-settings UI / mapping-editor UI** — Phase 6. Phase 2 exposes only the
  programmatic surface.

None of the above is in Phase 2 scope — discussion stayed within the
persistence-and-model boundary.

</deferred>

---

*Phase: 2-config-persistence-mapping-model*
*Context gathered: 2026-06-29*
