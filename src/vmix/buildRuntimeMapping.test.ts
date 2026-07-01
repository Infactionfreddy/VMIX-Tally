// Tests for the pure Key→positional MappingEntry bridge.
// Covers: VMIX-03 (Key-anchor seam D-03, SC4 Key reorder, D-04 silent drop)
// Run: npx vitest run src/vmix/buildRuntimeMapping.test.ts

import { describe, it, expect } from "vitest";
import { buildRuntimeMapping } from "./buildRuntimeMapping.js";
import type { PersistedMappingEntry } from "../config/schema.js";

// ---------------------------------------------------------------------------
// Fixtures: top-level const — not inside beforeEach.
// ---------------------------------------------------------------------------

/** Two persisted entries with stable GUIDs as anchors. */
const persistedEntries: PersistedMappingEntry[] = [
  { vmixKey: "key-guid-1", atemSource: 1, cameraId: "camA" },
  { vmixKey: "key-guid-2", atemSource: 2, cameraId: "camB" },
];

/** Normal roster: key-guid-1 is input 1, key-guid-2 is input 2. */
const normalRoster = new Map([
  ["key-guid-1", 1],
  ["key-guid-2", 2],
]);

/**
 * SC4 reorder fixture: same keys, swapped numbers.
 * The vMix operator moved Camera A to slot 2 and Camera B to slot 1.
 * buildRuntimeMapping must produce the UPDATED vmixInput values from the live roster.
 */
const reorderedRoster = new Map([
  ["key-guid-1", 2],  // Camera A now at position 2
  ["key-guid-2", 1],  // Camera B now at position 1
]);

/**
 * D-04 partial roster: key-guid-2 was deleted from vMix.
 * Only key-guid-1 is present in the live roster.
 */
const partialRoster = new Map([
  ["key-guid-1", 1],
]);

/** Empty roster: no inputs currently in vMix. */
const emptyRoster = new Map<string, number>();

// ---------------------------------------------------------------------------
// Normal mapping
// ---------------------------------------------------------------------------

describe("normal mapping — key found in roster → correct vmixInput", () => {
  it("VMIX-03: normalRoster produces correct MappingEntry for each persisted entry", () => {
    const result = buildRuntimeMapping(persistedEntries, normalRoster);
    expect(result).toEqual([
      { vmixInput: 1, atemSource: 1, cameraId: "camA" },
      { vmixInput: 2, atemSource: 2, cameraId: "camB" },
    ]);
  });

  it("VMIX-03: result length matches number of matched keys", () => {
    const result = buildRuntimeMapping(persistedEntries, normalRoster);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// SC4: Key reorder — same keys, swapped numbers
// ---------------------------------------------------------------------------

describe("SC4 — Key reorder: same keys at different positions → updated vmixInput", () => {
  it("SC4: reorderedRoster produces camA with vmixInput:2 (position updated from roster)", () => {
    const result = buildRuntimeMapping(persistedEntries, reorderedRoster);
    const camA = result.find((e) => e.cameraId === "camA");
    expect(camA).toBeDefined();
    expect(camA?.vmixInput).toBe(2);
  });

  it("SC4: reorderedRoster produces camB with vmixInput:1 (position updated from roster)", () => {
    const result = buildRuntimeMapping(persistedEntries, reorderedRoster);
    const camB = result.find((e) => e.cameraId === "camB");
    expect(camB).toBeDefined();
    expect(camB?.vmixInput).toBe(1);
  });

  it("SC4: reorderedRoster preserves atemSource values (only vmixInput changes)", () => {
    const result = buildRuntimeMapping(persistedEntries, reorderedRoster);
    expect(result).toEqual([
      { vmixInput: 2, atemSource: 1, cameraId: "camA" },
      { vmixInput: 1, atemSource: 2, cameraId: "camB" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// D-04: Deleted key → silently dropped
// ---------------------------------------------------------------------------

describe("D-04 — deleted key: absent from roster → silently dropped, other entries unaffected", () => {
  it("D-04: partialRoster drops key-guid-2 (absent), keeps key-guid-1", () => {
    const result = buildRuntimeMapping(persistedEntries, partialRoster);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ vmixInput: 1, atemSource: 1, cameraId: "camA" });
  });

  it("D-04: dropped entry produces no error, no undefined in result", () => {
    const result = buildRuntimeMapping(persistedEntries, partialRoster);
    // Verify camB is completely absent (not null/undefined)
    const camB = result.find((e) => e.cameraId === "camB");
    expect(camB).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Edge cases: empty inputs
// ---------------------------------------------------------------------------

describe("empty persisted mapping → empty result", () => {
  it("VMIX-03: empty persisted array returns [] regardless of roster", () => {
    const result = buildRuntimeMapping([], normalRoster);
    expect(result).toEqual([]);
  });
});

describe("empty roster → all entries silently dropped", () => {
  it("D-04: empty roster drops all persisted entries → empty result", () => {
    const result = buildRuntimeMapping(persistedEntries, emptyRoster);
    expect(result).toEqual([]);
  });
});
