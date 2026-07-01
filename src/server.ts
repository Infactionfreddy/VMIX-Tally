// Server entry point — the ONLY file that imports from both vmix/ and atem/ (D-01).
//
// Wiring: TallyOrchestrator 'stateChanged' → AtemConnector.applyState().
// The hot path: vMix take → TallyOrchestrator → AtemConnector → ATEM bus → red SDI tally.
//
// Fastify instance introduced here is the same one Phase 6 will extend — no re-architecture.
// Walk-test route (VERIFY-01) drives each mapped ATEM input to program in sequence via
// AtemConnector.walkTest(); a 409 guard prevents concurrent runs (T-04-07).

import { fileURLToPath } from "node:url";

import pino from "pino";
import Fastify from "fastify";
import type { Logger } from "pino";

import { ConfigStore } from "./config/configStore.js";
import { TallyOrchestrator } from "./vmix/tallyOrchestrator.js";
import { AtemConnector } from "./atem/AtemConnector.js";
import type { MappingEntry } from "./core/resolver.js";
import type { ResolverOutput } from "./core/events.js";

// ---------------------------------------------------------------------------
// buildApp — testable Fastify factory
//
// Accepts a pre-constructed AtemConnector, a MappingEntry[] for the walk-test,
// and a pino Logger. Registers the /walk-test route and returns the Fastify
// instance. Called by both tests (via inject) and the main bootstrap.
//
// Fastify 5 note: pass the existing pino instance via `loggerInstance` (not
// `logger`) — the `logger` option only accepts a config object in Fastify 5.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildApp(
  atemConnector: AtemConnector,
  mapping: MappingEntry[],
  logger: Logger,
) {
  const app = Fastify({ loggerInstance: logger });

  // Scoped inside buildApp so each test instance gets its own flag (not module-level).
  let isWalkRunning = false;

  // GET /walk-test — VERIFY-01
  // Returns 202 Accepted immediately; fires walk-test loop in background.
  // Returns 409 Conflict if a walk is already in progress (T-04-07 / D-11).
  app.get("/walk-test", async (_req, reply) => {
    if (isWalkRunning) {
      return reply.code(409).send({ error: "walk-test already running" });
    }

    isWalkRunning = true;

    // Background task — always resets the flag in finally (T-04-07).
    void (async () => {
      try {
        await atemConnector.walkTest(mapping, logger);
      } finally {
        isWalkRunning = false;
      }
    })();

    return reply.code(202).send({ status: "walk-test started" });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Main bootstrap — only runs when this file is the entry point (not on import).
//
// Guard pattern: compare process.argv[1] to import.meta.url so that vitest
// importing buildApp does NOT trigger the server bootstrap (no real ports,
// no ConfigStore disk reads, no ATEM connection attempts during tests).
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const logger = pino();

  const config = new ConfigStore();
  await config.init();

  const settings = config.getSettings();
  const vmixSettings = settings.vmix;
  const atemSettings = settings.atem;

  // D-02 fail-open: if ATEM settings not yet configured, use defaults so the
  // server starts and the operator can configure it via Phase 6 UI.
  const atem = new AtemConnector(
    atemSettings?.host ?? "192.168.1.1",
    atemSettings?.port ?? 9910,
    logger,
  );

  // TallyOrchestrator creates VmixConnector internally from config settings.
  // VmixConnector auto-connects via raw node:net Socket with exponential backoff (VMIX-04).
  const orchestrator = new TallyOrchestrator(config, logger);

  // D-01: ONLY wiring point between vmix/ and atem/.
  // TallyOrchestrator emits 'stateChanged' with a ResolverOutput copy (stateCopy from
  // tallyOrchestrator.ts). tallyReceivedAt is approximated as Date.now() since the
  // orchestrator's stateChanged payload does not carry the original TCP receipt timestamp
  // (that field lives inside VmixConnector and is not forwarded via the Phase 3 event).
  orchestrator.on("stateChanged", (newState: ResolverOutput) => {
    atem.applyState(newState, Date.now());
  });

  // Log configured vMix settings for operator diagnostics.
  if (vmixSettings === null) {
    logger.warn(
      { event: "server_no_vmix_settings" },
      "No vMix connection settings configured — TallyOrchestrator inactive until configured",
    );
  }

  // Build mapping for walk-test: PersistedMappingEntry has atemSource + cameraId,
  // matching MappingEntry shape (walkTest only needs atemSource and cameraId).
  const persistedMapping = config.getMapping();
  const mapping: MappingEntry[] = persistedMapping.map((e) => ({
    vmixInput: e.vmixNumber ?? 0,
    atemSource: e.atemSource,
    cameraId: e.cameraId,
  }));

  // D-02 fail-open: atem.connect() does not await or throw.
  atem.connect();

  const app = buildApp(atem, mapping, logger);
  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ event: "server_started", port }, "Server listening");
}
