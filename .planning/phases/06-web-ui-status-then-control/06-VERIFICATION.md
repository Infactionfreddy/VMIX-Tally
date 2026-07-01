---
phase: 06-web-ui-status-then-control
verified: 2026-07-01T21:20:00+02:00
fixes_applied: 2026-07-01T21:23:00+02:00
fix_commit: 37674ec
status: verified_with_caveats
score: 11/12 must-haves verified (2 BLOCKERs fixed post-verification)
overrides_applied: 3
re_verification: true
fixed_gaps:
  - truth: "User can manually force tally for a single camera — sticky, visually distinct, one-click releasable — routed through the Core so a live vMix change cannot silently stomp it"
    status: fixed
    fix: "Added ConfigStore.getOverrides() synchronous getter; added getOverrides() to ConfigStoreInterface; buildSnapshot() now reads configStore.getOverrides() — commit 37674ec"
  - truth: "Browser shows a grid of camera cards with LIVE/PREV/— badges reflecting tally state; camera names shown on cards"
    status: fixed
    fix: "buildSnapshot() now builds nameMap from configStore.getMapping() and includes name: nameMap.get(cameraId) ?? cameraId in each camera object; StateSnapshot interface updated to cameras: Array<{cameraId,name,tally}> — commit 37674ec"
  - truth: "ConnectionSettings pre-populate from async initialSettings prop"
    status: fixed
    fix: "Added $effect to ConnectionSettings.svelte that re-syncs vmixHost/vmixPort/atemHost when initialSettings prop resolves after async fetch — commit 37674ec"
  - truth: "User sees a latency/freshness indicator for the tally pipeline"
    status: partial
    reason: "LatencyReadout.svelte exists and correctly renders '— ms' with $derived color/label thresholds. However lastLatencyMs is permanently null in server.ts because the stateChanged event emits ResolverOutput directly (not {newState, tallyReceivedAt}) — documented as a Critical Deviation in 06-02-SUMMARY.md. The component exists and the null path works correctly, but the indicator can never show a real latency value. ROADMAP success criterion 3 says 'User sees a latency/freshness indicator' — the indicator renders but always shows '— ms', which is a degraded but present implementation. Classified as partial rather than failed because: the component is wired, visually present, and the deviation is explicitly documented with a path to fix."
    artifacts:
      - path: "src/server.ts"
        issue: "lastLatencyMs = null always (line 283) — tallyReceivedAt not available from stateChanged payload"
    missing:
      - "TallyOrchestrator needs to expose tallyReceivedAt in the stateChanged payload (or via a separate getter) so server.ts can compute Date.now() - tallyReceivedAt and populate lastLatencyMs"
human_verification:
  - test: "ConnectionSettings form pre-populate from /config/settings"
    expected: "Expanding 'Verbindung · ...' shows host/port fields pre-filled with saved values"
    why_human: "ConnectionSettings.svelte initializes vmixHost/vmixPort/atemHost from $state(initialSettings?.vmix?.host ?? '') at component creation time. App.svelte passes initialSettings as a $state prop that is undefined on mount and resolves after an async fetch. In Svelte 5 runes, local $state vars seeded from a prop are NOT reactive to later prop updates — the field will be empty even if initialSettings later resolves. This requires browser execution to confirm actual Svelte 5 runtime behavior."
  - test: "Human UI checkpoint for Plans 03 and 04 was bypassed"
    expected: "Full end-to-end UI visible in browser — header badges, tally grid, override controls, test controls, mapping editor, connection settings — all rendered correctly with German copy strings"
    why_human: "Both human checkpoint tasks (06-03 Task 3 and 06-04 Task 3) were skipped per executor instructions ('running all waves in one go'). No human has confirmed the UI renders in a real browser."
---

# Phase 6: Web UI — Status then Control — Verification Report

**Phase Goal:** The operator gets a live trust surface — who is red/green, link health, latency — then control: configure connections, edit mapping (showing the 3-way chain), and force/release per-camera override through the Core.
**Verified:** 2026-07-01T21:20:00+02:00
**Status:** GAPS FOUND
**Re-verification:** No — initial verification

## Summary

The Phase 6 implementation is structurally complete: all 4 plan waves executed, 195/195 tests pass, `vite build` produces a 55KB+ bundle, and both `tsc --noEmit` checks pass clean. The Svelte 5 frontend architecture (shared $state store, WS lifecycle, 12 components) and the Fastify backend layer (CSRF, broadcast, 4 route plugins, connector event wiring) are all present and wired.

However, two code-level blockers prevent the primary user-facing goals from working at runtime:

1. `buildSnapshot()` hardcodes `overrides: {}` — every WS broadcast erases override state in the frontend, making UI-04 (sticky manual override) non-functional in practice.
2. `buildSnapshot()` omits the `name` field from camera objects — `CameraCard` always renders a blank camera name.

A third issue (latencyMs permanently null) is a documented partial — the component exists but can only show "— ms".

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User sees real-time dashboard showing red/green cameras over WebSocket | PARTIAL | TallyGrid, CameraCard, TallyBadge all exist and are wired to bridgeState. WS lifecycle in App.svelte updates bridgeState on every message. Camera tally renders correctly. BUT CameraCard renders `{cam.name}` which is always empty — server never sends a name field in the cameras array. |
| 2 | User sees prominent per-endpoint connection status with DISCONNECTED state | VERIFIED | ConnectionBadge.svelte, Header.svelte, DisconnectBanner.svelte all verified. Header wires `bridgeState.connections.vmix/atem` to ConnectionBadge. DisconnectBanner uses `$derived hasDisconnect` with `aria-live="assertive"`. VmixConnector emits `ready`/`disconnected` (line 146/175). AtemConnector emits `disconnected` in handleDisconnected() (line 177). connStatus object in server.ts wired to all 4 events (lines 251-268). |
| 3 | User sees latency/freshness indicator | PARTIAL | LatencyReadout.svelte exists with `$derived` color thresholds (null→grey, <50ms→white, 50-100ms→amber, >100ms→red) and label logic ('— ms' / '{N} ms' / '{N} ms ⚠'). Component is wired in Header. BUT `lastLatencyMs` is permanently null in server.ts because `stateChanged` emits `ResolverOutput` directly (documented Critical Deviation in 06-02-SUMMARY). Indicator always shows '— ms'. |
| 4 | User can configure vMix and ATEM IP/port in the web UI (persisted via ConfigStore) | PARTIAL | ConnectionSettings.svelte exists with collapsible panel, `PUT /config/settings` wiring, closes on 200. GET/PUT /config/settings route verified (config.ts lines 41-55). Form fields present with German labels. BUT `initialSettings` pre-populate is broken by Svelte 5 timing: `let vmixHost = $state(initialSettings?.vmix?.host ?? '')` runs at component creation when `initialSettings` is still undefined (async fetch not yet complete). Fields will always start empty. Requires human verification. |
| 5 | User can manually force tally — sticky, visually distinct, one-click releasable | FAILED | OverrideControls.svelte correctly sends PUT /overrides/:cameraId. The route writes to disk and calls broadcast(). However broadcast() → buildSnapshot() returns `overrides: {}` hardcoded (server.ts line 141). Every WS message resets `bridgeState.overrides = {}`. CameraCard `$derived currentOverride` always resolves to null. Orange border never renders; PROG/PREV buttons never appear active. The "sticky" requirement fails because the state is immediately overwritten by the WS broadcast. |

**Score:** 2/5 truths fully VERIFIED, 2 PARTIAL, 1 FAILED

### Plan-Level Must-Have Truths (06-01 through 06-04)

**Plan 01 must-haves — all VERIFIED:**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | tsc --noEmit passes on both tsconfigs | VERIFIED | Confirmed: both pass clean (no output) |
| 2 | vite build exits 0 | VERIFIED | Build passes, dist/assets/*.js (55KB) and *.css (8.5KB) exist |
| 3 | schema.ts accepts config without overrides field | VERIFIED | `overrides: z.record(...).optional()` at schema.ts line 106 |
| 4 | schema.ts rejects overrides with invalid values | VERIFIED | `z.enum(['program', 'preview'])` enforces valid values |
| 5 | Wave 0 test stub files exist | VERIFIED | server.test.ts, overrides.test.ts, settings.test.ts all exist |

**Plan 02 must-haves — all VERIFIED:**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | WS client receives valid snapshot on connect | VERIFIED | server.ts line 240: `socket.send(JSON.stringify(buildSnapshot()))` on connect |
| 2 | PUT /overrides/cam1 {state:'program'} returns 200 + WS broadcast | VERIFIED | overrides.ts returns 200 {overrides}, calls broadcast(). Test: overrides.test.ts line 56 |
| 3 | PUT /overrides/cam1 {state:null} deletes key + returns 200 | VERIFIED | overrides.ts line 65: `delete overrides[cameraId]`. Test passes |
| 4 | PUT /overrides/cam1 with cross-site header returns 403 | VERIFIED | CSRF hook lines 187-193, tested in server.test.ts |
| 5 | PUT /config/settings valid=200, invalid=400 | VERIFIED | config.ts lines 47-56, schema.safeParse + toConfigValidationError |
| 6 | GET /vmix/roster returns {inputs:[]} when empty | VERIFIED | vmix.ts lines 34-36 |
| 7 | POST /test/:cameraId {action:'program'} returns 200 {ok:true} | VERIFIED | test.ts returns {ok:true} on valid action |

**Plan 03 must-haves — PARTIAL:**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Browser shows grid of camera cards with LIVE/PREV/— badges | PARTIAL | TallyBadge, TallyGrid, CameraCard all exist and wired. But camera name is missing (server never sends name field). |
| 2 | Header shows vMix and ATEM connection badges with correct colors | VERIFIED | Header.svelte, ConnectionBadge.svelte both verified. Color logic: #16a34a/connecting/#dc2626. |
| 3 | Latency readout shows '— ms' on initial load | VERIFIED | LatencyReadout $derived label: null → '— ms'. Permanent null is a deviation but null path works. |
| 4 | Disconnect banner appears prominently when disconnected | VERIFIED | DisconnectBanner uses $derived hasDisconnect, aria-live="assertive", red background #dc2626 |
| 5 | Override banner appears (orange) when overrides has entries | FAILED (downstream) | OverrideBanner logic is correct ($derived activeCount), but overrides in bridgeState are always {} due to buildSnapshot gap |
| 6 | Grid shows empty state copy when cameras empty | VERIFIED | TallyGrid lines 9-10: 'Keine Kameras konfiguriert' + 'Öffne den Mapping-Editor...' |
| 7 | No tally badge uses animation/transition | VERIFIED | grep confirms 0 matches for `transition:` in TallyBadge.svelte, 0 matches for `on:click` in all frontend files |

**Plan 04 must-haves — PARTIAL:**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Clicking [PROG] fires PUT /overrides/:cameraId {state:'program'} | VERIFIED | OverrideControls.svelte: handleToggle → setOverride → fetch PUT. Logic correct. |
| 2 | Clicking active [PROG] fires PUT with {state:null} to clear | VERIFIED | handleToggle: next = currentOverride === target ? null : target |
| 3 | Active override button has orange background | FAILED (downstream) | class:active-override style is correct, but currentOverride is always null (WS sends overrides: {}) |
| 4 | Clicking [Test: PROG] fires POST /test/:cameraId and shows [Fertig] | VERIFIED | TestControls.svelte: fetch POST, testState.activeCameraInTest set, testActive $derived |
| 5 | Only one camera in test mode at a time | VERIFIED | testState exported from state.svelte.ts, cross-instance coordination via shared $state |
| 6 | Mapping editor opens, fires GET /vmix/roster | VERIFIED | MappingEditor uses native `<details ontoggle>`, fetchRoster() on open |
| 7 | 'Mapping speichern' fires PUT /config/mapping | VERIFIED | save() in MappingEditor calls PUT /config/mapping with full mapping array |
| 8 | Connection settings pre-populates from GET /config/settings on load | UNCERTAIN | App.svelte fetches on mount and passes initialSettings prop. But ConnectionSettings initializes local $state from prop at creation time — async timing means fields likely start empty. Human verification required. |
| 9 | 'Einstellungen speichern' fires PUT + closes panel on success | VERIFIED | ConnectionSettings.svelte: PUT /config/settings, document.querySelector('#settings-panel').open = false on 200 |
| 10 | All error messages match German copy strings | VERIFIED | Sampled: 'Override konnte nicht gesetzt werden.', 'Einstellungen konnten nicht gespeichert werden. Bitte Eingaben prüfen.', 'Mapping konnte nicht gespeichert werden. Ungültige Eingaben.' |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/server.ts` | Fastify server with static, WS, CSRF, broadcast | STUB (partial) | File exists and is substantive. CSRF hook present. broadcast() iterates websocketServer.clients. Plugin registration order correct (static line 170, WS line 179). BUT buildSnapshot() hardcodes `overrides: {}` and omits camera `name` field. |
| `src/routes/overrides.ts` | PUT /overrides/:cameraId | VERIFIED | Zod validation, read→mutate→write configStore, call broadcast(), return 200 {overrides} |
| `src/routes/config.ts` | GET/PUT /config/mapping and /config/settings | VERIFIED | All 4 routes implemented, schema.safeParse, toConfigValidationError on 400 |
| `src/routes/test.ts` | POST /test/:cameraId | VERIFIED | Zod action validation, returns 200 {ok:true} on valid |
| `src/routes/vmix.ts` | GET /vmix/roster | VERIFIED | Returns {inputs:[]} when empty, {key,number} array when populated |
| `src/frontend/state.svelte.ts` | BridgeState, bridgeState = $state | VERIFIED | `export const bridgeState = $state<BridgeState>({...})`, testState also exported |
| `src/frontend/App.svelte` | WS lifecycle, stateChanged handler | VERIFIED | onMount, connect(), ws.onmessage updates bridgeState properties, wsAttempted guard |
| `src/frontend/OverrideControls.svelte` | Toggle trio, PUT call, no optimistic update | VERIFIED | Three buttons, handleToggle, setOverride with fetch, no local bridgeState mutation |
| `src/frontend/ConnectionSettings.svelte` | Pre-populate, closes on 200 | PARTIAL | PUT wiring and close-on-200 verified. Pre-populate timing uncertain (human verify). |
| `src/frontend/MappingEditor.svelte` | Collapsible, dirty-track, fetchRoster | VERIFIED | `<details ontoggle>`, dirty tracking, fetchRoster on open, PUT /config/mapping |
| `src/frontend/DisconnectBanner.svelte` | aria-live=assertive, conditional render | VERIFIED | aria-live="assertive", $derived hasDisconnect, German copy strings |
| `src/frontend/LatencyReadout.svelte` | $derived color thresholds | VERIFIED | $derived color and label, correct threshold values, inline style |
| `vite.config.ts` | svelte plugin, proxy config | VERIFIED | svelte(), root: 'src/frontend', all 5 proxy entries |
| `tsconfig.json` | excludes src/frontend | VERIFIED | "exclude": ["src/frontend"] present |
| `src/frontend/tsconfig.json` | moduleResolution: bundler | VERIFIED | "moduleResolution": "bundler", "isolatedModules": true, "exclude": [] |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server.ts` | TallyOrchestrator | `on('stateChanged')` fires broadcast() | VERIFIED | Line 277: orchestrator.on('stateChanged', ...) calls broadcast() |
| `server.ts` | `fastify.websocketServer.clients` | broadcast() iterates with readyState === WebSocket.OPEN | VERIFIED | Lines 156-160: iterates wsServer.clients, checks WebSocket.OPEN |
| `routes/overrides.ts` | ConfigStore + broadcast | PUT writes overrides then calls broadcast() | VERIFIED | Lines 70-73: configStore.write() then broadcast() |
| `server.ts` | buildSnapshot overrides | reads from ConfigStore | FAILED | Line 141: `overrides: {}` hardcoded. configStore is injected but never called in buildSnapshot() |
| `App.svelte` | `state.svelte.ts` | onMessage updates bridgeState properties | VERIFIED | Lines 35-38: bridgeState.cameras, .connections, .latencyMs, .overrides all mutated |
| `TallyGrid.svelte` | `CameraCard.svelte` | `{#each bridgeState.cameras as cam}` renders CameraCard | VERIFIED | TallyGrid line 14 |
| `CameraCard.svelte` | `TallyBadge.svelte` | passes tally prop | VERIFIED | CameraCard: `<TallyBadge tally={cam.tally} />` |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `CameraCard.svelte` | `cam.name` | `buildSnapshot()` → `msg.cameras` | No — server never sends name field | HOLLOW_PROP |
| `OverrideControls.svelte` | `currentOverride` | `buildSnapshot().overrides` → `bridgeState.overrides` | No — always `{}` | DISCONNECTED |
| `OverrideBanner.svelte` | `activeCount` | `bridgeState.overrides` | No — always `{}` | DISCONNECTED |
| `LatencyReadout.svelte` | `bridgeState.latencyMs` | `lastLatencyMs` in server.ts | No — permanently null | STATIC |
| `ConnectionBadge.svelte` | `status` prop from Header | `connStatus` in server.ts via WS | Yes — connector events update connStatus | FLOWING |
| `DisconnectBanner.svelte` | `bridgeState.connections` | WS snapshot connections field | Yes — connStatus accurately reflects connector state | FLOWING |
| `TallyBadge.svelte` | `cam.tally` | `buildSnapshot().cameras[].tally` | Yes — from resolver.cameras map | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `npm test` — 195 tests pass | `npm test` | 12 files passed, 195 tests passed | PASS |
| `tsc --noEmit` server | `npx tsc --noEmit` | Exit 0, no output | PASS |
| `tsc --noEmit` frontend | `npx tsc --noEmit -p src/frontend/tsconfig.json` | Exit 0, no output | PASS |
| `vite build` produces bundle | `npx vite build --logLevel error` | Exit 0, dist/assets/index-*.js (55KB), *.css (8.5KB) | PASS |
| No `{@html}` in frontend | `grep -rn "@html" src/frontend/` | 0 matches | PASS |
| No `on:click` syntax | `grep -rn "on:click" src/frontend/` | 0 matches | PASS |
| No tally transition animation | `grep -rn "transition:" src/frontend/TallyBadge.svelte` | 0 matches | PASS |
| Plugin registration order | grep staticPlugin/websocketPlugin lines | static at line 170, WS at line 179 | PASS |
| CSRF hook present | `grep -c "sec-fetch-site" src/server.ts` | 1 | PASS |
| broadcast iterates clients | `grep -c "websocketServer" src/server.ts` | 5 | PASS |
| overrides field in buildSnapshot | `grep "overrides:" src/server.ts` (buildSnapshot return) | `overrides: {}` (hardcoded) | FAIL |

---

## Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` found. No probes declared in any plan file.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| UI-01 | 06-01, 06-02, 06-04 | Configure vMix/ATEM IP/port via web UI, persisted | PARTIAL | GET/PUT /config/settings route verified. ConnectionSettings UI exists. Pre-populate timing issue requires human verify. |
| UI-02 | 06-02, 06-03 | Real-time connection status, loud DISCONNECTED state | VERIFIED | ConnectionBadge, DisconnectBanner, connector events, connStatus tracking all verified |
| UI-03 | 06-02, 06-03 | Real-time tally dashboard over WebSocket | PARTIAL | Dashboard exists and WS delivers tally states. Camera cards render correctly except name field is always empty (server omits it). |
| UI-04 | 06-02, 06-03, 06-04 | Manual sticky override, visually distinct, one-click releasable | FAILED | PUT route and frontend controls are correct, but buildSnapshot() returns overrides: {} — the WS broadcast immediately erases override visibility after every state change. |
| UI-05 | 06-02, 06-03 | Latency/freshness indicator | PARTIAL | LatencyReadout component exists and null path renders '— ms'. lastLatencyMs is permanently null — documented Critical Deviation. Real latency available in pino logs only. |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/server.ts` | 141 | `overrides: {}` hardcoded in buildSnapshot() | BLOCKER | UI-04 override visibility broken — every WS broadcast resets bridgeState.overrides to {} |
| `src/server.ts` | 130-133 | buildSnapshot() omits `name` field from camera objects | BLOCKER | CameraCard renders empty camera names — UI-03 tally grid missing human-readable labels |
| `src/server.ts` | 283 | `lastLatencyMs = null` permanently | WARNING | UI-05 latency always shows '— ms' — documented deviation, pino logs have real latency |
| `src/routes/test.ts` | 47-48 | Returns 200 {ok:true} without issuing any ATEM command | INFO | Test route is a stub — does not call atemConnector at all. Per-camera test does not actually drive ATEM. Functional gap for D-12 but not a core UI requirement failure. |
| `src/frontend/ConnectionSettings.svelte` | 14-16 | `$state` initialized from prop without `$effect` for re-sync | WARNING | Pre-populate from async-fetched initialSettings prop likely does not work at runtime |

---

## Human Verification Required

### 1. ConnectionSettings Pre-Populate

**Test:** Start the server with a saved config (`config.json` has vmix.host set). Open http://localhost:3000. Expand the "Verbindung · ..." panel.
**Expected:** vMix Host and Port fields are pre-filled with the saved values from `config.json`.
**Why human:** `ConnectionSettings.svelte` initializes `let vmixHost = $state(initialSettings?.vmix?.host ?? '')` at component creation time. `App.svelte` passes `initialSettings` as an async-loaded `$state` prop — it is `undefined` when `ConnectionSettings` first renders. Svelte 5 local `$state` variables seeded from a prop are NOT reactive to subsequent prop updates without a `$effect`. The fields will likely always start empty.

### 2. Human UI Checkpoint (Plans 03 and 04 — Bypassed)

**Test:** Run `npx tsx src/server.ts` (or `node src/server.ts`), open http://localhost:3000 in a browser, and work through the full checklist from 06-04-PLAN.md Task 3.
**Expected:** Header connection badges visible, tally grid renders cameras (if mapping configured), override toggle trio clickable on each camera card, [Test: PROG]/[Test: PREV] buttons present, mapping editor collapses/expands, settings form visible.
**Why human:** Both `checkpoint:human-verify` tasks in Plans 03 and 04 were marked as skipped ("running all waves in one go" per executor instructions). No human has confirmed the UI renders in a real browser. Visual layout, German copy accuracy, and interactive behavior require browser observation.

---

## Gaps Summary

Three gaps block full goal achievement:

**BLOCKER 1 — buildSnapshot missing overrides from ConfigStore (`src/server.ts:141`)**

`buildSnapshot()` returns `overrides: {}` hardcoded. The function has access to `configStore` (it is injected into `buildApp`) but never calls `configStore.read()`. Since broadcast is called immediately after every override PUT, the WS message that follows always resets the frontend's override state to empty. This makes the entire UI-04 feature (sticky manual override — the only new control surface in Phase 6) non-functional at runtime despite the route, the persistence, and the frontend components all being correctly implemented.

Fix: maintain an in-memory `overridesCache` in `buildApp` (loaded at startup, updated whenever `registerOverridesRoute` writes), then read from cache in `buildSnapshot()`. Or make `buildSnapshot` async and call `await configStore.read()`.

**BLOCKER 2 — Camera name missing from snapshot (`src/server.ts:130-133`)**

`buildSnapshot()` maps camera state as `{ cameraId, tally }` without a `name` field. The frontend `CameraSnapshot` interface expects `{ cameraId, name, tally }`. Every camera card in the grid renders a blank name. This is a data-flow gap: the server has access to config.mapping which contains `vmixTitle` and `cameraId`, but does not read it in `buildSnapshot`.

Fix: in `buildSnapshot()`, read the current `config.mapping` array and look up `vmixTitle ?? cameraId` for each camera in the resolver output.

**WARNING — latencyMs permanently null**

`lastLatencyMs` is always null because the `stateChanged` event does not carry `tallyReceivedAt`. This was documented as a Critical Deviation in 06-02-SUMMARY. The LatencyReadout component is wired and shows '— ms' correctly for the null case. The ROADMAP success criterion says "User sees a latency/freshness indicator" — the indicator is present and functional for the null case, but never shows a real value. Not a code bug; a planned capability gap.

---

_Verified: 2026-07-01T21:20:00+02:00_
_Verifier: Claude (gsd-verifier)_
