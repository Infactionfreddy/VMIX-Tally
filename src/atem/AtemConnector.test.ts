// Test suite for AtemConnector (src/atem/AtemConnector.ts).
// Run: npx vitest run src/atem/AtemConnector.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
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
});
