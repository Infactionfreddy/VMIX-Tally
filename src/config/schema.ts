// zod schema + invariants for the persisted config document.
// Validates unknown → typed PersistedConfig. Pure — no fs/network.
// Only configStore.ts touches disk; this module is dependency-free except zod.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Connection sub-schema (D-11: nullable so first-boot with no config is valid)
// ---------------------------------------------------------------------------

const connection = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  })
  .nullable();

// ---------------------------------------------------------------------------
// vMix connection sub-schema — extends connection with vmixHttpPort (D-08)
//
// vmixHttpPort is separately configurable from the TCP port (8099).
// Default is 8088 but is applied by the CONSUMER at read time (NOT via .default()
// here) to keep the JSON file clean and avoid round-trip surprises.
// Optional field — existing stored configs without vmixHttpPort parse as valid.
// ---------------------------------------------------------------------------

const vmixConnection = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    /**
     * vMix HTTP API port (D-08). Optional — consumer applies ?? 8088 at read time.
     * NOT the TCP port (8099). Used for the roster fetch (`http://{host}:{vmixHttpPort}/api`).
     */
    vmixHttpPort: z.number().int().min(1).max(65535).optional(),
  })
  .nullable();

// ---------------------------------------------------------------------------
// Mapping entry sub-schema
//
// vmixKey (D-01): GUID — the stable anchor for each mapping entry.
//   Matching is by Key; Number/Title are display-only hints (D-02).
//
// atemSource + cameraId intentionally mirror coerceMapping's runtime guards
// in src/core/resolver.ts (lines 79-91) — this is the upstream persistence
// gate that must be at least as strict as the runtime hot-path guard.
// They are expressed here in zod independently (D-03: config/ must NOT
// import from core/); the duplication is intentional, not accidental.
//   coerceMapping: e.atemSource > 0 + isSafeNonNegInt(e.atemSource)
//     → here: z.number().int().positive()                         (D-09)
//   coerceMapping: typeof e.cameraId === "string" && e.cameraId.length > 0
//     → here: z.string().min(1)
// ---------------------------------------------------------------------------

const mappingEntry = z.object({
  /** vMix input Key (GUID). The single stable match key (D-01). */
  vmixKey: z.string().min(1),
  /**
   * vMix input Number — display hint only, NOT a match key (D-02).
   * Shifts on vMix reorder/add/delete; Phase 3 resolves Key → current Number.
   */
  vmixNumber: z.number().int().positive().optional(),
  /** vMix input Title — display hint only (D-02). */
  vmixTitle: z.string().optional(),
  /**
   * ATEM source ID (positive integer, mixEffect 0).
   * Mirrors coerceMapping's `atemSource > 0` guard (D-09, D-03 intentional mirror).
   * NOT capped at 8 — the ≤8 cap is on entry count (cameras), not on source numbers.
   */
  atemSource: z.number().int().positive(),
  /**
   * Camera identity label.
   * Mirrors coerceMapping's `cameraId.length > 0` guard (D-03 intentional mirror).
   */
  cameraId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Top-level persisted config schema
//
// mapping.max(8): ≤8 entries (cameras) per D-09 / MAP-01.
// version: optional literal for future migration anchoring (Claude's discretion).
// superRefine: three cross-entry uniqueness invariants (D-07).
//   Each duplicate emits a custom issue at the offending element's path so
//   the Phase 6 UI can highlight the exact row+field (D-10).
// ---------------------------------------------------------------------------

export const schema = z
  .object({
    /** Optional schema version — future migration anchor. */
    version: z.literal(1).optional(),
    settings: z.object({ vmix: vmixConnection, atem: connection }),
    /**
     * Input mapping: up to 8 entries (D-09). Partial/empty is valid (D-08).
     * Each entry anchors on vmixKey (GUID); see PersistedMappingEntry.
     */
    mapping: z.array(mappingEntry).max(8),
  })
  .superRefine((cfg, ctx) => {
    // D-07: Three uniqueness checks. Each one reports the duplicate entry's
    // element-scoped path so the Phase 6 editor can highlight the exact row+field.
    const dupCheck = (key: "vmixKey" | "atemSource" | "cameraId"): void => {
      const seen = new Map<unknown, number>();
      cfg.mapping.forEach((entry, i) => {
        const value = entry[key];
        if (seen.has(value)) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate ${key}: ${String(value)}`,
            path: ["mapping", i, key],
          });
        } else {
          seen.set(value, i);
        }
      });
    };
    dupCheck("vmixKey");
    dupCheck("atemSource");
    dupCheck("cameraId");
  });

// ---------------------------------------------------------------------------
// Exported types (derived from zod schema — always in sync)
// ---------------------------------------------------------------------------

/** The complete persisted config document shape. */
export type PersistedConfig = z.infer<typeof schema>;

/**
 * One entry in the persisted vMix-input → ATEM-input → camera mapping.
 * DELIBERATELY DISTINCT from the resolver's MappingEntry (which uses
 * positional vmixInput: number). These types share only atemSource and
 * cameraId; the vMix anchor differs (vmixKey vs vmixInput). D-03 seam.
 */
export type PersistedMappingEntry = z.infer<typeof mappingEntry>;

// ---------------------------------------------------------------------------
// ConfigValidationError — structured field-level error for the Phase 6 UI
//
// z.treeifyError (zod v4 top-level helper) preserves per-index paths for
// the mapping array, enabling the UI to highlight exact rows+fields (D-10).
// Do NOT use the deprecated zod v3 instance methods (format / flatten on ZodError instances).
// ---------------------------------------------------------------------------

/** Structured validation error returned on safeParse failure. Phase 6 UI consumer. */
export interface ConfigValidationError {
  kind: "config-validation";
  /** Flat list of issues with element-scoped paths (e.g. ["mapping", 2, "atemSource"]). */
  issues: Array<{
    path: (string | number)[];
    message: string;
    code: string;
  }>;
  /** Nested error tree for structured rendering. Built with z.treeifyError (D-10). */
  tree: ReturnType<typeof z.treeifyError>;
}

/**
 * Convert a ZodError into a ConfigValidationError consumable by the Phase 6 UI.
 * Uses z.treeifyError (zod v4 top-level helper) — NOT the deprecated v3 instance methods.
 */
export function toConfigValidationError(err: z.ZodError): ConfigValidationError {
  return {
    kind: "config-validation",
    issues: err.issues.map((issue) => ({
      // zod paths are always string | number at runtime; PropertyKey includes symbol
      // only in the TS type — cast is safe here.
      path: issue.path as (string | number)[],
      message: issue.message,
      code: issue.code,
    })),
    tree: z.treeifyError(err),
  };
}
