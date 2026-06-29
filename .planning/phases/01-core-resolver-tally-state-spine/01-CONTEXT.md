# Phase 1: Core Resolver + Tally State Spine - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning

<domain>
## Phase Boundary

A pure, fully-tested desired-state engine with **zero external I/O**. It takes
three inputs — vMix live/preview tally, the vMix→ATEM/camera mapping, and the
manual override layer — and produces:

1. A **canonical per-camera state map** (`off | program | preview`), keyed by camera id.
2. A single **`{program, preview}` ATEM bus state** (single ME).
3. A **contended/dropped-inputs side signal** for the UI.

It owns the single-writer diff reconciler: it emits an ATEM command only when the
desired bus state differs from the last-sent state.

**In scope:** resolution precedence, multi-program arbitration, override layering,
the diff/no-op reconciler, defensive handling of incomplete input, and the output
data contract that Phases 2/3/4/6 consume.

**Out of scope (other phases):** any network I/O, vMix parsing (Phase 3), ATEM
connection/commands (Phase 4), config persistence + the mapping editor (Phase 2/6),
the web UI surfaces that consume these signals (Phase 6), reconnect/resync (Phase 5).
Overlay/PiP *tally logic* (lighting multiple cameras) stays out per project scope —
this phase only needs to *detect and report* contention, not represent it as tally.

</domain>

<decisions>
## Implementation Decisions

### Output Contract & State Shape
- **D-01:** The resolver emits **both** a per-camera `{off | program | preview}`
  map (for the UI dashboard, CORE-01) **and** a single `{program, preview}` ATEM
  bus state (for the ATEM connector, SC1). No consumer re-derives the other.
- **D-02:** Canonical state is keyed by a **separate camera id/label**, decoupled
  from both vMix input numbers and ATEM input numbers. This mirrors the real
  three-way chain (vMix input → ATEM input → camera id) called out in PITFALLS.
  The mapping carries the vMix↔ATEM↔camera relationships; the resolver speaks in
  camera identity for canonical state and ATEM input # for the bus output.
- **D-03:** The **Core owns the last-sent desired state** and emits only on
  change (single-writer reconciler, CORE-03). The diff/no-op-on-unchanged
  behavior lives inside the Core, not in a downstream connector.

### Multi-Program Conflict Policy (the keystone — PITFALLS Pitfall 3)
- **D-04:** When several inputs are program at once (overlay/PiP), the **lowest
  ATEM input number wins** the single program bus. Deterministic, order- and
  arrival-independent — no flicker based on event timing.
- **D-05:** Per-camera canonical state reflects **physical truth**: only the bus
  winner is `program` (red); all other live-but-losing cameras are `off`. The
  dashboard never claims a camera is red when its tally light cannot be.
- **D-06:** The resolver exposes a **contended/dropped-inputs side signal** — the
  list of program-flagged inputs that lost the bus — so Phase 6 can warn
  "overlaid sources get no tally." This is a sidecar, separate from the clean
  `off | program | preview` tally states (does not violate CORE-01).

### Override Scope & Conflict (PITFALLS Pitfall 6)
- **D-07:** A manual override can force a camera to **any** of `program`,
  `preview`, or `off` (force-off included, e.g. to mute a stuck tally / isolate a
  camera during a walk-test).
- **D-08:** A forced-program override **takes the bus outright** over live state —
  it cannot be out-arbitrated by a lower-numbered *live* input. "Override last"
  means override-program beats live-program unconditionally.
- **D-09:** **Multiple overrides may be active simultaneously** (sticky, per
  camera). Among multiple forced-program overrides, the lowest ATEM # wins the
  bus (same arbitration rule as live). Supports the per-camera override panel
  (UI-04).

### Defensive Defaults / Robustness
- **D-10:** A vMix input that goes live but has **no mapping** is ignored (no bus
  output) **and flagged in the contended/dropped signal** so the UI can warn
  "live input has no camera." Reuses the D-06 contention channel.
- **D-11:** When **nothing is live** (empty / all-zero tally), both buses are off
  (`program = none`, `preview = none`), all cameras off — unless an override is
  active. No stale red, no hold-last.
- **D-12:** When the same camera resolves to both program and preview at once
  (transition edge, or the vMix overlay quirk reporting `2` instead of `1`),
  **program (red) wins** — red is the safety-critical on-air signal.
- **D-13:** The resolver is a **total function — it never throws.** Malformed,
  empty, or out-of-range input (undefined tally, empty mapping, bad values) is
  coerced to a safe all-off result. Bad input means no tally, never a crash in
  the hot path.

### Resolved Precedence Chain (summary)
These decisions compose into one chain, each tier arbitrated by lowest ATEM #:

```
override-program  →  live-program  →  preview  →  off
(lowest # among       (lowest #         (program-
 overrides)            among live)       wins on collision, D-12)
```
Override (any forced state) is layered last over live; live is never mutated, so
clearing an override instantly reveals current live state (SC2). Anything not
selected for a bus is `off`.

### Claude's Discretion
- Exact TypeScript type/interface names and module file layout (planner/executor
  decide), within the `core/` structure proposed in ARCHITECTURE.md.
- Internal representation of the override layer (map vs list), as long as it
  satisfies D-07..D-09 and "live never mutated."
- The precise shape of the contended/dropped side signal (array of input ids vs
  richer objects), as long as it carries enough for a Phase 6 warning.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap (this phase)
- `.planning/REQUIREMENTS.md` — CORE-01 (canonical per-camera off/program/preview),
  CORE-02 (precedence live→mapping→override), CORE-03 (single-writer diff
  reconciler, emit-on-diff only), CORE-04 (only main PGM/PVW drives tally).
- `.planning/ROADMAP.md` §"Phase 1" — goal + 5 success criteria the resolver must satisfy.

### Architecture & Pitfalls (directly shape the resolver design)
- `.planning/research/ARCHITECTURE.md` §"Pattern 1: Mediator with Canonical
  Desired-State", §"Pattern 3: Layered State Merge for Override", §"Recommended
  Project Structure" (`src/core/` layout: `tallyState`, `resolver`, `debounce`,
  `events`) — the resolver sketch and module boundaries.
- `.planning/research/PITFALLS.md` §"Pitfall 3" (overlay/multi-program — mirror
  per-input, define conflict policy, program-wins precedence), §"Pitfall 6"
  (override precedence — single authoritative desired state + override layer).

### Project-level context
- `.planning/PROJECT.md` §"Key Decisions" — cut-only ATEM, read-only vMix,
  main-PGM-only, red+green tally.

No additional external ADRs/specs — requirements are fully captured in the
decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tools/atem-simulator/` (committed `ef76947`) — a working ATEM UDP simulator
  with codecs, web tally UI, and atem-connection integration tests. Not consumed
  by Phase 1 (pure logic, no I/O), but it is the hardware-free harness that will
  validate the resolver's bus output once Phase 4 wires the ATEM connector. Keep
  the Phase 1 output contract (`{program, preview}`) aligned with what the
  simulator/atem-connection expects (ATEM input numbers, single ME / `mixEffect 0`).

### Established Patterns
- ARCHITECTURE.md prescribes `core/` knows nothing about sockets or HTTP — the
  resolver is a pure function. Phase 1 must honor that boundary strictly.
- Mediator / canonical desired-state (not command pass-through) is the locked
  architectural pattern; the diff reconciler is part of the Core.

### Integration Points
- **Inputs to the resolver:** vMix tally array (Phase 3), mapping (Phase 2),
  override layer (Phase 6 sets it, Core owns it).
- **Outputs:** per-camera map + contended signal → Web UI (Phase 6); `{program,
  preview}` bus state → ATEM connector (Phase 4).
- Phase 1 should define these as stable typed contracts so Phases 2/3/4/6 build
  against them without churn.

</code_context>

<specifics>
## Specific Ideas

- The single composed precedence chain (override-program → live-program →
  preview → off, each arbitrated by lowest ATEM #) is the canonical mental model
  for the test suite — there should be explicit unit tests for each tier and each
  collision/edge case (D-04..D-13).
- "Live never mutated" is a hard invariant (SC2): override shadows live; clearing
  an override must instantly reveal current live state. Worth a dedicated test.
- No-op-on-unchanged (CORE-03, SC4) is a first-class testable behavior, not an
  optimization detail.

</specifics>

<deferred>
## Deferred Ideas

- **User-defined per-input priority order** for multi-program arbitration —
  considered as an alternative to lowest-ATEM-#, deferred. Would need config
  (Phase 2) and is not required for v1; lowest-# is the locked rule.
- **Debounce / coalescing** of rapid tally bursts (ARCHITECTURE.md mentions
  ~20–40 ms) — relevant to the hot path but tied to the live ingest/command
  cadence; belongs with Phase 3/4 where real event streams exist, not the pure
  resolver. Note for later: keep it small to stay within the <100 ms budget (REL-01).
- **UI surfacing** of the contended/dropped signal and the override "MANUAL" sticky
  badge — Phase 6. Phase 1 only produces the signal.

None of the above is in Phase 1 scope — discussion stayed within the pure-resolver boundary.

</deferred>

---

*Phase: 1-core-resolver-tally-state-spine*
*Context gathered: 2026-06-29*
