// Contract round-trip tests for the typed output contract in events.ts.
// These tests verify that the exported types express the correct shapes
// at both the type-level (via TypeScript compilation) and value-level
// (via runtime assertions). They constitute the RED gate for Plan 01-01.

import { describe, it, expect } from "vitest";
import type {
  CameraTallyState,
  CameraId,
  AtemSource,
  DesiredAtemBusState,
  CameraTallyMap,
  ContendedReason,
  ContendedInput,
  ResolverOutput,
} from "./events.js";

describe("CameraTallyState", () => {
  it("accepts all three valid literal members", () => {
    const off: CameraTallyState = "off";
    const program: CameraTallyState = "program";
    const preview: CameraTallyState = "preview";
    expect(off).toBe("off");
    expect(program).toBe("program");
    expect(preview).toBe("preview");
  });
});

describe("CameraTallyMap", () => {
  it("round-trips known camera ids and their states", () => {
    const map: CameraTallyMap = {
      "cam-1": "program",
      "cam-2": "preview",
      "cam-3": "off",
    };
    expect(map["cam-1"]).toBe("program");
    expect(map["cam-2"]).toBe("preview");
    expect(map["cam-3"]).toBe("off");
    expect(Object.keys(map)).toEqual(["cam-1", "cam-2", "cam-3"]);
  });
});

describe("DesiredAtemBusState", () => {
  it("accepts a concrete program and preview ATEM source id", () => {
    const bus: DesiredAtemBusState = { program: 1, preview: 2 };
    expect(bus.program).toBe(1);
    expect(bus.preview).toBe(2);
  });

  it("accepts both program and preview as null (nothing live, D-11)", () => {
    const bus: DesiredAtemBusState = { program: null, preview: null };
    expect(bus.program).toBeNull();
    expect(bus.preview).toBeNull();
  });

  it("accepts mixed: program set, preview null", () => {
    const bus: DesiredAtemBusState = { program: 3, preview: null };
    expect(bus.program).toBe(3);
    expect(bus.preview).toBeNull();
  });
});

describe("ContendedInput sidecar (D-06 / D-10)", () => {
  it("represents a lost-bus entry (live input that lost multi-program arbitration)", () => {
    const entry: ContendedInput = {
      vmixInputNumber: 4,
      reason: "lost-bus",
      atemSource: 4,
    };
    expect(entry.vmixInputNumber).toBe(4);
    expect(entry.reason).toBe("lost-bus");
    expect(entry.atemSource).toBe(4);
  });

  it("represents an unmapped entry (live input with no camera mapping)", () => {
    const entry: ContendedInput = {
      vmixInputNumber: 7,
      reason: "unmapped",
      atemSource: null,
    };
    expect(entry.vmixInputNumber).toBe(7);
    expect(entry.reason).toBe("unmapped");
    expect(entry.atemSource).toBeNull();
  });
});

describe("ResolverOutput", () => {
  it("aggregates cameras, bus, and contended as three distinct typed fields (D-01 + D-06)", () => {
    const output: ResolverOutput = {
      cameras: {
        "cam-1": "program",
        "cam-2": "off",
      },
      bus: {
        program: 1,
        preview: null,
      },
      contended: [
        {
          vmixInputNumber: 5,
          reason: "unmapped",
          atemSource: null,
        },
      ],
    };
    expect(Object.keys(output)).toEqual(["cameras", "bus", "contended"]);
    expect(output.cameras["cam-1"]).toBe("program");
    expect(output.bus.program).toBe(1);
    expect(output.bus.preview).toBeNull();
    expect(output.contended).toHaveLength(1);
    expect(output.contended[0]?.reason).toBe("unmapped");
  });

  it("allows an empty contended array (no contention — clean tally)", () => {
    const output: ResolverOutput = {
      cameras: { "cam-1": "off" },
      bus: { program: null, preview: null },
      contended: [],
    };
    expect(output.contended).toHaveLength(0);
  });
});
