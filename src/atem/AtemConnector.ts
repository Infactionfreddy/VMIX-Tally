// ATEM hardware interface — wraps atem-connection 3.9.0.
//
// Hydration gate: isHydrated becomes true on the 'connected' event, NOT 'stateChanged'.
// Reason: stateChanged is suppressed during the InitCompleteCommand batch (atem.js lines
// 175-181, verified 3.9.0). The 'connected' event fires at _onInitComplete() with
// atem.state fully populated. Using 'stateChanged' as the hydration signal would leave
// isHydrated permanently false until the first real switcher change after connect.
//
// Command dispatch: applyState() feeds ResolverOutput into TallyStateReconciler.submit()
// and issues changeProgramInput/changePreviewInput ONLY for changed fields (CORE-03).
//
// Latency logging: latencyMs = Date.now() - tallyReceivedAt is logged BEFORE awaiting
// the command promise, capturing time from tally receipt to command-send (REL-01).
//
// Fail-open: connect() does not await or throw (D-02). All command rejections are caught
// and logged, never thrown (T-04-03).
//
// Reconnect: 'disconnected' event triggers exponential backoff loop (ATEM-04, D-01).
// 'ready' event emitted on every successful hydration (initial + reconnect) — server.ts
// listens to re-assert current desired state (D-02). needsResync flag ensures
// reconciler.reset() runs before first submit() after reconnect (D-03).

import { EventEmitter } from "node:events";
import { Atem } from "atem-connection";
import type { Logger } from "pino";
import { TallyStateReconciler } from "../core/tallyState.js";
import type { ResolverOutput } from "../core/events.js";
import type { MappingEntry } from "../core/resolver.js";

export class AtemConnector extends EventEmitter {
  private readonly atem: Atem;
  private readonly reconciler = new TallyStateReconciler();
  private isHydrated = false;
  private pendingState: ResolverOutput | null = null;
  private readonly logger: Logger;

  // Backoff / lifecycle state (ATEM-04)
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private needsResync = false;

  constructor(
    private host: string,
    private port: number,
    logger: Logger,
    _atemFactory?: () => Atem,
  ) {
    super();
    this.logger = logger;
    this.atem = _atemFactory ? _atemFactory() : new Atem();

    this.atem.on("connected", () => {
      this.handleConnected();
    });

    this.atem.on("disconnected", () => {
      this.handleDisconnected();
    });

    this.atem.on("stateChanged", (_state: unknown, paths: string[]) => {
      this.logger.debug(
        { event: "atem_state_changed", paths },
        "ATEM state changed",
      );
    });
  }

  /**
   * Initiate the connection to the ATEM. Fail-open: does not await or throw (D-02).
   */
  connect(): void {
    this.logger.info(
      { event: "atem_connect_attempt", host: this.host, port: this.port },
      "Connecting to ATEM",
    );
    void this.atem.connect(this.host, this.port);
  }

  /**
   * Apply a new desired ATEM bus state from TallyOrchestrator.
   *
   * If not yet hydrated (ATEM 'connected' event not yet received), stores as
   * pendingState to be flushed on hydration (D-04). Once hydrated, dispatches
   * only changed fields via TallyStateReconciler (CORE-03, ATEM-02/03).
   *
   * @param newState      ResolverOutput from the tally resolver.
   * @param tallyReceivedAt Date.now() at the moment the raw vMix TCP push arrived (REL-01).
   */
  applyState(newState: ResolverOutput, tallyReceivedAt: number): void {
    if (!this.isHydrated) {
      this.pendingState = newState;
      return;
    }
    this._dispatch(newState, tallyReceivedAt);
  }

  /**
   * Directly set ATEM program input — bypasses reconciler (used by test route).
   * No-op when not hydrated.
   */
  setProgram(atemSource: number): void {
    if (!this.isHydrated) return;
    void this.atem
      .changeProgramInput(atemSource, 0)
      .catch((err: unknown) => this.logger.error({ err }, 'setProgram failed'));
  }

  /**
   * Directly set ATEM preview input — bypasses reconciler (used by test route).
   * No-op when not hydrated.
   */
  setPreview(atemSource: number): void {
    if (!this.isHydrated) return;
    void this.atem
      .changePreviewInput(atemSource, 0)
      .catch((err: unknown) => this.logger.error({ err }, 'setPreview failed'));
  }

  /**
   * Re-apply the desired state after a test — resets the reconciler so the
   * ATEM always receives the commands even if desired state hasn't changed.
   */
  resetAndApply(state: ResolverOutput): void {
    if (!this.isHydrated) return;
    this.reconciler.reset();
    this._dispatch(state);
  }

  /**
   * Switch to a new ATEM host/port without restarting the server.
   * Cancels any pending retry timer, resets state, and connects to the new address.
   */
  reconnect(host: string, port: number): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.host = host;
    this.port = port;
    this.isHydrated = false;
    this.pendingState = null;
    this.attempt = 0;
    this.needsResync = false;
    this.logger.info({ event: 'atem_reconnect', host, port }, 'ATEM reconnecting to new host');
    void this.atem.connect(host, port);
  }

  /**
   * Tear down the connector: cancel any pending reconnect timer and destroy the
   * underlying atem-connection instance. Safe to call multiple times.
   */
  destroy(): void {
    this.destroyed = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this.atem.destroy();
  }

  /**
   * Run the sequential walk-test loop (VERIFY-01).
   *
   * For each mapped camera: program (2 s red) → preview (2 s green) → next.
   * Bypasses TallyStateReconciler — this is a diagnostic tool, not live tally (D-07).
   */
  async walkTest(mapping: MappingEntry[], logger: Logger): Promise<void> {
    logger.info(
      { event: "walk_test_started", cameras: mapping.length },
      "Walk-test starting",
    );

    for (const entry of mapping) {
      logger.info(
        { event: "walk_program", cameraId: entry.cameraId, atemSource: entry.atemSource },
        "Walk-test: setting program",
      );
      await this.atem.changeProgramInput(entry.atemSource, 0);
      await new Promise<void>((res) => setTimeout(res, 2000));

      logger.info(
        { event: "walk_preview", cameraId: entry.cameraId, atemSource: entry.atemSource },
        "Walk-test: setting preview",
      );
      await this.atem.changePreviewInput(entry.atemSource, 0);
      await new Promise<void>((res) => setTimeout(res, 2000));
    }

    logger.info({ event: "walk_test_complete" }, "Walk-test complete");
  }

  // ---------------------------------------------------------------------------
  // Private handlers
  // ---------------------------------------------------------------------------

  private handleConnected(): void {
    this.isHydrated = true;
    this.attempt = 0; // reset backoff counter on successful connect (ATEM-04)
    this.logger.info(
      { event: "atem_hydrated", host: this.host },
      "ATEM hydrated",
    );

    if (this.pendingState !== null) {
      this.logger.info(
        { event: "atem_pending_flush" },
        "Flushing pending state after hydration",
      );
      const s = this.pendingState;
      this.pendingState = null;
      this._dispatch(s);
    }

    // D-02: needsResync MUST be set BEFORE emit('ready') so that the 'ready'
    // listener's applyState() call sees needsResync=true and calls reconciler.reset().
    this.needsResync = true;
    this.emit("ready");
  }

  private handleDisconnected(): void {
    this.isHydrated = false;
    this.logger.warn(
      { event: "atem_disconnected" },
      "ATEM disconnected — scheduling reconnect",
    );
    // Phase 6 UI-02: signal disconnection BEFORE scheduling reconnect
    this.emit("disconnected");
    this.scheduleReconnect(); // D-01: backoff starts on every disconnect
  }

  private _dispatch(state: ResolverOutput, tallyReceivedAt?: number): void {
    // D-03: if flagged for resync, reset reconciler so next submit() always reports
    // changed:true — guarantees ATEM receives the command even if desired state is
    // unchanged from pre-disconnect (needsResync set in handleConnected() before emit('ready')).
    if (this.needsResync) {
      this.reconciler.reset();
      this.needsResync = false;
    }

    const report = this.reconciler.submit(state.bus);
    if (!report.changed) return;

    // Log BEFORE issuing commands — captures time from tally receipt to command-send (REL-01).
    // Guard: only compute latencyMs when tallyReceivedAt is available.
    if (tallyReceivedAt !== undefined) {
      this.logger.info(
        {
          event: "atem_command_sent",
          latencyMs: Date.now() - tallyReceivedAt,
          program: state.bus.program,
          preview: state.bus.preview,
        },
        "ATEM bus updated",
      );
    }

    // T-04-01: null guard — never pass null to changeProgramInput/changePreviewInput.
    // T-04-03: fire-and-forget with .catch — errors logged, never thrown (D-02 fail-open).
    if (report.program && state.bus.program !== null) {
      void this.atem
        .changeProgramInput(state.bus.program, 0)
        .catch((err: unknown) =>
          this.logger.error({ err }, "changeProgramInput failed"),
        );
    }

    if (report.preview && state.bus.preview !== null) {
      void this.atem
        .changePreviewInput(state.bus.preview, 0)
        .catch((err: unknown) =>
          this.logger.error({ err }, "changePreviewInput failed"),
        );
    }
  }

  // ---------------------------------------------------------------------------
  // Backoff reconnect (ATEM-04, D-03)
  // ---------------------------------------------------------------------------

  /**
   * Compute next backoff delay.
   * Formula: min(1000 * 2^attempt, 30000) * (0.75 + Math.random() * 0.5)
   * Result: initial ~1s, max ~30s, ±25% jitter.
   */
  private backoffDelay(): number {
    const base = Math.min(1000 * Math.pow(2, this.attempt), 30_000);
    return base * (0.75 + Math.random() * 0.5);
  }

  /**
   * Schedule a reconnect attempt after backoff delay. Guard: destroyed flag halts
   * the loop. Single-timer invariant: called only from 'disconnected' handler.
   * Do NOT call atem.disconnect() before atem.connect() — _isDisconnecting flag
   * is not set on unexpected drops (05-RESEARCH.md Pattern 2).
   */
  private scheduleReconnect(): void {
    if (this.destroyed) return;
    const delay = this.backoffDelay();
    this.attempt++;
    this.logger.info(
      { event: "atem_reconnecting", attempt: this.attempt, delayMs: Math.round(delay) },
      "ATEM reconnecting",
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // Guard: skip if already hydrated — atem-connection calls disconnect() internally
      // when connect() is called while connected, which would fire handleDisconnected()
      // again and create an infinite reconnect loop on real ATEM hardware.
      if (!this.destroyed && !this.isHydrated) {
        void this.atem.connect(this.host, this.port).catch((err: unknown) => {
          this.logger.warn({ err }, "ATEM connect() rejected");
        });
      }
    }, delay);
  }
}
