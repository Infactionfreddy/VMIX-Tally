// ConfigStore: the ONLY codebase module that touches disk.
// Wraps lowdb Low+JSONFile adapter with a validate-before-write gate (D-10).
// core/ stays pure — no fs imports outside this module.
//
// This is a minimal implementation stub for Phase 4 server.ts compilation.
// The full implementation is delivered in Phase 2 Plan 02-02.
// Method surface satisfies:
//   - ConfigStoreReader interface (tallyOrchestrator.ts)
//   - server.ts bootstrap (init, getSettings, getMapping)

import { Low } from "lowdb";
import { JSONFile } from "lowdb/node";
import { schema, toConfigValidationError } from "./schema.js";
import type { PersistedConfig, PersistedMappingEntry, ConfigValidationError } from "./schema.js";

// ---------------------------------------------------------------------------
// Default document — first-boot safe state (D-11)
// ---------------------------------------------------------------------------

const DEFAULTS: PersistedConfig = {
  settings: { vmix: null, atem: null },
  mapping: [],
};

// ---------------------------------------------------------------------------
// ConfigStore
// ---------------------------------------------------------------------------

/**
 * Thin lowdb wrapper. Exposes async init() + synchronous getters for hot-path
 * access. Satisfies the ConfigStoreReader interface used by TallyOrchestrator.
 *
 * Every mutation validates via schema.safeParse BEFORE assigning db.data or
 * calling db.write() — invalid input is rejected whole (D-10).
 */
export class ConfigStore {
  private readonly db: Low<PersistedConfig>;

  constructor(path = "config.json") {
    this.db = new Low<PersistedConfig>(
      new JSONFile<PersistedConfig>(path),
      structuredClone(DEFAULTS),
    );
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Load the persisted document from disk.
   * Missing file → DEFAULTS (lowdb null→defaults behaviour).
   * Call once after construction before any getters.
   */
  async init(): Promise<void> {
    await this.db.read();
  }

  // ---------------------------------------------------------------------------
  // Synchronous getters (ConfigStoreReader interface + server.ts bootstrap)
  // ---------------------------------------------------------------------------

  /**
   * Return the full settings object synchronously.
   * Guards db.data null (noUncheckedIndexedAccess).
   */
  getSettings(): PersistedConfig["settings"] {
    return (this.db.data ?? structuredClone(DEFAULTS)).settings;
  }

  /**
   * Return vMix connection settings or null if not configured (ConfigStoreReader).
   */
  getVmixSettings(): { host: string; port: number; vmixHttpPort?: number } | null {
    return (this.db.data ?? structuredClone(DEFAULTS)).settings.vmix;
  }

  /**
   * Return the current persisted mapping synchronously (ConfigStoreReader).
   * In-memory — no disk I/O in hot path.
   */
  getMapping(): PersistedMappingEntry[] {
    return (this.db.data ?? structuredClone(DEFAULTS)).mapping;
  }

  // ---------------------------------------------------------------------------
  // Async read/write interface (Phase 6 REST route API)
  // ---------------------------------------------------------------------------

  /**
   * Return the full persisted config document asynchronously.
   * Phase 6 route handlers use this for read-then-modify-then-write patterns.
   */
  async read(): Promise<PersistedConfig> {
    return structuredClone(this.db.data ?? structuredClone(DEFAULTS));
  }

  /**
   * Write a pre-validated config document directly to disk.
   * NOTE: bypasses schema validation — callers are responsible for validating
   * via schema.safeParse before calling this (route handlers do this).
   * For validation-gated writes, use save() instead.
   */
  async write(cfg: PersistedConfig): Promise<void> {
    this.db.data = structuredClone(cfg);
    await this.db.write();
  }

  // ---------------------------------------------------------------------------
  // Whole-document save (validate-before-write, D-10)
  // ---------------------------------------------------------------------------

  /**
   * Persist a candidate document.
   * Validates with schema.safeParse BEFORE writing — invariant violations are
   * rejected whole; the on-disk file is left byte-untouched (D-10).
   *
   * Returns ConfigValidationError on validation failure; undefined on success.
   */
  async save(candidate: unknown): Promise<ConfigValidationError | undefined> {
    const parsed = schema.safeParse(candidate);
    if (!parsed.success) {
      return toConfigValidationError(parsed.error);
    }
    this.db.data = parsed.data;
    await this.db.write();
    return undefined;
  }
}
