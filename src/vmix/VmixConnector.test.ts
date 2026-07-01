// Tests for VmixConnector.
// Strategy (D-12): inject a mock TcpConnection via the optional tcpFactory
// parameter — no module-level vi.mock hoisting needed.
// fetchRoster is also mocked via vi.mock to avoid real HTTP calls.
//
// Covers:
//   VMIX-01 — connect + SUBSCRIBE TALLY (including reconnect re-subscribe)
//   VMIX-02 — tally push events + rosterUpdated on connect
//   D-02/D-03 — roster re-sync on length change (hold tally during resync)
//   roster() — returns a copy, not the internal reference

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TcpConnection, TallyEventData } from "./VmixConnector.js";

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

import { VmixConnector } from "./VmixConnector.js";
import { fetchRoster } from "./parseRosterXml.js";

// ---------------------------------------------------------------------------
// Mock TCP connection factory helpers
// ---------------------------------------------------------------------------

/**
 * Creates a minimal mock TcpConnection.
 * Captures all listeners registered via .on() and exposes a trigger() helper
 * so tests can fire events (e.g. trigger('connect') or trigger('tally', '10')).
 */
function createMockTcp(): {
  tcp: TcpConnection;
  send: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  trigger(event: string, ...args: unknown[]): void;
} {
  const listeners: Record<string, Function[]> = {};
  const send = vi.fn().mockResolvedValue(undefined);
  const shutdown = vi.fn();

  const tcp: TcpConnection = {
    on(type: string, callback: Function): void {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(callback);
    },
    send,
    shutdown,
  };

  function trigger(event: string, ...args: unknown[]): void {
    const cbs = listeners[event] ?? [];
    for (const cb of cbs) {
      cb(...args);
    }
  }

  return { tcp, send, shutdown, trigger };
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

/**
 * Helper: create a VmixConnector with injected mock TCP + logger.
 * Returns the connector, the mock TCP controls, and the logger stub.
 */
function makeConnector(host = "192.168.1.100") {
  const mockTcp = createMockTcp();
  const logger = makeLogger();

  const connector = new VmixConnector(
    host,
    8099, // tcpPort
    8088, // httpPort
    logger,
    (_host: string, _port: number) => mockTcp.tcp,
  );

  return { connector, mockTcp, logger };
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
    const { mockTcp } = makeConnector();

    // Trigger the connect event — handleConnect is async so we await the
    // promise that resolves after fetchRoster (two microtask ticks).
    mockTcp.trigger("connect");
    // Flush all pending microtasks (fetchRoster mock resolves immediately).
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTcp.send).toHaveBeenCalledWith("SUBSCRIBE TALLY");
    expect(mockTcp.send).toHaveBeenCalledTimes(1);
  });

  it("VMIX-01: SUBSCRIBE TALLY re-sent on second connect (reconnect)", async () => {
    const { mockTcp } = makeConnector();

    // First connect
    mockTcp.trigger("connect");
    await Promise.resolve();
    await Promise.resolve();

    // Second connect (simulates reconnect after disconnect)
    mockTcp.trigger("connect");
    await Promise.resolve();
    await Promise.resolve();

    expect(mockTcp.send).toHaveBeenCalledWith("SUBSCRIBE TALLY");
    expect(mockTcp.send).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// VMIX-02: tally push events
// ---------------------------------------------------------------------------

describe("VMIX-02 — tally push events", () => {
  it("VMIX-02: 'tally' event emitted with parsed rawTally on push", async () => {
    const { connector, mockTcp } = makeConnector();

    const tallyEvents: TallyEventData[] = [];
    connector.on("tally", (data: TallyEventData) => tallyEvents.push(data));

    // Trigger connect so currentRosterLength is initialized
    mockTcp.trigger("connect");
    await Promise.resolve();
    await Promise.resolve();

    // Push a tally string: "10" → rawTally=[1,0], rosterLength=2
    mockTcp.trigger("tally", "10");

    expect(tallyEvents).toHaveLength(1);
    expect(tallyEvents[0]).toEqual({ rawTally: [1, 0], rosterLength: 2 });
  });

  it("VMIX-02: 'rosterUpdated' event emitted after connect", async () => {
    const { connector, mockTcp } = makeConnector();

    const rosterEvents: Map<string, number>[] = [];
    connector.on(
      "rosterUpdated",
      (m: Map<string, number>) => rosterEvents.push(m),
    );

    mockTcp.trigger("connect");
    await Promise.resolve();
    await Promise.resolve();

    expect(rosterEvents).toHaveLength(1);
    expect(rosterEvents[0]).toBeInstanceOf(Map);
    // Should contain the mocked roster
    expect(rosterEvents[0]!.get("guid-A")).toBe(1);
    expect(rosterEvents[0]!.get("guid-B")).toBe(2);
  });

  it("VMIX-02: 'tally' event NOT emitted when connect fires before any tally push (no spurious event)", async () => {
    const { connector, mockTcp } = makeConnector();

    const tallyEvents: TallyEventData[] = [];
    connector.on("tally", (data: TallyEventData) => tallyEvents.push(data));

    mockTcp.trigger("connect");
    await Promise.resolve();
    await Promise.resolve();

    // No tally push yet — no tally event should be emitted
    expect(tallyEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// D-02 / D-03: roster re-sync on length change
// ---------------------------------------------------------------------------

describe("D-02/D-03 — roster re-sync on length change", () => {
  it("D-02: length change triggers rosterUpdated emission after resync", async () => {
    const { connector, mockTcp } = makeConnector();

    const rosterEvents: Map<string, number>[] = [];
    const tallyEvents: TallyEventData[] = [];
    connector.on(
      "rosterUpdated",
      (m: Map<string, number>) => rosterEvents.push(m),
    );
    connector.on("tally", (data: TallyEventData) => tallyEvents.push(data));

    // Connect (roster length initialised to -1, then first tally initialises it to 2)
    mockTcp.trigger("connect");
    await Promise.resolve();
    await Promise.resolve();

    // First push: length 2 → sets currentRosterLength to 2, emits tally
    mockTcp.trigger("tally", "10");
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

    mockTcp.trigger("tally", "102");
    // Flush: resync is async (fetchRoster + emit)
    await Promise.resolve();
    await Promise.resolve();

    // rosterUpdated should be emitted a second time (after resync)
    expect(rosterEvents).toHaveLength(2);
    // tally emitted after resync with new rosterLength=3
    expect(tallyEvents).toHaveLength(2);
    expect(tallyEvents[1]).toEqual({ rawTally: [1, 0, 2], rosterLength: 3 });
  });

  it("D-03: during resync, tally not emitted synchronously (held until async resync completes)", async () => {
    const { connector, mockTcp } = makeConnector();

    const tallyEvents: TallyEventData[] = [];
    connector.on("tally", (data: TallyEventData) => tallyEvents.push(data));

    // Connect and first push to initialise rosterLength=2
    mockTcp.trigger("connect");
    await Promise.resolve();
    await Promise.resolve();
    mockTcp.trigger("tally", "10");
    expect(tallyEvents).toHaveLength(1); // first normal tally

    // Second push with different length → triggers resync
    // Resync is async — tally must NOT be emitted synchronously here
    mockTcp.trigger("tally", "102"); // length 3 — change triggers resync
    // Synchronously: no new tally emitted yet (held until resync resolves)
    expect(tallyEvents).toHaveLength(1);

    // After microtask flush (resync completes): tally emitted
    await Promise.resolve();
    await Promise.resolve();
    expect(tallyEvents).toHaveLength(2);
    expect(tallyEvents[1]!.rosterLength).toBe(3);
  });

  it("D-03: length change between two pushes — only ONE tally event per push after each resync", async () => {
    const { connector, mockTcp } = makeConnector();

    const tallyEvents: TallyEventData[] = [];
    connector.on("tally", (data: TallyEventData) => tallyEvents.push(data));

    mockTcp.trigger("connect");
    await Promise.resolve();
    await Promise.resolve();

    // Push length=2 twice: no resync, two tally events
    mockTcp.trigger("tally", "10");
    mockTcp.trigger("tally", "01");
    expect(tallyEvents).toHaveLength(2);

    // Push length=1 → resync
    mockTcp.trigger("tally", "1");
    await Promise.resolve();
    await Promise.resolve();
    // Exactly one more tally event after resync
    expect(tallyEvents).toHaveLength(3);
    expect(tallyEvents[2]!.rosterLength).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// roster(): returns copy — mutation does not affect internal state
// ---------------------------------------------------------------------------

describe("roster() returns copy", () => {
  it("roster() returns a copy — mutation does not affect internal state", async () => {
    const { connector, mockTcp } = makeConnector();

    mockTcp.trigger("connect");
    await Promise.resolve();
    await Promise.resolve();

    const copy1 = connector.roster();
    // Mutate the returned copy
    copy1.set("guid-A", 999);

    const copy2 = connector.roster();
    // Internal state should not be affected
    expect(copy2.get("guid-A")).toBe(1);
    expect(copy2.get("guid-B")).toBe(2);
  });

  it("roster() returns a Map (not null/undefined)", async () => {
    const { connector } = makeConnector();
    expect(connector.roster()).toBeInstanceOf(Map);
  });

  it("roster() returns empty Map before any connect (internal rosterMap initialized to empty)", () => {
    const { connector } = makeConnector();
    expect(connector.roster().size).toBe(0);
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

  it("T-03-11: connector with short host has no-op tcp — shutdown does not throw", () => {
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
    const { connector, mockTcp } = makeConnector();

    let receivedMap: Map<string, number> | undefined;
    connector.on("rosterUpdated", (m: Map<string, number>) => {
      receivedMap = m;
    });

    mockTcp.trigger("connect");
    await Promise.resolve();
    await Promise.resolve();

    expect(receivedMap).toBeDefined();
    receivedMap!.set("guid-A", 999);

    // connector.roster() should still reflect the original data
    expect(connector.roster().get("guid-A")).toBe(1);
  });
});
