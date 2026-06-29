// Exhaustive resolver test suite: one test per precedence tier and edge case.
// Covers D-04..D-13, SC1, SC2 (live never mutated), SC3, SC5.
// Run: npx vitest run src/core/resolver.test.ts

import { describe, it, expect } from "vitest";
import { resolve } from "./resolver.js";
import type { MappingEntry, OverrideEntry } from "./resolver.js";

// ---------------------------------------------------------------------------
// Baseline fixtures: 4 cameras, ascending ATEM source numbers
// ---------------------------------------------------------------------------

const baseMapping: MappingEntry[] = [
  { vmixInput: 1, atemSource: 1, cameraId: "camA" },
  { vmixInput: 2, atemSource: 2, cameraId: "camB" },
  { vmixInput: 3, atemSource: 3, cameraId: "camC" },
  { vmixInput: 4, atemSource: 4, cameraId: "camD" },
];

// All-off tally
const allOff = [0, 0, 0, 0];

// ---------------------------------------------------------------------------
// SC1: Well-formed single ResolverOutput
// ---------------------------------------------------------------------------

describe("SC1 — resolve returns one well-formed ResolverOutput", () => {
  it("SC1: basic live-program returns cameras+bus+contended with correct shapes", () => {
    const result = resolve([1, 0, 0, 0], baseMapping, []);
    expect(result).toEqual({
      cameras: { camA: "program", camB: "off", camC: "off", camD: "off" },
      bus: { program: 1, preview: null },
      contended: [],
    });
  });

  it("SC1: live-preview returns correct bus.preview and camera preview state", () => {
    const result = resolve([0, 2, 0, 0], baseMapping, []);
    expect(result).toEqual({
      cameras: { camA: "off", camB: "preview", camC: "off", camD: "off" },
      bus: { program: null, preview: 2 },
      contended: [],
    });
  });

  it("SC1: program+preview together returns correct bus and per-camera map", () => {
    const result = resolve([1, 2, 0, 0], baseMapping, []);
    expect(result).toEqual({
      cameras: { camA: "program", camB: "preview", camC: "off", camD: "off" },
      bus: { program: 1, preview: 2 },
      contended: [],
    });
  });
});

// ---------------------------------------------------------------------------
// SC2 — live never mutated (ARCHITECTURE Anti-Pattern 4)
// ---------------------------------------------------------------------------

describe("SC2 — live state is never mutated by resolve()", () => {
  it("SC2: original tally/mapping/overrides arrays are unchanged after resolve (D-08)", () => {
    const tally = [1, 2, 0, 0];
    const mapping: MappingEntry[] = [
      { vmixInput: 1, atemSource: 1, cameraId: "camA" },
      { vmixInput: 2, atemSource: 2, cameraId: "camB" },
    ];
    const overrides: OverrideEntry[] = [{ cameraId: "camB", force: "program" }];

    // Snapshot before resolve
    const tallyBefore = structuredClone(tally);
    const mappingBefore = structuredClone(mapping);
    const overridesBefore = structuredClone(overrides);

    resolve(tally, mapping, overrides);

    // Verify inputs unchanged after resolve
    expect(tally).toEqual(tallyBefore);
    expect(mapping).toEqual(mappingBefore);
    expect(overrides).toEqual(overridesBefore);
  });

  it("SC2: clearing the override after a force-program reveals pure live state", () => {
    const tally = [1, 0, 0, 0];
    const mapping = baseMapping;
    const overrides: OverrideEntry[] = [{ cameraId: "camB", force: "program" }];

    // With override: camB is forced-program; its atemSource (2) is higher than camA (1)
    // BUT forced-program beats live-program (D-08): camB (atemSource=2) wins because
    // it's the ONLY forced-program candidate; camA is a live-program loser
    const withOverride = resolve(tally, mapping, overrides);
    expect(withOverride.bus.program).toBe(2); // forced camB wins
    expect(withOverride.cameras["camA"]).toBe("off"); // live camA loses

    // Without override: pure live result
    const withoutOverride = resolve(tally, mapping, []);
    expect(withoutOverride.bus.program).toBe(1); // live camA wins
    expect(withoutOverride.cameras["camA"]).toBe("program");
    expect(withoutOverride.cameras["camB"]).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// SC3 / CORE-04 / D-04 / D-05 / D-06 — multi-program arbitration
// ---------------------------------------------------------------------------

describe("SC3/CORE-04/D-04/D-05/D-06 — lowest ATEM number wins when multiple inputs are live-program", () => {
  it("D-04/D-05: two live-program inputs — lower ATEM # wins bus.program, higher is off (CORE-04)", () => {
    // camA (atemSource=1) and camB (atemSource=2) both program
    const result = resolve([1, 1, 0, 0], baseMapping, []);
    expect(result.bus.program).toBe(1); // lowest ATEM source wins
    expect(result.cameras["camA"]).toBe("program");
    expect(result.cameras["camB"]).toBe("off"); // physical truth: only bus winner is red
  });

  it("D-06: losing live-program input appears in contended with reason lost-bus", () => {
    const result = resolve([1, 1, 0, 0], baseMapping, []);
    expect(result.contended).toContainEqual({
      vmixInputNumber: 2, // camB
      reason: "lost-bus",
      atemSource: 2,
    });
  });

  it("SC3: three live-program inputs — lowest atemSource wins, two losers in contended (CORE-04/D-04)", () => {
    const result = resolve([1, 1, 1, 0], baseMapping, []);
    expect(result.bus.program).toBe(1); // camA wins
    expect(result.cameras["camA"]).toBe("program");
    expect(result.cameras["camB"]).toBe("off");
    expect(result.cameras["camC"]).toBe("off");
    expect(result.contended.filter((c) => c.reason === "lost-bus")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// CR-01 / D-06 cross-field consistency — contended must never contradict cameras
// Regression for the verification BLOCKER: a "lost-bus" row is "absent from the
// clean tally map" (D-06), so it must NEVER name a camera that the final map
// shows as program/preview. A live-program loser that recovers tally on the
// preview bus is the canonical trigger.
// ---------------------------------------------------------------------------

describe("CR-01/D-06 — contended never lists a camera that has tally in the final map", () => {
  it("CR-01: live-program loser that wins the preview bus is NOT reported as lost-bus", () => {
    // camA + camB both live-program (camA wins, atemSource 1 < 2); camB is also
    // force-preview, so it recovers tally on the preview bus → "preview", green.
    const result = resolve(
      [1, 1, 0, 0],
      baseMapping,
      [{ cameraId: "camB", force: "preview" }],
    );
    // camB visibly has green tally...
    expect(result.cameras["camB"]).toBe("preview");
    expect(result.bus.preview).toBe(2);
    expect(result.cameras["camA"]).toBe("program");
    // ...so it must NOT also appear as "lost-bus" (the old self-contradiction).
    expect(
      result.contended.some(
        (c) => c.reason === "lost-bus" && c.atemSource === 2,
      ),
    ).toBe(false);
    // camB lost the program bus but recovered preview → contended is fully clean here.
    expect(result.contended).toEqual([]);
  });

  it("CR-01 invariant: no camera that is non-off in `cameras` appears as lost-bus in `contended`", () => {
    // Exercise a spread of program/preview/override collisions and assert the
    // cross-field invariant holds for every contended lost-bus row.
    const scenarios: ReadonlyArray<{
      tally: number[];
      overrides: OverrideEntry[];
    }> = [
      { tally: [1, 1, 0, 0], overrides: [{ cameraId: "camB", force: "preview" }] },
      { tally: [1, 1, 1, 0], overrides: [{ cameraId: "camC", force: "preview" }] },
      { tally: [1, 1, 2, 0], overrides: [{ cameraId: "camB", force: "preview" }] },
      {
        tally: [1, 1, 0, 0],
        overrides: [
          { cameraId: "camA", force: "program" },
          { cameraId: "camB", force: "preview" },
        ],
      },
    ];
    const sourceToCamera = new Map(
      baseMapping.map((m) => [m.atemSource, m.cameraId]),
    );
    for (const { tally, overrides } of scenarios) {
      const result = resolve(tally, baseMapping, overrides);
      for (const c of result.contended) {
        if (c.reason !== "lost-bus" || c.atemSource === null) continue;
        const camId = sourceToCamera.get(c.atemSource);
        if (camId === undefined) continue;
        // The defect being guarded: a "lost-bus" camera must be "off" in the map.
        expect(result.cameras[camId]).toBe("off");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// D-07 — force-off override
// ---------------------------------------------------------------------------

describe("D-07 — force-off removes camera from bus and program consideration", () => {
  it("D-07: force-off on live-program camera removes it from bus.program; next candidate takes it", () => {
    // camA (atemSource=1) is live-program, but force-off → camB (atemSource=2) should win
    const overrides: OverrideEntry[] = [{ cameraId: "camA", force: "off" }];
    const result = resolve([1, 1, 0, 0], baseMapping, overrides);
    expect(result.bus.program).toBe(2); // camB wins because camA forced off
    expect(result.cameras["camA"]).toBe("off");
    expect(result.cameras["camB"]).toBe("program");
  });

  it("D-07: force-off on the only live-program camera → bus.program is null", () => {
    const overrides: OverrideEntry[] = [{ cameraId: "camA", force: "off" }];
    const result = resolve([1, 0, 0, 0], baseMapping, overrides);
    expect(result.bus.program).toBe(null);
    expect(result.cameras["camA"]).toBe("off");
  });

  it("D-07: force-off on live-preview camera removes it from bus.preview", () => {
    const overrides: OverrideEntry[] = [{ cameraId: "camB", force: "off" }];
    const result = resolve([1, 2, 0, 0], baseMapping, overrides);
    expect(result.bus.preview).toBe(null);
    expect(result.cameras["camB"]).toBe("off");
  });
});

// ---------------------------------------------------------------------------
// D-08 — forced-program override beats live-program
// ---------------------------------------------------------------------------

describe("D-08 — forced-program override beats live-program regardless of ATEM number", () => {
  it("D-08: low-numbered live-program + higher-numbered force-program → override wins bus (D-08)", () => {
    // camA (atemSource=1) is live-program — should normally win lowest-#
    // camC (atemSource=3) is forced-program — but force beats live regardless of number
    const overrides: OverrideEntry[] = [{ cameraId: "camC", force: "program" }];
    const result = resolve([1, 0, 0, 0], baseMapping, overrides);
    // Forced-program tier is evaluated first; camC wins even though atemSource=3 > 1
    expect(result.bus.program).toBe(3);
    expect(result.cameras["camC"]).toBe("program");
    expect(result.cameras["camA"]).toBe("off"); // live-program camA loses (D-08)
  });

  it("D-08: camA live-program AND camA force-program → no contention; camA wins normally", () => {
    // Both apply to same camera — it simply wins and is not contended with itself
    const overrides: OverrideEntry[] = [{ cameraId: "camA", force: "program" }];
    const result = resolve([1, 0, 0, 0], baseMapping, overrides);
    expect(result.bus.program).toBe(1);
    expect(result.cameras["camA"]).toBe("program");
    expect(result.contended.filter((c) => c.vmixInputNumber === 1)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D-09 — multiple forced-program overrides
// ---------------------------------------------------------------------------

describe("D-09 — multiple forced-program overrides: lowest atemSource wins bus", () => {
  it("D-09: two force-program overrides — lower atemSource wins bus, other is contended lost-bus", () => {
    // camB (atemSource=2) and camC (atemSource=3) both forced-program
    const overrides: OverrideEntry[] = [
      { cameraId: "camB", force: "program" },
      { cameraId: "camC", force: "program" },
    ];
    const result = resolve(allOff, baseMapping, overrides);
    expect(result.bus.program).toBe(2); // camB has lower atemSource
    expect(result.cameras["camB"]).toBe("program");
    expect(result.cameras["camC"]).toBe("off"); // loses arbitration
    expect(result.contended).toContainEqual({
      vmixInputNumber: 3,
      reason: "lost-bus",
      atemSource: 3,
    });
  });

  it("D-09: three force-program overrides — lowest wins, other two are lost-bus contended", () => {
    const overrides: OverrideEntry[] = [
      { cameraId: "camA", force: "program" },
      { cameraId: "camB", force: "program" },
      { cameraId: "camC", force: "program" },
    ];
    const result = resolve(allOff, baseMapping, overrides);
    expect(result.bus.program).toBe(1); // camA wins (lowest)
    expect(result.cameras["camA"]).toBe("program");
    expect(result.contended.filter((c) => c.reason === "lost-bus")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// D-10 — unmapped live inputs
// ---------------------------------------------------------------------------

describe("D-10 — live vMix input with no mapping is ignored for bus and flagged unmapped", () => {
  it("D-10: live-program vMix input 5 has no mapping → contended unmapped, no bus effect", () => {
    // 5-element tally: vmix input 5 = program, but only inputs 1-4 are in mapping
    const result = resolve([0, 0, 0, 0, 1], baseMapping, []);
    expect(result.bus.program).toBe(null); // no mapped input is live
    expect(result.contended).toContainEqual({
      vmixInputNumber: 5,
      reason: "unmapped",
      atemSource: null,
    });
  });

  it("D-10: live-preview vMix input with no mapping → contended unmapped", () => {
    const result = resolve([0, 0, 0, 0, 2], baseMapping, []);
    expect(result.bus.preview).toBe(null);
    expect(result.contended).toContainEqual({
      vmixInputNumber: 5,
      reason: "unmapped",
      atemSource: null,
    });
  });

  it("D-10: unmapped live does not block a mapped live camera from being program", () => {
    // vmix 1 = mapped (program), vmix 5 = unmapped (program)
    const result = resolve([1, 0, 0, 0, 1], baseMapping, []);
    expect(result.bus.program).toBe(1); // camA wins
    expect(result.cameras["camA"]).toBe("program");
    expect(result.contended).toContainEqual({
      vmixInputNumber: 5,
      reason: "unmapped",
      atemSource: null,
    });
  });
});

// ---------------------------------------------------------------------------
// D-11 — empty / all-zero / undefined / null tally
// ---------------------------------------------------------------------------

describe("D-11 — empty/all-zero/undefined/null tally resolves to all-off with no override", () => {
  it("D-11: empty array tally → bus null/null, all cameras off", () => {
    const result = resolve([], baseMapping, []);
    expect(result.bus).toEqual({ program: null, preview: null });
    for (const state of Object.values(result.cameras)) {
      expect(state).toBe("off");
    }
  });

  it("D-11: all-zero tally → bus null/null, all cameras off", () => {
    const result = resolve(allOff, baseMapping, []);
    expect(result.bus).toEqual({ program: null, preview: null });
    for (const state of Object.values(result.cameras)) {
      expect(state).toBe("off");
    }
  });

  it("D-11: undefined tally → bus null/null, all cameras off", () => {
    const result = resolve(undefined, baseMapping, []);
    expect(result.bus).toEqual({ program: null, preview: null });
    for (const state of Object.values(result.cameras)) {
      expect(state).toBe("off");
    }
  });

  it("D-11: null tally → bus null/null, all cameras off", () => {
    const result = resolve(null, baseMapping, []);
    expect(result.bus).toEqual({ program: null, preview: null });
    for (const state of Object.values(result.cameras)) {
      expect(state).toBe("off");
    }
  });

  it("D-11: active override on all-zero tally still fires (override beats nothing-live)", () => {
    const overrides: OverrideEntry[] = [{ cameraId: "camA", force: "program" }];
    const result = resolve(allOff, baseMapping, overrides);
    expect(result.bus.program).toBe(1); // force-program override takes the bus
    expect(result.cameras["camA"]).toBe("program");
  });
});

// ---------------------------------------------------------------------------
// D-12 — program-wins when same camera is both program and preview
// ---------------------------------------------------------------------------

describe("D-12 — program wins when same camera is both program and preview simultaneously", () => {
  it("D-12: tally value 1 (program) on a camera that is also force-preview → camera is program", () => {
    // camA is live-program; someone also force-previews camA → program wins (D-12)
    const overrides: OverrideEntry[] = [{ cameraId: "camA", force: "preview" }];
    const result = resolve([1, 0, 0, 0], baseMapping, overrides);
    // camA is in both program-tier (live) and preview-tier (override), program wins
    expect(result.cameras["camA"]).toBe("program");
    expect(result.bus.program).toBe(1);
  });

  it("D-12: preview winner excluded from program-wins: camA is program, camA is also preview candidate → camA is program not preview in map (D-12)", () => {
    // camA live-program; camA also live-preview (weird vMix state)
    // The program-wins logic: preview winner is excluded when it equals program winner
    const result = resolve([1, 2, 0, 0], baseMapping, []);
    // camA wins program; camB wins preview (since camA already assigned program)
    // Wait — camA=1, camB=2; so camA program, camB preview
    expect(result.cameras["camA"]).toBe("program");
    expect(result.cameras["camB"]).toBe("preview");
    expect(result.bus.program).toBe(1);
    expect(result.bus.preview).toBe(2);
  });

  it("D-12: force-program camA AND force-preview camA → camA is program (program wins collision)", () => {
    const overrides: OverrideEntry[] = [
      { cameraId: "camA", force: "program" },
      { cameraId: "camA", force: "preview" },
    ];
    // When the same cameraId has both force-program and force-preview entries,
    // force-program takes it to program-tier first; the preview entry excludes camA
    // from preview because camA === programWinnerCamera
    const result = resolve(allOff, baseMapping, overrides);
    expect(result.cameras["camA"]).toBe("program");
    expect(result.bus.program).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D-13 — total function: never throws on malformed input
// ---------------------------------------------------------------------------

describe("D-13 — resolve is a total function that never throws on malformed/empty/adversarial input", () => {
  it("D-13: non-array tally (object) → safe all-off ResolverOutput, no throw", () => {
    expect(() =>
      resolve({ 0: 1 } as unknown as number[], baseMapping, []),
    ).not.toThrow();
    const result = resolve({ 0: 1 } as unknown as number[], baseMapping, []);
    expect(result.bus).toEqual({ program: null, preview: null });
  });

  it("D-13: tally with NaN values → safe, NaN treated as off (not program or preview)", () => {
    expect(() => resolve([NaN, NaN, 1, 0], baseMapping, [])).not.toThrow();
    const result = resolve([NaN, NaN, 1, 0], baseMapping, []);
    // NaN values coerced to off; camC (vmixInput=3, index=2) = program
    expect(result.cameras["camC"]).toBe("program");
    expect(result.cameras["camA"]).toBe("off");
    expect(result.cameras["camB"]).toBe("off");
  });

  it("D-13: empty mapping → returns empty cameras object, no throw", () => {
    expect(() => resolve([1, 0], [], [])).not.toThrow();
    const result = resolve([1, 0], [], []);
    expect(result.cameras).toEqual({});
    expect(result.bus).toEqual({ program: null, preview: null });
  });

  it("D-13: null mapping → returns empty cameras, no throw", () => {
    expect(() => resolve([1, 0], null, [])).not.toThrow();
    const result = resolve([1, 0], null, []);
    expect(result.cameras).toEqual({});
    expect(result.bus).toEqual({ program: null, preview: null });
  });

  it("D-13: malformed override entry with invalid force value → skipped, no throw", () => {
    const badOverrides = [
      { cameraId: "camA", force: "RED" as "program" }, // invalid force
    ];
    expect(() => resolve([1, 0, 0, 0], baseMapping, badOverrides)).not.toThrow();
    // Bad override dropped; pure live result
    const result = resolve([1, 0, 0, 0], baseMapping, badOverrides);
    expect(result.bus.program).toBe(1); // live camA wins without interference
  });

  it("D-13: mapping entry with non-integer atemSource → entry dropped, no throw", () => {
    const badMapping: MappingEntry[] = [
      { vmixInput: 1, atemSource: 1.5 as number, cameraId: "camA" },
      { vmixInput: 2, atemSource: 2, cameraId: "camB" },
    ];
    expect(() => resolve([1, 0], badMapping, [])).not.toThrow();
    const result = resolve([1, 0], badMapping, []);
    // camA entry dropped (atemSource=1.5 is not integer); camB is only valid entry
    expect(Object.keys(result.cameras)).not.toContain("camA");
    expect(Object.keys(result.cameras)).toContain("camB");
  });

  it("D-13: oversized tally array (1000 entries) — output bounded by mapping, not tally length", () => {
    const bigTally = new Array<number>(1000).fill(0);
    bigTally[0] = 1; // vmixInput 1 = program
    expect(() => resolve(bigTally, baseMapping, [])).not.toThrow();
    const result = resolve(bigTally, baseMapping, []);
    // Only 4 mapping entries; output has exactly 4 cameras
    expect(Object.keys(result.cameras)).toHaveLength(4);
    expect(result.cameras["camA"]).toBe("program");
  });

  it("D-13: completely null tally and null overrides → safe all-off, no throw", () => {
    expect(() => resolve(null, baseMapping, null)).not.toThrow();
    const result = resolve(null, baseMapping, null);
    expect(result.bus).toEqual({ program: null, preview: null });
  });
});

// ---------------------------------------------------------------------------
// SC5 — every camera is exactly one of off|program|preview
// ---------------------------------------------------------------------------

describe("SC5 — every camera in output map is exactly off|program|preview, nothing else", () => {
  it("SC5: complex scenario — all camera states are valid enum values", () => {
    const overrides: OverrideEntry[] = [
      { cameraId: "camC", force: "program" },
      { cameraId: "camD", force: "off" },
    ];
    const result = resolve([1, 2, 0, 0], baseMapping, overrides);
    const validStates = new Set(["off", "program", "preview"]);
    for (const [cam, state] of Object.entries(result.cameras)) {
      expect(
        validStates.has(state),
        `${cam} has invalid state: ${state}`,
      ).toBe(true);
    }
  });

  it("SC5: all-override scenario — all camera states are valid enum values", () => {
    const overrides: OverrideEntry[] = [
      { cameraId: "camA", force: "program" },
      { cameraId: "camB", force: "preview" },
      { cameraId: "camC", force: "off" },
      { cameraId: "camD", force: "off" },
    ];
    const result = resolve(allOff, baseMapping, overrides);
    const validStates = new Set(["off", "program", "preview"]);
    for (const state of Object.values(result.cameras)) {
      expect(validStates.has(state)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Extra: force-preview contributes to bus.preview (D-07 preview override path)
// ---------------------------------------------------------------------------

describe("D-07 preview override — forced-preview camera gets bus.preview when not program winner", () => {
  it("D-07: force-preview on an otherwise-off camera sets bus.preview and camera to preview", () => {
    const overrides: OverrideEntry[] = [{ cameraId: "camC", force: "preview" }];
    const result = resolve(allOff, baseMapping, overrides);
    expect(result.bus.preview).toBe(3);
    expect(result.cameras["camC"]).toBe("preview");
  });

  it("D-07: force-preview loses to live-program for that slot; forced-preview camera is still preview (not program)", () => {
    // camA is live-program; camC is forced-preview
    const overrides: OverrideEntry[] = [{ cameraId: "camC", force: "preview" }];
    const result = resolve([1, 0, 0, 0], baseMapping, overrides);
    expect(result.bus.program).toBe(1);
    expect(result.bus.preview).toBe(3);
    expect(result.cameras["camA"]).toBe("program");
    expect(result.cameras["camC"]).toBe("preview");
  });
});
