// GET /vmix/roster — returns current vMix input roster (D-09, D-10).
//
// Backed by VmixConnector.roster() which is an in-memory Map<vmixKey, vmixNumber>.
// Returns {inputs: []} when roster is empty (vMix offline — D-10).
// No blocking calls — roster() is synchronous in-memory access (T-06-02-F).
//
// NOTE: rosterTitle(key) does not exist on VmixConnector (CRITICAL DEVIATION).
// Returns {key, number} pairs only — no title field.

import type { FastifyPluginAsync } from "fastify";
import type { VmixConnector } from "../vmix/VmixConnector.js";

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

interface VmixRouteOptions {
  vmixConnector: VmixConnector;
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export const registerVmixRoute: FastifyPluginAsync<VmixRouteOptions> = async (
  fastify,
  options,
) => {
  const { vmixConnector } = options;

  fastify.get('/vmix/roster', async (_request, reply) => {
    const roster = vmixConnector.roster(); // Map<vmixKey, vmixNumber> — in-memory, non-blocking

    if (roster.size === 0) {
      // D-10: vMix offline — return empty inputs array
      return reply.send({ inputs: [] });
    }

    const inputs = Array.from(roster.entries()).map(([key, number]) => ({
      key,
      number,
    }));

    return reply.send({ inputs });
  });
};
