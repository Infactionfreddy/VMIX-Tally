// Server entry point — the ONLY file that imports from both vmix/ and atem/ (D-01).
//
// Wiring: TallyOrchestrator 'stateChanged' → AtemConnector.applyState().
// The hot path: vMix take → TallyOrchestrator → AtemConnector → ATEM bus → red SDI tally.
//
// Phase 6 additions:
//   - @fastify/static serves dist/ SPA (registered FIRST — Pitfall 5)
//   - @fastify/websocket exposes /ws for live tally snapshots
//   - CSRF onRequest hook rejects cross-origin PUT/POST/DELETE (T-06-02-D)
//   - broadcast() iterates fastify.websocketServer.clients (readyState === OPEN)
//   - buildSnapshot() returns cameras:[] when orchestrator state is null (Pitfall 2)
//   - Connection status tracking wired to connector 'ready'/'disconnected' events
//   - Walk-test route (VERIFY-01) drives each mapped ATEM input sequentially

import { fileURLToPath } from "node:url";
import path from "node:path";

import pino from "pino";
import Fastify from "fastify";
import websocketPlugin from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import { WebSocket } from "ws";
import type { Logger } from "pino";

import { ConfigStore } from "./config/configStore.js";
import { TallyOrchestrator } from "./vmix/tallyOrchestrator.js";
import { VmixConnector } from "./vmix/VmixConnector.js";
import { AtemConnector } from "./atem/AtemConnector.js";
import type { MappingEntry } from "./core/resolver.js";
import type { ResolverOutput } from "./core/events.js";
import { registerOverridesRoute } from "./routes/overrides.js";
import { registerConfigRoute } from "./routes/config.js";
import { registerTestRoute } from "./routes/test.js";
import { registerVmixRoute } from "./routes/vmix.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

interface StateSnapshot {
  type: 'state';
  cameras: Array<{ cameraId: string; tally: string }>;
  connections: { vmix: ConnectionStatus; atem: ConnectionStatus };
  latencyMs: number | null;
  overrides: Record<string, 'program' | 'preview'>;
}

// ---------------------------------------------------------------------------
// Minimal interface for ConfigStore dependency (testable without full ConfigStore)
// ---------------------------------------------------------------------------

interface ConfigStoreInterface {
  read(): Promise<import('./config/schema.js').PersistedConfig>;
  write(cfg: import('./config/schema.js').PersistedConfig): Promise<void>;
}

// ---------------------------------------------------------------------------
// Minimal interfaces for connector dependencies (testable with mocks)
// ---------------------------------------------------------------------------

interface OrchestratorInterface {
  on(event: 'stateChanged', handler: (state: ResolverOutput) => void): void;
  currentDesiredState(): ResolverOutput | null;
}

interface VmixConnectorInterface {
  on(event: 'ready' | 'disconnected' | string, handler: () => void): void;
  roster(): Map<string, number>;
}

interface AtemConnectorInterface {
  on(event: 'ready' | 'disconnected' | string, handler: () => void): void;
  walkTest(mapping: MappingEntry[], logger: Logger): Promise<void>;
}

// ---------------------------------------------------------------------------
// buildApp — testable Fastify factory
//
// Phase 6 expanded signature: accepts orchestrator, vmixConnector, configStore
// in addition to existing atemConnector, mapping, logger.
//
// Registration order (CRITICAL — Pitfall 5):
//   (1) @fastify/static   — serves dist/ SPA
//   (2) @fastify/websocket — required before registering WS routes
//   (3) CSRF onRequest hook
//   (4) REST route plugins
//   (5) GET /ws — WebSocket route (must be after websocketPlugin)
//
// Fastify 5 note: pass the existing pino instance via `loggerInstance` (not
// `logger`) — the `logger` option only accepts a config object in Fastify 5.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildApp(
  atemConnector: AtemConnectorInterface,
  orchestrator: OrchestratorInterface,
  vmixConnector: VmixConnectorInterface,
  configStore: ConfigStoreInterface,
  mapping: MappingEntry[],
  logger: Logger,
) {
  const app = Fastify({ loggerInstance: logger });

  // ---------------------------------------------------------------------------
  // Connection status — in-memory object tracking connector state (D-04 trigger 2)
  // ---------------------------------------------------------------------------

  const connStatus: { vmix: ConnectionStatus; atem: ConnectionStatus } = {
    vmix: 'connecting',
    atem: 'connecting',
  };

  // ---------------------------------------------------------------------------
  // Latency tracking — updated on every 'stateChanged' event
  // ---------------------------------------------------------------------------

  let lastLatencyMs: number | null = null;

  // ---------------------------------------------------------------------------
  // buildSnapshot — D-03 snapshot shape
  // Handles null orchestrator state gracefully (Pitfall 2): cameras:[] when null.
  // ---------------------------------------------------------------------------

  function buildSnapshot(): StateSnapshot {
    const state = orchestrator.currentDesiredState();

    const cameras: StateSnapshot['cameras'] = state
      ? Object.entries(state.cameras).map(([cameraId, tally]) => ({
          cameraId,
          tally,
        }))
      : [];

    return {
      type: 'state',
      cameras,
      connections: { ...connStatus },
      latencyMs: lastLatencyMs,
      overrides: {},
    };
  }

  // ---------------------------------------------------------------------------
  // broadcast — iterates websocketServer.clients with readyState === OPEN check
  // ---------------------------------------------------------------------------

  function broadcast(): void {
    const snapshot = buildSnapshot();
    const msg = JSON.stringify(snapshot);
    // websocketServer is only available after @fastify/websocket is registered.
    // Guard: if plugin not yet registered (e.g. during test setup), skip broadcast.
    if (!('websocketServer' in app)) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wsServer = (app as any).websocketServer as { clients: Set<WebSocket> };
    for (const client of wsServer.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Register @fastify/static BEFORE @fastify/websocket (Pitfall 5)
  // ---------------------------------------------------------------------------

  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  void app.register(staticPlugin, {
    root: path.join(__dirname, '..', 'dist'),
    prefix: '/',
  });

  // ---------------------------------------------------------------------------
  // Register @fastify/websocket BEFORE routes (required for WS route handler)
  // ---------------------------------------------------------------------------

  void app.register(websocketPlugin);

  // ---------------------------------------------------------------------------
  // CSRF onRequest hook — blocks cross-origin PUT/POST/DELETE (T-06-02-D)
  // Registered after plugins but before routes.
  // ---------------------------------------------------------------------------

  app.addHook('onRequest', async (request, reply) => {
    if (['PUT', 'POST', 'DELETE'].includes(request.method)) {
      const secFetchSite = request.headers['sec-fetch-site'];
      if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
        return reply.code(403).send({ error: 'CSRF: cross-origin request rejected' });
      }
      const origin = request.headers['origin'];
      if (origin && !origin.startsWith(`http://${request.hostname}`)) {
        return reply.code(403).send({ error: 'CSRF: invalid origin' });
      }
    }
  });

  // ---------------------------------------------------------------------------
  // REST route plugins — registered after CSRF hook
  // ---------------------------------------------------------------------------

  void app.register(registerOverridesRoute, { configStore, broadcast });
  void app.register(registerConfigRoute, { configStore });
  void app.register(registerTestRoute, { atemConnector: atemConnector as never });
  void app.register(registerVmixRoute, { vmixConnector: vmixConnector as never });

  // ---------------------------------------------------------------------------
  // Walk-test route (VERIFY-01) — preserved from Phase 4
  // ---------------------------------------------------------------------------

  let isWalkRunning = false;

  app.get("/walk-test", async (_req, reply) => {
    if (isWalkRunning) {
      return reply.code(409).send({ error: "walk-test already running" });
    }

    isWalkRunning = true;

    void (async () => {
      try {
        await atemConnector.walkTest(mapping, logger);
      } finally {
        isWalkRunning = false;
      }
    })();

    return reply.code(202).send({ status: "walk-test started" });
  });

  // ---------------------------------------------------------------------------
  // WS route — must be registered AFTER websocketPlugin
  // Sends immediate snapshot on connect (D-04 trigger 3)
  // ---------------------------------------------------------------------------

  void app.register(async (fastifyWs) => {
    fastifyWs.get('/ws', { websocket: true }, (socket, _req) => {
      // D-04 trigger 3: send full snapshot immediately so browser never starts blank
      socket.send(JSON.stringify(buildSnapshot()));
      // Push-only channel — incoming messages are ignored (T-06-02-E)
    });
  });

  // ---------------------------------------------------------------------------
  // Connection status tracking — Pattern 4 from RESEARCH.md
  // vmixConnector 'ready'/'disconnected' events (added in this plan)
  // atemConnector 'ready' (existing), 'disconnected' (added in this plan)
  // ---------------------------------------------------------------------------

  vmixConnector.on('ready', () => {
    connStatus.vmix = 'connected';
    broadcast();
  });

  vmixConnector.on('disconnected', () => {
    connStatus.vmix = 'disconnected';
    broadcast();
  });

  atemConnector.on('ready', () => {
    connStatus.atem = 'connected';
    broadcast();
  });

  atemConnector.on('disconnected', () => {
    connStatus.atem = 'disconnected';
    broadcast();
  });

  // ---------------------------------------------------------------------------
  // TallyOrchestrator 'stateChanged' → update lastLatencyMs + broadcast (D-04 trigger 1)
  // CRITICAL DEVIATION: payload is ResolverOutput directly (not {newState, tallyReceivedAt})
  // Approximate tallyReceivedAt = Date.now() (< 1ms error, within 100ms bound)
  // ---------------------------------------------------------------------------

  orchestrator.on('stateChanged', (state: ResolverOutput) => {
    // CRITICAL DEVIATION: 'stateChanged' emits ResolverOutput directly (not {newState, tallyReceivedAt}).
    // tallyReceivedAt is not available from this event — latencyMs remains null.
    // Real latency is captured in pino logs (Phase 4 D-08: latencyMs in atem_command_sent).
    // A future phase can expose tallyReceivedAt via orchestrator if needed for UI-05.
    void state; // consumed by buildSnapshot via orchestrator.currentDesiredState()
    lastLatencyMs = null; // no measurement available from this event payload
    broadcast();
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
  orchestrator.on("stateChanged", (newState: ResolverOutput) => {
    atem.applyState(newState, Date.now());
  });

  // ATEM-04 / D-02: Re-assert full current desired state on every ATEM reconnect.
  atem.on("ready", () => {
    const state = orchestrator.currentDesiredState();
    if (state !== null) {
      atem.applyState(state, Date.now());
      logger.info(
        { event: "atem_resynced" },
        "ATEM ready — re-asserted current desired state",
      );
    }
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

  // Get VmixConnector instance from orchestrator for Phase 6 event wiring
  // TallyOrchestrator exposes the connector via its internal field; access via cast.
  // Phase 6 needs VmixConnector for 'ready'/'disconnected' events and roster endpoint.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vmix = (orchestrator as any).connector as VmixConnector;

  // D-02 fail-open: atem.connect() does not await or throw.
  atem.connect();

  const app = buildApp(atem, orchestrator, vmix, config, mapping, logger);
  const port = Number(process.env["PORT"] ?? 3000);
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ event: "server_started", port }, "Server listening");
}
