# Phase 1: Core Resolver + Tally State Spine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-29
**Phase:** 1-core-resolver-tally-state-spine
**Areas discussed:** Output contract & state shape, Multi-program conflict policy, Override scope & conflict, Defensive defaults

---

## Output Contract & State Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Both: per-camera map + bus state | Emit per-camera {off\|program\|preview} map (CORE-01) AND single {program, preview} bus state (SC1) | ✓ |
| Only {program, preview} bus | Emit just the ATEM bus state; UI re-derives per-camera | |
| Only per-camera map | Emit just per-camera map; ATEM connector collapses downstream | |

**User's choice:** Both: per-camera map + bus state

| Option | Description | Selected |
|--------|-------------|----------|
| By ATEM input number | Keyed by ATEM input # (recommended) | |
| By vMix input number | Keyed by vMix input identity | |
| By separate camera id/label | Distinct camera identity layer decoupled from vMix/ATEM numbers | ✓ |

**User's choice:** By separate camera id/label
**Notes:** Mirrors the three-way chain (vMix input → ATEM input → camera id) from PITFALLS. Richer model than the recommended ATEM-#-keying.

| Option | Description | Selected |
|--------|-------------|----------|
| Core owns last-sent + emits on change | Core holds last-sent desired state, emits only on diff | ✓ |
| Pure resolver + separate reconciler | Stateless resolve() + separate reconciler tracking last-sent | |

**User's choice:** Core owns last-sent + emits on change

---

## Multi-program Conflict Policy

| Option | Description | Selected |
|--------|-------------|----------|
| Lowest ATEM input number | Deterministic, order-independent winner of program bus | ✓ |
| First in vMix tally order | Positional first program flag wins | |
| Last take wins (most recent) | Most recently switched-to-program wins | |
| User-defined priority order | Explicit per-input priority list | |

**User's choice:** Lowest ATEM input number

| Option | Description | Selected |
|--------|-------------|----------|
| Physical truth: winner red, rest off | Per-camera map matches actual camera lights | ✓ |
| Intent mirror: all live = red | Mark every vMix-program camera red even if bus shows one | |

**User's choice:** Physical truth: winner red, rest off

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, expose a contended/dropped signal | Sidecar list of program-flagged inputs that lost the bus | ✓ |
| No, silently drop non-winners | Only winner appears, losers vanish | |

**User's choice:** Yes, expose a contended/dropped signal

---

## Override Scope & Conflict

| Option | Description | Selected |
|--------|-------------|----------|
| Any: program / preview / off | Override can force red, green, or dark | ✓ |
| program or preview only | Force red/green but not off | |
| program (red) only | Force red only | |

**User's choice:** Any: program / preview / off

| Option | Description | Selected |
|--------|-------------|----------|
| Override takes the bus outright | Forced-program override wins regardless of live/input # | ✓ |
| Override joins lowest-# arbitration | Override competes with live in same arbitration | |

**User's choice:** Override takes the bus outright

| Option | Description | Selected |
|--------|-------------|----------|
| Multiple allowed, lowest-# wins bus | Several sticky overrides; lowest ATEM # wins among forced-program | ✓ |
| One override at a time | New override clears previous | |

**User's choice:** Multiple allowed, lowest-# wins bus

---

## Defensive Defaults

| Option | Description | Selected |
|--------|-------------|----------|
| Ignore, but flag as contended | No bus output, added to contended/dropped signal | ✓ |
| Ignore silently | No bus output, no trace | |
| Treat as error | Reject/throw on unmapped-live | |

**User's choice:** Ignore, but flag as contended

| Option | Description | Selected |
|--------|-------------|----------|
| Both buses off | program=none, preview=none, all off (unless override) | ✓ |
| Hold last state | Keep previous bus output until change | |

**User's choice:** Both buses off (no program, no preview)

| Option | Description | Selected |
|--------|-------------|----------|
| Program (red) wins | Red precedence over green for same camera | ✓ |
| Preview (green) wins | Green precedence | |

**User's choice:** Program (red) wins

| Option | Description | Selected |
|--------|-------------|----------|
| Total function — never throw | Coerce bad input to safe all-off result | ✓ |
| Validate and throw | Reject malformed input at boundary | |

**User's choice:** Total function — never throw

---

## Claude's Discretion

- Exact TypeScript type/interface names and `core/` module file layout.
- Internal representation of the override layer (map vs list).
- Precise shape of the contended/dropped side signal.

## Deferred Ideas

- User-defined per-input priority order for multi-program arbitration (would need Phase 2 config).
- Debounce/coalescing of rapid tally bursts (~20–40 ms) — belongs with Phase 3/4 hot path.
- UI surfacing of contended signal + override "MANUAL" sticky badge — Phase 6.
