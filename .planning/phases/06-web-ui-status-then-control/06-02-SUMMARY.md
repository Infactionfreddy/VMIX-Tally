---
phase: 06-web-ui-status-then-control
plan: "02"
subsystem: server-backend
tags: [fastify, websocket, rest-routes, csrf, broadcast, connection-tracking, wave2]
dependency_graph:
  requires:
    - tsconfig-split-nodext-vs-bundler
    - schema-overrides-field
    - wave0-test-stubs
  provides:
    - fastify-ws-broadcast
    - fastify-csrf-hook
    - rest-overrides-route
    - rest-config-routes
    - rest-test-route
    - rest-vmix-roster-route
    - connector-ready-disconnected-events
    - configstore-read-write-interface
  affects:
    - src/server.ts
    - src/atem/AtemConnector.ts
    - src/vmix/VmixConnector.ts
    - src/config/configStore.ts
    - src/routes/overrides.ts
    - src/routes/config.ts
    - src/routes/test.ts
    - src/routes/vmix.ts
tech_stack:
  added:
    - "@fastify/static (registered in buildApp)"
    - "@fastify/websocket (registered in buildApp)"
  patterns:
    - fastify-plugin-async-pattern
    - zod-safeParse-then-respond
    - configStore-read-mutate-write
    - broadcast-websocketServer-clients
    - csrf-sec-fetch-site-header-check
key_files:
  created:
    - src/routes/overrides.ts
    - src/routes/config.ts
    - src/routes/test.ts
    - src/routes/vmix.ts
  modified:
    - src/server.ts (buildApp expanded, plugins, CSRF, broadcast, WS route)
    - src/atem/AtemConnector.ts (emit disconnected in handleDisconnected)
    - src/vmix/VmixConnector.ts (emit ready on connect, emit disconnected on close)
    - src/config/configStore.ts (add read()/write() async methods)
    - src/routes/overrides.test.ts (replace it.todo with real assertions)
    - src/routes/settings.test.ts (replace it.todo with real assertions)
    - src/server.test.ts (replace it.todo, expand buildApp mock args)
decisions:
  - "buildApp expanded to 6-arg signature: (atemConnector, orchestrator, vmixConnector, configStore, mapping, logger) — all Phase 6 dependencies injected for testability"
  - "VmixConnector ready/disconnected events added in sock connect/close handlers — enables connection status tracking in server.ts"
  - "AtemConnector disconnected event added in handleDisconnected() BEFORE scheduleReconnect() — enables UI-02"
  - "ConfigStore.read()/write() added — bypasses save() validation gate, callers (route handlers) validate before write"
  - "lastLatencyMs stays null: stateChanged emits ResolverOutput directly (CRITICAL DEVIATION from plan), tallyReceivedAt not available; real latency in pino logs"
  - "@fastify/static registered BEFORE @fastify/websocket (Pitfall 5 prevention)"
metrics:
  duration: ~30m execution
  completed: 2026-07-01
  tasks_completed: 2
  files_created: 4
  files_modified: 7
---

# Phase 6 Plan 02: Fastify Server Expansion + REST Routes + Connection Tracking Summary

**One-liner:** Expanded buildApp() to 6-arg injection pattern, registered @fastify/static/@fastify/websocket in correct order, added CSRF hook, broadcast helper, WS /ws route, all REST endpoints (overrides/config/test/vmix), added 'ready'/'disconnected' events to both connectors.

## What Was Implemented

### Task 1: Fastify server expansion — plugins, CSRF, broadcast, WS route

**src/server.ts — expanded buildApp() signature:**
buildApp now accepts: `(atemConnector, orchestrator, vmixConnector, configStore, mapping, logger)`. The new 3 args (orchestrator, vmixConnector, configStore) carry all Phase 6 dependencies. All 195 tests pass — including the 3 existing Phase 4 walk-test tests.

**Plugin registration order (Pitfall 5 enforced):**
1. `@fastify/static` (line 170) — serves `dist/` SPA
2. `@fastify/websocket` (line 179) — enables WS route handler
3. CSRF onRequest hook (line 184)
4. REST route plugins (lines 203-206)
5. GET /ws WebSocket route (line 237)

**CSRF hook (T-06-02-D):**
Rejects PUT/POST/DELETE when `sec-fetch-site` header is `cross-site` or `same-site`. Falls back to `Origin` header check. Returns 403 with structured error body.

**broadcast() helper:**
Iterates `fastify.websocketServer.clients` (Set<WebSocket>), checks `readyState === WebSocket.OPEN` before `client.send()`. Guard: skips if websocketServer not yet available (test startup timing).

**buildSnapshot() — null-safe (Pitfall 2):**
Returns `cameras: []` when `orchestrator.currentDesiredState()` returns null (cold start). Always returns valid JSON with `connections`, `latencyMs`, `overrides` fields.

**Connection status tracking:**
`connStatus` object initialized to `{vmix: 'connecting', atem: 'connecting'}`. Wired to connector events: vmixConnector 'ready' → connected, 'disconnected' → disconnected; atemConnector 'ready' → connected, 'disconnected' → disconnected. Each status change calls broadcast().

**TallyOrchestrator stateChanged wiring:**
Calls broadcast() on each stateChanged event. Sets `lastLatencyMs = null` (see Known Stubs).

**WS /ws route:**
Sends immediate snapshot via `socket.send(JSON.stringify(buildSnapshot()))` on every new WebSocket connection (D-04 trigger 3).

**src/vmix/VmixConnector.ts:**
Added `this.emit("ready")` in `sock.on("connect")` handler (after successful TCP connect). Added `this.emit("disconnected")` in `sock.on("close")` handler BEFORE `scheduleReconnect()`.

**src/atem/AtemConnector.ts:**
Added `this.emit("disconnected")` in `handleDisconnected()` BEFORE `scheduleReconnect()`.

**src/config/configStore.ts:**
Added `read(): Promise<PersistedConfig>` — returns a structuredClone of current db.data. Added `write(cfg: PersistedConfig): Promise<void>` — directly writes without validation (route handlers validate before calling). `save()` method unchanged (still validates via schema.safeParse).

### Task 2: REST route handlers + fill Wave 0 test stubs

**src/routes/overrides.ts:**
Fastify plugin (`registerOverridesRoute`) that registers PUT `/overrides/:cameraId`. Zod body: `{state: z.enum(['program','preview']).nullable()}`. Returns 400 on invalid state. Reads config, mutates overrides map (delete key for null, set value otherwise), writes config, calls broadcast(), returns `{overrides: updatedMap}`.

**src/routes/config.ts:**
Fastify plugin (`registerConfigRoute`) with 4 routes:
- GET `/config/settings` → `{settings: config.settings}`
- PUT `/config/settings` → merge into full config, safeParse, 400+ConfigValidationError on failure, 200+`{settings}` on success
- GET `/config/mapping` → `{mapping: config.mapping}`
- PUT `/config/mapping` → replace mapping, safeParse (catches max-8 rule), 400+ConfigValidationError on failure

**src/routes/test.ts:**
Fastify plugin (`registerTestRoute`) — POST `/test/:cameraId`. Zod body: `{action: z.enum(['program','preview','clear'])}`. Returns 400 on invalid action, 200 `{ok: true}` on valid.

**src/routes/vmix.ts:**
Fastify plugin (`registerVmixRoute`) — GET `/vmix/roster`. Calls `vmixConnector.roster()` (in-memory Map, non-blocking). Returns `{inputs: []}` when roster empty (vMix offline), otherwise maps entries to `{key, number}` (no title field — rosterTitle does not exist per CRITICAL DEVIATION).

**Test stubs filled:**
- `src/routes/overrides.test.ts`: 5 real Fastify.inject() assertions (program, preview, null-clear, 400-invalid, broadcast-called-once)
- `src/routes/settings.test.ts`: 6 real assertions (GET settings, PUT settings valid/invalid, GET mapping, PUT mapping valid/9-entries)
- `src/server.test.ts`: 13 stubs replaced (walk-test tests updated to new 6-arg signature, broadcast/connStatus/CSRF assertions)

## Final Test Count

```
vitest run v4.1.9

Test Files  12 passed (12)
     Tests  195 passed (195)
  Duration  ~400ms
```

- 174 original tests: all green (zero regressions)
- 21 Wave 0 stubs from Plan 01: all replaced with real passing assertions
- 0 failures

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] ConfigStore.read()/write() methods added**
- Found during: Task 2 route implementation
- Issue: Route handlers in PLAN.md require `configStore.read()` and `configStore.write()` interface, but ConfigStore only had `save()` (validated write) and synchronous getters.
- Fix: Added `read()` (structuredClone of db.data) and `write()` (direct write, callers validate). Preserved existing `save()` for validated-write use cases.
- Files modified: src/config/configStore.ts
- Commit: df6a4ed

**2. [Rule 1 - Bug] lastLatencyMs corrected from 0 to null (CRITICAL DEVIATION)**
- Found during: Task 1 implementation
- Issue: Plan's `<interfaces>` block said `stateChanged` emits `{newState, tallyReceivedAt}` but actual implementation emits `ResolverOutput` directly. `tallyReceivedAt` is not available in the listener. Setting `lastLatencyMs = 0` would indicate 0ms latency (incorrect).
- Fix: Set `lastLatencyMs = null` and documented the deviation. Real latency is in pino logs (Phase 4 D-08 `atem_command_sent.latencyMs`).
- Files modified: src/server.ts
- Commit: 17b39ec

**3. [Rule 2 - Missing Critical] VmixConnector 'ready'/'disconnected' events added**
- Found during: Task 1 interface verification
- Issue: Plan says "CORRECTED: emit('ready') after TCP sock.on('connect') fires". These events did not exist in VmixConnector.
- Fix: Added both events as documented in CRITICAL INTERFACE DEVIATIONS section.
- Files modified: src/vmix/VmixConnector.ts
- Commit: df6a4ed

**4. [Rule 2 - Missing Critical] AtemConnector 'disconnected' event added**
- Found during: Task 1 interface verification
- Issue: Plan says "CORRECTED: emit('disconnected') at the TOP of handleDisconnected() BEFORE scheduleReconnect()". This event did not exist.
- Fix: Added emit('disconnected') before scheduleReconnect() in handleDisconnected().
- Files modified: src/atem/AtemConnector.ts
- Commit: df6a4ed

## Known Stubs

| File | Content | Reason |
|------|---------|--------|
| src/server.ts | `lastLatencyMs = null` in stateChanged handler | tallyReceivedAt not in stateChanged payload (CRITICAL DEVIATION). Real latency available in pino logs. Future phase can expose via TallyOrchestrator. |
| src/routes/vmix.ts | Returns `{key, number}` only, no title field | `rosterTitle()` does not exist on VmixConnector (CRITICAL DEVIATION from plan). The in-memory roster Map only stores `vmixKey → vmixNumber`. |

## Verification Commands

| Command | Result |
|---------|--------|
| npm test | PASS — 195 passed, 0 failures |
| npx tsc --noEmit | PASS |
| grep -c "sec-fetch-site" src/server.ts | 1 |
| grep -c "websocketServer" src/server.ts | 5 |
| grep -c "overrides" src/routes/overrides.ts | 9 |
| grep -n "staticPlugin" src/server.ts (line) | 170 (before websocketPlugin at 179) |

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED | 128f463 | Present — server.test.ts/overrides.test.ts/settings.test.ts all fail (13+ failing) |
| GREEN | df6a4ed | Present — 195 tests passing |
| REFACTOR | 17b39ec | Fix commit (lastLatencyMs null) |

## Commits

| Hash | Type | Message |
|------|------|---------|
| 128f463 | test | test(06-02): fill Wave 0 test stubs with failing assertions RED |
| df6a4ed | feat | feat(06-02): Fastify server expansion + REST routes + connection tracking |
| 17b39ec | fix | fix(06-02): set lastLatencyMs = null when tallyReceivedAt unavailable |

## Self-Check

Files exist:
- src/routes/overrides.ts — FOUND
- src/routes/config.ts — FOUND
- src/routes/test.ts — FOUND
- src/routes/vmix.ts — FOUND
- src/server.ts has 'sec-fetch-site' — FOUND
- src/server.ts has 'websocketServer' — FOUND

Commits exist:
- 128f463 RED commit — FOUND
- df6a4ed GREEN commit — FOUND
- 17b39ec fix commit — FOUND

## Self-Check: PASSED
