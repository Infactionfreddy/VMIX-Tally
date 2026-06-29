---
phase: 01-core-resolver-tally-state-spine
reviewed: 2026-06-29T16:54:53Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/core/events.ts
  - src/core/events.test.ts
  - src/core/resolver.ts
  - src/core/resolver.test.ts
  - src/core/tallyState.ts
  - src/core/tallyState.test.ts
findings:
  critical: 1
  warning: 5
  info: 3
  total: 9
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-06-29T16:54:53Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the Core spine of the vMix→ATEM tally bridge: the typed output contract
(`events.ts`), the pure desired-state resolver (`resolver.ts`), and the single-writer
diff reconciler (`tallyState.ts`), plus their three test suites. The implementation is
generally strong: defensive coercion (D-13) is genuinely robust — NaN, negative,
out-of-range, sparse, string, oversized, and null/undefined inputs all coerce to a safe
all-off result without throwing, verified by direct probing. Purity (SC2) holds, the
override-conflict precedence (force-off beats force-program/preview, lowest-ATEM-#
arbitration at every tier) is correct, and the reconciler's no-op-on-unchanged guarantee
is solid for all values the resolver actually emits. All 60 existing tests pass and
`tsc --noEmit` is clean under strict + `noUncheckedIndexedAccess`.

The review surfaced **one BLOCKER**: the `contended` sidecar's `lost-bus` reason can be
attached to a camera that simultaneously resolves to `"preview"` (green tally). This
directly contradicts the documented contract (`lost-bus` means "absent from the clean
per-camera tally map" / "gets no tally", D-06) and will drive a false Phase 6 UI warning
("overlaid source X gets no tally") about a camera the dashboard shows as green. Because
the contended sidecar is a stable cross-phase contract and red/green correctness is the
project's core value, this should be resolved before downstream phases build on it.

Five WARNINGs cover a silent duplicate-`vmixInput` data-integrity gap, an inaccurate
purity comment masking a missing defensive copy, a NaN-thrash defense gap in the
reconciler, and dead defensive code.

## Critical Issues

### CR-01: `lost-bus` contended entry attached to a camera that is actually `preview` (green)

**File:** `src/core/resolver.ts:277-298` (live-program loser → contended) and `src/core/resolver.ts:311-329` (preview candidates)

**Issue:** A camera can be a live-program *loser* (added to `contended` with
`reason: "lost-bus"`) AND simultaneously the preview-bus *winner* (`cameras[cam] = "preview"`,
`bus.preview` set). The two code paths never reconcile: the live-program loop pushes the
losing camera into `contended` (line 277-285), and the preview loop independently selects
the same camera as preview winner (it is eligible because `cam !== programWinnerCamera`).

This violates the contract documented in `events.ts:54-58` and decision D-06:
`lost-bus` is defined as "a program-flagged input that lost lowest-ATEM-# arbitration"
and is described as a camera that is "absent from the clean per-camera tally map" /
"overlaid source X gets no tally". A camera resolving to `"preview"` is **not** absent and
**does** get tally (green). The output object is internally self-contradictory.

Reproduced directly:
```
resolve([1, 1, 0, 0], baseMapping, [{ cameraId: "camB", force: "preview" }])
=> {
     cameras: { camA: "program", camB: "preview", camC: "off", camD: "off" },
     bus: { program: 1, preview: 2 },
     contended: [ { vmixInputNumber: 2, reason: "lost-bus", atemSource: 2 } ]  // camB
   }
```
Here `camB` is GREEN (`"preview"`, `bus.preview: 2`) yet is reported as a dropped/contended
program input. A Phase 6 consumer that renders `contended` as "these sources get no tally"
would warn about a camera that visibly has tally — a correctness defect in the safety-critical
output, not a cosmetic one.

The same contradiction occurs with two pure live-program inputs where the loser is also
live-preview-eligible via override; the live-program loser path does not check whether the
losing camera ultimately wins the preview bus.

**Fix:** Defer/recompute `contended` after the per-camera map is final, so a camera is only
listed `lost-bus` if its final `CameraTallyState` is `"off"`. One concrete approach — compute
the program winner, preview winner, and force-off set first; build the final `cameras` map;
then, when emitting `lost-bus` entries, skip any camera whose final state is not `"off"`:

```ts
// After cameras{} is fully composed (Step 4), filter lost-bus contention:
const finalContended = contended.filter((c) => {
  if (c.reason !== "lost-bus") return true;
  const entry = vmixToEntry.get(c.vmixInputNumber);
  if (entry === undefined) return true;
  // Only report lost-bus if the camera ended up with NO tally.
  return cameras[entry.cameraId] === "off";
});
return { cameras, bus: { program: busProgram, preview: busPreview }, contended: finalContended };
```

Add a regression test asserting that a live-program loser that subsequently wins the preview
bus is NOT present in `contended` with `reason: "lost-bus"`.

## Warnings

### WR-01: Duplicate `vmixInput` mapping entries silently overwrite the lookup and emit a phantom `lost-bus`

**File:** `src/core/resolver.ts:156-160` (vmixToEntry build) and `src/core/resolver.ts:186-194` (per-mapping tally read)

**Issue:** `coerceMapping` does not enforce uniqueness of `vmixInput`. When two entries share
the same `vmixInput`, `vmixToEntry.set` keeps only the last (line 159), but the live-program
collection loop (line 186) iterates **all** mapping entries and reads the same tally slot for
both — so both cameras are treated as live-program off a single vMix input. The second camera
then loses arbitration and is reported `lost-bus`, even though it shares the exact vMix input
of the winner (it is not really a separate contended source).

Reproduced:
```
resolve([1, 0],
  [ { vmixInput: 1, atemSource: 1, cameraId: "camA" },
    { vmixInput: 1, atemSource: 5, cameraId: "camX" } ], [])
=> { cameras: { camA: "program", camX: "off" },
     bus: { program: 1, preview: null },
     contended: [ { vmixInputNumber: 1, reason: "lost-bus", atemSource: 5 } ] }
```
Two different ATEM sources are reported for the same `vmixInputNumber: 1`, which is incoherent
for downstream consumers. The mapping originates from persisted config (Phase 2) and is
explicitly an untrusted boundary (threat model T-02-01), so malformed/duplicate config is
in-scope for defensive handling.

**Fix:** De-duplicate by `vmixInput` (and ideally `cameraId` and `atemSource`) during coercion,
keeping the first valid entry and dropping later collisions:

```ts
const seenVmix = new Set<number>();
const deduped = raw.filter((e) => { /* ...existing validity checks... */ })
  .filter((e) => {
    if (seenVmix.has(e.vmixInput)) return false;
    seenVmix.add(e.vmixInput);
    return true;
  });
```

### WR-02: Inaccurate "non-aliased copies" comment masks a missing defensive copy of the tally array

**File:** `src/core/resolver.ts:140` (comment) and `src/core/resolver.ts:70-73` (`coerceTally`)

**Issue:** Line 140 states "Build local, non-aliased copies," but `coerceTally` returns the
caller's array by reference (`return raw;`, line 72) — it is aliased, not copied. Purity is
not currently violated because `resolve` only ever reads `safeTally` and never writes to it,
so the SC2 test passes. However, the comment asserts a guarantee the code does not provide.
A future edit that mutates `safeTally` (e.g. an in-place normalization) would silently break
the "live never mutated" invariant (D-08/SC2) while the misleading comment suggests safety.

**Fix:** Either make the comment accurate ("inputs are treated as readonly and never written;
no copy needed") or actually copy in `coerceTally` (`return raw.slice();`) to match the stated
intent. Given SC2 is a hard invariant, an explicit defensive copy is the safer choice and
removes the foot-gun.

### WR-03: Reconciler defeats no-op guarantee for `NaN` bus values (defense-in-depth gap)

**File:** `src/core/tallyState.ts:72-78`

**Issue:** `submit` compares with `!==`. Because `NaN !== NaN`, if `program` (or `preview`)
were ever `NaN`, two identical `submit({ program: NaN, ... })` calls both report
`changed: true` and emit a `"change"` event every time — perpetual command thrash, defeating
SC4 / T-03-02 (command-thrash prevention). Reproduced: `submit({program: NaN, preview: null})`
twice yields `{changed:true,...}` both times.

The resolver — the documented producer — never emits `NaN` (it coerces to `null`), so this is
not a live bug today. But `DesiredAtemBusState` is a shared cross-phase contract; the
reconciler accepts it with zero validation, and Phase 4/5 (ATEM reconnect/resync) may feed it
from other sources. The single-writer's anti-thrash guarantee is its entire reason to exist,
so it should not be silently bypassable by a non-finite value.

**Fix:** Use a finite-aware equality, e.g. treat any non-finite number as `null` on entry, or
compare with `Object.is`-style handling that collapses `NaN`:

```ts
const norm = (v: number | null) => (typeof v === "number" && !Number.isFinite(v) ? null : v);
const p = norm(desired.program);
const v = norm(desired.preview);
const programChanged = this.lastSent.program !== p;
const previewChanged = this.lastSent.preview !== v;
// ...store/emit { program: p, preview: v }
```

### WR-04: `bestSource !== Infinity` guard is dead / inconsistently applied across tiers

**File:** `src/core/resolver.ts:237` (program tier guard) vs `src/core/resolver.ts:343-344` (preview tier)

**Issue:** In the forced-program tier, the winner is committed only if
`bestCam !== null && bestSource !== Infinity` (line 237). But `forceProgramCandidates` is
guarded as non-empty (line 227) and every `src` comes from a coerced mapping where
`atemSource` is a finite integer > 0 (lines 85-87), so `bestSource` can never remain
`Infinity` and `bestCam` can never remain `null`. The guard is unreachable dead code. The
live-program tier (line 272) and preview tier (line 343) handle the analogous situation
differently (the preview tier maps `Infinity → null` at line 344). The inconsistency makes the
three near-identical "lowest atemSource wins" blocks harder to verify as equivalent and invites
copy-paste drift.

**Fix:** Extract the repeated "pick lowest atemSource from a non-empty candidate list" into a
single small helper used by all three tiers, removing the dead guard and unifying the
empty/sentinel handling. This also shrinks the function and reduces the risk that a future
edit fixes a bug in one tier but not the others.

### WR-05: Three structurally-identical arbitration blocks duplicated inline (drift risk)

**File:** `src/core/resolver.ts:227-254`, `src/core/resolver.ts:262-286`, `src/core/resolver.ts:334-345`

**Issue:** The "find the candidate with the lowest `atemSource`, make it the winner, push the
rest to `contended` as `lost-bus`" logic is hand-inlined three times with subtle differences
(forced-program pushes losers from a `[cam, src]` tuple list; live-program pushes from a
`MappingEntry` list; preview has no loser-push). This duplication is the proximate cause of
CR-01 and WR-04: the loser/contended bookkeeping is implemented per-tier instead of once, so
the tiers disagree about when a camera is "really" contended. Beyond the specific bugs, any
future change to arbitration semantics must be applied in three places.

**Fix:** Consolidate into one arbitration primitive that takes a candidate list
(`{cameraId, atemSource, vmixInput}[]`) plus an exclusion predicate and returns
`{ winner, losers }`; derive `contended` once from the final per-camera map (see CR-01 fix).
This collapses the three blocks and makes the precedence chain auditable as a single function.

## Info

### IN-01: `isSafeNonNegInt` accepts 0 but `atemSource` separately requires `> 0` — split the intent

**File:** `src/core/resolver.ts:62-64` and `src/core/resolver.ts:85-87`

**Issue:** `isSafeNonNegInt` permits `0` (it is named "NonNeg"), then `coerceMapping` separately
re-checks `e.atemSource > 0` (line 87) to exclude source 0, while `vmixInput` is allowed to be
`0` (a valid-but-odd value that maps to array index `-1`, always read as `undefined`/off — see
probe with `vmixInput: 0`). The two-step check works but the per-field validity rules are split
across the predicate and the filter, making the actual accepted domain (vmixInput ≥ 0,
atemSource ≥ 1) non-obvious.

**Fix:** Make field intent explicit, e.g. a dedicated `isPositiveInt` for `atemSource` and
`isNonNegInt` for `vmixInput`, or document the `vmixInput: 0` case. Not a behavioral bug —
clarity only.

### IN-02: Comment claims event payload `state` is "the copy already stored in lastSent" but it is a second copy

**File:** `src/core/tallyState.ts:89-93`

**Issue:** The comment (line 89) says "Emit the copy already stored in lastSent so the payload
is also a safe copy," but the code spreads `lastSent` again (`state: { ...this.lastSent }`,
line 91), creating a distinct object from the stored one. The behavior is correct and safe (the
payload is independent of internal state), but the comment misdescribes it as reusing the
stored reference. Minor doc/code mismatch.

**Fix:** Reword to "Emit a fresh copy so the payload cannot alias internal state."

### IN-03: Redundant `&& isFinite(raw)` after `Number.isInteger` / `typeof` narrowing

**File:** `src/core/resolver.ts:188` and `src/core/resolver.ts:200`; also `isFinite` vs `Number.isFinite` at `src/core/resolver.ts:63`

**Issue:** At lines 188/200, `typeof raw === "number" && isFinite(raw)` is used to gate the
tally value, then compared `=== 1`/`=== 2`. Since only `1`/`2` produce an effect and `NaN`/`Infinity`
are never `=== 1`/`=== 2`, the `isFinite` check is redundant for correctness here (it changes
nothing observable). Separately, line 63 uses the global `isFinite` (which coerces) inside
`isSafeNonNegInt`, where `Number.isInteger` already guarantees a finite number — the global
`isFinite` is both redundant and the coercing variant; prefer `Number.isFinite` for consistency
with the stricter intent elsewhere.

**Fix:** Drop the redundant `isFinite` guards where `=== 1`/`=== 2` already excludes non-finite
values, and standardize on `Number.isFinite` where a finiteness check is genuinely needed.
Cosmetic; no behavior change.

---

_Reviewed: 2026-06-29T16:54:53Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
