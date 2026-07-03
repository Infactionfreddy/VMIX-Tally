// Test suite for AtemConnector (src/atem/AtemConnector.ts).
// Run: npx vitest run src/atem/AtemConnector.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "pino";
import { AtemConnector } from "./AtemConnector.js";

// ---------------------------------------------------------------------------
// Mock Atem factory
// ---------------------------------------------------------------------------

/**
 * Creates a mock Atem instance with captured event handlers.
 * Provides an `emit(event, ...args)` helper to trigger captured handlers.
 */
function createMockAtem() {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};

  const mockAtem = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(handler);
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    changeProgramInput: vi.fn().mockResolvedValue(undefined),
    changePreviewInput: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  };

  const emit = (event: string, ...args: unknown[]) => {
    const eventHandlers = handlers[event] ?? [];
    for (const handler of eventHandlers) {
      handler(...args);
    }
  };

  return { mockAtem, emit };
}

// ---------------------------------------------------------------------------
// Mock Logger
// ---------------------------------------------------------------------------

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResolverOutput(program: number | null, preview: number | null) {
  return {
    cameras: {},
    bus: { program, preview },
    contended: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AtemConnector", () => {
  let mockAtem: ReturnType<typeof createMockAtem>["mockAtem"];
  let emit: ReturnType<typeof createMockAtem>["emit"];
  let connector: AtemConnector;

  beforeEach(() => {
    vi.clearAllMocks();
    const result = createMockAtem();
    mockAtem = result.mockAtem;
    emit = result.emit;
    connector = new AtemConnector(
      "192.168.1.100",
      9910,
      mockLogger,
      () => mockAtem as never,
    );
  });

  // ── ATEM-01 — connect and hydration gate ────────────────────────────────────

  describe("ATEM-01 — connect and hydration gate", () => {
    it("ATEM-01: connect() calls atem.connect(host, port)", () => {
      connector.connect();
      expect(mockAtem.connect).toHaveBeenCalledWith("192.168.1.100", 9910);
    });

    it("ATEM-01: 'connected' event sets isHydrated — applyState dispatches after connect", () => {
      // Before 'connected': applyState should not dispatch
      const state = makeResolverOutput(3, 2);
      const ts = Date.now() - 50;

      // Trigger 'connected' to hydrate
      emit("connected");

      // After 'connected': applyState should dispatch (changeProgramInput called)
      connector.applyState(state, ts);

      expect(mockAtem.changeProgramInput).toHaveBeenCalledWith(3, 0);
    });

    it("ATEM-01: pendingState flushed immediately on 'connected' event", () => {
      const state = makeResolverOutput(3, 2);
      const ts = Date.now() - 50;

      // Call applyState BEFORE hydration → should store as pending
      connector.applyState(state, ts);
      expect(mockAtem.changeProgramInput).not.toHaveBeenCalled();

      // Emit 'connected' → pending state should be flushed
      emit("connected");

      expect(mockAtem.changeProgramInput).toHaveBeenCalledWith(3, 0);
    });
  });

  // ── ATEM-02/03 — applyState command dispatch ────────────────────────────────

  describe("ATEM-02/03 — applyState command dispatch", () => {
    beforeEach(() => {
      // Hydrate the connector before each dispatch test
      emit("connected");
    });

    it("ATEM-02: applyState calls changeProgramInput(src, 0) not cut()", () => {
      const state = makeResolverOutput(3, 2);
      const ts = Date.now() - 50;

      connector.applyState(state, ts);

      expect(mockAtem.changeProgramInput).toHaveBeenCalledWith(3, 0);
      // Verify no forbidden methods exist on the mock (cut/autoTransition)
      expect((mockAtem as Record<string, unknown>)["cut"]).toBeUndefined();
      expect((mockAtem as Record<string, unknown>)["autoTransition"]).toBeUndefined();
    });

    it("ATEM-03: applyState calls changePreviewInput(src, 0)", () => {
      const state = makeResolverOutput(3, 2);
      const ts = Date.now() - 50;

      connector.applyState(state, ts);

      expect(mockAtem.changePreviewInput).toHaveBeenCalledWith(2, 0);
    });

    it("CORE-03: no command sent when state unchanged (reconciler no-op)", () => {
      const state = makeResolverOutput(3, 2);
      const ts = Date.now() - 50;

      // First call — should dispatch
      connector.applyState(state, ts);
      expect(mockAtem.changeProgramInput).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Second call with identical state — should NOT dispatch (reconciler no-op)
      connector.applyState(state, Date.now() - 10);
      expect(mockAtem.changeProgramInput).not.toHaveBeenCalled();
      expect(mockAtem.changePreviewInput).not.toHaveBeenCalled();
    });

    it("ATEM-02: null bus.program does not call changeProgramInput", () => {
      const state = makeResolverOutput(null, 2);
      const ts = Date.now() - 50;

      connector.applyState(state, ts);

      expect(mockAtem.changeProgramInput).not.toHaveBeenCalled();
      expect(mockAtem.changePreviewInput).toHaveBeenCalledWith(2, 0);
    });
  });

  // ── REL-01 — latency logging ─────────────────────────────────────────────────

  describe("REL-01 — latency logging", () => {
    beforeEach(() => {
      emit("connected");
    });

    it("REL-01: latencyMs field present in logger.info on command dispatch", () => {
      const state = makeResolverOutput(3, 2);
      const ts = Date.now() - 50;

      connector.applyState(state, ts);

      // Find the info call with atem_command_sent
      const calls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls;
      const commandSentCall = calls.find(
        (call) =>
          typeof call[0] === "object" &&
          call[0] !== null &&
          (call[0] as Record<string, unknown>)["event"] === "atem_command_sent",
      );

      expect(commandSentCall).toBeDefined();
      const logObj = commandSentCall![0] as Record<string, unknown>;
      expect(typeof logObj["latencyMs"]).toBe("number");
      expect(logObj["latencyMs"]).toBeGreaterThanOrEqual(0);
    });
  });

  // ── ATEM reconnect + resync — ATEM-04 ───────────────────────────────────────

  describe("ATEM reconnect + resync — ATEM-04", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("T1: 'disconnected' event sets isHydrated to false", () => {
      // First hydrate
      emit("connected");
      // Confirm hydrated: applyState should dispatch
      const state = makeResolverOutput(3, 2);
      connector.applyState(state, Date.now());
      expect(mockAtem.changeProgramInput).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Now disconnect
      emit("disconnected");

      // After disconnect, applyState should NOT dispatch (stores as pending)
      connector.applyState(makeResolverOutput(1, 2), Date.now());
      expect(mockAtem.changeProgramInput).not.toHaveBeenCalled();
    });

    it("T2: 'disconnected' event schedules exactly one reconnect timer", () => {
      // Hydrate first
      emit("connected");
      vi.clearAllMocks();

      // Disconnect
      emit("disconnected");

      // Advance timers: the reconnect should call atem.connect() once
      vi.runAllTimers();

      expect(mockAtem.connect).toHaveBeenCalledTimes(1);
      expect(mockAtem.connect).toHaveBeenCalledWith("192.168.1.100", expect.any(Number));
    });

    it("T3: On reconnect, 'connected' event sets isHydrated back to true", () => {
      // Hydrate, disconnect, then reconnect
      emit("connected");
      emit("disconnected");

      // Trigger the scheduled reconnect
      vi.runAllTimers();

      // Now emit 'connected' to simulate successful reconnect
      emit("connected");

      // isHydrated should be true again — applyState should dispatch
      const state = makeResolverOutput(3, 2);
      connector.applyState(state, Date.now());
      expect(mockAtem.changeProgramInput).toHaveBeenCalledWith(3, 0);
    });

    it("T4: 'ready' event is emitted after isHydrated flips to true on reconnect", () => {
      // Hydrate, disconnect, reconnect
      emit("connected");
      emit("disconnected");
      vi.runAllTimers();

      const readyListener = vi.fn();
      connector.on("ready", readyListener);

      emit("connected");

      expect(readyListener).toHaveBeenCalledTimes(1);
    });

    it("T5: reconciler.reset() is called before applyState() on reconnect (needsResync path)", () => {
      // Access private reconciler via cast to spy on it
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reconciler = (connector as any).reconciler as { reset: () => void };
      const resetSpy = vi.spyOn(reconciler, "reset");

      // Hydrate, dispatch once to set reconciler state
      emit("connected");
      connector.applyState(makeResolverOutput(3, 2), Date.now());
      resetSpy.mockClear();

      // Disconnect then reconnect
      emit("disconnected");
      vi.runAllTimers();
      emit("connected");

      // Now call applyState — should trigger reconciler.reset() via needsResync
      connector.applyState(makeResolverOutput(3, 2), Date.now());

      expect(resetSpy).toHaveBeenCalled();
    });

    it("T6: applyState() issues ATEM command even when desired state is identical to pre-disconnect state", () => {
      // Hydrate, set state
      emit("connected");
      const state = makeResolverOutput(3, 2);
      connector.applyState(state, Date.now());
      expect(mockAtem.changeProgramInput).toHaveBeenCalledTimes(1);

      vi.clearAllMocks();

      // Second call with same state — no-op (reconciler dedup)
      connector.applyState(state, Date.now());
      expect(mockAtem.changeProgramInput).not.toHaveBeenCalled();

      // Disconnect + reconnect
      emit("disconnected");
      vi.runAllTimers();
      emit("connected");

      vi.clearAllMocks();

      // Same state again — but should be sent because reconciler was reset (needsResync)
      connector.applyState(state, Date.now());
      expect(mockAtem.changeProgramInput).toHaveBeenCalledTimes(1);
    });

    it("T7: No 'ready' event if 'disconnected' fires without subsequent 'connected'", () => {
      const readyListener = vi.fn();
      connector.on("ready", readyListener);

      emit("connected"); // initial hydration emits ready on first connect too
      const initialCount = readyListener.mock.calls.length;

      emit("disconnected");
      // Do NOT emit 'connected' after

      expect(readyListener).toHaveBeenCalledTimes(initialCount); // no new 'ready'
    });

    it("T8: destroy() cancels the pending retry timer", () => {
      // Hydrate then disconnect to schedule reconnect
      emit("connected");
      emit("disconnected");

      // Destroy before timer fires
      connector.destroy();

      // Advance timers — connect should NOT be called
      vi.runAllTimers();

      expect(mockAtem.connect).not.toHaveBeenCalled();
    });

    it("T9: backoff at attempt=0 returns ~1000ms (Math.random → 0.5)", () => {
      // Math.random is pinned to 0.5: delay = min(1000*2^0, 30000) * (0.75 + 0.5*0.5) = 1000 * 1.0 = 1000ms
      // We verify by checking that the timer fires connect() at exactly 1000ms
      emit("connected");
      emit("disconnected");

      // Timer should fire at 1000ms (±0 since Math.random = 0.5 → factor = 1.0)
      vi.advanceTimersByTime(999);
      expect(mockAtem.connect).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(mockAtem.connect).toHaveBeenCalledTimes(1);
    });

    it("T10: attempt counter resets to 0 after successful hydration", () => {
      // Trigger several disconnects to increment attempt counter
      emit("connected");
      emit("disconnected"); // attempt → 1

      vi.runAllTimers(); // fires connect()

      emit("disconnected"); // attempt → 2
      vi.runAllTimers(); // fires connect() after 2s

      // Now simulate successful reconnect
      emit("connected"); // attempt should reset to 0

      // After reset, next disconnect should schedule at ~1000ms (attempt=0)
      emit("disconnected");

      vi.advanceTimersByTime(999);
      expect(mockAtem.connect).toHaveBeenCalledTimes(2); // only previous two calls

      vi.advanceTimersByTime(1);
      expect(mockAtem.connect).toHaveBeenCalledTimes(3); // new call at 1000ms → attempt was 0
    });

    it("T11: reconnect() while hydrated suppresses the internal synthetic 'disconnected' event and does not schedule a redundant reconnect", () => {
      // Hydrate on the original host
      emit("connected");
      vi.clearAllMocks();

      // Operator changes ATEM host/port while already connected
      connector.reconnect("192.168.1.200", 9910);
      expect(mockAtem.connect).toHaveBeenCalledWith("192.168.1.200", 9910);
      expect(mockAtem.connect).toHaveBeenCalledTimes(1);

      // Simulate atem-connection's internal restartConnection() behavior: calling
      // connect() while Established synchronously triggers a synthetic 'disconnected'
      // event before the new connection is established.
      emit("disconnected");

      // The synthetic disconnect must be suppressed: no redundant scheduleReconnect()
      // timer should have been started, so advancing all timers must not produce any
      // further connect() calls beyond the one reconnect() already issued.
      vi.runAllTimers();
      expect(mockAtem.connect).toHaveBeenCalledTimes(1);
    });

    it("T13: reconnect() resets destroyed so a connector can reconnect after destroy()", () => {
      connector.destroy();
      connector.reconnect("192.168.1.200", 9910);
      emit("connected"); // new host hydrates — also clears suppressNextDisconnect
      vi.clearAllMocks();

      // A genuine disconnect after this point must schedule a normal backoff reconnect —
      // if `destroyed` were still true (pre-fix bug), scheduleReconnect()'s guard would
      // silently no-op forever.
      emit("disconnected");
      vi.runAllTimers();
      expect(mockAtem.connect).toHaveBeenCalledTimes(1);
    });
  });
});
