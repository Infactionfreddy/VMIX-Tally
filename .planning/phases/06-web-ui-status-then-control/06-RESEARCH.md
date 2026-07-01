# Phase 6: Web UI — Status then Control — Research

**Researched:** 2026-07-01
**Domain:** Svelte 5 + Vite frontend, @fastify/websocket + @fastify/static server expansion, REST API security
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Frontend is **Svelte 5** — `$state`, `$derived`, reactive live-status primitives.
- **D-02:** Build pipeline: **Vite** builds to `dist/`. Fastify serves `dist/` via `@fastify/static` on the same port. Dev: `vite dev` on 5173 + Fastify on 3000 (proxied). Production = always `dist/` + Fastify.
- **D-03:** Single WebSocket snapshot message type `{ type: "state", cameras, connections, latencyMs, overrides }`. `tally` values: `"program"` | `"preview"` | `"off"`. `connections`: `"connected"` | `"disconnected"` | `"connecting"`. `overrides`: cameraId → null | "program" | "preview".
- **D-04:** Server pushes on three triggers: (1) `TallyOrchestrator 'stateChanged'`, (2) connector connect/disconnect/ready events, (3) new WS client connects.
- **D-05:** Overrides persisted in ConfigStore as optional `overrides` field: `z.record(z.string(), z.enum(['program', 'preview'])).optional()`. Survives server restarts.
- **D-06:** `TallyOrchestrator` reads overrides from ConfigStore on every `'tally'` event (live-read, same pattern as mapping).
- **D-07:** Override endpoint: `PUT /overrides/:cameraId` body `{ state: "program" | "preview" | null }`. `null` clears. 200 OK with current overrides map. Triggers immediate WS snapshot push.
- **D-08:** Override UI: toggle trio `[Aus][PROG][PREV]` per camera card. Active override button gets orange border. Clicking active button clears (null).
- **D-09:** Mapping editor shows live vMix roster from `GET /vmix/roster` (one-shot on editor open). Backed by `VmixConnector.roster()`.
- **D-10:** If vMix offline, `GET /vmix/roster` returns empty `inputs: []`. Editor falls back to manual GUID text input.
- **D-11:** Config REST: `GET /config/mapping`, `PUT /config/mapping`, `GET /config/settings`, `PUT /config/settings`. Zod-validated, reusing Phase 2 schemas.
- **D-12:** Per-camera test controls: `[Test: PROG][Test: PREV][Fertig]` buttons. Endpoint `POST /test/:cameraId` body `{ action: "program" | "preview" | "clear" }`.
- **D-13:** ConfigStore schema extended with `overrides` field (backward-compatible optional field). `src/config/schema.ts` modified.
- **UI-SPEC:** Dark broadcast theme, 14 Svelte components, German copy, no component libraries, scoped `<style>` blocks, no ShadCN, inline SVG icons only.

### Claude's Discretion

- Svelte component structure (single-page layout, component split).
- CSS approach (scoped Svelte styles — specified in UI-SPEC).
- Whether `GET /walk-test` endpoint is kept or superseded by `POST /test/:cameraId`.
- Fastify port default (3000), configurable via `PORT` env var.
- Whether `@fastify/websocket` or standalone `ws` instance (CONTEXT.md recommends `@fastify/websocket`).

### Deferred Ideas (OUT OF SCOPE)

- `GET /metrics` p50/p95 latency endpoint
- Event log (OPS-01)
- Import/export config (OPS-02)
- Windows service packaging (PKG-01)
- Multi-switcher support (MULTI-01)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | User can configure vMix and ATEM connection settings (IP/Port) in the web UI | `PUT /config/settings` + `ConnectionSettings.svelte` component; settings fetched on page load from `GET /config/settings` |
| UI-02 | User sees real-time connection status/health for vMix and ATEM | WS snapshot `connections` field; `ConnectionBadge.svelte` + `DisconnectBanner.svelte`; connector events trigger snapshot push (D-04) |
| UI-03 | User sees real-time dashboard showing which camera is currently red/green | WS snapshot `cameras` array; `TallyGrid.svelte` + `CameraCard.svelte`; no-animation instant state flip |
| UI-04 | User can manually force tally for a camera (sticky, visually distinct, releasable) | `PUT /overrides/:cameraId`; ConfigStore `overrides` field (D-05); orange visual treatment; `OverrideControls.svelte` |
| UI-05 | User sees a latency/freshness indicator for the tally pipeline | `latencyMs` in WS snapshot; `LatencyReadout.svelte`; color thresholds `<50ms` white / `50–100ms` yellow / `>100ms` red |

</phase_requirements>

---

## Summary

Phase 6 adds a full web UI layer on top of the completed vMix→ATEM tally pipeline. The build is split into two independent TypeScript compilation contexts: the server (Node.js, `NodeNext` modules, existing `tsconfig.json`) and the frontend (browser, `bundler` module resolution, new `src/frontend/tsconfig.json`). This split is required because the existing project `tsconfig.json` uses `"moduleResolution": "NodeNext"` which conflicts with Vite's isolated-module transpilation model — the frontend needs `"moduleResolution": "bundler"` and `"isolatedModules": true`.

The server side registers two Fastify plugins (`@fastify/static`, `@fastify/websocket`) on the existing Phase 4/5 Fastify instance. The broadcast pattern is straightforward: iterate `fastify.websocketServer.clients`, check `readyState === WebSocket.OPEN`, call `socket.send()`. Connection status values (`"connected"` | `"disconnected"` | `"connecting"`) are tracked by `server.ts` based on connector events (`'ready'`, `'disconnected'` from both `VmixConnector` and `AtemConnector` from Phase 5).

The Svelte 5 frontend uses a single `.svelte.ts` state file (`src/frontend/state.svelte.ts`) that exports a `$state` object as a shared reactive store consumed by all 14 components. All WS handling lives in `App.svelte` via `onMount` + teardown function. No SvelteKit, no router, no component library — plain Svelte 5 compiled to a static SPA.

**Primary recommendation:** Two-phase build (Wave 1: server expansion + WS broadcast + static serving; Wave 2: Svelte frontend components + REST UI controls). The frontend TypeScript configuration split is the highest-risk setup step — do it explicitly in Wave 0 to avoid silent type errors propagating into the build.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WS snapshot push (broadcast) | API / Backend (`server.ts`) | — | Server owns the set of connected clients; frontend only receives |
| Connection status tracking | API / Backend (`server.ts`) | — | Server is the only party that knows connector event state |
| Override persistence | API / Backend (ConfigStore) | — | Must survive browser reload; not browser state |
| Override REST validation | API / Backend (Fastify + Zod) | — | Data integrity gate before ConfigStore write |
| Live tally dashboard display | Browser / Client (Svelte) | — | Read-only reactive display of WS snapshot |
| Camera card override toggles | Browser / Client (Svelte) | API / Backend | UI fires PUT; server validates + persists + broadcasts |
| Mapping editor | Browser / Client (Svelte) | API / Backend | One-shot GET on open; full PUT on save |
| Roster fetch | API / Backend (`/vmix/roster`) | — | Server queries `VmixConnector.roster()` in-memory map |
| Static file serving | API / Backend (`@fastify/static`) | — | Same process/port as API and WS |
| Frontend build | CDN / Static (Vite → `dist/`) | — | Build-time only; output served by Fastify |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `svelte` | 5.56.4 | Frontend reactive UI framework | [VERIFIED: npm registry] — latest stable as of 2026-06-23. Compiles away at build time, no runtime framework overhead. `$state`/`$derived`/`$effect` runes model matches live-tally update pattern exactly. |
| `@sveltejs/vite-plugin-svelte` | 7.1.2 | Vite plugin compiling `.svelte` files | [VERIFIED: npm registry] — latest stable 2026-05-07. Official Svelte team plugin; peer requires `svelte ^5.46.4` + `vite ^8.0.0`. |
| `vite` | 8.1.2 | Frontend build tool | [VERIFIED: npm registry] — latest stable 2026-06-30. Build-time only. Requires Node `^20.19.0 || >=22.12.0` — satisfied by project's Node 22 requirement. |
| `fastify` | 5.9.0 | HTTP server (already in use from Phase 4) | [VERIFIED: npm registry] — locked from Phase 4. Phase 6 expands plugin registrations only. |
| `@fastify/static` | 9.1.3 | Serve `dist/` UI from same port | [VERIFIED: npm registry] — latest stable 2026-04-21. Fastify 5 compatible (requires `>=8.x`). |
| `@fastify/websocket` | 11.2.0 | WS server bound to Fastify lifecycle | [VERIFIED: npm registry] — latest stable 2026-03-05. Wraps `ws ^8.16.0`, adds `fastify.websocketServer` accessor. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/ws` | 8.18.1 | TypeScript types for `ws` socket in WS handlers | Required when writing typed `@fastify/websocket` route handlers — `WebSocket` type for socket parameter |
| `pino` | 10.3.1 | Structured logging (already in project) | Already locked from Phases 3–4; Fastify route handlers use `request.log` |
| `zod` | 4.4.3 | Validate REST payloads | Already locked; reuse existing `schema.ts` validators for `PUT /config/mapping`, `PUT /config/settings`; new schemas for `PUT /overrides/:cameraId` and `POST /test/:cameraId` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@fastify/websocket` | Standalone `ws` server instance | Standalone `ws` avoids Fastify plugin overhead but loses shared lifecycle (register/close hooks). `@fastify/websocket` is the CONTEXT.md recommendation and keeps WS on the same port. |
| `@sveltejs/vite-plugin-svelte` plain Vite | SvelteKit | SvelteKit adds SSR, routing, adapter complexity. This is a single-page tool with no routing needs — plain Svelte SPA is correct. |
| Scoped `<style>` in each component | Tailwind CSS | Tailwind requires PostCSS setup and additional dependencies. Scoped Svelte styles are specified in UI-SPEC and match the "no build dependency" philosophy for a LAN deploy. |

**Installation (new packages only — these are additions to existing `package.json`):**
```bash
# Runtime deps
npm install fastify @fastify/static @fastify/websocket pino
# note: fastify + pino may already be in package.json from Phase 4

# Frontend devDeps (build-time only)
npm install --save-dev svelte @sveltejs/vite-plugin-svelte vite @types/ws
```

**Version verification:**
```
svelte:                     5.56.4  (2026-06-23)
vite:                       8.1.2   (2026-06-30)
@sveltejs/vite-plugin-svelte: 7.1.2 (2026-05-07)
fastify:                    5.9.0   (2026-06-28)
@fastify/static:            9.1.3   (2026-04-21)
@fastify/websocket:         11.2.0  (2026-03-05)
@types/ws:                  8.18.1  (2025-08-03)
pino:                       10.3.1  (2026-02-09)
```

---

## Package Legitimacy Audit

> slopcheck was not available at research time. All packages verified via npm registry against official GitHub sources.

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `svelte` | npm | ~10 yrs (2016-11) | github.com/sveltejs/svelte | unavailable | Approved — official Svelte team |
| `@sveltejs/vite-plugin-svelte` | npm | ~5 yrs (2021-03) | github.com/sveltejs/vite-plugin-svelte | unavailable | Approved — official Svelte team |
| `vite` | npm | ~6 yrs (2020-04) | github.com/vitejs/vite | unavailable | Approved — official Vite team (Evan You) |
| `fastify` | npm | ~10 yrs (2016-10) | github.com/fastify/fastify | unavailable | Approved — already in project |
| `@fastify/static` | npm | ~4 yrs (2022-04) | github.com/fastify/fastify-static | unavailable | Approved — official Fastify org |
| `@fastify/websocket` | npm | ~4 yrs (2022-04) | github.com/fastify/fastify-websocket | unavailable | Approved — official Fastify org |
| `pino` | npm | ~10 yrs (2016-02) | github.com/pinojs/pino | unavailable | Approved — already in project |
| `@types/ws` | npm | DefinitelyTyped | github.com/DefinitelyTyped | unavailable | Approved — DefinitelyTyped |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**No postinstall scripts detected** on any of the above packages (verified via `npm view <pkg> scripts.postinstall`).

*All packages above are [ASSUMED] clean due to slopcheck unavailability, but all are confirmed via official GitHub organizations and multi-year npm registry presence. Risk is negligible.*

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (Svelte 5 SPA)
  │  WebSocket (ws://:3000/ws)
  │    ← snapshot: { type:"state", cameras, connections, latencyMs, overrides }
  │  REST (http://:3000/)
  │    → PUT /overrides/:cameraId
  │    → PUT /config/mapping
  │    → PUT /config/settings
  │    → POST /test/:cameraId
  │    → GET /vmix/roster
  │    → GET /config/settings
  │    → GET /config/mapping
  │
  └─── @fastify/static ──→ dist/ (Svelte SPA build output)
       @fastify/websocket─→ WS handler: on connect → push snapshot
                                        fastify.websocketServer.clients → broadcast()
       Fastify routes ────→ REST handlers (Zod-validated, ConfigStore CRUD)
  │
  ├── TallyOrchestrator ─── 'stateChanged' ──→ broadcast snapshot
  ├── VmixConnector ──────── 'ready'/'disconnected' ──→ update connStatus → broadcast
  ├── AtemConnector ──────── 'ready'/'disconnected' ──→ update connStatus → broadcast
  └── ConfigStore ─────────── read/write overrides, mapping, settings
```

**Data flow for a live tally change:**
vMix switches input → VmixConnector TCP push → TallyOrchestrator resolves → `'stateChanged'` → `server.ts` broadcast() → all WS clients receive snapshot → Svelte `$state` updates → TallyBadge re-renders instantly.

**Data flow for a manual override:**
Operator clicks `[PROG]` button → `OverrideControls` fires `PUT /overrides/cam1 { state: "program" }` → Fastify validates → ConfigStore.write(overrides) → broadcast() → all clients see updated `overrides` map in next snapshot → next `'stateChanged'` event resolves with override applied.

### Recommended Project Structure

```
src/
├── server.ts                  # Phase 4/5 entry point — Phase 6 adds plugin registrations
├── config/
│   └── schema.ts              # Extended with 'overrides' field (D-13)
├── vmix/                      # Phase 3/5 — unchanged by Phase 6
├── atem/                      # Phase 4/5 — unchanged by Phase 6
├── core/                      # Phase 1 — unchanged
└── frontend/
    ├── tsconfig.json          # Separate frontend TS config (moduleResolution: bundler)
    ├── index.html             # Vite SPA entry point
    ├── main.ts                # Svelte mount: createRoot(App, { target: document.body })
    ├── state.svelte.ts        # Shared $state store: BridgeState object
    ├── App.svelte             # Root: WS lifecycle, init fetches, layout shell
    ├── Header.svelte
    ├── DisconnectBanner.svelte
    ├── OverrideBanner.svelte
    ├── TallyGrid.svelte
    ├── CameraCard.svelte
    ├── TallyBadge.svelte
    ├── OverrideControls.svelte
    ├── TestControls.svelte
    ├── MappingEditor.svelte
    ├── MappingRow.svelte
    ├── ConnectionSettings.svelte
    ├── ConnectionBadge.svelte
    └── LatencyReadout.svelte

vite.config.ts                 # Root-level Vite config
dist/                          # Vite build output — served by @fastify/static
```

### Pattern 1: Svelte 5 Shared Reactive State Store

**What:** A `.svelte.ts` file exports a plain `$state` object. All components import and mutate it directly. This replaces Svelte 4 stores for cross-component state.

**When to use:** When multiple sibling components need to read/write the same state (the WS snapshot, connection status, overrides).

```typescript
// Source: svelte.dev/docs/svelte/$state + mainmatter.com/blog/2025/03/11/global-state-in-svelte-5/
// src/frontend/state.svelte.ts
import type { CameraTallyState } from '../core/events.js';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
export type TallyValue = 'program' | 'preview' | 'off';

export interface CameraSnapshot {
  cameraId: string;
  name: string;
  tally: TallyValue;
}

export interface BridgeState {
  cameras: CameraSnapshot[];
  connections: { vmix: ConnectionStatus; atem: ConnectionStatus };
  latencyMs: number | null;
  overrides: Record<string, 'program' | 'preview' | null>;
  wsConnected: boolean;
}

export const bridgeState = $state<BridgeState>({
  cameras: [],
  connections: { vmix: 'connecting', atem: 'connecting' },
  latencyMs: null,
  overrides: {},
  wsConnected: false,
});
```

**Critical rule:** Do NOT export a bare `let` from a `.svelte.ts` file — the variable is frozen at import time. Export an object (proxy) and mutate properties. [VERIFIED: svelte.dev/docs/svelte/$state]

### Pattern 2: WebSocket Lifecycle in App.svelte

**What:** `onMount` sets up the WS connection and returns a cleanup function. Updates write to the shared `bridgeState` object. Reconnect is handled via simple `setTimeout` in `onerror`/`onclose` handlers.

**When to use:** Root `App.svelte` only. Child components read state; they do not manage the WS connection.

```typescript
// Source: svelte.dev/docs/svelte/lifecycle-hooks
// src/frontend/App.svelte <script lang="ts">
import { onMount } from 'svelte';
import { bridgeState } from './state.svelte.js';

onMount(() => {
  function connect() {
    const ws = new WebSocket(`ws://${location.host}/ws`);

    ws.onopen = () => { bridgeState.wsConnected = true; };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'state') {
        bridgeState.cameras = msg.cameras;
        bridgeState.connections = msg.connections;
        bridgeState.latencyMs = msg.latencyMs;
        bridgeState.overrides = msg.overrides;
      }
    };

    ws.onclose = () => {
      bridgeState.wsConnected = false;
      setTimeout(connect, 2000); // reconnect after 2s
    };

    ws.onerror = () => { ws.close(); };

    return ws;
  }

  const ws = connect();
  return () => { ws.close(); }; // cleanup on unmount
});
```

### Pattern 3: @fastify/websocket Plugin Registration + Broadcast Helper

**What:** Register `@fastify/websocket` after `@fastify/static`. On WS route handler: push immediate snapshot on connect. Broadcast function iterates `fastify.websocketServer.clients`, checks `readyState === WebSocket.OPEN`.

**When to use:** `server.ts` expansion in Phase 6.

```typescript
// Source: github.com/fastify/fastify-websocket README + betterstack.com fastify guide
// src/server.ts additions

import websocketPlugin from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { WebSocket } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await fastify.register(staticPlugin, {
  root: path.join(__dirname, '..', 'dist'),
  prefix: '/',
});

await fastify.register(websocketPlugin);

// Broadcast helper — call after any state change
function broadcast(snapshot: StateSnapshot): void {
  const msg = JSON.stringify(snapshot);
  for (const client of fastify.websocketServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

// WS route: push snapshot immediately on connect
fastify.get('/ws', { websocket: true }, (socket, _req) => {
  socket.send(JSON.stringify(buildSnapshot()));
  // No incoming messages expected — this is a push-only channel
});
```

### Pattern 4: Connection Status Tracking in server.ts

**What:** `server.ts` maintains an in-memory `connectionStatus` object and updates it when `VmixConnector`/`AtemConnector` emit `'ready'` and `'disconnected'` events (from Phase 5). After update, broadcast the snapshot immediately (D-04 trigger 2).

**When to use:** Always — required for UI-02.

```typescript
// Source: CONTEXT.md D-04, Phase 5 CONTEXT.md D-02 (AtemConnector 'ready'/'disconnected')
const connStatus = {
  vmix: 'connecting' as ConnectionStatus,
  atem: 'connecting' as ConnectionStatus,
};

vmixConnector.on('ready', () => {
  connStatus.vmix = 'connected';
  broadcast(buildSnapshot());
});
vmixConnector.on('disconnected', () => {
  connStatus.vmix = 'disconnected';
  broadcast(buildSnapshot());
});

atemConnector.on('ready', () => {
  connStatus.atem = 'connected';
  broadcast(buildSnapshot());
});
atemConnector.on('disconnected', () => {
  connStatus.atem = 'disconnected';
  broadcast(buildSnapshot());
});
```

**Note on 'connecting' state:** Phase 5 connectors emit `'ready'` (connected) and `'disconnected'` but not an explicit `'connecting'` event. The `"connecting"` status in the WS snapshot should be the *initial* value before the first `'ready'` event, not a continuously updated state. After the first `'ready'` and a subsequent `'disconnected'`, the status is `"disconnected"` until the next `'ready'`. [ASSUMED — connector event API is from Phase 5 CONTEXT.md; exact event names should be confirmed during Phase 5 implementation]

### Pattern 5: Vite Config for Svelte 5 SPA

**What:** Root-level `vite.config.ts`. Build outputs to `dist/`. Dev proxy forwards `/api`, `/ws`, and static assets to Fastify on port 3000.

```typescript
// Source: vite.dev/config/server-options + github.com/sveltejs/vite-plugin-svelte README
// vite.config.ts (project root)
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'src/frontend',
  plugins: [svelte()],
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
```

**Note on `root`:** Setting `root: 'src/frontend'` means Vite looks for `src/frontend/index.html` as the entry point. `build.outDir` is relative to the Vite root, so `../../dist` resolves to the project root `dist/`.

### Pattern 6: Separate Frontend TypeScript Config

**What:** The existing `tsconfig.json` uses `"moduleResolution": "NodeNext"` for the Node.js server. Vite requires `"moduleResolution": "bundler"` and `"isolatedModules": true` for the frontend. These are incompatible in a single `tsconfig.json`. A separate `src/frontend/tsconfig.json` extends the root config and overrides the conflicting options.

```json
// src/frontend/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["./**/*.ts", "./**/*.svelte"]
}
```

**Root `tsconfig.json`:** Must add `exclude: ["src/frontend"]` to prevent the Node.js compiler from trying to process frontend files with NodeNext module resolution. [VERIFIED: svelte.dev/docs/svelte/typescript — isolatedModules required; search results confirm NodeNext/bundler conflict]

### Pattern 7: $derived for UI Computed State

**What:** Compute derived display values from the shared state object without side effects. Reactive — updates whenever dependencies change.

```typescript
// Source: svelte.dev/docs/svelte/$derived
// Example in a component <script lang="ts">
import { bridgeState } from './state.svelte.js';

let hasDisconnect = $derived(
  bridgeState.connections.vmix === 'disconnected' ||
  bridgeState.connections.atem === 'disconnected'
);

let activeOverrideCount = $derived(
  Object.values(bridgeState.overrides).filter(v => v !== null).length
);
```

### Pattern 8: Override PUT Call from OverrideControls

**What:** `OverrideControls` fires a `PUT /overrides/:cameraId` REST call. The component does not optimistically update state — it waits for the server's WS broadcast to reflect the change. This avoids state-of-source ambiguity.

```typescript
// Source: CONTEXT.md D-07, D-08
async function setOverride(cameraId: string, state: 'program' | 'preview' | null) {
  try {
    await fetch(`/overrides/${cameraId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    // No local state update — WS broadcast from server reflects change
  } catch {
    errorMsg = 'Override konnte nicht gesetzt werden.';
  }
}
```

### Anti-Patterns to Avoid

- **Exporting bare `let` from `.svelte.ts` files:** JavaScript module imports are bindings — a reassigned exported `let` is not reactive in importing components. Export an object and mutate properties. [VERIFIED: svelte.dev/docs/svelte/$state]
- **Optimistic UI updates for REST calls:** Since the server always pushes a WS snapshot after a successful PUT, optimistic updates create a dual-state problem. Let the WS broadcast drive UI state.
- **Using `$effect` for state derivation:** `$effect` is for side effects (network calls, DOM manipulation). Use `$derived` for computed values. Misusing `$effect` causes infinite loops. [VERIFIED: svelte.dev/docs/svelte/$effect]
- **Registering `@fastify/websocket` before `@fastify/static`:** Plugin registration order in Fastify matters. Register static first (serves `dist/`), then websocket (handles `/ws` route). If reversed, the WS upgrade may conflict with static file serving for the same port.
- **Using `NodeNext` tsconfig for frontend source:** Vite uses isolated module transpilation incompatible with `NodeNext`. Always use a separate `src/frontend/tsconfig.json` with `"moduleResolution": "bundler"`.
- **Animating tally state transitions:** The UI-SPEC explicitly prohibits animation on tally changes (instant state flip). Animated transitions make the state look "old" during transition in a live production — a safety concern.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebSocket broadcast to N clients | Custom event bus, manual Set tracking | `fastify.websocketServer.clients` (built into `@fastify/websocket` / `ws`) | The underlying `ws.Server` already maintains a `Set<WebSocket>` of all connected clients. Manual tracking duplicates this. |
| Schema validation for REST payloads | Custom type-checking in route handlers | Zod (already in project) | Phase 2 already established the `toConfigValidationError` pattern; reuse it for new endpoints. Consistent 400 error shape for the UI. |
| CSS framework for 14 components | Tailwind, Bootstrap, Pico | Scoped Svelte `<style>` blocks | UI-SPEC mandates scoped styles + no component library. 14 components is well within the complexity horizon for hand-rolled CSS. |
| SPA routing | React Router, client-side hash router | None — single-page, no routing | The UI is one page with collapsible `<details>` sections. Zero routing needed. |
| Frontend bundling for a Node module | Manual `tsc` to ESM | Vite + `@sveltejs/vite-plugin-svelte` | Svelte files cannot be compiled by plain `tsc`. Vite handles `.svelte` → ESM → optimized static bundle. |
| State management library | Svelte stores, Redux, Zustand | `.svelte.ts` + `$state` | Svelte 5 runes subsume the need for external stores for this scope. |

**Key insight:** The broadcast problem is the only non-obvious complexity. `fastify.websocketServer.clients` is a `Set<WebSocket>` — iterate it, check `readyState === WebSocket.OPEN`, call `client.send()`. That is the complete broadcast solution; no library or abstraction needed.

---

## Common Pitfalls

### Pitfall 1: NodeNext vs Bundler tsconfig Conflict

**What goes wrong:** Vite fails to compile `.svelte` files or TypeScript imports in the frontend fail with module resolution errors. Or `tsc --noEmit` passes but the runtime bundle is broken.

**Why it happens:** The existing `tsconfig.json` uses `"moduleResolution": "NodeNext"` for the Node.js server. Vite requires `"moduleResolution": "bundler"` (or `"esnext"`) for browser targets. Vite's `@sveltejs/vite-plugin-svelte` also requires `"isolatedModules": true`. These settings conflict in a single `tsconfig.json`.

**How to avoid:** Create `src/frontend/tsconfig.json` with `"moduleResolution": "bundler"` and `"isolatedModules": true`. Add `"exclude": ["src/frontend"]` to root `tsconfig.json`. Vite reads the closest `tsconfig.json` to the root; point it to `src/frontend/tsconfig.json` via `vite.config.ts` if needed.

**Warning signs:** TypeScript errors about module specifiers needing `.js` extensions in frontend files; Vite build warnings about TypeScript configuration; `Cannot find module` errors in `.svelte` files.

### Pitfall 2: WS Snapshot Sent Before Fastify Hydrates

**What goes wrong:** A new WS client connects and receives an empty or partial snapshot before the connectors have reported their status.

**Why it happens:** The `buildSnapshot()` function is called immediately on WS connect (D-04 trigger 3), but `connStatus.vmix/atem` may still be `"connecting"` and `orchestrator.currentState` may be `null` on first startup.

**How to avoid:** `buildSnapshot()` must handle `null` orchestrator state gracefully — return `cameras: []` when `currentState` is null. `connStatus` is initialized to `"connecting"` (not `undefined`), so the snapshot is always valid JSON. The UI shows skeleton cards when `cameras` is empty.

**Warning signs:** Browser console errors parsing JSON; `undefined` values in snapshot; client-side type errors on first render.

### Pitfall 3: Exporting Bare `let` from `.svelte.ts`

**What goes wrong:** State updates in one component don't propagate to other components that imported the shared state.

**Why it happens:** JavaScript module exports are bindings. When a component imports `let count` and the exporting module reassigns it (`count = 5`), the import reflects the change within the same module but NOT across module boundaries in all runtimes. More critically: Svelte's reactivity tracks property mutations on objects, not variable reassignment.

**How to avoid:** Always export a `$state` object: `export const bridgeState = $state({ ... })`. Mutate `bridgeState.cameras = newValue` — never reassign `bridgeState` itself.

**Warning signs:** State change in App.svelte doesn't update Header.svelte; `$derived` values in child components don't re-evaluate.

### Pitfall 4: Connection Status Has No "Connecting" Event from Connectors

**What goes wrong:** The UI shows `"connecting"` forever, or flips incorrectly between `"connecting"` and `"connected"`.

**Why it happens:** Phase 5 connectors emit `'ready'` (connected) and `'disconnected'` events but no `'connecting'` event. The `"connecting"` status is only valid as the initial value before the first `'ready'` arrives. After a `'disconnected'` event, the correct transition is: set to `"disconnected"` immediately, then to `"connecting"` when backoff loop starts (if signaled), then to `"connected"` on next `'ready'`.

**How to avoid:** On `'disconnected'` event, set status to `"disconnected"` and broadcast. If the connector emits a `'reconnecting'` or `'backoff'` event (check during Phase 5 implementation), use it to transition to `"connecting"`. If no such event exists, keep `"disconnected"` until `'ready'` fires. Do not guess intermediate states.

**Warning signs:** Disconnect banner never appears; connection badge stuck on `"Verbinde …"` after disconnect.

### Pitfall 5: `@fastify/websocket` Plugin Registration Order

**What goes wrong:** Static files are not served, or WebSocket connections fail with 404.

**Why it happens:** Fastify plugins are registered in order. `@fastify/static` sets up a wildcard route for `dist/`. If `@fastify/websocket` is registered after an API route at `/ws`, the wildcard static route may intercept the WS upgrade request.

**How to avoid:** Register order: (1) `@fastify/static`, (2) `@fastify/websocket`, (3) API routes. The `/ws` WebSocket route must be registered after `@fastify/websocket`. SPA fallback `setNotFoundHandler` must be registered last.

**Warning signs:** `GET /ws` returns a file from `dist/` instead of upgrading to WebSocket; static file 404 for the root index.html.

### Pitfall 6: SPA 404 Fallback and API Route Conflicts

**What goes wrong:** REST API calls return `index.html` instead of JSON; or navigating to a URL path returns 404 instead of the SPA.

**Why it happens:** `@fastify/static`'s `setNotFoundHandler` catch-all for SPA routing intercepts API requests to paths with no file match.

**How to avoid:** Register all API routes (`/api/*`, `/overrides/*`, `/config/*`, `/test/*`, `/vmix/*`, `/ws`) before the `setNotFoundHandler`. The fallback handler should only serve `index.html` for requests that don't match any registered route. Alternatively, namespace all API routes under a prefix like `/api/`.

**Warning signs:** Fetch calls returning HTML in the browser console; Chrome DevTools showing `Content-Type: text/html` for REST responses.

---

## Code Examples

### ConfigStore Schema Extension (D-13)

```typescript
// Source: CONTEXT.md D-05, D-13 + src/config/schema.ts (Phase 2)
// Addition to src/config/schema.ts top-level schema object:

export const schema = z.object({
  version: z.literal(1).optional(),
  settings: z.object({ vmix: connection, atem: connection }),
  mapping: z.array(mappingEntry).max(8),
  // Phase 6 addition — backward-compatible (optional field)
  overrides: z.record(z.string(), z.enum(['program', 'preview'])).optional(),
}).superRefine(/* ... existing uniqueness checks unchanged ... */);
```

### Override REST Route (Fastify 5 + Zod)

```typescript
// Source: CONTEXT.md D-07 + fastify.dev routing docs
const overrideBodySchema = z.object({
  state: z.enum(['program', 'preview']).nullable(),
});

fastify.put('/overrides/:cameraId', async (request, reply) => {
  const { cameraId } = request.params as { cameraId: string };
  const result = overrideBodySchema.safeParse(request.body);
  if (!result.success) {
    return reply.code(400).send({ error: 'Invalid override state' });
  }
  const { state } = result.data;

  const config = await configStore.read();
  const overrides = { ...(config.overrides ?? {}) };
  if (state === null) {
    delete overrides[cameraId];
  } else {
    overrides[cameraId] = state;
  }
  await configStore.write({ ...config, overrides });
  broadcast(buildSnapshot()); // D-07: trigger immediate WS push
  return reply.send({ overrides });
});
```

### Vite Proxy WebSocket (dev mode)

```typescript
// Source: vite.dev/config/server-options
// vite.config.ts — note: ws proxy requires target with ws:// scheme
server: {
  proxy: {
    '/overrides': 'http://localhost:3000',
    '/config': 'http://localhost:3000',
    '/test': 'http://localhost:3000',
    '/vmix': 'http://localhost:3000',
    '/ws': { target: 'ws://localhost:3000', ws: true },
  },
}
```

### TallyBadge Component Pattern

```svelte
<!-- Source: 06-UI-SPEC.md Color section + svelte.dev/docs/svelte/$props -->
<!-- src/frontend/TallyBadge.svelte -->
<script lang="ts">
  import type { TallyValue } from './state.svelte.js';
  let { tally }: { tally: TallyValue } = $props();
  const labels: Record<TallyValue, string> = {
    program: 'LIVE',
    preview: 'PREV',
    off: '—',
  };
</script>

<div class="badge" class:program={tally === 'program'}
     class:preview={tally === 'preview'} class:off={tally === 'off'}>
  {labels[tally]}
</div>

<style>
  .badge {
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-display);
    font-weight: 700;
    text-transform: uppercase;
  }
  .program { background: var(--tally-program); color: #fff; }
  .preview { background: var(--tally-preview); color: #fff; }
  .off     { background: var(--tally-off); color: #9ca3af; }
</style>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Svelte 4 stores (`writable`, `derived`) for cross-component state | Svelte 5 `.svelte.ts` files with `$state` objects | Svelte 5 (Oct 2024) | Simpler API, no subscription boilerplate; stores still work but are no longer idiomatic |
| `beforeUpdate`/`afterUpdate` lifecycle | `$effect` / `$effect.pre` | Svelte 5 | Deprecated in Svelte 5; use runes instead |
| `on:click` event syntax | `onclick={handler}` attribute syntax | Svelte 5 | Old `on:click` still works but new syntax is idiomatic in Svelte 5 |
| `@fastify/websocket` 10.x (ws ^7) | `@fastify/websocket` 11.x (ws ^8) | 2024 | API identical; ws version bump for Node 18+ compatibility |
| Vite 7.x | Vite 8.x | June 2026 | Requires Node `^20.19.0 || >=22.12.0`; satisfied by project requirement |

**Deprecated/outdated:**
- `@sveltejs/vite-plugin-svelte` v5/v4: Only v7.x supports Svelte 5 peer `^5.46.4`. Do not install older versions.
- `node-vmix` package: Phase 5 replaces it with raw `net.Socket`; may be removed from `package.json` in Phase 5.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 5 connectors emit `'ready'` and `'disconnected'` events (no `'connecting'` event) | Pitfall 4, Pattern 4 | If Phase 5 adds a `'connecting'` event, the connection status tracking can be enriched — low risk, only affects UI polish |
| A2 | `VmixConnector` exposes a `.roster()` method returning `Map<vmixKey, vmixNumber>` (from Phase 3 CONTEXT.md D-09 interpretation) | D-09 / `GET /vmix/roster` endpoint | If the method has a different signature, the `/vmix/roster` REST handler needs adjustment — data shape change, not architectural |
| A3 | `server.ts` from Phase 4 uses a Fastify instance exported or accessible for Phase 6 plugin registration | Pattern 3 | If Phase 4 doesn't export Fastify instance, Phase 6 needs to restructure bootstrap — medium risk, solvable |
| A4 | The Phase 5 `AtemConnector` emits `'disconnected'` on drop (confirmed in Phase 5 CONTEXT.md D-01/D-07); `VmixConnector` emits equivalent `'disconnected'` via raw socket `'close'` event | Pattern 4 | Confirmed via Phase 5 CONTEXT.md — low risk |

**If this table is empty:** Not applicable — 4 assumptions identified.

---

## Open Questions (RESOLVED)

1. **`VmixConnector` event name for disconnection**
   - What we know: Phase 5 CONTEXT.md says VmixConnector event interface is "preserved" (`'tally'`, `'rosterUpdated'`). AtemConnector explicitly emits `'disconnected'`.
   - What's unclear: Whether Phase 5 adds `'disconnected'` to `VmixConnector` as well, or whether `server.ts` must listen to the raw socket `'close'` event differently.
   - Recommendation: During Phase 6 implementation, check Phase 5's VmixConnector for its disconnect event name. If not `'disconnected'`, add it to Phase 5 scope or handle in server.ts via the available event.
   - RESOLVED: Phase 5 CONTEXT.md D-01/D-07 confirm both connectors emit `'ready'` and `'disconnected'`. Plan 02 Task 1 wires `vmixConnector.on('disconnected', ...)` and `atemConnector.on('disconnected', ...)` accordingly.

2. **`lastLatencyMs` in memory — where it lives**
   - What we know: CONTEXT.md §Specific Ideas says `server.ts` maintains `lastLatencyMs` updated on each `'stateChanged'` event from `TallyOrchestrator`. The `latencyMs` field is in pino logs (Phase 4 D-08).
   - What's unclear: Does `TallyOrchestrator` expose `lastLatencyMs`, or does `server.ts` compute it from `tallyReceivedAt` at broadcast time?
   - Recommendation: `server.ts` already receives `{ newState, tallyReceivedAt }` in the `'stateChanged'` payload. Compute `lastLatencyMs = Date.now() - tallyReceivedAt` at broadcast time, store in a local variable. Simple, no new orchestrator API needed.
   - RESOLVED: Plan 02 Task 1 behavior implements `lastLatencyMs = Date.now() - tallyReceivedAt` computed in the `'stateChanged'` handler in `server.ts`. No new orchestrator API needed.

3. **SPA `index.html` fallback and `@fastify/static` configuration**
   - What we know: `@fastify/static` serves `dist/`. For a SPA with no client-side routing, the only URL is `/`. No need for a catch-all 404 → index.html handler since the UI is single-page.
   - What's unclear: Whether any direct URL navigation to non-root paths is expected.
   - Recommendation: Since there is no client-side routing (UI-SPEC: "No sidebar, no tabs, no routing. One URL, one scroll"), the SPA fallback complexity does not apply. Serve `dist/` with `prefix: '/'` and let `@fastify/static` handle the default `index.html` behavior.
   - RESOLVED: Plan 02 Task 1 serves `dist/` with `prefix: '/'`. No SPA fallback needed — single URL, no client-side routing per UI-SPEC.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 | All runtime + Vite | ✓ | v22.23.0 | — |
| npm | Package installation | ✓ | 10.9.8 | — |
| TypeScript | Server + frontend typecheck | ✓ | 5.9.3 | — |
| Vite | Frontend build | ✓ (via project) | 7.3.6 (local) | Install 8.1.2 from npm |
| vitest | Test runner | ✓ | 3.2.6 | — |

**Note on Vite version:** The globally installed Vite is 7.3.6 but the project should pin `vite@8.1.2` in `devDependencies` (CLAUDE.md recommendation, Vite 8 requires Node `>=22.12.0` which is satisfied). The local `node_modules` install will be 8.1.2 after `npm install`.

**Missing dependencies with no fallback:** none — all required tools available.

**Missing dependencies with fallback:** none.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.2.6 |
| Config file | `vitest.config.ts` (exists — `include: ["src/**/*.test.ts"]`, `environment: "node"`) |
| Quick run command | `npm test` (vitest run) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UI-01 | `PUT /config/settings` validates and persists settings | unit (Fastify inject) | `npm test -- --grep "PUT /config/settings"` | ❌ Wave 0 |
| UI-02 | WS snapshot `connections` field reflects connector state | unit (mock connector events) | `npm test -- --grep "broadcast connection"` | ❌ Wave 0 |
| UI-03 | WS snapshot `cameras` array mirrors `TallyOrchestrator` state | unit (mock orchestrator) | `npm test -- --grep "broadcast snapshot"` | ❌ Wave 0 |
| UI-04 | `PUT /overrides/:cameraId` persists override; null clears it | unit (Fastify inject + ConfigStore) | `npm test -- --grep "PUT /overrides"` | ❌ Wave 0 |
| UI-05 | `latencyMs` in snapshot equals `Date.now() - tallyReceivedAt` at push time | unit | `npm test -- --grep "latencyMs"` | ❌ Wave 0 |
| ConfigStore schema | `overrides` field is optional, backward-compatible | unit (schema.test.ts extend) | `npm test -- src/config/schema.test.ts` | Extend existing |

**Note on frontend testing:** The Svelte component behavior (toggle interactions, DOM rendering) is manual-only for Phase 6. The `vitest.config.ts` uses `environment: "node"` — adding a browser/happy-dom environment for Svelte component tests would require config changes out of scope for this phase. REST and WS behavior is fully testable via Fastify `inject()`.

### Sampling Rate

- **Per task commit:** `npm test` (full vitest run, ~2–5s for 6 server-side test files)
- **Per wave merge:** `npm test` + `npx tsc --noEmit` (both tsconfigs)
- **Phase gate:** `npm test` green + `tsc --noEmit` green + manual browser smoke test before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/server.test.ts` — WS broadcast tests (REQ UI-02, UI-03)
- [ ] `src/routes/overrides.test.ts` — PUT /overrides/:cameraId (REQ UI-04)
- [ ] `src/routes/settings.test.ts` — PUT/GET /config/settings (REQ UI-01)
- [ ] Extend `src/config/schema.test.ts` — overrides field backward-compat (REQ UI-04)

*(No test infrastructure changes needed — existing vitest config covers `src/**/*.test.ts`)*

---

## Security Domain

> `security_enforcement` is enabled (absent from config = enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | LAN-only tool; "No authentication" is explicit in REQUIREMENTS.md §Out of Scope |
| V3 Session Management | No | No sessions; stateless REST + WS push |
| V4 Access Control | No | Single-user LAN tool; no roles |
| V5 Input Validation | Yes | Zod on all REST request bodies (`PUT /overrides`, `PUT /config/mapping`, `PUT /config/settings`, `POST /test`) |
| V6 Cryptography | No | No secrets stored; no encrypted fields |

### CSRF Analysis for LAN Same-Origin SPA

**Threat:** A malicious web page open in the same browser as the tally UI could issue `PUT /overrides/:cameraId` cross-site, forcing override state.

**Mitigation approach:** Since the frontend SPA and Fastify API are served from the **same origin** (same host:port), the `Sec-Fetch-Site: same-origin` header is the primary CSRF defense for state-changing REST endpoints. [CITED: cheatsheetseries.owasp.org/cheatsheets/CSRF_Prevention]

**Recommended implementation:** Add a Fastify `onRequest` hook for `PUT`, `POST`, `DELETE` methods that validates `Sec-Fetch-Site: same-origin` (or `none` for direct navigation), with `Origin` / `Referer` header fallback for clients that don't send `Sec-Fetch-Site`. A 403 is returned for requests that fail this check.

```typescript
// Lightweight CSRF gate — no token management needed for same-origin LAN SPA
fastify.addHook('onRequest', async (request, reply) => {
  if (['PUT', 'POST', 'DELETE'].includes(request.method)) {
    const secFetchSite = request.headers['sec-fetch-site'];
    if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
      return reply.code(403).send({ error: 'CSRF: cross-origin request rejected' });
    }
    // Fallback: check Origin header
    const origin = request.headers['origin'];
    if (origin && !origin.startsWith(`http://${request.hostname}`)) {
      return reply.code(403).send({ error: 'CSRF: invalid origin' });
    }
  }
});
```

**XSS Risk:** The tally state is display-only (camera names come from the persisted config, not from vMix in real time). Camera names and settings are operator-entered at config time, not from untrusted sources. No `innerHTML` should be used in Svelte components — Svelte's template system escapes by default. Low XSS surface area.

**No CSRF token management needed** for a same-origin LAN tool. The `Sec-Fetch-Site` approach is appropriate and simpler than CSRF tokens. [CITED: cheatsheetseries.owasp.org/cheatsheets/CSRF_Prevention]

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-origin PUT/POST to override tally | Tampering | `Sec-Fetch-Site` header validation (same-origin gate) |
| Malformed override body (out-of-range values) | Tampering | Zod validation on all request bodies |
| Duplicate ATEM source in mapping | Tampering | Existing `schema.ts` `superRefine` uniqueness checks |
| WS message injection (browser → server) | Tampering | WS handler ignores all incoming messages (push-only channel) |
| UI rendering untrusted camera names as HTML | XSS | Svelte template escaping (auto) — never use `{@html}` |

---

## Sources

### Primary (HIGH confidence)
- [svelte.dev/docs/svelte/$state](https://svelte.dev/docs/svelte/$state) — `$state` rune API, shared state patterns, object export requirement
- [svelte.dev/docs/svelte/$derived](https://svelte.dev/docs/svelte/$derived) — `$derived` and `$derived.by` patterns
- [svelte.dev/docs/svelte/$effect](https://svelte.dev/docs/svelte/$effect) — `$effect` for WS side effects and cleanup
- [svelte.dev/docs/svelte/$props](https://svelte.dev/docs/svelte/$props) — component prop declaration with TypeScript
- [svelte.dev/docs/svelte/lifecycle-hooks](https://svelte.dev/docs/svelte/lifecycle-hooks) — `onMount` + cleanup return pattern
- [svelte.dev/docs/svelte/stores](https://svelte.dev/docs/svelte/stores) — runes vs stores guidance
- [svelte.dev/docs/svelte/typescript](https://svelte.dev/docs/svelte/typescript) — TypeScript config requirements, `isolatedModules`
- [github.com/fastify/fastify-websocket README](https://github.com/fastify/fastify-websocket/blob/main/README.md) — plugin registration, WS handler types, `@types/ws` requirement
- [github.com/fastify/fastify-static README](https://github.com/fastify/fastify-static) — `root`, `prefix`, Fastify 5 compatibility
- [vite.dev/config/server-options](https://vite.dev/config/server-options) — `server.proxy`, `ws: true` option
- [cheatsheetseries.owasp.org CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) — `Sec-Fetch-Site` CSRF defense
- npm registry — verified versions for all packages (`npm view <pkg> version`)

### Secondary (MEDIUM confidence)
- [mainmatter.com/blog/2025/03/11/global-state-in-svelte-5/](https://mainmatter.com/blog/2025/03/11/global-state-in-svelte-5/) — object getter/setter and plain object patterns for global state
- [betterstack.com/community/guides/scaling-nodejs/fastify-websockets/](https://betterstack.com/community/guides/scaling-nodejs/fastify-websockets/) — broadcast via manual Set pattern; `readyState === OPEN` check
- [github.com/sveltejs/vite-plugin-svelte README](https://github.com/sveltejs/vite-plugin-svelte) — minimal `vite.config.ts` structure

### Tertiary (LOW confidence / inferred)
- Phase 5 CONTEXT.md `'ready'` / `'disconnected'` event names for connectors — these are from design context, not yet implemented code. Verify during Phase 6 Wave 1.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified on npm registry with official GitHub orgs; peer dependency compatibility confirmed
- Architecture: HIGH — locked decisions from CONTEXT.md constrain the design; patterns are well-established Svelte 5 + Fastify idioms
- Pitfalls: HIGH for TypeScript config split (confirmed by svelte.dev/docs and search results); MEDIUM for connector event names (Phase 5 not yet implemented)
- Security: HIGH — CSRF threat model is simple for a same-origin LAN SPA; Sec-Fetch-Site approach confirmed by OWASP

**Research date:** 2026-07-01
**Valid until:** 2026-08-01 (30 days — Svelte 5 and Vite 8 are in active development but API surface is stable)
