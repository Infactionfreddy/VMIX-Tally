# Phase 1: Core Resolver + Tally State Spine - Pattern Map

**Mapped:** 2026-06-29
**Files analyzed:** 4 logical new modules (types/contract, resolver, reconciler/state, tests) — exact file split is planner discretion
**Analogs found:** 2 / 4 strong (test conventions + output-contract shape); 2 / 4 have no logic analog (pure resolver/reconciler logic does not exist in this repo)

> **Greenfield warning.** There is NO `src/` directory, no root `package.json`, and no
> root `tsconfig.json` yet. The resolver phase is the first production code in the repo.
> The only existing code is `tools/atem-simulator/` (a dev/test harness, committed
> `ef76947`). Therefore most "analogs" below are about **conventions to replicate** and
> **the ATEM bus shape to align with** — not copy-paste logic templates. Where there is
> genuinely no analog for the pure resolution/reconciler logic, that is stated plainly so
> the planner uses ARCHITECTURE.md Pattern 1/3 and the CONTEXT.md precedence chain instead.

---

## File Classification

| New File (planner may rename/split) | Role | Data Flow | Closest Analog | Match Quality |
|-------------------------------------|------|-----------|----------------|---------------|
| `src/core/events.ts` (typed contracts: per-camera map, `{program, preview}` bus, contended sidecar) | types / contract | transform (data shape) | `tools/atem-simulator/src/commands.js` + `src/state.js` (ATEM bus/tally shape) | shape-anchor (no TS analog, but bus shape is authoritative) |
| `src/core/resolver.ts` (pure: vMixTally + mapping + override → desired state) | service (pure function) | transform | ARCHITECTURE.md Pattern 1 sketch (no in-repo code analog) | NO logic analog — design from CONTEXT precedence chain |
| `src/core/tallyState.ts` (last-sent state + single-writer diff reconciler, D-03/CORE-03) | store / reducer | event-driven (emit-on-diff) | `tools/atem-simulator/src/state.js` (`set*` returns `false` on no-op + `EventEmitter`) | role+pattern partial match (emit-on-change idiom only) |
| `src/core/*.test.ts` (per-tier precedence + edge-case + no-op tests) | test | request-response (assert) | `tools/atem-simulator/test/codec.test.js` (`node:test` unit style) | exact (test runner + style) |

---

## Pattern Assignments

### `src/core/events.ts` — types / output contract (transform)

**Analog (shape anchor, NOT a TS file):** `tools/atem-simulator/src/commands.js` + `tools/atem-simulator/src/state.js`

This is the single most load-bearing alignment in the phase. The resolver's `{program, preview}`
ATEM bus output (D-01) must match exactly how the simulator — and therefore real
`atem-connection` — represents program/preview so the Phase 1 contract does not churn when
Phase 4 wires the connector. The simulator's encoders were proven wire-correct against
`atem-connection`'s own `deserialize` (see `codec.test.js`), so these shapes are authoritative.

**ATEM bus = source id by MIX-EFFECT (single ME, mixEffect 0).** From `commands.js` lines 68-82:
```javascript
/** `PrgI` — program input state for a mix-effect. */
export function encodeProgramInput(me, source) { /* me @0 (u8), source @2 (u16BE) */ }
/** `PrvI` — preview input state for a mix-effect. */
export function encodePreviewInput(me, source) { /* me @0 (u8), source @2 (u16BE) */ }
```
And `codec.test.js` lines 23-35 confirm the decoded shape from `atem-connection`:
```javascript
const cmd = Commands.ProgramInputUpdateCommand.deserialize(payload, PROTOCOL_VERSION);
assert.equal(cmd.mixEffect, 0);          // single ME = 0
assert.equal(cmd.properties.source, 5);  // program is a single source id (number)
```
**Contract rules the resolver's bus output must obey:**
- `program` and `preview` are each a **single ATEM source id (number)** for `mixEffect 0` — NOT a per-input array, NOT a camera id. (D-01 "single `{program, preview}` ATEM bus state", D-02 "ATEM input # for the bus output".)
- ATEM source ids are **`u16` numbers** (`writeUInt16BE`, `& 0xffff`). Range/`> 8` is fine; the cap of 8 cameras (CLAUDE.md) is a domain constraint, not a wire constraint. ATEM input numbering is its own namespace, distinct from vMix input numbers and camera ids (D-02, PITFALLS Pitfall 1 three-way chain).
- "Nothing live" (D-11): the resolver needs an explicit "no source" representation for `program`/`preview`. Note the simulator's `state.js` always holds a concrete `programInput`/`previewInput` (defaults to `1`) — it has **no "none" concept**. So the resolver contract must add one (e.g. `null`/`undefined`); do NOT copy the simulator's "always a number" assumption. ARCHITECTURE.md's resolver sketch (lines 113-122) uses `undefined` for absent program/preview — follow that.

**Per-camera canonical map = tristate keyed by CAMERA id.** From `state.js` lines 56-70 `snapshot()`:
```javascript
inputs: this.inputs.map((i) => ({
  id: i.id,
  program: ((tallyMap.get(i.id) ?? 0) & TALLY_PROGRAM) !== 0,   // bool
  preview: ((tallyMap.get(i.id) ?? 0) & TALLY_PREVIEW) !== 0,   // bool
}))
```
The simulator models per-source tally as **two independent booleans** (program AND preview can
both be true — a bitfield). The resolver's CONTEXT contract (D-01, CORE-01) is **different and
intentionally narrower**: a single `off | program | preview` enum per camera, where program
wins on collision (D-12). Do NOT copy the simulator's two-boolean model for the canonical map —
it is the wrong shape for CORE-01. The simulator's bitfield is only relevant to the *bus*/wire
layer (Phase 4), not the canonical UI map. The contended sidecar (D-06) carries what the
collapse-to-enum discards.

**Tally bit constants (for reference / Phase 4 alignment only):** `commands.js` lines 16-17:
```javascript
export const TALLY_PROGRAM = 0x01;
export const TALLY_PREVIEW = 0x02;
```

---

### `src/core/resolver.ts` — pure resolution function (transform)

**Analog:** NONE in repo. This is original pure logic. Do not force a match.

The only "reference" is the ARCHITECTURE.md Pattern 1 sketch (lines 106-123), which is a
*simplified* version that the CONTEXT decisions deliberately supersede — the sketch assumes a
single program input (`findIndex(v => v === 1)`), but D-04/Pitfall 3 require multi-program
arbitration by lowest ATEM #. **Build from the CONTEXT precedence chain, not the sketch.**

**Canonical precedence chain to implement (CONTEXT lines 87-97):**
```
override-program  →  live-program  →  preview  →  off
(lowest ATEM # among   (lowest ATEM #    (program wins on
 forced-program        among live)        collision, D-12)
 overrides, D-09)
```
Each tier arbitrated by **lowest ATEM input number** (D-04, D-09). Override layered last over
live; **live never mutated** (D-08, SC2, ARCHITECTURE Pattern 3 / Anti-Pattern 4).

**Hard requirements with no analog — design directly from these decisions:**
- D-04/D-05/D-06: lowest-ATEM-# wins the single program bus; losing live-program inputs are `off` in the canonical map; losers reported in the contended sidecar.
- D-07/D-08/D-09: override can force `program|preview|off`; forced-program beats live-program unconditionally; multiple overrides allowed, lowest-# wins among them.
- D-10: live vMix input with no mapping → ignored for bus, flagged in contended signal (reuse D-06 channel).
- D-11: empty / all-zero tally → both buses off, all cameras off (unless override).
- D-12: same camera program+preview at once → program wins.
- D-13: **total function, never throws.** Malformed/empty/out-of-range input coerced to safe all-off. This is the one behavior the simulator does NOT model (it trusts its inputs) — there is no defensive-coercion analog; write it from scratch with explicit guard tests.

**Convention to replicate (from the only existing code):** the simulator is **pure-ish, I/O-free
in its state module** and uses plain functions + small objects. Keep `resolver.ts` a pure
function with no imports of sockets/HTTP (ARCHITECTURE.md lines 92, 107 — `core/` knows nothing
about I/O). Mirror the simulator's terse top-of-file comment explaining the module's single
responsibility (see `state.js` lines 1-3, `commands.js` lines 1-8).

---

### `src/core/tallyState.ts` — last-sent state + single-writer diff reconciler (event-driven)

**Analog (idiom only):** `tools/atem-simulator/src/state.js`

The reconciler logic (own last-sent desired state, emit ATEM command only on diff — D-03,
CORE-03, SC4) has **no full analog**, but the simulator's `state.js` demonstrates the exact
**emit-on-change / no-op-on-unchanged idiom** the reconciler needs:

`state.js` lines 22-36 — return `false` when nothing changed, emit + return `true` when it did:
```javascript
setProgram(source) {
  if (this.programInput === source) return false;   // no-op: identical → don't emit
  this.programInput = source;
  this.emit('program', source);
  this.emit('change');
  return true;
}
```
**Replicate:** the "compare against held state, short-circuit if equal, otherwise mutate +
emit" shape is exactly the single-writer diff (CORE-03 / SC4 "no-op-on-unchanged is a
first-class testable behavior"). The reconciler holds the last-sent `{program, preview}` and
emits only when the freshly-resolved desired state differs.

**Differences — do NOT copy blindly:**
- The simulator diffs program and preview **independently** (two setters). The reconciler
  diffs the whole desired `{program, preview}` bus state (one unit) per CONTEXT D-01/D-03 —
  decide whether to emit per-field or per-bus; per-field matches the eventual `changeProgramInput`/
  `changePreviewInput` split in ARCHITECTURE.md Pattern 1.
- `EventEmitter` usage (`extends EventEmitter`, `state.js` line 8) is the repo's established
  cross-module signalling mechanism (also `session.js` line 24, ARCHITECTURE.md "Plain TS
  module + EventEmitter"). The resolver core MAY use it for emitting desired-state/UI snapshots —
  but keep the pure `resolver.ts` itself a plain function; put any emitter on the state/reconciler
  module, mirroring how the simulator keeps codec functions (`commands.js`) pure and puts the
  emitter on `state.js`.

---

### `src/core/*.test.ts` — unit tests (assert)

**Analog (exact, replicate house style):** `tools/atem-simulator/test/codec.test.js` and
`test/e2e.test.js`

This is the strongest analog in the repo. The test conventions are established and must match.

**Runner + imports** (`codec.test.js` lines 4-5; e2e lines 4-6):
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events'; // only when waiting on emitters
```
- **`node:test`** is the runner (NOT vitest/jest), with **`node:assert/strict`**. CLAUDE.md
  recommends `vitest` for mapping logic, but the **only established, committed convention is
  `node:test`** — match the existing code unless the planner explicitly chooses to introduce
  vitest + a build step. Flag this decision to the planner.
- Test script (`package.json` line 12): `"test": "node --test --test-force-exit"`. Replicate
  `--test-force-exit` (the simulator uses it to avoid hanging on open handles; harmless for pure tests).

**Test naming + structure** (`codec.test.js` lines 23-35) — one behavior per `test()`, plain
descriptive sentence as the name, direct asserts, no nested describe blocks:
```javascript
test('PrgI decodes to the program input we encoded', () => {
  const payload = payloadOf(encodeProgramInput(0, 5));
  const cmd = Commands.ProgramInputUpdateCommand.deserialize(payload, PROTOCOL_VERSION);
  assert.equal(cmd.mixEffect, 0);
  assert.equal(cmd.properties.source, 5);
});
```
**Replicate for the resolver:** one `test()` per precedence tier and per edge case
(D-04..D-13) — CONTEXT explicitly calls for "explicit unit tests for each tier and each
collision/edge case" and dedicated tests for "live never mutated" (SC2) and "no-op-on-unchanged"
(SC4). Use `assert.deepEqual` for whole-state comparison (see `codec.test.js` lines 47-49 for the
`deepEqual` idiom on object results).

**Language note:** the simulator is **plain ESM JavaScript with JSDoc** (`@param` typedefs, see
`state.js` lines 9-14, `session.js` lines 25-31), not TypeScript. CLAUDE.md strongly recommends
TypeScript for the protocol/state shapes. The planner must decide TS vs JS+JSDoc and set up
`tsconfig.json`/`package.json` accordingly (neither exists yet). If TS is chosen, tests become
`*.test.ts` run via `tsx`/`node --test` with a loader — note this is NEW tooling for the repo.

---

## Shared Patterns

### Module format: ESM
**Source:** `tools/atem-simulator/package.json` line 5 (`"type": "module"`), all `src/*.js` use `import`/`export`.
**Apply to:** all new core files. The repo is ESM. CLAUDE.md also notes `lowdb@7` is ESM-only and the server "must be ESM". Use `import`/`export`, not CommonJS.

### File-header responsibility comment
**Source:** `state.js` lines 1-3, `commands.js` lines 1-8, `session.js` lines 1-3.
**Apply to:** every new module. Each file opens with a short comment stating its single
responsibility and any non-obvious design constraint. Replicate this — it is the consistent
house documentation style.
```javascript
// In-memory switcher state: a single mix-effect with program/preview, ...
// Kept deliberately minimal — exactly what a vMix→ATEM tally bridge needs to observe.
```

### EventEmitter for cross-module signalling
**Source:** `state.js` line 8 (`extends EventEmitter`), `session.js` line 24.
**Apply to:** the state/reconciler module IF it needs to push desired-state/UI snapshots
(ARCHITECTURE.md "Plain TS module + EventEmitter"). Keep pure resolution out of it.

### Defensive / safe-default mindset
**Source:** `state.js` line 66 (`tallyMap.get(i.id) ?? 0`), constructor defaults lines 17-19.
**Apply to:** resolver (D-13 total function). The simulator already uses `??` fallbacks for
missing data; extend this to full coercion-never-throw in the resolver.

---

## No Analog Found

| Concern | Role | Data Flow | Reason |
|---------|------|-----------|--------|
| Multi-program arbitration (lowest-ATEM-# wins) | resolver logic | transform | No existing code arbitrates multiple program sources; simulator holds exactly one `programInput`. Design from D-04/D-09 + Pitfall 3. |
| Override layer merged over live (live never mutated) | resolver/state | transform | No override concept anywhere in repo. Design from ARCHITECTURE Pattern 3 + D-07..D-09. |
| Contended/dropped sidecar signal | contract/resolver | transform | No analog; this is a new output channel (D-06/D-10). Shape is planner discretion. |
| Total-function input coercion (never throws) | resolver | transform | Simulator trusts its inputs; no defensive-coercion precedent. Design from D-13. |
| Diff/no-op reconciler holding last-sent desired bus state | tallyState | event-driven | Only the per-field "emit-on-change" idiom exists (`state.js` setters); the held-last-desired-state reconciler over a composite `{program, preview}` is new (D-03/CORE-03). |

---

## Metadata

**Analog search scope:** repo root (no `src/`, no root `package.json`/`tsconfig.json`),
`tools/atem-simulator/` (src + test + package.json).
**Files scanned:** `tools/atem-simulator/src/{state,commands,session}.js`,
`tools/atem-simulator/test/{codec,e2e}.test.js`, `tools/atem-simulator/package.json`; plus
CONTEXT.md, ARCHITECTURE.md, PITFALLS.md.
**Pattern extraction date:** 2026-06-29

**Key alignment to carry into planning:** the resolver's `{program, preview}` bus output is a
single ATEM source id (u16 number) per field for `mixEffect 0`, plus an explicit "none" — this
matches `atem-connection`'s `ProgramInputUpdateCommand`/`PreviewInputUpdateCommand` shape proven
in `codec.test.js`, so Phase 4 wires the real connector without contract churn. The per-camera
canonical map is a NARROWER `off|program|preview` enum (program wins collisions), NOT the
simulator's two-boolean bitfield — the contended sidecar carries what that collapse discards.
