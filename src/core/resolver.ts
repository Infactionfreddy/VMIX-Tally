// Pure desired-state resolver: (vMixTally, mapping, overrides) → ResolverOutput.
// Zero I/O — no imports of node: builtins, sockets, or HTTP.
// Total function (D-13): malformed/empty/out-of-range inputs are coerced to a safe
// all-off ResolverOutput; this function never throws on adversarial input.

import type {
  CameraId,
  CameraTallyState,
  CameraTallyMap,
  DesiredAtemBusState,
  ContendedInput,
  ResolverOutput,
} from "./events.js";

// ---------------------------------------------------------------------------
// Input types (defined here, re-exported so callers can import them)
// ---------------------------------------------------------------------------

/**
 * vMix tally array: index = vMix input position (1-based in the protocol;
 * the caller is responsible for that offset), value = 0 (off) | 1 (program) | 2 (preview).
 * The resolver treats this as a plain readonly number[] and does NOT assume
 * "exactly one input is program" (D-04, PITFALLS Pitfall 3).
 */
export type VmixTally = readonly number[];

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

/** The complete mapping: all vMix inputs that have a known ATEM/camera destination. */
export type Mapping = readonly MappingEntry[];

/**
 * A single per-camera sticky override entry (D-07..D-09).
 * Multiple may be active simultaneously; the resolver accepts all active entries.
 */
export interface OverrideEntry {
  /** The camera to force. */
  cameraId: CameraId;
  /** The state to force this camera into. */
  force: CameraTallyState;
}

/** The full override layer: zero or more per-camera force entries. */
export type Overrides = readonly OverrideEntry[];

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Check whether a value is a safe integer >= 0 (valid for vmixInput or atemSource). */
function isSafeNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && isFinite(v);
}

/**
 * Validate and coerce the tally input (D-13).
 * Returns a readonly number[] (may be empty); never throws.
 */
function coerceTally(raw: VmixTally | null | undefined): readonly number[] {
  if (!Array.isArray(raw)) return [];
  return raw;
}

/**
 * Validate and coerce mapping entries (D-13).
 * Drops entries with non-integer/negative atemSource or vmixInput.
 */
function coerceMapping(raw: Mapping | null | undefined): MappingEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is MappingEntry =>
      e !== null &&
      typeof e === "object" &&
      isSafeNonNegInt(e.vmixInput) &&
      isSafeNonNegInt(e.atemSource) &&
      e.atemSource > 0 &&
      typeof e.cameraId === "string" &&
      e.cameraId.length > 0,
  );
}

const VALID_FORCE_VALUES: readonly CameraTallyState[] = ["program", "preview", "off"];

/**
 * Validate and coerce override entries (D-13).
 * Drops entries whose force is not a valid CameraTallyState.
 */
function coerceOverrides(raw: Overrides | null | undefined): OverrideEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (e): e is OverrideEntry =>
      e !== null &&
      typeof e === "object" &&
      typeof e.cameraId === "string" &&
      e.cameraId.length > 0 &&
      (VALID_FORCE_VALUES as string[]).includes(e.force),
  );
}

/** The empty (all-off) safe result for when nothing can resolve. */
function makeEmptyOutput(mapping: MappingEntry[]): ResolverOutput {
  const cameras: CameraTallyMap = {};
  for (const entry of mapping) {
    cameras[entry.cameraId] = "off";
  }
  return { cameras, bus: { program: null, preview: null }, contended: [] };
}

/**
 * Internal-only contended entry that also carries the originating cameraId for
 * "lost-bus" rows. The public ContendedInput contract has no cameraId, so this
 * is stripped at the return site (Step 5). The cameraId lets Step 5 reconcile
 * `contended` against the FINAL per-camera map: a camera that lost the program
 * bus but recovered tally on the preview bus must NOT be reported as "lost-bus"
 * (D-06 — "lost-bus" means absent from the clean tally map, i.e. finally "off").
 */
type PendingContended = ContendedInput & { cameraId?: CameraId };

// ---------------------------------------------------------------------------
// Main resolver
// ---------------------------------------------------------------------------

/**
 * Resolve the desired ATEM bus state and per-camera tally map.
 *
 * Precedence chain (each tier arbitrated by lowest atemSource number):
 *   override-program → live-program → preview → off
 *
 * @param tally   vMix positional tally array (index = vMix input, value = 0|1|2).
 * @param mapping vMix-input → {atemSource, cameraId} mapping for all cameras.
 * @param overrides Per-camera sticky force overrides (program | preview | off).
 * @returns ResolverOutput — never throws (D-13).
 */
export function resolve(
  tally: VmixTally | null | undefined,
  mapping: Mapping | null | undefined,
  overrides: Overrides | null | undefined,
): ResolverOutput {
  // Step 1: Defensively coerce all inputs (D-13). Build local, non-aliased copies.
  const safeTally = coerceTally(tally);
  const safeMapping = coerceMapping(mapping);
  const safeOverrides = coerceOverrides(overrides);

  // Early exit: nothing to map → safe all-off (D-11, D-13).
  if (safeMapping.length === 0) {
    return { cameras: {}, bus: { program: null, preview: null }, contended: [] };
  }

  // Build lookup: cameraId → MappingEntry (for override resolution)
  const cameraToEntry = new Map<CameraId, MappingEntry>();
  for (const entry of safeMapping) {
    cameraToEntry.set(entry.cameraId, entry);
  }

  // Build lookup: vmixInput → MappingEntry (for tally resolution)
  const vmixToEntry = new Map<number, MappingEntry>();
  for (const entry of safeMapping) {
    vmixToEntry.set(entry.vmixInput, entry);
  }

  // Collect per-camera override forces
  const forceProgram = new Map<CameraId, number>(); // cameraId → atemSource
  const forcePreview = new Map<CameraId, number>(); // cameraId → atemSource
  const forceOff = new Set<CameraId>();

  for (const override of safeOverrides) {
    const entry = cameraToEntry.get(override.cameraId);
    if (entry === undefined) continue; // D-13: override for unmapped camera → skip
    if (override.force === "program") {
      forceProgram.set(override.cameraId, entry.atemSource);
    } else if (override.force === "preview") {
      forcePreview.set(override.cameraId, entry.atemSource);
    } else {
      forceOff.add(override.cameraId);
    }
  }

  // Collect live-program and live-preview candidates from the tally array.
  // Iteration is bounded by mapping (≤8 entries), NOT by the tally array length
  // — so an oversized 1000-padded tally cannot drive unbounded output work (D-13, T-02-01).
  const liveProgramEntries: MappingEntry[] = [];
  const livePreviewEntries: MappingEntry[] = [];
  const contended: PendingContended[] = [];

  for (const entry of safeMapping) {
    const raw = safeTally[entry.vmixInput - 1]; // 1-based vmixInput → 0-based array
    const state = typeof raw === "number" && isFinite(raw) ? raw : 0;
    if (state === 1) {
      liveProgramEntries.push(entry);
    } else if (state === 2) {
      livePreviewEntries.push(entry);
    }
  }

  // Collect unmapped live inputs (D-10): vMix inputs that are live (1 or 2)
  // but have no mapping entry.
  for (let i = 0; i < safeTally.length; i++) {
    const raw = safeTally[i];
    const state = typeof raw === "number" && isFinite(raw) ? raw : 0;
    if (state === 1 || state === 2) {
      const vmixInput = i + 1; // 0-based index → 1-based vmixInput
      if (!vmixToEntry.has(vmixInput)) {
        contended.push({
          vmixInputNumber: vmixInput,
          reason: "unmapped",
          atemSource: null,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step 2: Determine bus.program winner.
  //
  // Precedence: forced-program overrides BEAT live-program inputs (D-08).
  // Among each tier, lowest atemSource wins (D-04, D-09).
  // force-off cameras are excluded from all bus consideration (D-07).
  // ---------------------------------------------------------------------------
  let programWinnerCamera: CameraId | null = null;
  let programWinnerSource: number | null = null;

  // Tier 1: forced-program overrides (D-08)
  const forceProgramCandidates = [...forceProgram.entries()].filter(
    ([camId]) => !forceOff.has(camId),
  );
  if (forceProgramCandidates.length > 0) {
    // Pick lowest atemSource (D-09)
    let bestSource = Infinity;
    let bestCam: CameraId | null = null;
    for (const [camId, src] of forceProgramCandidates) {
      if (src < bestSource) {
        bestSource = src;
        bestCam = camId;
      }
    }
    if (bestCam !== null && bestSource !== Infinity) {
      programWinnerCamera = bestCam;
      programWinnerSource = bestSource;
    }
    // All OTHER forced-program cameras are "lost-bus" contended (D-09)
    for (const [camId, src] of forceProgramCandidates) {
      if (camId !== programWinnerCamera) {
        const entry = cameraToEntry.get(camId);
        if (entry !== undefined) {
          contended.push({
            vmixInputNumber: entry.vmixInput,
            reason: "lost-bus",
            atemSource: src,
            cameraId: camId,
          });
        }
      }
    }
  }

  // Tier 2: live-program (only if no forced-program winner) (D-08)
  if (programWinnerCamera === null) {
    // Exclude force-off cameras from live-program consideration (D-07)
    const livePgmCandidates = liveProgramEntries.filter(
      (e) => !forceOff.has(e.cameraId),
    );
    if (livePgmCandidates.length > 0) {
      // Lowest atemSource wins (D-04)
      let bestSource = Infinity;
      let bestEntry: MappingEntry | null = null;
      for (const e of livePgmCandidates) {
        if (e.atemSource < bestSource) {
          bestSource = e.atemSource;
          bestEntry = e;
        }
      }
      if (bestEntry !== null) {
        programWinnerCamera = bestEntry.cameraId;
        programWinnerSource = bestEntry.atemSource;
      }
      // Losers → contended "lost-bus" (D-05/D-06)
      for (const e of livePgmCandidates) {
        if (e !== bestEntry) {
          contended.push({
            vmixInputNumber: e.vmixInput,
            reason: "lost-bus",
            atemSource: e.atemSource,
            cameraId: e.cameraId,
          });
        }
      }
    }
  } else {
    // We have a forced-program winner; live-program inputs that are NOT force-overridden
    // still lose the bus → contended "lost-bus" (D-05/D-06)
    for (const e of liveProgramEntries) {
      if (!forceOff.has(e.cameraId) && !forceProgram.has(e.cameraId)) {
        contended.push({
          vmixInputNumber: e.vmixInput,
          reason: "lost-bus",
          atemSource: e.atemSource,
          cameraId: e.cameraId,
        });
      }
    }
  }

  const busProgram: DesiredAtemBusState["program"] = programWinnerSource;

  // ---------------------------------------------------------------------------
  // Step 3: Determine bus.preview winner.
  //
  // Candidates: forced-preview overrides PLUS live-preview mapped inputs.
  // Exclude: the program winner camera (D-12 — program wins collision).
  // Exclude: force-off cameras (D-07).
  // Lowest atemSource among remaining candidates wins (D-04-style).
  // ---------------------------------------------------------------------------
  const previewCandidates: Array<{ cameraId: CameraId; atemSource: number }> = [];

  // Forced-preview overrides
  for (const [camId, src] of forcePreview.entries()) {
    if (camId !== programWinnerCamera && !forceOff.has(camId)) {
      previewCandidates.push({ cameraId: camId, atemSource: src });
    }
  }

  // Live-preview entries (exclude program winner, force-off, and forced-preview that already included)
  for (const e of livePreviewEntries) {
    if (
      e.cameraId !== programWinnerCamera &&
      !forceOff.has(e.cameraId) &&
      !forcePreview.has(e.cameraId) // avoid double-counting forced-preview cameras
    ) {
      previewCandidates.push({ cameraId: e.cameraId, atemSource: e.atemSource });
    }
  }

  let previewWinnerCamera: CameraId | null = null;
  let previewWinnerSource: number | null = null;

  if (previewCandidates.length > 0) {
    let bestSource = Infinity;
    let bestCam: CameraId | null = null;
    for (const c of previewCandidates) {
      if (c.atemSource < bestSource) {
        bestSource = c.atemSource;
        bestCam = c.cameraId;
      }
    }
    previewWinnerCamera = bestCam;
    previewWinnerSource = bestSource === Infinity ? null : bestSource;
  }

  const busPreview: DesiredAtemBusState["preview"] = previewWinnerSource;

  // ---------------------------------------------------------------------------
  // Step 4: Compose the per-camera map.
  //
  // Assign "program" to the bus.program winner first (D-12 program-wins implicit).
  // Assign "preview" to the bus.preview winner.
  // Apply force-off last (D-07) — overrides any assignment above.
  // All other cameras → "off".
  // ---------------------------------------------------------------------------
  const cameras: CameraTallyMap = {};
  for (const entry of safeMapping) {
    cameras[entry.cameraId] = "off";
  }
  if (previewWinnerCamera !== null) {
    cameras[previewWinnerCamera] = "preview";
  }
  if (programWinnerCamera !== null) {
    cameras[programWinnerCamera] = "program";
  }
  // force-off overrides even a program/preview assignment (D-07)
  for (const camId of forceOff) {
    if (camId in cameras) {
      cameras[camId] = "off";
    }
  }

  // ---------------------------------------------------------------------------
  // Step 5: Reconcile contended against the FINAL camera map, then return.
  //
  // A "lost-bus" row means "this live input is absent from the clean tally map"
  // (D-06). But a camera that lost the program bus can still recover tally on the
  // preview bus (e.g. live-program loser that is also force-preview) — it ends up
  // "preview" in `cameras`, so it is NOT absent and must not appear as "lost-bus".
  // Drop any "lost-bus" row whose camera is non-"off" in the final map, then strip
  // the internal cameraId to honor the public ContendedInput contract.
  // "unmapped" rows (no cameraId) are always preserved (D-10).
  const reconciledContended: ContendedInput[] = contended
    .filter(
      (c) =>
        c.reason !== "lost-bus" ||
        c.cameraId === undefined ||
        cameras[c.cameraId] === "off",
    )
    .map(({ cameraId: _cameraId, ...row }) => row);

  // D-11 covered: empty/all-zero tally → bus null/null, all off.
  return {
    cameras,
    bus: { program: busProgram, preview: busPreview },
    contended: reconciledContended,
  };
}
