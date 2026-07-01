// Tests for PUT /overrides/:cameraId REST endpoint (Phase 6 D-07, UI-04).
// Run: npx vitest run src/routes/overrides.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerOverridesRoute } from './overrides.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeMockConfigStore(initialOverrides: Record<string, 'program' | 'preview'> = {}) {
  const config = {
    version: 1 as const,
    settings: { vmix: null, atem: null },
    mapping: [],
    overrides: { ...initialOverrides },
  };
  return {
    read: vi.fn().mockResolvedValue(structuredClone(config)),
    write: vi.fn().mockImplementation(async (newConfig: typeof config) => {
      config.overrides = { ...(newConfig.overrides ?? {}) };
    }),
  };
}

async function buildTestApp(
  configStore: ReturnType<typeof makeMockConfigStore>,
  broadcast: ReturnType<typeof vi.fn>,
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(registerOverridesRoute, {
    configStore,
    broadcast: broadcast as unknown as () => void,
  });
  return app;
}

// ---------------------------------------------------------------------------

describe('PUT /overrides/:cameraId (UI-04, D-07)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('sets override to program and returns 200 with overrides map', async () => {
    const mockConfigStore = makeMockConfigStore();
    const broadcast = vi.fn();
    const app = await buildTestApp(mockConfigStore, broadcast);

    const response = await app.inject({
      method: 'PUT',
      url: '/overrides/cam1',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'program' }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { overrides: Record<string, string> };
    expect(body.overrides['cam1']).toBe('program');
  });

  it('sets override to preview and returns 200 with overrides map', async () => {
    const mockConfigStore = makeMockConfigStore();
    const broadcast = vi.fn();
    const app = await buildTestApp(mockConfigStore, broadcast);

    const response = await app.inject({
      method: 'PUT',
      url: '/overrides/cam2',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'preview' }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { overrides: Record<string, string> };
    expect(body.overrides['cam2']).toBe('preview');
  });

  it('clears override when state is null and returns 200', async () => {
    const mockConfigStore = makeMockConfigStore({ cam1: 'program' });
    const broadcast = vi.fn();
    const app = await buildTestApp(mockConfigStore, broadcast);

    const response = await app.inject({
      method: 'PUT',
      url: '/overrides/cam1',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: null }),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { overrides: Record<string, string> };
    expect(Object.prototype.hasOwnProperty.call(body.overrides, 'cam1')).toBe(false);
  });

  it('returns 400 for invalid state value', async () => {
    const mockConfigStore = makeMockConfigStore();
    const broadcast = vi.fn();
    const app = await buildTestApp(mockConfigStore, broadcast);

    const response = await app.inject({
      method: 'PUT',
      url: '/overrides/cam1',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'invalid' }),
    });

    expect(response.statusCode).toBe(400);
  });

  it('triggers WS broadcast immediately after override write', async () => {
    const mockConfigStore = makeMockConfigStore();
    const broadcast = vi.fn();
    const app = await buildTestApp(mockConfigStore, broadcast);

    await app.inject({
      method: 'PUT',
      url: '/overrides/cam1',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'program' }),
    });

    expect(broadcast).toHaveBeenCalledOnce();
  });
});
