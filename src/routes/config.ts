// GET/PUT /config/settings and GET/PUT /config/mapping (D-11, UI-01).
//
// All PUT routes merge the incoming body into the current stored config,
// then validate the full document with the existing schema before writing.
// Returns ConfigValidationError shape on 400 (T-06-02-B).
//
// Reuses schema and toConfigValidationError from src/config/schema.ts — do NOT duplicate.

import { schema, toConfigValidationError } from "../config/schema.js";
import type { PersistedConfig } from "../config/schema.js";
import type { FastifyPluginAsync } from "fastify";

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

interface ConfigRouteOptions {
  configStore: ConfigStoreReader;
  onSettingsChanged?: (settings: PersistedConfig['settings']) => void;
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export const registerConfigRoute: FastifyPluginAsync<ConfigRouteOptions> = async (
  fastify,
  options,
) => {
  const { configStore, onSettingsChanged } = options;

  // GET /config/settings — return current connection settings
  fastify.get('/config/settings', async (_request, reply) => {
    const config = await configStore.read();
    return reply.send({ settings: config.settings });
  });

  // PUT /config/settings — merge + validate + write new settings
  fastify.put('/config/settings', async (request, reply) => {
    const current = await configStore.read();
    const candidate = { ...current, settings: request.body };
    const result = schema.safeParse(candidate);
    if (!result.success) {
      return reply.code(400).send(toConfigValidationError(result.error));
    }
    await configStore.write(result.data);
    onSettingsChanged?.(result.data.settings);
    return reply.send({ settings: result.data.settings });
  });

  // GET /config/mapping — return current mapping array
  fastify.get('/config/mapping', async (_request, reply) => {
    const config = await configStore.read();
    return reply.send({ mapping: config.mapping });
  });

  // PUT /config/mapping — replace full mapping array (validated by schema.max(8))
  fastify.put('/config/mapping', async (request, reply) => {
    const current = await configStore.read();
    const candidate = { ...current, mapping: request.body };
    const result = schema.safeParse(candidate);
    if (!result.success) {
      return reply.code(400).send(toConfigValidationError(result.error));
    }
    await configStore.write(result.data);
    return reply.send({ mapping: result.data.mapping });
  });
};
