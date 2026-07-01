// Tests for settings + mapping REST endpoints (Phase 6 UI-01).
// Run: npx vitest run src/routes/settings.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerConfigRoute } from './config.js';
import type { PersistedConfig } from '../config/schema.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeBaseConfig(overrides: Partial<PersistedConfig> = {}): PersistedConfig {
  return {
    version: 1,
    settings: {
      vmix: { host: '192.168.1.10', port: 8099 },
      atem: { host: '192.168.1.20', port: 9910 },
    },
    mapping: [],
    ...overrides,
  };
}

function makeMockConfigStore(initial: PersistedConfig = makeBaseConfig()) {
  let stored = structuredClone(initial);
  return {
    read: vi.fn().mockImplementation(async () => structuredClone(stored)),
    write: vi.fn().mockImplementation(async (cfg: PersistedConfig) => {
      stored = structuredClone(cfg);
    }),
  };
}

async function buildTestApp(
  configStore: ReturnType<typeof makeMockConfigStore>,
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(registerConfigRoute, { configStore });
  return app;
}

// ---------------------------------------------------------------------------

describe('GET /config/settings (UI-01)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns current settings from ConfigStore', async () => {
    const mockConfigStore = makeMockConfigStore();
    const app = await buildTestApp(mockConfigStore);

    const response = await app.inject({ method: 'GET', url: '/config/settings' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { settings: PersistedConfig['settings'] };
    expect(body.settings.vmix?.host).toBe('192.168.1.10');
    expect(body.settings.atem?.host).toBe('192.168.1.20');
  });
});

describe('PUT /config/settings (UI-01)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('updates settings and returns 200 with new settings', async () => {
    const mockConfigStore = makeMockConfigStore();
    const app = await buildTestApp(mockConfigStore);

    const response = await app.inject({
      method: 'PUT',
      url: '/config/settings',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vmix: { host: '10.0.0.1', port: 8099 },
        atem: { host: '10.0.0.2', port: 9910 },
      }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { settings: PersistedConfig['settings'] };
    expect(body.settings.vmix?.host).toBe('10.0.0.1');
  });

  it('rejects invalid host/port with 400 and ConfigValidationError shape', async () => {
    const mockConfigStore = makeMockConfigStore();
    const app = await buildTestApp(mockConfigStore);

    const response = await app.inject({
      method: 'PUT',
      url: '/config/settings',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        vmix: { host: '192.168.1.10', port: 99999 }, // port out of range (max 65535)
        atem: { host: '192.168.1.20', port: 9910 },
      }),
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as { kind: string };
    expect(body.kind).toBe('config-validation');
  });
});

describe('GET /config/mapping (UI-01)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns current mapping array from ConfigStore', async () => {
    const mockConfigStore = makeMockConfigStore(makeBaseConfig({ mapping: [] }));
    const app = await buildTestApp(mockConfigStore);

    const response = await app.inject({ method: 'GET', url: '/config/mapping' });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { mapping: unknown[] };
    expect(Array.isArray(body.mapping)).toBe(true);
  });
});

describe('PUT /config/mapping (UI-01)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('replaces mapping and returns 200 with new mapping', async () => {
    const mockConfigStore = makeMockConfigStore();
    const app = await buildTestApp(mockConfigStore);

    const response = await app.inject({
      method: 'PUT',
      url: '/config/mapping',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([]),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { mapping: unknown[] };
    expect(Array.isArray(body.mapping)).toBe(true);
  });

  it('rejects mapping with 9 entries with 400 (max 8)', async () => {
    const mockConfigStore = makeMockConfigStore();
    const app = await buildTestApp(mockConfigStore);

    // Build 9 valid but distinct entries (schema.max(8) should reject)
    const nineEntries = Array.from({ length: 9 }, (_, i) => ({
      vmixKey: `key-${i}`,
      vmixNumber: i + 1,
      atemSource: i + 1,
      cameraId: `cam-${i}`,
    }));

    const response = await app.inject({
      method: 'PUT',
      url: '/config/mapping',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(nineEntries),
    });

    expect(response.statusCode).toBe(400);
  });
});
