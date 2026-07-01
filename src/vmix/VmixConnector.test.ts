// Tests for VmixConnector.
// Strategy: vi.mock('node:net') intercepts createConnection; each test helper
// configures the mock before constructing VmixConnector.
// fetchRoster is also mocked via vi.mock to avoid real HTTP calls.
//
// Covers:
//   VMIX-01 — connect + SUBSCRIBE TALLY (including reconnect re-subscribe)
//   VMIX-02 — tally push events + rosterUpdated on connect
//   D-02/D-03 — roster re-sync on length change (hold tally during resync)
//   roster() — returns a copy, not the internal reference
//   T-03-11 — host.length < 3 guard
//   VMIX-04 — backoff reconnect loop (raw node:net socket)

import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TallyEventData } from "./VmixConnector.js";

// ---------------------------------------------------------------------------
// Mock fetchRoster to avoid real HTTP calls.
// All tests use the same resolved Map unless overridden with mockResolvedValueOnce.
// ---------------------------------------------------------------------------
vi.mock("./parseRosterXml.js", () => ({
  fetchRoster: vi.fn().mockResolvedValue(
    new Map([
      ["guid-A", 1],
      ["guid-B", 2],
    ]),
  ),
}));

// ---------------------------------------------------------------------------
// Mock node:net so VmixConnector's createConnection can be intercepted.
// vi.mock is hoisted to the top of the file — the factory function sets up
// a vi.fn() that tests can configure with mockReturnValue.
// ---------------------------------------------------------------------------
vi.mock("node:net", () => ({
  createConnection: vi.fn(),
}));

import { VmixConnector } from "./VmixConnector.js";
import { fetchRoster } from "./parseRosterXml.js";
import { createConnection } from "node:net";

// ---------------------------------------------------------------------------
// Mock socket factory helpers
// ---------------------------------------------------------------------------

/**
 * Creates a mock Socket-like EventEmitter with write/destroy stubs.
 * Passed to vi.mocked(createConnection).mockReturnValue() before each test.
 */
function createMockSocket() {
  const sock = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  };
  sock.write = vi.fn();
  sock.destroy = vi.fn().mockImplementation(() => {
    sock.destroyed = true;
  });
  sock.destroyed = false;
  return sock;
}

/**
 * Build a no-op pino-compatible logger stub.
 */
function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  } as unknown as import("pino").Logger;
}

const mockCreateConnection = vi.mocked(createConnection);

/**
 * Helper: configure createConnection mock and create a VmixConnector.
 * Returns the connector, the mock socket (for event triggering), and the logger.
 *
 * Usage:
 *   const { connector, mockSocket, logger } = makeConnector();
 *   mockSocket.emit('connect');  // triggers VmixConnector's connect handler
 *   mockSocket.emit('data', Buffer.from('TALLY OK 10\r\n'));  // triggers tally
 */
function makeConnector(host = "192.168.1.100") {
  const mockSocket = createMockSocket();
  const logger = makeLogger();

  mockCreateConnection.mockReturnValue(
    mockSocket as unknown as import("node:net").Socket,
  );

  const connector = new VmixConnector(
    host,
    8099, // tcpPort
    8088, // httpPort
    logger,
  );

  return { connector, mockSocket, logger };
}

// Reset mock call counts before each test.
beforeEach(() => {
  vi.mocked(fetchRoster).mockResolvedValue(
    new Map([
      ["guid-A", 1],
      ["guid-B", 2],
    ]),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// VMIX-01: connect and SUBSCRIBE TALLY
// ---------------------------------------------------------------------------

describe("VMIX-01 — VmixConnector connect and subscribe", () => {
  it("VMIX-01: SUBSCRIBE TALLY sent after connect event fires", async () => {
    const { connector, mockSocket } = makeConnector();

    // Trigger the connect event — fetchAndEmitRoster is async
    mockSocket.emit("connect");
    // Flush all pending microtasks (fetchRoster mock resolves immediately).
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSocket.write).toHaveBeenCalledWith("SUBSCRIBE TALLY\r\n");
    expect(mockSocket.write).toHaveBeenCalledTimes(1);

    // Cancel any pending reconnect timer to avoid cross-test contamination
    connector.destroy();
  });

  it("VMIX-01: SUBSCRIBE TALLY re-sent on second connect (reconnect)", async () => {
    vi.useFakeTimers();
    try {
      const { connector, mockSocket } = makeConnector();

      // First connect
      mockSocket.emit("connect");
      await Promise.resolve();
      await Promise.resolve();

      // Simulate reconnect: fire 'close' to schedule retry, provide a new socket
      const reconnectSocket = createMockSocket();
      mockCreateConnection.mockReturnValueOnce(
        reconnectSocket as unknown as import("node:net").Socket,
      );
      mockSocket.emit("close");

      // Advance the backoff timer so createSocket() fires with reconnectSocket
      vi.runAllTimers();

      // Manually trigger connect on the new socket
      reconnectSocket.emit("connect");
      await Promise.resolve();
      await Promise.resolve();

      expect(reconnectSocket.write).toHaveBeenCalledWith("SUBSCRIBE TALLY\r\n");
      expect(reconnectSocket.write).toHaveBeenCalledTimes(1);

      connector.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// VMIX-02: tally push events
// ---------------------------------------------------------------------------

describe("VMIX-02 — tally push events", () => {
  it("VMIX-02: 'tally' event emitted with parsed rawTally on push", async () => {
    const { connector, mockSocket } = makeConnector();

    const tallyEvents: TallyEventData[] = [];
    connector.on("tally", (data: TallyEventData) => tallyEvents.push(data));

    // Trigger connect so currentRosterLength is initialized
    mockSocket.emit("connect");
    await Promise.resolve();
    await Promise.resolve();

    // Push a tally line: TALLY OK 10 → rawTally=[1,0], rosterLength=2
    mockSocket.emit("data", Buffer.from("TALLY OK 10\r\n"));

    expect(tallyEvents).toHaveLength(1);
    expect(tallyEvents[0]).toEqual({ rawTally: [1, 0], rosterLength: 2 });

    connector.destroy();
  });

  it("VMIX-02: 'rosterUpdated' event emitted after connect", async () => {
    const { connector, mockSocket } = makeConnector();

    const rosterEvents: Map<string, number>[] = [];
    connector.on(
      "rosterUpdated",
      (m: Map<string, number>) => rosterEvents.push(m),
    );

    mockSocket.emit("connect");
    await Promise.resolve();
    await Promise.resolve();

    expect(rosterEvents).toHaveLength(1);
    expect(rosterEvents[0]).toBeInstanceOf(Map);
    // Should contain the mocked roster
    expect(rosterEvents[0]!.get("guid-A")).toBe(1);
    expect(rosterEvents[0]!.get("guid-B")).toBe(2);

    connector.destroy();
  });

  it("VMIX-02: 'tally' event NOT emitted when connect fires before any tally push (no spurious event)", async () => {
    const { connector, mockSocket } = makeConnector();

    const tallyEvents: TallyEventData[] = [];
    connector.on("tally", (data: TallyEventData) => tallyEvents.push(data));

    mockSocket.emit("connect");
    await Promise.resolve();
    await Promise.resolve();

    // No tally push yet — no tally event should be emitted
    expect(tallyEvents).toHaveLength(0);

    connector.destroy();
  });
});

// ---------------------------------------------------------------------------
// D-02 / D-03: roster re-sync on length change
// ---------------------------------------------------------------------------

describe("D-02/D-03 — roster re-sync on length change", () => {
  it("D-02: length change triggers rosterUpdated emission after resync", async () => {
    const { connector, mockSocket } = makeConnector();

    const rosterEvents: Map<string, number>[] = [];
    const tallyEvents: TallyEventData[] = [];
    connector.on(
      "rosterUpdated",
      (m: Map<string, number>) => rosterEvents.push(m),
    );
    connector.on("tally", (data: TallyEventData) => tallyEvents.push(data));

    // Connect (roster length initialised to -1, then first tally initialises it to 2)
    mockSocket.emit("connect");
    await Promise.resolve();
    await Promise.resolve();

    // First push: length 2 → sets currentRosterLength to 2, emits tally
    mockSocket.emit("data", Buffer.from("TALLY OK 10\r\n"));
    expect(tallyEvents).toHaveLength(1);
    expect(rosterEvents).toHaveLength(1); // from connect

    // Second push: length 3 → length change → triggers resync
    // Set up a new roster response for the resync
    vi.mocked(fetchRoster).mockResolvedValueOnce(
      new Map([
        ["guid-A", 1],
        ["guid-B", 2],
        ["guid-C", 3],
      ]),
    );

    mockSocket.emit("data", Buffer.from("TALLY OK 102\r\n"));
    // Flush: resync is async (fetchRoster + emit)
    await Promise.resolve();
    await Promise.resolve();

    // rosterUpdated should be emitted a second time (after resync)
    expect(rosterEvents).toHaveLength(2);
    // tally emitted after resync with new rosterLength=3
    expect(tallyEvents).toHaveLength(2);
    expect(tallyEvents[1]).toEqual({ rawTally: [1, 0, 2], rosterLength: 3 });

    connector.destroy();
  });

  it("D-03: during resync, tally not emitted synchronously (held until async resync completes)", async () => {
    const { connector, mockSocket } = makeConnector();

    const tallyEvents: TallyEventData[] = [];
    connector.on("tally", (data: TallyEventData) => tallyEvents.push(data));

    // Connect and first push to initialise rosterLength=2
    mockSocket.emit("connect");
    await Promise.resolve();
    await Promise.resolve();
    mockSocket.emit("data", Buffer.from("TALLY OK 10\r\n"));
    expect(tallyEvents).toHaveLength(1); // first normal tally

    // Second push with different length → triggers resync
    // Resync is async — tally must NOT be emitted synchronously here
    mockSocket.emit("data", Buffer.from("TALLY OK 102\r\n")); // length 3 — change triggers resync
    // Synchronously: no new tally emitted yet (held until resync resolves)
    expect(tallyEvents).toHaveLength(1);

    // After microtask flush (resync completes): tally emitted
    await Promise.resolve();
    await Promise.resolve();
    expect(tallyEvents).toHaveLength(2);
    expect(tallyEvents[1]!.rosterLength).toBe(3);

    connector.destroy();
  });

  it("D-03: length change between two pushes — only ONE tally event per push after each resync", async () => {
    const { connector, mockSocket } = makeConnector();

    const tallyEvents: TallyEventData[] = [];
    connector.on("tally", (data: TallyEventData) => tallyEvents.push(data));

    mockSocket.emit("connect");
    await Promise.resolve();
    await Promise.resolve();

    // Push length=2 twice: no resync, two tally events
    mockSocket.emit("data", Buffer.from("TALLY OK 10\r\n"));
    mockSocket.emit("data", Buffer.from("TALLY OK 01\r\n"));
    expect(tallyEvents).toHaveLength(2);

    // Push length=1 → resync
    mockSocket.emit("data", Buffer.from("TALLY OK 1\r\n"));
    await Promise.resolve();
    await Promise.resolve();
    // Exactly one more tally event after resync
    expect(tallyEvents).toHaveLength(3);
    expect(tallyEvents[2]!.rosterLength).toBe(1);

    connector.destroy();
  });
});

// ---------------------------------------------------------------------------
// roster(): returns copy — mutation does not affect internal state
// ---------------------------------------------------------------------------

describe("roster() returns copy", () => {
  it("roster() returns a copy — mutation does not affect internal state", async () => {
    const { connector, mockSocket } = makeConnector();

    mockSocket.emit("connect");
    await Promise.resolve();
    await Promise.resolve();

    const copy1 = connector.roster();
    // Mutate the returned copy
    copy1.set("guid-A", 999);

    const copy2 = connector.roster();
    // Internal state should not be affected
    expect(copy2.get("guid-A")).toBe(1);
    expect(copy2.get("guid-B")).toBe(2);

    connector.destroy();
  });

  it("roster() returns a Map (not null/undefined)", async () => {
    const { connector } = makeConnector();
    expect(connector.roster()).toBeInstanceOf(Map);
    connector.destroy();
  });

  it("roster() returns empty Map before any connect (internal rosterMap initialized to empty)", () => {
    const { connector } = makeConnector();
    expect(connector.roster().size).toBe(0);
    connector.destroy();
  });
});

// ---------------------------------------------------------------------------
// T-03-11: host guard — short host does not crash
// ---------------------------------------------------------------------------

describe("T-03-11 — host.length < 3 guard", () => {
  it("T-03-11: VmixConnector constructor logs error for short host and does not throw", () => {
    const logger = makeLogger();
    // This host is < 3 chars — should NOT throw; should log error instead
    expect(() => {
      new VmixConnector("ab", 8099, 8088, logger);
    }).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("T-03-11: connector with short host has no-op — shutdown does not throw", () => {
    const logger = makeLogger();
    const connector = new VmixConnector("ab", 8099, 8088, logger);
    expect(() => connector.shutdown()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// rosterUpdated event emits a COPY — caller mutation does not affect roster()
// ---------------------------------------------------------------------------

describe("rosterUpdated emits a copy", () => {
  it("mutating the Map received via rosterUpdated does not change connector.roster()", async () => {
    const { connector, mockSocket } = makeConnector();

    let receivedMap: Map<string, number> | undefined;
    connector.on("rosterUpdated", (m: Map<string, number>) => {
      receivedMap = m;
    });

    mockSocket.emit("connect");
    await Promise.resolve();
    await Promise.resolve();

    expect(receivedMap).toBeDefined();
    receivedMap!.set("guid-A", 999);

    // connector.roster() should still reflect the original data
    expect(connector.roster().get("guid-A")).toBe(1);

    connector.destroy();
  });
});

// ---------------------------------------------------------------------------
// backoff reconnect — VMIX-04
// Tests for raw node:net socket + exponential backoff reconnect loop.
//
// Mock strategy: vi.mock('node:net', ...) at file top (hoisted by Vitest);
// each test configures vi.mocked(createConnection).mockReturnValue(mockSocket).
// ---------------------------------------------------------------------------

/**
 * Creates a mock Socket-like EventEmitter with write/destroy stubs.
 * Used by the VMIX-04 backoff tests only.
 */
function createMockSocketForBackoff() {
  const sock = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    destroyed: boolean;
  };
  sock.write = vi.fn();
  sock.destroy = vi.fn().mockImplementation(() => {
    sock.destroyed = true;
  });
  sock.destroyed = false;
  return sock;
}

describe("backoff reconnect — VMIX-04", () => {
  let mockSocket: ReturnType<typeof createMockSocketForBackoff>;

  beforeEach(() => {
    vi.useFakeTimers();

    // Set up a fresh mock socket for each test
    mockSocket = createMockSocketForBackoff();
    mockCreateConnection.mockReturnValue(
      mockSocket as unknown as import("node:net").Socket,
    );

    // Keep fetchRoster mocked
    vi.mocked(fetchRoster).mockResolvedValue(
      new Map([
        ["guid-A", 1],
        ["guid-B", 2],
      ]),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  /**
   * Helper: ensure a mock socket won't throw on unhandled 'error' events.
   * EventEmitter throws if 'error' is emitted with no listener registered.
   * VmixConnector registers its own error handler on the real socket.
   * In tests that fire 'error' on the mockSocket directly, add a safety listener.
   */
  function silenceErrors(sock: ReturnType<typeof createMockSocketForBackoff>): void {
    sock.on("error", () => undefined);
  }

  // T1: backoffDelay at attempt=0 returns ~1000ms (vi.spyOn Math.random → 0.5)
  it("T1: backoffDelay at attempt=0 returns 1000ms when Math.random()=0.5", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const logger = makeLogger();
    const connector = new VmixConnector("192.168.1.100", 8099, 8088, logger);

    // Verify initial createSocket() was called
    expect(mockCreateConnection).toHaveBeenCalledTimes(1);

    // Track the setTimeout delay
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    mockSocket.emit("close");

    // scheduleReconnect at attempt=0: base=1000, jitter=0.75+0.5*0.5=1.0 → 1000ms
    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(1000);

    connector.destroy();
  });

  // T2: backoffDelay at attempt=5 returns 30000ms (capped — vi.spyOn Math.random → 0.5)
  it("T2: backoffDelay at attempt=5 is capped at 30000ms when Math.random()=0.5", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const logger = makeLogger();
    const connector = new VmixConnector("192.168.1.100", 8099, 8088, logger);

    // Simulate 5 disconnect/reconnect cycles to reach attempt=5
    for (let i = 0; i < 5; i++) {
      const nextSocket = createMockSocketForBackoff();
      mockCreateConnection.mockReturnValueOnce(
        nextSocket as unknown as import("node:net").Socket,
      );
      mockSocket.emit("close");
      vi.runAllTimers();
      mockSocket = nextSocket;
    }

    // Now at attempt=5, fire close again and capture the setTimeout delay
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    mockSocket.emit("close");

    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(30000);

    connector.destroy();
  });

  // T3: attempt counter resets to 0 after successful 'connect' event fires
  it("T3: attempt counter resets to 0 after successful connect", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const logger = makeLogger();
    const connector = new VmixConnector("192.168.1.100", 8099, 8088, logger);

    // Simulate one disconnect to increment attempt to 1
    const reconnectSocket = createMockSocketForBackoff();
    mockCreateConnection.mockReturnValueOnce(
      reconnectSocket as unknown as import("node:net").Socket,
    );
    mockSocket.emit("close");
    expect(vi.getTimerCount()).toBe(1);

    vi.runAllTimers(); // fires the retry timer → createSocket() called with reconnectSocket

    // Fire 'connect' on the new socket → attempt resets to 0
    reconnectSocket.emit("connect");

    // Now fire 'close' again — attempt=0 should produce 1000ms delay
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    reconnectSocket.emit("close");

    const delays = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(delays).toContain(1000);

    connector.destroy();
  });

  // T4: lineBuffer is empty after 'connect' event (no stale bytes from prior session)
  it("T4: lineBuffer cleared in connect handler (no stale bytes from prior session)", () => {
    const logger = makeLogger();
    const connector = new VmixConnector("192.168.1.100", 8099, 8088, logger);

    // Push a partial line to simulate buffered bytes mid-session
    mockSocket.emit("data", Buffer.from("PARTIAL"));

    // Disconnect + reconnect
    const reconnectSocket = createMockSocketForBackoff();
    mockCreateConnection.mockReturnValueOnce(
      reconnectSocket as unknown as import("node:net").Socket,
    );
    mockSocket.emit("close");
    vi.runAllTimers();

    // Fire connect on new socket — lineBuffer should be cleared
    reconnectSocket.emit("connect");

    // Subscribe and listen for tally events
    const tallyEvents: unknown[] = [];
    connector.on("tally", (d: unknown) => tallyEvents.push(d));

    // Emit a clean TALLY OK line — should parse cleanly without stale prefix
    reconnectSocket.emit("data", Buffer.from("TALLY OK 10\r\n"));

    expect(tallyEvents).toHaveLength(1);
    expect((tallyEvents[0] as { rawTally: number[] }).rawTally).toEqual([1, 0]);

    connector.destroy();
  });

  // T5: 'error' event calls sock.destroy() but does NOT schedule a reconnect timer
  it("T5: error event calls sock.destroy() but does NOT schedule reconnect timer", () => {
    const logger = makeLogger();
    const connector = new VmixConnector("192.168.1.100", 8099, 8088, logger);

    // VmixConnector registers its own 'error' handler on the socket.
    // Fire error directly on mockSocket — VmixConnector's handler calls sock.destroy().
    silenceErrors(mockSocket);

    const timersBefore = vi.getTimerCount();

    // Fire 'error' — should call sock.destroy(), should NOT schedule reconnect
    mockSocket.emit("error", new Error("ECONNREFUSED"));

    // Timer count must not increase from the error alone
    expect(vi.getTimerCount()).toBe(timersBefore);
    // The mock socket's destroy method should have been called
    expect(mockSocket.destroy).toHaveBeenCalled();

    connector.destroy();
  });

  // T6: 'close' event after error schedules exactly one reconnect timer
  it("T6: close after error schedules exactly one reconnect timer (single timer invariant)", () => {
    const logger = makeLogger();
    const connector = new VmixConnector("192.168.1.100", 8099, 8088, logger);

    // Safety listener to prevent unhandled error throw (VmixConnector's handler handles it)
    silenceErrors(mockSocket);

    // Fire 'error' then 'close' (natural Node.js sequence on socket error)
    mockSocket.emit("error", new Error("ECONNREFUSED"));
    mockSocket.emit("close");

    // Exactly one timer should be pending
    expect(vi.getTimerCount()).toBe(1);

    connector.destroy();
    // After destroy, timer should be cancelled
    expect(vi.getTimerCount()).toBe(0);
  });

  // T7: destroy() cancels the pending retry timer and prevents further reconnects
  it("T7: destroy() cancels pending retry timer and prevents further reconnects", () => {
    const logger = makeLogger();
    const connector = new VmixConnector("192.168.1.100", 8099, 8088, logger);

    // Schedule a reconnect
    mockSocket.emit("close");
    expect(vi.getTimerCount()).toBe(1);

    // destroy() should cancel the timer
    connector.destroy();
    expect(vi.getTimerCount()).toBe(0);

    // Advance timers — createConnection should NOT be called again
    const callCountBefore = mockCreateConnection.mock.calls.length;
    vi.runAllTimers();
    expect(mockCreateConnection.mock.calls.length).toBe(callCountBefore);
  });

  // T8: destroy() after successful connect stops future reconnects (destroyed guard)
  it("T8: destroy() after successful connect prevents future reconnects", () => {
    const logger = makeLogger();
    const connector = new VmixConnector("192.168.1.100", 8099, 8088, logger);

    // Fire connect to establish connection
    mockSocket.emit("connect");

    // Now destroy the connector
    connector.destroy();

    // Fire close — destroyed guard should prevent scheduleReconnect from scheduling
    mockSocket.emit("close");
    expect(vi.getTimerCount()).toBe(0);

    // No new connections should be created
    const callCountAfter = mockCreateConnection.mock.calls.length;
    vi.runAllTimers();
    expect(mockCreateConnection.mock.calls.length).toBe(callCountAfter);
  });
});
