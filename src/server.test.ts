// Test suite for server walk-test route (src/server.ts).
// Run: npx vitest run src/server.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Logger } from "pino";
import type { MappingEntry } from "./core/resolver.js";
import { buildApp } from "./server.js";

// ---------------------------------------------------------------------------
// Mock Logger — minimal pino-shaped object
// ---------------------------------------------------------------------------

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn().mockReturnThis(),
  level: "info",
} as unknown as Logger;

// ---------------------------------------------------------------------------
// Sample mapping for tests
// ---------------------------------------------------------------------------

const sampleMapping: MappingEntry[] = [
  { vmixInput: 1, atemSource: 1, cameraId: "cam-1" },
  { vmixInput: 2, atemSource: 2, cameraId: "cam-2" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockAtem(walkTestImpl?: () => Promise<void>) {
  return {
    walkTest: vi.fn().mockImplementation(walkTestImpl ?? (() => Promise.resolve())),
  };
}

// ---------------------------------------------------------------------------

describe("server walk-test route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("VERIFY-01: GET /walk-test returns 202 on first call", async () => {
    const mockAtem = makeMockAtem();
    const app = buildApp(mockAtem as never, sampleMapping, mockLogger);

    const response = await app.inject({ method: "GET", url: "/walk-test" });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "walk-test started" });
  });

  it("VERIFY-01: GET /walk-test returns 409 when walk already running", async () => {
    // Use a never-resolving walkTest so isWalkRunning stays true
    const mockAtem = makeMockAtem(() => new Promise<void>(() => {}));
    const app = buildApp(mockAtem as never, sampleMapping, mockLogger);

    // First call — sets isWalkRunning = true, fires background task that never resolves
    const first = await app.inject({ method: "GET", url: "/walk-test" });
    expect(first.statusCode).toBe(202);

    // Second call — isWalkRunning is still true → 409
    const second = await app.inject({ method: "GET", url: "/walk-test" });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "walk-test already running" });
  });

  it("VERIFY-01: walk-test calls atemConnector.walkTest with mapping", async () => {
    const mockAtem = makeMockAtem();
    const app = buildApp(mockAtem as never, sampleMapping, mockLogger);

    await app.inject({ method: "GET", url: "/walk-test" });

    // walkTest should be called with the mapping and logger
    // Allow a tick for the background void async task to start
    await new Promise<void>((res) => setImmediate(res));

    expect(mockAtem.walkTest).toHaveBeenCalledWith(sampleMapping, mockLogger);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 Wave 0 stubs — filled in by Plan 02
// These todo stubs define the WS broadcast + CSRF behavior contract.
// ---------------------------------------------------------------------------

describe('broadcast snapshot (UI-02, UI-03)', () => {
  it.todo('pushes full snapshot to all OPEN WS clients on stateChanged event');
  it.todo('includes cameras: [] when orchestrator.currentState is null');
  it.todo('includes connections field reflecting current connStatus');
  it.todo('includes latencyMs computed from tallyReceivedAt');
});

describe('connection status tracking (UI-02)', () => {
  it.todo('sets connStatus.vmix = connected on vmixConnector ready event');
  it.todo('sets connStatus.vmix = disconnected on vmixConnector disconnected event');
  it.todo('sets connStatus.atem = connected on atemConnector ready event');
  it.todo('sets connStatus.atem = disconnected on atemConnector disconnected event');
});

describe('CSRF hook (security)', () => {
  it.todo('rejects PUT /overrides with Sec-Fetch-Site: cross-site with 403');
  it.todo('accepts PUT /overrides with Sec-Fetch-Site: same-origin with 200');
});
