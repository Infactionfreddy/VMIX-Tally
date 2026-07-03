// VmixConnector: raw node:net Socket replacing node-vmix ConnectionTCP.
// Handles TCP subscription (vMix push) and HTTP roster fetch,
// emitting typed 'tally' and 'rosterUpdated' events.
//
// Separation boundary (D-09): This module has ZERO imports from core/.
// The tallyOrchestrator owns the wiring between vmix/ and core/.
//
// Covers: VMIX-01 (TCP connect + SUBSCRIBE TALLY), VMIX-02 (push tally events),
//         VMIX-04 (auto-reconnect with exponential backoff)
// Mitigations: T-03-07 (parseTallyString coerces), T-03-10 (fetchRoster timeout),
//              T-03-11 (host.length guard), D-02/D-03 (resync without tally flash),
//              T-05-02 (backoff max 30s; destroyed guard halts loop)

import { EventEmitter } from "node:events";
import { createConnection } from "node:net";
import type { Socket } from "node:net";

import type { Logger } from "pino";

import { parseTallyString } from "./parseTallyString.js";
import { fetchRoster } from "./parseRosterXml.js";

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
 * EventEmitter that manages a raw node:net TCP connection to vMix.
 *
 * Connects to vMix over TCP, subscribes to TALLY pushes, and emits:
 *   'tally'         → TallyEventData  (on every TALLY push from vMix)
 *   'rosterUpdated' → Map<string, number>  (after connect and after roster re-sync)
 *
 * On disconnect, automatically reconnects with exponential backoff:
 *   delay = min(1000 * 2^attempt, 30000) * (0.75 + Math.random() * 0.5)
 *   attempt resets to 0 on every successful connect (VMIX-04 / D-03).
 *
 * Critical invariants (05-RESEARCH.md):
 *   - 'error' handler calls sock.destroy() only — no scheduleReconnect here
 *   - scheduleReconnect() triggered from 'close' only (single-timer invariant)
 *   - lineBuffer cleared in 'connect' handler (no stale bytes on reconnect)
 *   - destroyed flag halts the backoff loop after explicit destroy()
 *
 * When the TALLY string length changes between pushes, a roster re-sync is
 * triggered: the 'tally' event is held until the re-fetch completes so there
 * is no all-off flash (D-02 / D-03).
 *
 * Host guard (T-03-11): if host.length < 3, logs an error and does not connect.
 */
export class VmixConnector extends EventEmitter {
  // Backoff + reconnect state
  private socket: Socket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private lineBuffer = "";

  // Roster state
  private rosterMap: Map<string, number> = new Map();

  // Sentinel: -1 = not yet known for the current connection cycle.
  // Reset to -1 on every 'connect' to force a fresh length comparison.
  private currentRosterLength: number = -1;

  constructor(
    private host: string,
    private tcpPort: number,
    private httpPort: number,
    private readonly logger: Logger,
  ) {
    super();

    // T-03-11: Guard against short host (node:net would error immediately).
    if (host.length < 3) {
      logger.error(
        { host },
        "VmixConnector: host must be at least 3 characters — TCP connection aborted",
      );
      return;
    }

    this.createSocket();
  }

  // ---------------------------------------------------------------------------
  // Backoff helpers
  // ---------------------------------------------------------------------------

  /**
   * Exponential backoff delay with ±25% jitter (D-03).
   * attempt=0 → ~1000ms, attempt=5+ → ~30000ms (capped).
   * Tests spy on Math.random to get deterministic delays.
   */
  private backoffDelay(): number {
    const base = Math.min(1000 * Math.pow(2, this.attempt), 30_000);
    return base * (0.75 + Math.random() * 0.5);
  }

  /**
   * Schedule the next connection attempt with backoff.
   * Called from 'close' handler ONLY (never from 'error').
   */
  private scheduleReconnect(): void {
    if (this.destroyed) return;
    const delay = this.backoffDelay();
    this.attempt++;
    this.logger.info(
      { attempt: this.attempt, delayMs: Math.round(delay) },
      "vmix TCP reconnecting",
    );
    this.retryTimer = setTimeout(() => this.createSocket(), delay);
  }

  // ---------------------------------------------------------------------------
  // Socket lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create a fresh node:net Socket and attach all event handlers.
   * Called on initial connect and on every reconnect attempt.
   * A fresh socket is always created — never reuse a socket after 'close'.
   */
  private createSocket(): void {
    this.retryTimer = null;
    if (this.destroyed) return;

    const sock = createConnection({ host: this.host, port: this.tcpPort });
    this.socket = sock;

    sock.on("connect", () => {
      this.attempt = 0; // reset on successful connect
      this.lineBuffer = ""; // clear stale bytes from prior session
      this.logger.info(
        { host: this.host, port: this.tcpPort },
        "vmix TCP connected",
      );
      sock.write("SUBSCRIBE TALLY\r\n");
      void this.fetchAndEmitRoster();
      // Phase 6 UI-02: signal connection status to server.ts
      this.emit("ready");
    });

    sock.on("data", (chunk: Buffer) => {
      this.lineBuffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = this.lineBuffer.indexOf("\r\n")) !== -1) {
        const line = this.lineBuffer.slice(0, idx);
        this.lineBuffer = this.lineBuffer.slice(idx + 2);
        this.handleLine(line);
      }
    });

    // 'error' handler: destroy the socket only — DO NOT call scheduleReconnect here.
    // Node.js guarantees 'close' fires after 'error'; let 'close' trigger the backoff.
    // Calling scheduleReconnect from both 'error' AND 'close' creates duplicate timers
    // (double-timer anti-pattern documented in 05-RESEARCH.md Pitfall 1).
    sock.on("error", (err: Error) => {
      this.logger.warn({ err }, "vmix TCP error");
      sock.destroy(); // ensures 'close' fires so the backoff loop continues
    });

    // 'close' is the single trigger for scheduling reconnect (VMIX-04 single-timer invariant).
    sock.on("close", () => {
      this.logger.info(
        { host: this.host },
        "vmix TCP closed — scheduling reconnect",
      );
      // Phase 6 UI-02: signal disconnection BEFORE scheduling reconnect
      this.emit("disconnected");
      this.scheduleReconnect();
    });
  }

  // ---------------------------------------------------------------------------
  // Line protocol dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatch a complete line received from vMix TCP.
   * Only 'TALLY OK ...' lines are handled; all others are silently ignored.
   */
  private handleLine(line: string): void {
    if (line.startsWith("TALLY OK ")) {
      const digits = line.slice("TALLY OK ".length);
      this.handleTally(digits);
    }
    // SUBSCRIBE TALLY acknowledgement and other lines: silently ignored.
  }

  /**
   * Called on every 'TALLY OK' line from vMix.
   * tallyString is the bare digit string after stripping 'TALLY OK '.
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
    this.emit("tally", {
      rawTally,
      rosterLength: rawTally.length,
    } satisfies TallyEventData);
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
    this.emit("tally", {
      rawTally,
      rosterLength: rawTally.length,
    } satisfies TallyEventData);
  }

  // ---------------------------------------------------------------------------
  // HTTP roster fetch (unchanged from Phase 3 D-06)
  // ---------------------------------------------------------------------------

  /**
   * Fetch the current vMix roster over HTTP, update rosterMap, and emit
   * 'rosterUpdated'. Called after every successful TCP connect.
   * Failure is non-fatal — fetchRoster returns an empty Map on error.
   */
  private async fetchAndEmitRoster(): Promise<void> {
    // Fetch roster first so rosterUpdated is emitted with fresh data.
    this.rosterMap = await fetchRoster(this.host, this.httpPort);

    // Reset length sentinel: the next tally push starts fresh (no stale comparison).
    this.currentRosterLength = -1;

    // Emit a copy — never the internal reference (D-09 ownership invariant).
    this.emit("rosterUpdated", new Map(this.rosterMap));
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns a COPY of the current internal roster Map.
   * Callers cannot corrupt internal state by mutating the returned value.
   */
  roster(): Map<string, number> {
    return new Map(this.rosterMap);
  }

  /**
   * Gracefully shut down: cancel any pending retry timer and destroy the socket.
   * After calling destroy(), no further reconnect attempts will be made.
   *
   * Replaces Phase 3 shutdown() — renamed per D-04 to match node:net semantics.
   * Server.ts and TallyOrchestrator must call destroy() instead of shutdown().
   */
  destroy(): void {
    this.destroyed = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.socket?.destroy();
  }

  /**
   * Alias for destroy() — preserved for backward-compat with Phase 3 callers
   * that call shutdown(). Will be removed in a future phase.
   */
  shutdown(): void {
    this.destroy();
  }

  /**
   * Switch to a new vMix host/port without restarting the server.
   * Tears down the current connection, updates the target address, and reconnects.
   */
  reconnect(host: string, tcpPort: number, httpPort: number): void {
    // Stop current connection and cancel any pending retry timer.
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.socket?.destroy();

    // Reset all state for a clean start.
    this.destroyed = false;
    this.attempt = 0;
    this.currentRosterLength = -1;
    this.rosterMap = new Map();
    this.lineBuffer = '';

    this.host = host;
    this.tcpPort = tcpPort;
    this.httpPort = httpPort;

    if (host.length < 3) {
      this.logger.warn({ host }, 'VmixConnector.reconnect: host too short — not connecting');
      return;
    }

    this.logger.info({ host, tcpPort }, 'VmixConnector: reconnecting to new host');
    this.createSocket();
  }
}
