# Phase 6: Web UI — Status then Control - Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 22 new/modified files
**Analogs found:** 17 / 22 (5 files are new territory with no codebase analog)

---

## Codebase State at Pattern Mapping Time

Phases 1–2 are fully implemented (`src/core/`, `src/config/`). Phases 3–5 are
planned but not yet in source. This means:

- `src/vmix/VmixConnector.ts`, `src/vmix/tallyOrchestrator.ts`, `src/server.ts`,
  `src/atem/AtemConnector.ts`, `src/config/configStore.ts` do NOT yet exist.
- Where a Phase 3–5 file is the intended analog, the pattern is extracted from the
  **planned interface** documented in that phase's CONTEXT.md + the closest
  existing implemented file.
- Frontend (Svelte 5) files have no codebase analog at all — RESEARCH.md patterns
  apply in full.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/config/schema.ts` (modify) | config schema | — | itself | exact — backward-compatible extension |
| `src/server.ts` (expand) | server entrypoint | event-driven + request-response | `src/core/tallyState.ts` (EventEmitter wiring pattern) | partial — server bootstrap is new territory |
| `src/routes/overrides.ts` | route handler | request-response (CRUD) | `src/config/schema.ts` (Zod validation pattern) | role-match |
| `src/routes/config.ts` | route handler | request-response (CRUD) | `src/config/schema.ts` (Zod validation pattern) | role-match |
| `src/routes/test.ts` | route handler | request-response | `src/config/schema.ts` (Zod validation pattern) | role-match |
| `src/routes/vmix.ts` | route handler | request-response | — | no analog (roster pass-through is new) |
| `src/server.test.ts` | test (WS broadcast) | — | `src/core/tallyState.test.ts` | role-match (EventEmitter + mock injection) |
| `src/routes/overrides.test.ts` | test (REST route) | — | `src/config/schema.test.ts` | role-match (fixture-driven, safeParse pattern) |
| `src/routes/settings.test.ts` | test (REST route) | — | `src/config/schema.test.ts` | role-match |
| `vite.config.ts` | config | — | — | no analog (first Vite config in project) |
| `src/frontend/tsconfig.json` | config | — | `tsconfig.json` | role-match (extends root) |
| `src/frontend/main.ts` | frontend entrypoint | — | — | no analog |
| `src/frontend/state.svelte.ts` | frontend state store | event-driven | — | no analog (Svelte 5 runes pattern) |
| `src/frontend/App.svelte` | component (root) | event-driven (WS) | — | no analog |
| `src/frontend/Header.svelte` | component | request-response (read state) | — | no analog |
| `src/frontend/DisconnectBanner.svelte` | component | request-response (read state) | — | no analog |
| `src/frontend/OverrideBanner.svelte` | component | request-response (read state) | — | no analog |
| `src/frontend/TallyGrid.svelte` | component | request-response (read state) | — | no analog |
| `src/frontend/CameraCard.svelte` | component | request-response (read state) | — | no analog |
| `src/frontend/TallyBadge.svelte` | component | request-response (read state) | — | no analog |
| `src/frontend/OverrideControls.svelte` | component | request-response (PUT) | — | no analog |
| `src/frontend/TestControls.svelte` | component | request-response (POST) | — | no analog |
| `src/frontend/MappingEditor.svelte` | component | request-response (GET/PUT) | — | no analog |
| `src/frontend/MappingRow.svelte` | component | request-response (read state) | — | no analog |
| `src/frontend/ConnectionSettings.svelte` | component | request-response (GET/PUT) | — | no analog |
| `src/frontend/ConnectionBadge.svelte` | component | request-response (read state) | — | no analog |
| `src/frontend/LatencyReadout.svelte` | component | request-response (read state) | — | no analog |

---

## Pattern Assignments

### `src/config/schema.ts` (modify — add `overrides` field, D-13)

**Analog:** itself — `src/config/schema.ts` lines 68–100

**Existing schema extension pattern** (lines 68–78 — how the top-level object is structured):
```typescript
export const schema = z
  .object({
    version: z.literal(1).optional(),
    settings: z.object({ vmix: connection, atem: connection }),
    mapping: z.array(mappingEntry).max(8),
    // Phase 6 addition goes here — see below
  })
  .superRefine(/* ... existing uniqueness checks unchanged ... */);
```

**Add after `mapping` line (backward-compatible optional field):**
```typescript
/**
 * Per-camera sticky manual overrides (Phase 6 D-05).
 * Key: cameraId (string). Value: forced tally state.
 * Optional — absent in stored configs from Phases 1–5; treated as empty.
 */
overrides: z.record(z.string(), z.enum(['program', 'preview'])).optional(),
```

**Existing optional field pattern to copy** (lines 71, 42–45 — how optional fields are done):
```typescript
version: z.literal(1).optional(),
vmixNumber: z.number().int().positive().optional(),
vmixTitle: z.string().optional(),
```

**Type export pattern** (lines 107–115 — new type must follow this):
```typescript
export type PersistedConfig = z.infer<typeof schema>;
export type PersistedMappingEntry = z.infer<typeof mappingEntry>;
// Add:
export type PersistedOverrides = NonNullable<PersistedConfig['overrides']>;
```

**Test extension:** Extend `src/config/schema.test.ts` using the existing
`baseConfig` fixture at line 16. Add a `describe("overrides field", ...)` block
using the same `structuredClone(baseConfig)` pattern (lines 44–60).

---

### `src/server.ts` (expand — register plugins, broadcast, event wiring)

**Analog (EventEmitter wiring):** `src/core/tallyState.ts` lines 50–95

**Import pattern** (`src/core/tallyState.ts` lines 10–11):
```typescript
import { EventEmitter } from "node:events";
import type { DesiredAtemBusState } from "./events.js";
```
Server expansion adds plugin imports. Copy the `node:` prefix convention and
`.js` extension on all local imports:
```typescript
import websocketPlugin from '@fastify/websocket';
import staticPlugin from '@fastify/static';
import { WebSocket } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
```

**EventEmitter listener wiring pattern** (`src/core/tallyState.ts` lines 71–97):
```typescript
// Typed event emission — copy this on/emit pattern for connector event listeners:
this.emit("change", payload);
// In server.ts, listening to connector events:
vmixConnector.on('ready', () => {
  connStatus.vmix = 'connected';
  broadcast(buildSnapshot());
});
vmixConnector.on('disconnected', () => {
  connStatus.vmix = 'disconnected';
  broadcast(buildSnapshot());
});
```

**Plugin registration order (Fastify anti-pattern warning from RESEARCH.md):**
```typescript
// ALWAYS in this order (Pitfall 5 — wrong order causes 404 on /ws):
await fastify.register(staticPlugin, {
  root: path.join(__dirname, '..', 'dist'),
  prefix: '/',
});
await fastify.register(websocketPlugin);
// API routes after plugins:
fastify.put('/overrides/:cameraId', ...);
// WS route last:
fastify.get('/ws', { websocket: true }, (socket, _req) => { ... });
```

**Broadcast helper pattern** (RESEARCH.md Pattern 3):
```typescript
function broadcast(snapshot: StateSnapshot): void {
  const msg = JSON.stringify(snapshot);
  for (const client of fastify.websocketServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}
```

**buildSnapshot null-safety pattern** (RESEARCH.md Pitfall 2 — handle null
orchestrator state on startup):
```typescript
function buildSnapshot(): StateSnapshot {
  return {
    type: 'state',
    cameras: orchestrator?.currentState
      ? Object.entries(orchestrator.currentState.cameras).map(([cameraId, tally]) => ({
          cameraId,
          name: configStore.nameFor(cameraId) ?? cameraId,
          tally,
        }))
      : [],
    connections: { ...connStatus },
    latencyMs: lastLatencyMs,
    overrides: config.overrides ?? {},
  };
}
```

**CSRF hook pattern** (RESEARCH.md Security section):
```typescript
fastify.addHook('onRequest', async (request, reply) => {
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
```

---

### `src/routes/overrides.ts` (route handler, CRUD)

**Analog:** `src/config/schema.ts` lines 142–154 — `toConfigValidationError` and
Zod safeParse-then-respond pattern.

**Zod validation pattern** (`src/config/schema.ts` lines 142–154):
```typescript
export function toConfigValidationError(err: z.ZodError): ConfigValidationError {
  return {
    kind: "config-validation",
    issues: err.issues.map((issue) => ({
      path: issue.path as (string | number)[],
      message: issue.message,
      code: issue.code,
    })),
    tree: z.treeifyError(err),
  };
}
```
Apply same safeParse-check-respond idiom in the route handler:
```typescript
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
  broadcast(buildSnapshot()); // D-07: immediate WS push after override change
  return reply.send({ overrides });
});
```

**Error response shape** — copy the `kind:` discriminant pattern from
`src/config/schema.ts` lines 126–136:
```typescript
export interface ConfigValidationError {
  kind: "config-validation";
  issues: Array<{ path: (string | number)[]; message: string; code: string; }>;
  tree: ReturnType<typeof z.treeifyError>;
}
```

---

### `src/routes/config.ts` (route handler, CRUD — GET/PUT settings + mapping)

**Analog:** `src/config/schema.ts` lines 68–100 + lines 142–154

**Reuse existing schema validators directly** — do NOT duplicate. Import and call:
```typescript
import { schema, toConfigValidationError } from '../config/schema.js';
import type { PersistedConfig } from '../config/schema.js';
```

**PUT handler pattern** (same safeParse-check-write idiom as overrides above):
```typescript
fastify.put('/config/mapping', async (request, reply) => {
  const partial = { ...(await configStore.read()), mapping: request.body };
  const result = schema.safeParse(partial);
  if (!result.success) {
    return reply.code(400).send(toConfigValidationError(result.error));
  }
  await configStore.write(result.data);
  return reply.send({ mapping: result.data.mapping });
});
```

**GET handler pattern** (simple read-through, no validation needed):
```typescript
fastify.get('/config/settings', async (_request, reply) => {
  const config = await configStore.read();
  return reply.send({ settings: config.settings });
});
```

**ConfigStore write pattern** — copy from Phase 2 configStore (not yet implemented,
but the interface is: `read(): Promise<PersistedConfig>` and
`write(cfg: PersistedConfig): Promise<void>`).

---

### `src/routes/test.ts` (route handler, request-response)

**Analog:** `src/config/schema.ts` Zod validation pattern (lines 5–6, 142–154)

**Zod body schema for test endpoint** (D-12):
```typescript
const testBodySchema = z.object({
  action: z.enum(['program', 'preview', 'clear']),
});

fastify.post('/test/:cameraId', async (request, reply) => {
  const { cameraId } = request.params as { cameraId: string };
  const result = testBodySchema.safeParse(request.body);
  if (!result.success) {
    return reply.code(400).send({ error: 'Invalid test action' });
  }
  // Delegate to AtemConnector directly (Phase 4/5 interface)
  // No ConfigStore write — test commands are ephemeral
  return reply.send({ ok: true });
});
```

---

### `src/routes/vmix.ts` (route handler, roster pass-through)

**No close analog** — see "No Analog Found" section.

**Pattern from RESEARCH.md D-09:**
```typescript
fastify.get('/vmix/roster', async (_request, reply) => {
  const roster = vmixConnector.roster(); // Map<vmixKey, vmixNumber>
  if (roster.size === 0) {
    return reply.send({ inputs: [] });
  }
  const inputs = Array.from(roster.entries()).map(([key, number]) => ({
    key,
    number,
    title: vmixConnector.rosterTitle(key) ?? '',
  }));
  return reply.send({ inputs });
});
```

---

### `src/server.test.ts` (test — WS broadcast + connection status)

**Analog:** `src/core/tallyState.test.ts` — EventEmitter + mock injection pattern.

**Mock injection pattern** (`src/core/tallyState.test.ts` — vi.fn() mocks):
```typescript
import { describe, it, expect, vi } from "vitest";
// Inject mock connectors to control event emission:
const mockVmixConnector = { on: vi.fn(), emit: vi.fn() };
const mockOrchestrator = { on: vi.fn(), currentState: null };
```

**Fastify inject pattern** for REST testing (from RESEARCH.md Validation section):
```typescript
const response = await fastify.inject({
  method: 'PUT',
  url: '/overrides/cam1',
  body: { state: 'program' },
});
expect(response.statusCode).toBe(200);
```

**Test structure** — copy the `describe/it/expect` block pattern from
`src/config/schema.test.ts` lines 44–60:
```typescript
describe("broadcast snapshot", () => {
  it("pushes snapshot to all OPEN WS clients on stateChanged", () => {
    // ...
  });
  it("includes cameras: [] when orchestrator.currentState is null", () => {
    // ...
  });
});
```

---

### `src/routes/overrides.test.ts` and `src/routes/settings.test.ts` (tests — REST routes)

**Analog:** `src/config/schema.test.ts` — fixture-driven `describe/it/expect` blocks.

**Fixture pattern** (`src/config/schema.test.ts` lines 16–38):
```typescript
const baseConfig: PersistedConfig = {
  version: 1,
  settings: { vmix: null, atem: null },
  mapping: [],
};
// Per-test: structuredClone(baseConfig) + mutate
```

**safeParse assertion pattern** (`src/config/schema.test.ts` lines 45–59):
```typescript
it("empty mapping (0 entries) is valid", () => {
  const result = schema.safeParse(structuredClone(baseConfig));
  expect(result.success).toBe(true);
});
it("9th entry rejected with mapping-array error", () => {
  // ...
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths = result.error.issues.map((iss) => iss.path);
    expect(paths.some((p) => p[0] === "mapping")).toBe(true);
  }
});
```
Apply same: test `PUT /overrides/:cameraId` with valid/invalid bodies using
`fastify.inject()`. Assert `statusCode` and response body shape.

---

### `vite.config.ts` (project root — Vite build config)

**No codebase analog** — see "No Analog Found" section.

**Pattern from RESEARCH.md Pattern 5** (use verbatim):
```typescript
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
      '/overrides': 'http://localhost:3000',
      '/config': 'http://localhost:3000',
      '/test': 'http://localhost:3000',
      '/vmix': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
```

---

### `src/frontend/tsconfig.json` (frontend TypeScript config)

**Analog:** `tsconfig.json` (project root) — extend and override.

**Root tsconfig pattern** (`tsconfig.json` lines 1–15):
```json
{
  "compilerOptions": {
    "strict": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "verbatimModuleSyntax": true,
    "skipLibCheck": true
  }
}
```

**Frontend override** (RESEARCH.md Pattern 6 — must differ on these exact keys):
```json
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

**Root `tsconfig.json` must also add** (to prevent NodeNext from processing
frontend files — RESEARCH.md Pitfall 1):
```json
"exclude": ["src/frontend"]
```

---

### `src/frontend/state.svelte.ts` (shared reactive state store)

**No codebase analog** — Svelte 5 runes are new territory.

**Pattern from RESEARCH.md Pattern 1** (use verbatim — critical: export object, not bare let):
```typescript
import type { CameraTallyState } from '../core/events.js';

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting';
export type TallyValue = CameraTallyState; // reuse existing type

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

// CRITICAL: export an object (proxy), never a bare `let`
export const bridgeState = $state<BridgeState>({
  cameras: [],
  connections: { vmix: 'connecting', atem: 'connecting' },
  latencyMs: null,
  overrides: {},
  wsConnected: false,
});
```

**Type reuse:** `CameraTallyState` is defined in `src/core/events.ts` line 12 as
`"off" | "program" | "preview"` — import it directly rather than redefining.

---

### `src/frontend/App.svelte` (root component — WS lifecycle)

**No codebase analog** — Svelte 5 component is new territory.

**WS lifecycle pattern from RESEARCH.md Pattern 2:**
```typescript
// <script lang="ts">
import { onMount } from 'svelte';
import { bridgeState } from './state.svelte.js';

onMount(() => {
  function connect() {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => { bridgeState.wsConnected = true; };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string);
      if (msg.type === 'state') {
        bridgeState.cameras = msg.cameras;
        bridgeState.connections = msg.connections;
        bridgeState.latencyMs = msg.latencyMs;
        bridgeState.overrides = msg.overrides;
      }
    };
    ws.onclose = () => {
      bridgeState.wsConnected = false;
      setTimeout(connect, 2000);
    };
    ws.onerror = () => { ws.close(); };
    return ws;
  }
  const ws = connect();
  return () => { ws.close(); }; // cleanup on unmount
});
```

**Init fetch pattern** (load settings on mount — fires once, no polling):
```typescript
// In onMount, after WS connect():
const settingsRes = await fetch('/config/settings');
if (settingsRes.ok) {
  const { settings } = await settingsRes.json();
  // store in local component state for ConnectionSettings pre-population
}
```

---

### Svelte Component Pattern (all 14 `src/frontend/*.svelte` files)

All components share the same structural skeleton. Copy for every component:

**Props declaration pattern** (RESEARCH.md — `$props()` API, Svelte 5 idiomatic):
```svelte
<script lang="ts">
  import type { TallyValue } from './state.svelte.js';

  // Props — destructure from $props()
  let { tally, cameraId }: { tally: TallyValue; cameraId: string } = $props();
</script>
```

**Shared state read pattern** (for components that read bridgeState directly):
```svelte
<script lang="ts">
  import { bridgeState } from './state.svelte.js';
  // Read: bridgeState.cameras, bridgeState.connections, etc.
  // Never reassign bridgeState itself — mutate properties only
</script>
```

**Derived value pattern** (RESEARCH.md Pattern 7):
```svelte
<script lang="ts">
  import { bridgeState } from './state.svelte.js';

  let hasDisconnect = $derived(
    bridgeState.connections.vmix === 'disconnected' ||
    bridgeState.connections.atem === 'disconnected'
  );
  let activeOverrideCount = $derived(
    Object.values(bridgeState.overrides).filter(v => v !== null).length
  );
</script>
```

**Event handler (onclick) pattern** (Svelte 5 idiomatic — NOT `on:click`):
```svelte
<button onclick={() => handleClick()}>Label</button>
```

**Scoped style block pattern** (UI-SPEC mandate — every component gets its own):
```svelte
<style>
  .badge { /* scoped — no class collisions with sibling components */ }
  .program { background: var(--tally-program); color: #fff; }
  .preview { background: var(--tally-preview); color: #fff; }
  .off     { background: var(--tally-off); color: #9ca3af; }
</style>
```

**CSS variable contract** (all components consume these from global `:root`):
```css
/* Applied to all tally states: */
--tally-program: #dc2626
--tally-preview: #16a34a
--tally-off: #374151
--tally-override: #ea580c
/* Applied to layout: */
--color-surface: #111827
--color-surface-raised: #1f2937
--color-accent: #3b82f6
/* Typography: */
--text-body: 14px
--text-label: 12px
--text-heading: 18px
--text-display: 28px
/* Spacing: */
--sp-xs: 4px  --sp-sm: 8px  --sp-md: 16px  --sp-lg: 24px
--sp-xl: 32px  --sp-2xl: 48px  --sp-3xl: 64px
```

---

### `src/frontend/TallyBadge.svelte` (leaf component)

**Analog:** none in codebase — but RESEARCH.md Code Examples provides this exactly.

**Complete component pattern** (RESEARCH.md Code Examples — TallyBadge):
```svelte
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
    min-height: 48px;          /* UI-SPEC touch/readability target */
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

**No animation** — UI-SPEC explicitly prohibits transitions on tally state changes.
Never add `transition:` or `animate:` directives to tally state elements.

---

### `src/frontend/OverrideControls.svelte` (component — PUT /overrides)

**REST call pattern** (RESEARCH.md Pattern 8 — no optimistic update):
```typescript
async function setOverride(cameraId: string, state: 'program' | 'preview' | null) {
  try {
    await fetch(`/overrides/${cameraId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    // No local state update — WS broadcast from server drives the change
  } catch {
    errorMsg = 'Override konnte nicht gesetzt werden.';
  }
}
```

**Toggle button active-state pattern** (UI-SPEC D-08 — clicking active button clears):
```svelte
<script lang="ts">
  let { cameraId, currentOverride }:
    { cameraId: string; currentOverride: 'program' | 'preview' | null } = $props();

  async function handleToggle(target: 'program' | 'preview' | null) {
    // Clicking the active button sends null (clear); others send the value
    const next = currentOverride === target ? null : target;
    await setOverride(cameraId, next);
  }
</script>

<div class="controls">
  <button
    class:active={currentOverride === null}
    onclick={() => handleToggle(null)}>Aus</button>
  <button
    class:active={currentOverride === 'program'}
    onclick={() => handleToggle('program')}>PROG</button>
  <button
    class:active={currentOverride === 'preview'}
    onclick={() => handleToggle('preview')}>PREV</button>
</div>
```

---

### `src/frontend/MappingEditor.svelte` (component — GET/PUT /config/mapping)

**Collapsible `<details>` pattern** (UI-SPEC — native HTML, zero JS):
```svelte
<details ontoggle={(e) => { if ((e.target as HTMLDetailsElement).open) fetchRoster(); }}>
  <summary>Mapping · {mappingRows.length} Eingänge konfiguriert</summary>
  <!-- table of MappingRow components -->
</details>
```

**One-shot roster fetch on open** (D-09 — fetch only when editor opens):
```typescript
async function fetchRoster() {
  const res = await fetch('/vmix/roster');
  if (res.ok) {
    const { inputs } = await res.json();
    roster = inputs; // populated → show <select>; empty → show text input (D-10)
  }
}
```

**Save pattern** (PUT with full array — no partial updates):
```typescript
async function save() {
  const res = await fetch('/config/mapping', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mappingRows),
  });
  if (!res.ok) {
    errorMsg = 'Mapping konnte nicht gespeichert werden. Ungültige Eingaben.';
  }
}
```

---

### `src/frontend/ConnectionSettings.svelte` (component — GET/PUT /config/settings)

**Pre-populate on page load** (App.svelte fetches settings once; passes as prop):
```svelte
<script lang="ts">
  let { initialSettings } = $props();
  let vmixHost = $state(initialSettings?.vmix?.host ?? '');
  let vmixPort = $state(initialSettings?.vmix?.port ?? 8099);
  let atemHost = $state(initialSettings?.atem?.host ?? '');
</script>
```

**Save + close panel pattern**:
```typescript
async function save() {
  const res = await fetch('/config/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vmix: { host: vmixHost, port: vmixPort }, atem: { host: atemHost, port: 9910 } }),
  });
  if (res.ok) {
    // Close the <details> panel on success (UI-SPEC)
    (document.querySelector('#settings-panel') as HTMLDetailsElement).open = false;
  } else {
    errorMsg = 'Einstellungen konnten nicht gespeichert werden. Bitte Eingaben prüfen.';
  }
}
```

---

### `src/frontend/LatencyReadout.svelte` (component — latency threshold coloring)

**$derived threshold pattern** (RESEARCH.md Pattern 7):
```svelte
<script lang="ts">
  import { bridgeState } from './state.svelte.js';

  let color = $derived(
    bridgeState.latencyMs === null ? '#9ca3af'
    : bridgeState.latencyMs < 50  ? '#ffffff'
    : bridgeState.latencyMs < 100 ? '#ca8a04'
    : '#dc2626'
  );

  let label = $derived(
    bridgeState.latencyMs === null
      ? '— ms'
      : bridgeState.latencyMs > 100
        ? `${bridgeState.latencyMs} ms ⚠`
        : `${bridgeState.latencyMs} ms`
  );
</script>

<span style="color: {color}">{label}</span>
```

---

## Shared Patterns

### Zod safeParse-then-respond (all route handlers)

**Source:** `src/config/schema.ts` lines 142–154 (`toConfigValidationError`)
**Apply to:** `src/routes/overrides.ts`, `src/routes/config.ts`, `src/routes/test.ts`

```typescript
// Always: safeParse → check success → 400 on failure → proceed on success
const result = bodySchema.safeParse(request.body);
if (!result.success) {
  return reply.code(400).send({ error: 'Invalid input' });
}
// Use result.data (typed) from here
```

### NodeNext `.js` import extension (all server-side TypeScript)

**Source:** `src/core/resolver.ts` line 13, `src/core/tallyState.ts` line 11
**Apply to:** All `src/**/*.ts` files (NOT `src/frontend/**`)

```typescript
// All local imports MUST have .js extension (NodeNext moduleResolution)
import { schema } from '../config/schema.js';
import type { ResolverOutput } from '../core/events.js';
```

### `node:` prefix for Node built-ins (all server-side TypeScript)

**Source:** `src/core/tallyState.ts` line 10
**Apply to:** All server-side files that import Node built-ins

```typescript
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";
```

### ESM-only module style (project-wide)

**Source:** `package.json` line 8: `"type": "module"`
**Apply to:** All `.ts` files — no `require()`, no `module.exports`

### Type-only imports with `import type`

**Source:** `src/core/resolver.ts` lines 6–13, `src/core/tallyState.ts` line 11
**Apply to:** All files that import only types (not values)

```typescript
import type { DesiredAtemBusState } from "./events.js";
// Not: import { DesiredAtemBusState } from "./events.js"
```

### Defensive total-function stance (all pure functions)

**Source:** `src/core/resolver.ts` lines 62–118 (`coerceTally`, `coerceMapping`,
`coerceOverrides`) + `src/config/schema.ts` lines 79–100 (`superRefine`)
**Apply to:** Any new pure utility functions

```typescript
// Never throw on bad input — coerce to safe default:
if (!Array.isArray(raw)) return [];
const state = typeof raw === "number" && isFinite(raw) ? raw : 0;
```

### `$state` object mutation (all Svelte frontend files)

**Source:** RESEARCH.md Pattern 1 + Pitfall 3
**Apply to:** All `src/frontend/*.svelte` and `src/frontend/state.svelte.ts`

```typescript
// CORRECT: mutate property on the exported $state object
bridgeState.cameras = msg.cameras;

// WRONG: reassign the exported binding (not reactive across module boundaries)
// bridgeState = { ...bridgeState, cameras: msg.cameras }; // NEVER DO THIS
```

### No `@html` in Svelte templates (XSS prevention)

**Source:** RESEARCH.md Security section
**Apply to:** All `src/frontend/*.svelte` files

Svelte's template system escapes by default. Camera names and titles from config
are operator-entered, not untrusted, but never use `{@html ...}` regardless.

---

## No Analog Found

Files with no close match in the codebase — use RESEARCH.md patterns exclusively:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/routes/vmix.ts` | route handler | request-response | Roster pass-through from VmixConnector is a new pattern; no existing route handlers in codebase |
| `vite.config.ts` | build config | — | First Vite config in project; no frontend build tooling existed before Phase 6 |
| `src/frontend/main.ts` | SPA entrypoint | — | First frontend file; Svelte mount pattern (`mount(App, { target: document.body })`) from Svelte 5 docs only |
| `src/frontend/state.svelte.ts` | reactive store | event-driven | Svelte 5 runes (`$state`) are new to codebase; no prior `.svelte.ts` files |
| All `src/frontend/*.svelte` | components | various | No Svelte components exist anywhere in codebase |

---

## Key Anti-Patterns to Enforce

These are project-specific pitfalls extracted from RESEARCH.md that the planner
must call out in each plan's acceptance criteria:

| Anti-Pattern | Where It Bites | How to Prevent |
|--------------|----------------|----------------|
| Export bare `let` from `.svelte.ts` | `state.svelte.ts` | Export `$state` object; mutate properties |
| `NodeNext` tsconfig for frontend | `src/frontend/tsconfig.json` | Separate tsconfig with `"moduleResolution": "bundler"` |
| Register `@fastify/websocket` before `@fastify/static` | `server.ts` | Static first, then websocket, then routes, then WS route |
| Optimistic UI updates on REST calls | `OverrideControls.svelte`, `MappingEditor.svelte` | Let WS broadcast drive state; no local optimistic mutations |
| `on:click` event syntax (Svelte 4) | all `.svelte` files | Use `onclick={handler}` (Svelte 5 idiomatic) |
| Missing `.js` extension on local imports | all `src/**/*.ts` server files | NodeNext requires explicit `.js` extension on all local imports |
| `animate:` / `transition:` on tally elements | `TallyBadge.svelte`, `CameraCard.svelte` | UI-SPEC prohibition — instant state flip only, no CSS transitions |

---

## Metadata

**Analog search scope:** `src/core/`, `src/config/`, project root config files
**Files scanned:** 8 TypeScript source files + 3 config files
**Pattern extraction date:** 2026-07-01
**Note:** Phases 3–5 source files planned but not yet implemented. Route handler
patterns are derived from the Phase 2 Zod/schema patterns (the only existing
validation/response logic in the codebase). Svelte patterns are sourced entirely
from RESEARCH.md (verified against svelte.dev/docs).
