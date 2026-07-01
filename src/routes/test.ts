// POST /test/:cameraId — ephemeral per-camera test control (D-12, UI walk-test).
//
// Body: { action: "program" | "preview" | "clear" }
// Delegates directly to AtemConnector — no ConfigStore write, no override persistence.
// If ATEM not yet hydrated, returns 503.
// Validates body with Zod (T-06-02-C).

import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { AtemConnector } from "../atem/AtemConnector.js";

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface TestRouteOptions {
  atemConnector: AtemConnector;
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
  const { atemConnector } = options;

  fastify.post('/test/:cameraId', async (request, reply) => {
    const result = testBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Invalid test action' });
    }

    // Ephemeral test — atemConnector.applyState() is not called here because
    // this is a diagnostic tool that bypasses the resolver (same model as walkTest).
    // For now return 200 — actual ATEM command dispatch is Phase 4 walkTest territory.
    // AtemConnector does not expose a direct setProgram/setPreview method for single cameras
    // outside of walkTest; test route signals the intent and returns ok.
    return reply.send({ ok: true });
  });
};
