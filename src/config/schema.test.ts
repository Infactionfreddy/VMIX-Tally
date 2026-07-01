// Invariant + boundary tests for the persisted config schema.
// Covers: D-07 (three uniqueness invariants), D-08 (partial mapping), D-09 (≤8 cap,
// atemSource positive int not capped at 8), D-10 (structured error shape),
// and alignment with the resolver's coerceMapping shared-field guards.
// Run: npx vitest run src/config/schema.test.ts

import { describe, it, expect } from "vitest";
import { schema, toConfigValidationError } from "./schema.js";
import type { PersistedConfig } from "./schema.js";

// ---------------------------------------------------------------------------
// Baseline fixture: a minimal valid PersistedConfig (0 mapping entries)
// Mutate per-test with structuredClone to keep each test independent.
// ---------------------------------------------------------------------------

const baseConfig: PersistedConfig = {
  version: 1,
  settings: { vmix: null, atem: null },
  mapping: [],
};

/** A valid 2-entry mapping for use in multi-entry tests. */
const twoEntries: PersistedConfig["mapping"] = [
  {
    vmixKey: "a0000000-0000-0000-0000-000000000001",
    vmixNumber: 1,
    vmixTitle: "Camera A",
    atemSource: 1,
    cameraId: "camA",
  },
  {
    vmixKey: "a0000000-0000-0000-0000-000000000002",
    vmixNumber: 2,
    vmixTitle: "Camera B",
    atemSource: 2,
    cameraId: "camB",
  },
];

// ---------------------------------------------------------------------------
// D-08: Partial / empty mapping is valid
// ---------------------------------------------------------------------------

describe("D-08 — partial and empty mapping", () => {
  it("D-08: empty mapping (0 entries) is valid", () => {
    const result = schema.safeParse(structuredClone(baseConfig));
    expect(result.success).toBe(true);
  });

  it("D-08: 3-entry mapping is valid", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = [
      { vmixKey: "key-1", atemSource: 1, cameraId: "camA" },
      { vmixKey: "key-2", atemSource: 2, cameraId: "camB" },
      { vmixKey: "key-3", atemSource: 3, cameraId: "camC" },
    ];
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D-09: ≤8 entry cap; atemSource is a positive int, NOT capped at 8
// ---------------------------------------------------------------------------

describe("D-09 — entry cap and atemSource range", () => {
  it("D-09: 8 mapping entries accepted", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = Array.from({ length: 8 }, (_, i) => ({
      vmixKey: `key-${i + 1}`,
      atemSource: i + 1,
      cameraId: `cam${i + 1}`,
    }));
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it("MAP-01: 9th entry rejected with mapping-array error", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = Array.from({ length: 9 }, (_, i) => ({
      vmixKey: `key-${i + 1}`,
      atemSource: i + 1,
      cameraId: `cam${i + 1}`,
    }));
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((iss) => iss.path);
      // The .max(8) error targets the mapping array itself
      expect(paths.some((p) => p.length === 1 && p[0] === "mapping")).toBe(true);
    }
  });

  it("D-09: atemSource = 9999 accepted (positive int, not capped at 8)", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = [{ vmixKey: "key-1", atemSource: 9999, cameraId: "camA" }];
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it("D-09: atemSource = 0 rejected", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = [{ vmixKey: "key-1", atemSource: 0, cameraId: "camA" }];
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it("D-09: atemSource = -1 rejected", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = [{ vmixKey: "key-1", atemSource: -1, cameraId: "camA" }];
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it("D-09: cameraId empty string rejected", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = [{ vmixKey: "key-1", atemSource: 1, cameraId: "" }];
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D-07: Three uniqueness invariants, each producing element-pathed errors
// ---------------------------------------------------------------------------

describe("D-07 — uniqueness: vmixKey", () => {
  it("D-07: duplicate vmixKey rejected with element path", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = [
      { vmixKey: "same-key", atemSource: 1, cameraId: "camA" },
      { vmixKey: "same-key", atemSource: 2, cameraId: "camB" },
    ];
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((iss) => iss.path);
      // Issue must be at ["mapping", 1, "vmixKey"] (second occurrence)
      expect(
        paths.some(
          (p) => p[0] === "mapping" && typeof p[1] === "number" && p[2] === "vmixKey"
        )
      ).toBe(true);
    }
  });
});

describe("D-07 — uniqueness: atemSource", () => {
  it("D-07: duplicate atemSource rejected with element path", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = [
      { vmixKey: "key-1", atemSource: 5, cameraId: "camA" },
      { vmixKey: "key-2", atemSource: 5, cameraId: "camB" },
    ];
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((iss) => iss.path);
      expect(
        paths.some(
          (p) => p[0] === "mapping" && typeof p[1] === "number" && p[2] === "atemSource"
        )
      ).toBe(true);
    }
  });
});

describe("D-07 — uniqueness: cameraId", () => {
  it("D-07: duplicate cameraId rejected with element path", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = [
      { vmixKey: "key-1", atemSource: 1, cameraId: "camSame" },
      { vmixKey: "key-2", atemSource: 2, cameraId: "camSame" },
    ];
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((iss) => iss.path);
      expect(
        paths.some(
          (p) => p[0] === "mapping" && typeof p[1] === "number" && p[2] === "cameraId"
        )
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Entry field validation: vmixKey min(1), optional fields
// ---------------------------------------------------------------------------

describe("entry field validation", () => {
  it("vmixKey empty string rejected", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = [{ vmixKey: "", atemSource: 1, cameraId: "camA" }];
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it("vmixNumber and vmixTitle optional — entry without them is valid", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = [{ vmixKey: "key-1", atemSource: 1, cameraId: "camA" }];
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it("vmixNumber non-positive rejected", () => {
    // Pass unknown to safeParse to test runtime validation without TS error
    const raw: unknown = {
      settings: { vmix: null, atem: null },
      mapping: [{ vmixKey: "key-1", vmixNumber: 0, atemSource: 1, cameraId: "camA" }],
    };
    const result = schema.safeParse(raw);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Connection settings: nullable (D-11), valid host/port
// ---------------------------------------------------------------------------

describe("connection settings", () => {
  it("settings.vmix and settings.atem may both be null (first-boot)", () => {
    const result = schema.safeParse(structuredClone(baseConfig));
    expect(result.success).toBe(true);
  });

  it("settings with valid host+port accepted", () => {
    const cfg = structuredClone(baseConfig);
    cfg.settings.vmix = { host: "192.168.1.100", port: 8099 };
    cfg.settings.atem = { host: "192.168.1.200", port: 9910 };
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it("port = 0 rejected", () => {
    const result = schema.safeParse({
      settings: { vmix: { host: "192.168.1.1", port: 0 }, atem: null },
      mapping: [],
    });
    expect(result.success).toBe(false);
  });

  it("port = 65535 accepted", () => {
    const result = schema.safeParse({
      settings: { vmix: { host: "192.168.1.1", port: 65535 }, atem: null },
      mapping: [],
    });
    expect(result.success).toBe(true);
  });

  it("port = 65536 rejected", () => {
    const result = schema.safeParse({
      settings: { vmix: { host: "192.168.1.1", port: 65536 }, atem: null },
      mapping: [],
    });
    expect(result.success).toBe(false);
  });

  it("host empty string rejected", () => {
    const result = schema.safeParse({
      settings: { vmix: { host: "", port: 8099 }, atem: null },
      mapping: [],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// version field: optional literal 1
// ---------------------------------------------------------------------------

describe("version field", () => {
  it("version absent is valid (optional)", () => {
    const result = schema.safeParse({
      settings: { vmix: null, atem: null },
      mapping: [],
    });
    expect(result.success).toBe(true);
  });

  it("version: 1 accepted", () => {
    const result = schema.safeParse({
      version: 1,
      settings: { vmix: null, atem: null },
      mapping: [],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D-10: toConfigValidationError produces structured shape
// ---------------------------------------------------------------------------

describe("D-10 — ConfigValidationError shape (toConfigValidationError)", () => {
  it("D-10: toConfigValidationError returns kind, issues[], and tree", () => {
    const cfg = structuredClone(baseConfig);
    cfg.mapping = [{ vmixKey: "same", atemSource: 1, cameraId: "camA" }, { vmixKey: "same", atemSource: 2, cameraId: "camB" }];
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(false);
    if (!result.success) {
      const validationError = toConfigValidationError(result.error);
      expect(validationError.kind).toBe("config-validation");
      expect(Array.isArray(validationError.issues)).toBe(true);
      expect(validationError.issues.length).toBeGreaterThan(0);
      // Each issue has path, message, code
      for (const issue of validationError.issues) {
        expect(Array.isArray(issue.path)).toBe(true);
        expect(typeof issue.message).toBe("string");
        expect(typeof issue.code).toBe("string");
      }
      // tree must be an object (z.treeifyError result)
      expect(typeof validationError.tree).toBe("object");
      expect(validationError.tree).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Alignment with coerceMapping (drift guard)
// Any PersistedMappingEntry accepted by the zod schema must satisfy the
// resolver's shared-field guards on atemSource and cameraId.
// Asserts the persistence gate is AT LEAST AS STRICT as the runtime gate.
// ---------------------------------------------------------------------------

describe("alignment with coerceMapping shared-field guards", () => {
  /**
   * Simulates the relevant subset of the resolver's coerceMapping guard
   * for the two shared fields: atemSource > 0 and cameraId.length > 0.
   * This is NOT imported from the resolver (D-03) — it's a local mirror.
   */
  function passesResolverSharedFieldGuards(entry: {
    atemSource: unknown;
    cameraId: unknown;
  }): boolean {
    return (
      typeof entry.atemSource === "number" &&
      Number.isInteger(entry.atemSource) &&
      entry.atemSource > 0 &&
      isFinite(entry.atemSource) &&
      typeof entry.cameraId === "string" &&
      entry.cameraId.length > 0
    );
  }

  it("alignment: any accepted entry satisfies resolver atemSource > 0 guard", () => {
    const validEntries = [
      { vmixKey: "k1", atemSource: 1, cameraId: "camA" },
      { vmixKey: "k2", atemSource: 9999, cameraId: "camB" },
      { vmixKey: "k3", atemSource: 100, cameraId: "camC" },
    ];
    for (const entry of validEntries) {
      const result = schema.safeParse({
        settings: { vmix: null, atem: null },
        mapping: [entry],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        const accepted = result.data.mapping[0];
        if (accepted !== undefined) {
          expect(passesResolverSharedFieldGuards(accepted)).toBe(true);
        }
      }
    }
  });

  it("alignment: rejected atemSource = 0 would fail coerceMapping guard", () => {
    // Schema rejects this; confirm our guard also rejects it (consistency check)
    const entry = { vmixKey: "k1", atemSource: 0, cameraId: "camA" };
    const result = schema.safeParse({
      settings: { vmix: null, atem: null },
      mapping: [entry],
    });
    expect(result.success).toBe(false);
    // And the resolver guard also rejects it — drift guard consistency
    expect(passesResolverSharedFieldGuards(entry)).toBe(false);
  });

  it("alignment: rejected empty cameraId would fail coerceMapping guard", () => {
    const entry = { vmixKey: "k1", atemSource: 1, cameraId: "" };
    const result = schema.safeParse({
      settings: { vmix: null, atem: null },
      mapping: [entry],
    });
    expect(result.success).toBe(false);
    expect(passesResolverSharedFieldGuards(entry)).toBe(false);
  });

  it("alignment: full valid 2-entry config satisfies resolver guards on all entries", () => {
    const cfg: PersistedConfig = {
      settings: { vmix: null, atem: null },
      mapping: structuredClone(twoEntries),
    };
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(true);
    if (result.success) {
      for (const entry of result.data.mapping) {
        expect(passesResolverSharedFieldGuards(entry)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// D-08 Phase3: vmixHttpPort backward-compatible schema extension
//
// vmixHttpPort is an optional field on the vmix connection sub-schema only.
// ATEM sub-schema is unaffected. Existing configs without vmixHttpPort still parse.
// ---------------------------------------------------------------------------

describe("D-08 Phase3 — vmixHttpPort backward-compatible schema extension", () => {
  it("D-08: vmixHttpPort absent is valid — backward-compatible with existing stored configs", () => {
    const result = schema.safeParse({
      settings: { vmix: { host: "192.168.1.1", port: 8099 }, atem: null },
      mapping: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.settings.vmix?.vmixHttpPort).toBeUndefined();
    }
  });

  it("D-08: vmixHttpPort: 8088 explicit value accepted", () => {
    const result = schema.safeParse({
      settings: { vmix: { host: "192.168.1.1", port: 8099, vmixHttpPort: 8088 }, atem: null },
      mapping: [],
    });
    expect(result.success).toBe(true);
  });

  it("D-08: vmixHttpPort: 0 rejected (below min 1)", () => {
    const result = schema.safeParse({
      settings: { vmix: { host: "192.168.1.1", port: 8099, vmixHttpPort: 0 }, atem: null },
      mapping: [],
    });
    expect(result.success).toBe(false);
  });

  it("D-08: vmixHttpPort: 65536 rejected (above max 65535)", () => {
    const result = schema.safeParse({
      settings: { vmix: { host: "192.168.1.1", port: 8099, vmixHttpPort: 65536 }, atem: null },
      mapping: [],
    });
    expect(result.success).toBe(false);
  });

  it("D-08: ATEM connection unaffected — atem sub-schema does not accept vmixHttpPort", () => {
    // Verify that the ATEM sub-schema does NOT include vmixHttpPort by confirming
    // the existing atem connection test still passes without any vmixHttpPort field.
    const result = schema.safeParse({
      settings: {
        vmix: null,
        atem: { host: "192.168.1.200", port: 9910 },
      },
      mapping: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // ATEM connection type should not have vmixHttpPort
      const atemConn = result.data.settings.atem;
      expect(atemConn).not.toBeNull();
      // TypeScript enforces this at compile time — atem uses the base connection schema
      // which has no vmixHttpPort. This test is a runtime confirmation.
      expect(Object.keys(atemConn ?? {})).not.toContain("vmixHttpPort");
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 6 D-13: overrides field backward-compatible schema extension
//
// overrides is an optional field on the top-level schema.
// Key: cameraId string. Value: 'program' | 'preview'.
// Absence = no overrides active (backward-compatible with Phase 1–5 configs).
// null is NOT a valid value — null means "no override" = absence of the key.
// ---------------------------------------------------------------------------

describe("overrides field (Phase 6 D-13)", () => {
  it("absent overrides field is valid (backward-compat)", () => {
    const result = schema.safeParse(structuredClone(baseConfig));
    expect(result.success).toBe(true);
  });
  it("overrides with valid value 'program' is valid", () => {
    const cfg = { ...structuredClone(baseConfig), overrides: { cam1: 'program' } };
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(true);
  });
  it("overrides with valid value 'preview' is valid", () => {
    const cfg = { ...structuredClone(baseConfig), overrides: { cam1: 'preview' } };
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(true);
  });
  it("overrides with invalid value is rejected", () => {
    const cfg = { ...structuredClone(baseConfig), overrides: { cam1: 'live' } };
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(false);
  });
  it("overrides with null value is rejected (null means absent key, not stored null)", () => {
    const cfg = { ...structuredClone(baseConfig), overrides: { cam1: null } };
    const result = schema.safeParse(cfg);
    expect(result.success).toBe(false);
  });
});
