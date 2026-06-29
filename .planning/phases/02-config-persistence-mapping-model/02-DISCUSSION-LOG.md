# Phase 2: Config Persistence + Mapping Model - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-29
**Phase:** 2-config-persistence-mapping-model
**Areas discussed:** Identity anchor, Persistence stack, Mapping invariants, Corrupt/missing recovery

---

## Identity anchor

What stable identity should each persisted mapping entry anchor on?

| Option | Description | Selected |
|--------|-------------|----------|
| Key (GUID) primary | Anchor on vMix Key (GUID); Number + Title as hints; Phase 3 resolves positional TALLY → Key. Survives reorder/add/delete; satisfies Phase 3 SC4. | ✓ |
| Number primary | Anchor on vMix Number. Simpler, no XML lookup, but breaks on reorder/delete — conflicts with Phase 3 SC4. | |
| Both, no primary | Store Key + Number co-equally, match on either. More flexible but ambiguous on disagreement. | |

**User's choice:** Key (GUID) primary
**Notes:** Surfaced the dependency on Phase 3 SC4. Flagged a downstream seam: resolver's
`MappingEntry.vmixInput: number` is positional and must be reconciled with the Key-anchored
persisted model (CONTEXT D-03) without breaking the existing 62-test resolver contract.

---

## Persistence stack

How should the config store be built?

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-rolled + zod | Plain fs atomic write + zod validation. Zero runtime store dep, leanest for SEA packaging. | |
| lowdb 7 + zod | Typed JSON file with atomic writes (steno) out of the box + zod validation. STACK.md baseline. | ✓ |
| Hand-rolled, no zod | Atomic write + hand-written type guards. Truly zero deps but duplicates validation. | |

**User's choice:** lowdb 7 + zod
**Notes:** lowdb 7 is ESM-only — fine, project is already `"type": "module"`. Flagged: confirm
lowdb's adapter write is genuinely atomic (write-temp + rename) on target OS, since SC4 is
non-negotiable (CONTEXT D-05).

---

## Mapping invariants

Which uniqueness constraints should the mapping model enforce on save? (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Unique vMix Key | No two entries map the same vMix input. | ✓ |
| Unique ATEM source | No two entries point at the same ATEM input number. | ✓ |
| Unique cameraId | No two entries share a camera identity label (resolver keys state by cameraId). | ✓ |
| Allow partial mappings | Permit <8 entries and incremental additions. | ✓ |

**User's choice:** All four
**Notes:** Captured distinction — the ≤8 cap is on entry count (cameras), NOT on `atemSource`
value (ATEM ports can exceed 8); `atemSource` validated as positive integer, matching the
resolver's `>0` guard (CONTEXT D-09).

### Follow-up: behavior on constraint violation

When a save violates a constraint, what should happen?

| Option | Description | Selected |
|--------|-------------|----------|
| Reject whole save | zod validates entire document; any violation rejects the write atomically + returns field-level error. No partial state persists. | ✓ |
| Reject offending entry | Persist valid entries, drop bad ones, report drops. More forgiving but can silently lose a mapping. | |

**User's choice:** Reject whole save
**Notes:** All-or-nothing; structured field-level errors shaped for the Phase 6 editor (CONTEXT D-10).

---

## Corrupt/missing recovery

How should the server boot when config.json is missing or corrupt?

| Option | Description | Selected |
|--------|-------------|----------|
| Missing→defaults, corrupt→quarantine | First run: empty defaults + fresh file. Corrupt: rename aside (config.json.bak-corrupt), log loudly, boot on defaults. Never overwrite the bad file. | ✓ |
| Missing→defaults, corrupt→refuse start | First run defaults; corrupt file halts startup until fixed. Safer but no tally until intervention. | |
| Always defaults on any failure | Any load failure silently falls back to defaults. Simplest but could wipe config with no trace. | |

**User's choice:** Missing→defaults, corrupt→quarantine
**Notes:** Mirrors the resolver's defensive total-function stance — never crash on bad data
(CONTEXT D-11/D-12).

---

## Claude's Discretion

- Exact zod schema layout and `src/config/` module/file names.
- Shape of the CRUD surface (whole-document replace vs per-entry mutators).
- Config file path/location (default to ARCHITECTURE.md's root `config.json` unless packaging dictates otherwise).
- Whether to add a schema `version` field now for future migrations.
- Connection-settings validation depth (IP/host format, port range) beyond well-formed + valid port.

## Deferred Ideas

- Mapping import/export (OPS-02, v2).
- Live config hot-reload into running connections (Phase 3/4/6).
- Schema migration runner (deferred until a real schema change exists).
- Mapping-editor / connection-setup UI (Phase 6).
