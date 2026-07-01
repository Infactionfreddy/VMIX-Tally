// TallyOrchestrator: wires VmixConnector 'tally' events through buildRuntimeMapping
// and resolve() to produce a ResolverOutput stored in-memory and emitted as 'stateChanged'.
//
// This is the ONLY file in src/vmix/ that imports from src/core/ (D-09 boundary rule).
// All other vmix/ modules are pure or network-only — they have zero core/ imports.
//
// Phase 3 observable output: when started with a real vMix host/port, the orchestrator
// logs every tally state change to stdout in structured pino JSON format.
// Phase 4 contract: subscribe to 'stateChanged' or poll currentDesiredState() to send
// ATEM bus commands — no vMix-specific knowledge needed.
//
// ConfigStore is referenced via the ConfigStoreReader interface below (D-12 testability seam).
// The concrete ConfigStore (Phase 2, Plan 02-02) satisfies this interface.
//
// Overrides: always [] in Phase 3. Override UI is Phase 6; Phase 4 reads state only.
//
// T-03-14 mitigation: handleTally body wrapped in try/catch — unexpected error is
// logged and swallowed; EventEmitter default 'error' behavior (process crash) is prevented.

import { EventEmitter } from "node:events";

import pino from "pino";
import type { Logger } from "pino";

import { resolve } from "../core/resolver.js";
import type { ResolverOutput } from "../core/events.js";
import type { MappingEntry, OverrideEntry } from "../core/resolver.js";

import { VmixConnector } from "./VmixConnector.js";
import type { TallyEventData } from "./VmixConnector.js";
import { buildRuntimeMapping } from "./buildRuntimeMapping.js";
import type { PersistedMappingEntry } from "../config/schema.js";

// ---------------------------------------------------------------------------
// ConfigStoreReader — minimal interface the orchestrator requires from ConfigStore.
//
// The full ConfigStore (Phase 2 Plan 02-02) satisfies this interface.
// Exporting it here lets tests inject a lightweight stub without importing
// the real lowdb-backed store (D-12 testability seam; mirrors TcpConnection in VmixConnector).
//
// ConfigStore API confirmed from 02-02-PLAN.md (configStore.ts not yet implemented):
//   - init(): Promise<void>  — loads the JSON file; called once after construction
//   - getMapping(): PersistedMappingEntry[]  — synchronous read of in-memory mapping
//   - getSettings(): PersistedConfig['settings']  — synchronous read of connection settings
//
// Because handleTally is sync and sits in the hot path (sub-ms per call, T-03-16),
// getMapping() MUST be synchronous. The full ConfigStore keeps the last-read document
// in memory and getMapping() just returns db.data.mapping — no I/O.
// ---------------------------------------------------------------------------

/**
 * Minimal interface the TallyOrchestrator requires from the config store.
 *
 * The concrete ConfigStore (Phase 2, Plan 02-02) will satisfy this interface.
 * Tests inject a lightweight stub object that matches this shape.
 */
export interface ConfigStoreReader {
  /**
   * Return the current persisted mapping entries synchronously.
   * The concrete store loads from disk on init(); subsequent calls return
   * the in-memory document — no disk I/O in the hot path.
   */
  getMapping(): PersistedMappingEntry[];

  /**
   * Return the current vMix connection settings synchronously.
   * Used by the orchestrator constructor to create the VmixConnector.
   * Returns null if settings have not been configured yet (first boot).
   */
  getVmixSettings(): { host: string; port: number; vmixHttpPort?: number } | null;
}

// ---------------------------------------------------------------------------
// TallyOrchestrator
// ---------------------------------------------------------------------------

/**
 * Wires VmixConnector 'tally' events through buildRuntimeMapping → resolve()
 * and stores the resulting ResolverOutput in-memory.
 *
 * On each tally event:
 *  1. Reads PersistedMappingEntry[] from the configStore (sync, in-memory)
 *  2. Calls buildRuntimeMapping(persisted, connector.roster()) → MappingEntry[]
 *  3. Calls resolve(rawTally, runtimeMapping, []) → ResolverOutput
 *  4. Stores the result as currentState
 *  5. Logs the state change via pino (structured JSON to stdout)
 *  6. Emits 'stateChanged' with the new ResolverOutput for Phase 4 subscribers
 *
 * Constructor args:
 *  - configStore: ConfigStoreReader — supplies mapping and connection settings
 *  - logger?: pino.Logger — injected for testability; defaults to pino() for production
 *  - connectorFactory?: optional factory for VmixConnector — injected in tests
 *    to avoid real TCP connections (same pattern as VmixConnector's tcpFactory)
 */
export class TallyOrchestrator extends EventEmitter {
  private readonly connector: VmixConnector;
  private readonly configStore: ConfigStoreReader;
  private readonly logger: Logger;
  private currentState: ResolverOutput | null = null;

  constructor(
    configStore: ConfigStoreReader,
    logger?: Logger,
    /**
     * Optional factory for VmixConnector — used in tests to inject a mock connector
     * without making real TCP connections (D-12 testability seam).
     * Defaults to creating a real VmixConnector from configStore.getVmixSettings().
     */
    connectorFactory?: (logger: Logger) => VmixConnector,
  ) {
    super();

    this.configStore = configStore;
    this.logger = logger ?? pino();

    if (connectorFactory != null) {
      this.connector = connectorFactory(this.logger);
    } else {
      const settings = configStore.getVmixSettings();
      if (settings === null) {
        // First-boot or misconfigured: no vMix connection settings saved yet.
        // The orchestrator is constructed but the connector will never connect.
        // Phase 6 (config UI) will update settings and restart the orchestrator.
        this.logger.warn(
          { event: "orchestrator_no_vmix_settings" },
          "TallyOrchestrator: no vMix connection settings configured — connector inactive",
        );
        // Create a no-op VmixConnector with an invalid host so it self-disables
        // via the T-03-11 guard inside VmixConnector (host.length < 3).
        this.connector = new VmixConnector("", 8099, 8088, this.logger);
      } else {
        const { host, port, vmixHttpPort } = settings;
        // Apply ?? 8088 default for vmixHttpPort at read time (D-08 convention).
        this.connector = new VmixConnector(host, port, vmixHttpPort ?? 8088, this.logger);
      }
    }

    // Register event listeners on the connector.
    this.connector.on("tally", (data: TallyEventData) => this.handleTally(data));
    this.connector.on("rosterUpdated", (_roster: Map<string, number>) => {
      this.logger.debug({ event: "roster_updated" }, "Roster updated");
    });
  }

  /**
   * Handle a 'tally' event from VmixConnector.
   *
   * T-03-14 mitigation: wrapped in try/catch — unexpected errors are logged and
   * swallowed instead of propagating as uncaught exceptions (which would trigger
   * EventEmitter's default 'error' behavior and crash the process).
   */
  private handleTally(data: TallyEventData): void {
    try {
      // Step 1: Read persisted mapping synchronously (in-memory, no disk I/O in hot path).
      const persisted: PersistedMappingEntry[] = this.configStore.getMapping();

      // Step 2: Build runtime mapping — resolves Key-anchored entries to positional MappingEntry[].
      const runtimeMapping: MappingEntry[] = buildRuntimeMapping(
        persisted,
        this.connector.roster(),
      );

      // Step 3: Resolve tally → ResolverOutput.
      // Overrides are always [] in Phase 3 (Phase 6 owns override UI).
      const newState: ResolverOutput = resolve(
        data.rawTally,
        runtimeMapping,
        [] as OverrideEntry[],
      );

      // Step 4: Check if bus state actually changed (avoid noisy log on identical pushes).
      const prev = this.currentState;
      const busChanged =
        prev === null ||
        prev.bus.program !== newState.bus.program ||
        prev.bus.preview !== newState.bus.preview;

      // Step 5: Store new state.
      this.currentState = newState;

      // Step 6: Log the change via pino (structured JSON to stdout).
      if (busChanged) {
        this.logger.info(
          {
            bus: newState.bus,
            cameras: newState.cameras,
            rosterLength: data.rosterLength,
            prevBus: prev?.bus ?? null,
          },
          "Tally state resolved",
        );
      } else {
        this.logger.debug(
          {
            bus: newState.bus,
            rosterLength: data.rosterLength,
          },
          "Tally state unchanged",
        );
      }

      // Step 7: Emit 'stateChanged' with a copy of the new state for Phase 4 subscribers.
      // Spread-copy each field to prevent the subscriber from mutating internal state.
      const stateCopy: ResolverOutput = {
        cameras: { ...newState.cameras },
        bus: { ...newState.bus },
        contended: [...newState.contended],
      };
      this.emit("stateChanged", stateCopy);
    } catch (err) {
      // T-03-14: log error and continue — do not crash the process.
      this.logger.error(
        { err, event: "handle_tally_error" },
        "TallyOrchestrator: unexpected error in handleTally — state not updated",
      );
    }
  }

  /**
   * Returns the latest resolved ResolverOutput, or null if no tally event has
   * been processed yet.
   *
   * Phase 4 contract: poll this getter or subscribe to 'stateChanged' to send
   * ATEM bus commands.
   */
  currentDesiredState(): ResolverOutput | null {
    return this.currentState;
  }

  /**
   * Gracefully shut down the underlying VmixConnector (closes TCP connection).
   */
  shutdown(): void {
    this.connector.shutdown();
  }
}
