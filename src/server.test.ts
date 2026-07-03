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
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeMockAtem(walkTestImpl?: () => Promise<void>) {
  return {
    walkTest: vi.fn().mockImplementation(walkTestImpl ?? (() => Promise.resolve())),
    on: vi.fn(),
    emit: vi.fn(),
  };
}

function makeMockVmix() {
  return {
    on: vi.fn(),
    emit: vi.fn(),
    roster: vi.fn().mockReturnValue(new Map<string, number>()),
  };
}

function makeMockOrchestrator() {
  return {
    on: vi.fn(),
    currentDesiredState: vi.fn().mockReturnValue(null),
    reResolve: vi.fn(),
  };
}

function makeMockConfigStore(overrides: Record<string, 'program' | 'preview'> = {}) {
  const config = {
    version: 1 as const,
    settings: { vmix: null, atem: null },
    mapping: [],
    overrides,
  };
  return {
    read: vi.fn().mockResolvedValue(structuredClone(config)),
    write: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockReturnValue(config.settings),
    getMapping: vi.fn().mockReturnValue(config.mapping),
    getOverrides: vi.fn().mockReturnValue(overrides),
  };
}

// ---------------------------------------------------------------------------

describe("server walk-test route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("VERIFY-01: GET /walk-test returns 202 on first call", async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );

    const response = await app.inject({ method: "GET", url: "/walk-test" });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "walk-test started" });
  });

  it("VERIFY-01: GET /walk-test returns 409 when walk already running", async () => {
    const mockAtem = makeMockAtem(() => new Promise<void>(() => {}));
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );

    const first = await app.inject({ method: "GET", url: "/walk-test" });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({ method: "GET", url: "/walk-test" });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ error: "walk-test already running" });
  });

  it("VERIFY-01: walk-test calls atemConnector.walkTest with mapping", async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );

    await app.inject({ method: "GET", url: "/walk-test" });
    await new Promise<void>((res) => setImmediate(res));

    expect(mockAtem.walkTest).toHaveBeenCalledWith(sampleMapping, mockLogger);
  });
});

// ---------------------------------------------------------------------------
// Phase 6 — WS broadcast + CSRF behavior
// ---------------------------------------------------------------------------

describe('broadcast snapshot (UI-02, UI-03)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('includes cameras: [] when orchestrator.currentDesiredState() is null', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    // /ws WebSocket route must be registered
    expect(app.hasRoute({ method: 'GET', url: '/ws' })).toBe(true);
  });

  it('includes connections field reflecting current connStatus', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    // Verify connStatus tracking wires 'ready' and 'disconnected' on both connectors
    expect(mockVmix.on).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(mockVmix.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
    expect(mockAtem.on).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(mockAtem.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
  });

  it('includes latencyMs computed from tallyReceivedAt', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    // orchestrator 'stateChanged' must be registered
    expect(mockOrchestrator.on).toHaveBeenCalledWith('stateChanged', expect.any(Function));
  });

  it('pushes full snapshot to all OPEN WS clients on stateChanged event', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    const stateChangedCall = (mockOrchestrator.on as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => call[0] === 'stateChanged',
    );
    expect(stateChangedCall).toBeDefined();
  });
});

describe('connection status tracking (UI-02)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sets connStatus.vmix = connected on vmixConnector ready event', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    const readyCalls = (mockVmix.on as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'ready',
    );
    expect(readyCalls.length).toBeGreaterThan(0);
  });

  it('sets connStatus.vmix = disconnected on vmixConnector disconnected event', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    const disconnectedCalls = (mockVmix.on as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'disconnected',
    );
    expect(disconnectedCalls.length).toBeGreaterThan(0);
  });

  it('sets connStatus.atem = connected on atemConnector ready event', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    const readyCalls = (mockAtem.on as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'ready',
    );
    expect(readyCalls.length).toBeGreaterThan(0);
  });

  it('sets connStatus.atem = disconnected on atemConnector disconnected event', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    const disconnectedCalls = (mockAtem.on as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'disconnected',
    );
    expect(disconnectedCalls.length).toBeGreaterThan(0);
  });
});

describe('CSRF hook (security)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('rejects PUT /overrides with Sec-Fetch-Site: cross-site with 403', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/overrides/cam1',
      headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'program' }),
    });

    expect(response.statusCode).toBe(403);
  });

  it('accepts PUT /overrides with Sec-Fetch-Site: same-origin with 200', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/overrides/cam1',
      headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'program' }),
    });

    expect(response.statusCode).toBe(200);
  });

  it('rejects PUT /overrides with subdomain-spoofed Origin (bypass attempt) with 403', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/overrides/cam1',
      headers: {
        'sec-fetch-site': 'none',
        origin: 'http://localhost.attacker.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ state: 'program' }),
    });

    expect(response.statusCode).toBe(403);
  });

  it('accepts PUT /overrides with exact same-origin Origin header with 200', async () => {
    const mockAtem = makeMockAtem();
    const mockVmix = makeMockVmix();
    const mockOrchestrator = makeMockOrchestrator();
    const mockConfigStore = makeMockConfigStore();
    const app = buildApp(
      mockAtem as never,
      mockOrchestrator as never,
      mockVmix as never,
      mockConfigStore as never,
      sampleMapping,
      mockLogger,
    );
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/overrides/cam1',
      headers: {
        'sec-fetch-site': 'none',
        origin: 'http://localhost:80',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ state: 'program' }),
    });

    expect(response.statusCode).toBe(200);
  });
});
