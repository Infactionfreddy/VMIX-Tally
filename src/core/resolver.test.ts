// RED gate: import resolve from the not-yet-existing resolver module.
// This file fails tsc with TS2307 until resolver.ts is created.
// Run: npx vitest run src/core/resolver.test.ts

import { describe, it, expect } from "vitest";
import { resolve } from "./resolver.js";
import type { MappingEntry, OverrideEntry } from "./resolver.js";

// Baseline mapping: 3 cameras, ascending ATEM source numbers
const baseMapping: MappingEntry[] = [
  { vmixInput: 1, atemSource: 1, cameraId: "camA" },
  { vmixInput: 2, atemSource: 2, cameraId: "camB" },
  { vmixInput: 3, atemSource: 3, cameraId: "camC" },
];

describe("resolve() — pure resolver (D-04..D-13, SC1-SC3, SC5)", () => {
  it("SC1: returns one well-formed ResolverOutput for basic live-program input", () => {
    // vMix input 1 = program (1), others off
    const result = resolve([1, 0, 0], baseMapping, []);
    expect(result).toEqual({
      cameras: { camA: "program", camB: "off", camC: "off" },
      bus: { program: 1, preview: null },
      contended: [],
    });
  });
});
