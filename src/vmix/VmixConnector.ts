// VmixConnector: EventEmitter wrapping node-vmix ConnectionTCP.
// Handles the TCP subscription (vMix push) and HTTP roster fetch,
// emitting typed 'tally' and 'rosterUpdated' events.
//
// Separation boundary (D-09): This module has ZERO imports from core/.
// The tallyOrchestrator (Plan 03) owns the wiring between vmix/ and core/.
//
// Covers: VMIX-01 (TCP connect + SUBSCRIBE TALLY), VMIX-02 (push tally events)
// Mitigations: T-03-07 (parseTallyString coerces), T-03-10 (fetchRoster timeout),
//              T-03-11 (host.length guard), D-02/D-03 (resync without tally flash)

import { EventEmitter } from "node:events";

import { ConnectionTCP } from "node-vmix";
import type { Logger } from "pino";

import { parseTallyString } from "./parseTallyString.js";
import { fetchRoster } from "./parseRosterXml.js";

/**
 * Minimal interface that describes what VmixConnector needs from ConnectionTCP.
 * Used internally for testability via tcpFactory injection.
 */
export interface TcpConnection {
  on(type: string, callback: Function): void;
  send(command: string): Promise<void> | void;
  shutdown(): void;
}

/**
 * The data shape emitted with the 'tally' event.
 * rawTally: positional tally array (index i = vMix input i+1).
 * rosterLength: number of inputs in the current roster (= rawTally.length).
 */
export interface TallyEventData {
  rawTally: number[];
  rosterLength: number;
}

/**
 * EventEmitter that wraps node-vmix's ConnectionTCP.
 *
 * Connects to vMix over TCP, subscribes to TALLY pushes, and emits:
 *   'tally'         → TallyEventData  (on every TALLY push from vMix)
 *   'rosterUpdated' → Map<string, number>  (after connect and after roster re-sync)
 *
 * The SUBSCRIBE TALLY command is re-sent on every 'connect' event, including
 * after auto-reconnect (Pitfall 2 / VMIX-02).
 *
 * When the TALLY string length changes between pushes, a roster re-sync is
 * triggered: the 'tally' event is held until the re-fetch completes so there
 * is no all-off flash (D-02 / D-03).
 *
 * Host guard (T-03-11): node-vmix constructor throws ApiUrlError if
 * host.length < 3. This class checks the length before constructing
 * ConnectionTCP and logs an error instead of crashing.
 */
export class VmixConnector extends EventEmitter {
  private readonly tcp: TcpConnection;
  private rosterMap: Map<string, number> = new Map();

  // Sentinel: -1 = not yet known for the current connection cycle.
  // Reset to -1 on every 'connect' to force a fresh length comparison.
  private currentRosterLength: number = -1;

  constructor(
    private readonly host: string,
    private readonly tcpPort: number,
    private readonly httpPort: number,
    private readonly logger: Logger,
    /**
     * Optional factory for creating the TCP connection — used in tests to
     * inject a mock without module-level vi.mock hoisting (D-12).
     * Defaults to creating a real node-vmix ConnectionTCP.
     */
    tcpFactory?: (host: string, port: number) => TcpConnection,
  ) {
    super();

    // T-03-11: Guard against node-vmix ApiUrlError thrown on host.length < 3.
    if (host.length < 3) {
      logger.error(
        { host },
        "VmixConnector: host must be at least 3 characters — TCP connection aborted",
      );
      // Create a no-op stub so the field is always initialised.
      const noopTcp: TcpConnection = {
        on: () => undefined,
        send: () => undefined,
        shutdown: () => undefined,
      };
      this.tcp = noopTcp;
      return;
    }

    this.tcp =
      tcpFactory != null
        ? tcpFactory(host, tcpPort)
        : new ConnectionTCP(host, {
            port: tcpPort,
            autoReconnect: true,
            debug: false,
          });

    // Register ALL listeners immediately after construction — before any
    // internal setTimeout(0) inside node-vmix fires (VMIX-01 timing contract).
    this.tcp.on("connect", () => void this.handleConnect());
    this.tcp.on("tally", (str: string) => this.handleTally(str));
    this.tcp.on("close", () =>
      this.logger.info({ event: "vmix_disconnected" }, "vMix TCP disconnected"),
    );
    this.tcp.on("error", (err: Error) =>
      this.logger.warn({ err }, "vMix TCP error"),
    );
  }

  /**
   * Called on every TCP 'connect' event (initial and after reconnect).
   * Fetches the roster, then sends SUBSCRIBE TALLY.
   * Resetting currentRosterLength to -1 forces the next tally push to
   * treat the length as unknown and emit without triggering a false resync.
   */
  private async handleConnect(): Promise<void> {
    this.logger.info(
      { host: this.host, port: this.tcpPort },
      "vMix TCP connected",
    );

    // Fetch roster first so rosterUpdated is emitted with fresh data.
    this.rosterMap = await fetchRoster(this.host, this.httpPort);

    // Reset length sentinel: the next tally push starts fresh (no stale comparison).
    this.currentRosterLength = -1;

    // Emit a copy — never the internal reference (D-09 ownership invariant).
    this.emit("rosterUpdated", new Map(this.rosterMap));

    // SUBSCRIBE TALLY MUST be sent after roster fetch and inside the
    // 'connect' handler so it is re-sent on every reconnect (Pitfall 2 / VMIX-02).
    this.tcp.send("SUBSCRIBE TALLY");
  }

  /**
   * Called on every 'tally' event from node-vmix.
   * tallyString is the bare digit string after node-vmix strips 'TALLY OK '.
   */
  private handleTally(tallyString: string): void {
    const rawTally = parseTallyString(tallyString);

    // D-02: roster length changed — trigger re-sync.
    // Skip when currentRosterLength is -1 (first push after connect — not a real change).
    if (
      rawTally.length !== this.currentRosterLength &&
      this.currentRosterLength !== -1
    ) {
      // D-03: do NOT emit tally until resync completes (no all-off flash).
      void this.resync(rawTally);
      return;
    }

    // First push after connect (currentRosterLength === -1): initialise and emit.
    this.currentRosterLength = rawTally.length;
    this.emit("tally", { rawTally, rosterLength: rawTally.length } satisfies TallyEventData);
  }

  /**
   * Re-fetch the roster when the tally string length changes (D-02).
   * The 'tally' event is held until the re-fetch completes (D-03).
   * rawTally is the tally that triggered the resync — emitted AFTER resync.
   */
  private async resync(rawTally: number[]): Promise<void> {
    this.logger.info(
      { event: "roster_resync", newLength: rawTally.length },
      "Roster length changed — re-fetching",
    );

    this.rosterMap = await fetchRoster(this.host, this.httpPort);
    this.currentRosterLength = rawTally.length;

    // Emit updated roster, then the held tally (D-03: tally only after resync).
    this.emit("rosterUpdated", new Map(this.rosterMap));
    this.emit("tally", { rawTally, rosterLength: rawTally.length } satisfies TallyEventData);
  }

  /**
   * Returns a COPY of the current internal roster Map.
   * Callers cannot corrupt internal state by mutating the returned value.
   */
  roster(): Map<string, number> {
    return new Map(this.rosterMap);
  }

  /**
   * Gracefully close the TCP connection.
   */
  shutdown(): void {
    this.tcp.shutdown();
  }
}
