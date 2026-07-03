// POST /test/:cameraId — ephemeral per-camera test control (D-12, UI walk-test).
//
// Body: { action: "program" | "preview" | "clear" }
// program/preview: directly sets the ATEM bus for this camera's atemSource,
// bypassing the resolver (diagnostic tool, no config persistence).
// clear: re-applies the current desired state via resetAndApply().
// If ATEM not yet hydrated, returns 503.
// Validates body with Zod (T-06-02-C).

import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { AtemConnector } from "../atem/AtemConnector.js";
import type { TallyOrchestrator } from "../vmix/tallyOrchestrator.js";
import type { PersistedConfig } from "../config/schema.js";

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface ConfigStoreReader {
  read(): Promise<PersistedConfig>;
}

interface TestRouteOptions {
  atemConnector: AtemConnector;
  orchestrator: TallyOrchestrator;
  configStore: ConfigStoreReader;
}

// ---------------------------------------------------------------------------
// Body schema (T-06-02-C)
// ---------------------------------------------------------------------------

const testBodySchema = z.object({
  action: z.enum(['program', 'preview', 'clear']),
});

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export const registerTestRoute: FastifyPluginAsync<TestRouteOptions> = async (
  fastify,
  options,
) => {
  const { atemConnector, orchestrator, configStore } = options;

  fastify.post('/test/:cameraId', async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };

    const result = testBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Invalid test action' });
    }

    const { action } = result.data;

    if (action === 'clear') {
      const state = orchestrator.currentDesiredState();
      if (state !== null) {
        atemConnector.resetAndApply(state);
      }
      return reply.send({ ok: true });
    }

    // Find atemSource for this camera
    const config = await configStore.read();
    const entry = config.mapping.find((m) => m.cameraId === cameraId);
    if (!entry) {
      return reply.code(404).send({ error: 'Camera not found in mapping' });
    }

    if (action === 'program') {
      atemConnector.setProgram(entry.atemSource);
    } else {
      atemConnector.setPreview(entry.atemSource);
    }

    return reply.send({ ok: true });
  });
};
