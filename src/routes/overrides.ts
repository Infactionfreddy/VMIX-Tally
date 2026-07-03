// PUT /overrides/:cameraId — per-camera sticky manual override endpoint (D-07, UI-04).
//
// Body: { state: "program" | "preview" | null }
// null clears the override for the camera (deletes the key from the overrides map).
// Writes to ConfigStore, then calls broadcast() for immediate WS snapshot push.
//
// Validation: Zod safeParse rejects values outside the allowed enum (T-06-02-A).

import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import type { PersistedConfig } from "../config/schema.js";
import type { TallyOrchestrator } from "../vmix/tallyOrchestrator.js";

// ---------------------------------------------------------------------------
// Minimal ConfigStore interface required by this route
// ---------------------------------------------------------------------------

interface ConfigStoreReader {
  read(): Promise<PersistedConfig>;
  write(cfg: PersistedConfig): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface OverridesRouteOptions {
  configStore: ConfigStoreReader;
  broadcast: () => void;
  orchestrator: TallyOrchestrator;
}

// ---------------------------------------------------------------------------
// Body schema (T-06-02-A)
// ---------------------------------------------------------------------------

const overrideBodySchema = z.object({
  state: z.enum(['program', 'preview']).nullable(),
});

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export const registerOverridesRoute: FastifyPluginAsync<OverridesRouteOptions> = async (
  fastify,
  options,
) => {
  const { configStore, broadcast, orchestrator } = options;

  fastify.put('/overrides/:cameraId', async (request, reply) => {
    const { cameraId } = request.params as { cameraId: string };

    const result = overrideBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: 'Invalid override state' });
    }

    const { state } = result.data;

    const config = await configStore.read();
    const overrides: Record<string, 'program' | 'preview'> = {
      ...(config.overrides ?? {}),
    };

    if (state === null) {
      delete overrides[cameraId];
    } else {
      overrides[cameraId] = state;
    }

    await configStore.write({ ...config, overrides });

    // D-07: re-resolve with new overrides so ATEM bus updates immediately,
    // then broadcast the new snapshot to all WebSocket clients.
    orchestrator.reResolve();
    broadcast();

    return reply.send({ overrides });
  });
};
