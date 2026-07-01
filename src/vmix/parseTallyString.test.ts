// Tests for the pure vMix tally string parser.
// Covers: VMIX-03 (positional tally indexing contract, empty roster, defensive coercion)
// Run: npx vitest run src/vmix/parseTallyString.test.ts

import { describe, it, expect } from "vitest";
import { parseTallyString } from "./parseTallyString.js";

// ---------------------------------------------------------------------------
// VMIX-03: empty roster
// ---------------------------------------------------------------------------

describe("VMIX-03 — parseTallyString: empty string (empty roster)", () => {
  it("VMIX-03: empty string returns [] (empty roster — no crash)", () => {
    expect(parseTallyString("")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// VMIX-03: single input
// ---------------------------------------------------------------------------

describe("VMIX-03 — parseTallyString: single input", () => {
  it("VMIX-03: '0' returns [0] (single input, off)", () => {
    expect(parseTallyString("0")).toEqual([0]);
  });

  it("VMIX-03: '1' returns [1] (single input, program)", () => {
    expect(parseTallyString("1")).toEqual([1]);
  });

  it("VMIX-03: '2' returns [2] (single input, preview)", () => {
    expect(parseTallyString("2")).toEqual([2]);
  });
});

// ---------------------------------------------------------------------------
// VMIX-03: multi-input normal case
// ---------------------------------------------------------------------------

describe("VMIX-03 — parseTallyString: normal multi-input tally", () => {
  it("VMIX-03: '1020' returns [1,0,2,0] (four inputs, input1=program, input3=preview)", () => {
    expect(parseTallyString("1020")).toEqual([1, 0, 2, 0]);
  });

  it("VMIX-03: '222' returns [2,2,2] (all preview — boundary)", () => {
    expect(parseTallyString("222")).toEqual([2, 2, 2]);
  });
});

// ---------------------------------------------------------------------------
// VMIX-03: positional contract — array[i] = state of vMix input (i+1)
// ---------------------------------------------------------------------------

describe("VMIX-03 — parseTallyString: positional contract (index = input - 1)", () => {
  it("VMIX-03: parseTallyString('10')[0] === 1 (input 1 → position 0)", () => {
    const result = parseTallyString("10");
    expect(result[0]).toBe(1); // input 1 is at index 0
  });

  it("VMIX-03: parseTallyString('10')[1] === 0 (input 2 → position 1)", () => {
    const result = parseTallyString("10");
    expect(result[1]).toBe(0); // input 2 is at index 1
  });
});

// ---------------------------------------------------------------------------
// VMIX-03: defensive coercion — non-0/1/2 characters coerce to 0
// ---------------------------------------------------------------------------

describe("VMIX-03 — parseTallyString: defensive coercion (non-0/1/2 → 0)", () => {
  it("VMIX-03: 'X' character coerced to 0 (defensive — never throw)", () => {
    expect(parseTallyString("X")).toEqual([0]);
  });

  it("VMIX-03: '3' character coerced to 0 (out-of-range digit)", () => {
    expect(parseTallyString("3")).toEqual([0]);
  });

  it("VMIX-03: '1X2' coerces X to 0 → [1,0,2]", () => {
    expect(parseTallyString("1X2")).toEqual([1, 0, 2]);
  });
});
