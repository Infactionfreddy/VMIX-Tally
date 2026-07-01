---
phase: 06-web-ui-status-then-control
plan: "03"
subsystem: frontend
tags: [svelte5, vite, websocket, tally-dashboard, status-components, wave3]
dependency_graph:
  requires:
    - fastify-ws-broadcast
    - configstore-read-write-interface
    - connector-ready-disconnected-events
  provides:
    - svelte-state-store
    - ws-lifecycle-app
    - tally-grid-components
    - status-display-components
  affects:
    - src/frontend/state.svelte.ts
    - src/frontend/main.ts
    - src/frontend/index.html
    - src/frontend/tsconfig.json
    - src/frontend/App.svelte
    - src/frontend/Header.svelte
    - src/frontend/DisconnectBanner.svelte
    - src/frontend/OverrideBanner.svelte
    - src/frontend/TallyGrid.svelte
    - src/frontend/CameraCard.svelte
    - src/frontend/TallyBadge.svelte
    - src/frontend/ConnectionBadge.svelte
    - src/frontend/LatencyReadout.svelte
    - src/frontend/MappingEditor.svelte (stub)
    - src/frontend/ConnectionSettings.svelte (stub)
    - src/frontend/OverrideControls.svelte (stub)
    - src/frontend/TestControls.svelte (stub)
tech_stack:
  added: []
  patterns:
    - svelte5-state-runes-shared-store
    - svelte5-onMount-ws-lifecycle
    - svelte5-derived-computed-values
    - svelte5-props-destructure
    - css-custom-variables-root
    - css-grid-auto-fill
key_files:
  created:
    - src/frontend/state.svelte.ts
    - src/frontend/App.svelte
    - src/frontend/Header.svelte
    - src/frontend/DisconnectBanner.svelte
    - src/frontend/OverrideBanner.svelte
    - src/frontend/TallyGrid.svelte
    - src/frontend/CameraCard.svelte
    - src/frontend/TallyBadge.svelte
    - src/frontend/ConnectionBadge.svelte
    - src/frontend/LatencyReadout.svelte
    - src/frontend/MappingEditor.svelte
    - src/frontend/ConnectionSettings.svelte
    - src/frontend/OverrideControls.svelte
    - src/frontend/TestControls.svelte
  modified:
    - src/frontend/main.ts (Svelte 5 mount() pattern)
    - src/frontend/index.html (full SPA with :root CSS variables)
    - src/frontend/tsconfig.json (removed rootDir restriction)
decisions:
  - "Svelte 5 $state shared store exported as const from .svelte.ts — not a bare let"
  - "WS lifecycle in App.svelte onMount — 2s reconnect, wsAttempted guard prevents flash on initial load"
  - "tsconfig.json rootDir removed — noEmit:true makes it redundant, and it blocked ../core/events.ts import"
  - "All 8 status components created alongside 4 Plan 04 stubs in single commit per plan spec"
metrics:
  duration: ~20m execution
  completed: 2026-07-01
  tasks_completed: 2
  files_created: 14
  files_modified: 3
---

# Phase 6 Plan 03: Status Dashboard Frontend — 12 Svelte Components Summary

**One-liner:** Svelte 5 SPA foundation with shared $state store, WS lifecycle, and 8 status display components (tally grid, connection badges, disconnect/override banners, latency readout) — vite build 132 modules, tsc clean.

## What Was Implemented

### Task 1: Frontend foundation — state store, WS lifecycle, entry point

**src/frontend/state.svelte.ts:**
Exports `bridgeState = $state<BridgeState>({...})` — a Svelte 5 reactive object (not a bare `let`). Defines `ConnectionStatus`, `TallyValue` (aliased from `CameraTallyState`), `CameraSnapshot`, and `BridgeState` interfaces. Initial state: cameras:[], connections: both `'connecting'`, latencyMs: null, overrides: {}, wsConnected: false.

**src/frontend/main.ts:**
Replaced stub with Svelte 5 `mount(App, { target: document.body })`.

**src/frontend/index.html:**
Full SPA entry point with all CSS custom variables in `:root` (tally-program/preview/off/override, surface/raised/accent/destructive colors, text-body/label/heading/display sizes, sp-xs through sp-3xl spacing scale). Global reset (`box-sizing`, `margin: 0`, `padding: 0`).

**src/frontend/App.svelte:**
Root component with WS lifecycle in `onMount`. `connect()` function creates `WebSocket` to `ws://${location.host}/ws`, updates `bridgeState` property mutations on `onmessage` (never reassigns `bridgeState`), reconnects after 2s on `onclose`. `wsAttempted` local `$state(false)` becomes `true` on first `ws.onopen` — prevents the WS disconnect overlay from flashing during initial page load. Fetches `/config/settings` once on mount for future ConnectionSettings pre-population. Renders: Header, DisconnectBanner, OverrideBanner, TallyGrid, MappingEditor (stub), ConnectionSettings (stub). German WS overlay: "Verbindung zur Bridge unterbrochen — Seite neu laden" with Neu laden button.

**Plan 04 stub files created:**
- `MappingEditor.svelte` — `<div><!-- Plan 04 --></div>`
- `ConnectionSettings.svelte` — `<div><!-- Plan 04 --></div>`
- `OverrideControls.svelte` — `<div></div>`
- `TestControls.svelte` — `<div></div>`

### Task 2: Status display components

**TallyBadge.svelte:**
Props: `{ tally: TallyValue }`. Labels: program='LIVE', preview='PREV', off='—'. Uses `class:program`, `class:preview`, `class:off` for tally colors. 48px min-height, 28px font, font-weight 700, uppercase. No `transition:` or `animate:` directives.

**ConnectionBadge.svelte:**
Props: `{ label: string; status: ConnectionStatus }`. Colored dot (8px circle) + label + German status text: 'Verbunden' | 'Verbinde …' | 'Getrennt'. Dot colors: connected=#16a34a, connecting=#ca8a04, disconnected=#dc2626. `aria-live="polite"` on container.

**LatencyReadout.svelte:**
Reads `bridgeState.latencyMs` directly. `$derived` color: null→#9ca3af, <50ms→#ffffff, 50–100ms→#ca8a04, >100ms→#dc2626. `$derived` label: null→'— ms', >100ms→'{N} ms ⚠', else→'{N} ms'. Inline style for color.

**Header.svelte:**
App title "vMix-Tally Bridge" + two `ConnectionBadge` components (vMix and ATEM) + `LatencyReadout`. Background: `var(--color-surface-raised)`. Flexbox space-between. `aria-live="polite"` on badges region.

**DisconnectBanner.svelte:**
`$derived hasDisconnect`. Renders only when true. Shows one or both lines: 'vMix getrennt — Tally-Daten möglicherweise veraltet' / 'ATEM getrennt — Kein Tally-Ausgang aktiv'. Background: #dc2626. `aria-live="assertive"`. Static position in document flow.

**OverrideBanner.svelte:**
`$derived activeCount` from `Object.values(bridgeState.overrides).filter(v => v !== null).length`. Local `$state dismissed = false`. Shows when `activeCount > 0 && !dismissed`. Text: '{activeCount} Kamera(s) mit aktivem manuellen Override'. Dismiss button (×) with `aria-label="Override-Warnung ausblenden"`.

**TallyGrid.svelte:**
CSS grid `repeat(auto-fill, minmax(180px, 1fr))`, gap `var(--sp-lg)`. `{#each bridgeState.cameras as cam (cam.cameraId)}` renders `CameraCard`. Empty state: heading 'Keine Kameras konfiguriert' + body 'Öffne den Mapping-Editor und weise jedem vMix-Eingang eine ATEM-Kamera zu.'

**CameraCard.svelte:**
Props: `{ cam: CameraSnapshot }`. `$derived currentOverride = bridgeState.overrides[cam.cameraId] ?? null`. Orange 4px left border via `class:has-override`. Camera name (heading font, truncate overflow). TallyBadge (receives `cam.tally`). OverrideControls (stub). TestControls (stub).

## Build and Type Check Results

| Command | Result |
|---------|--------|
| `npx vite build` | PASS — 132 modules transformed, 97ms, dist/index.html + dist/assets/*.js generated |
| `npx tsc --noEmit -p src/frontend/tsconfig.json` | PASS — 0 errors |
| `npm test` | PASS — 195/195 passed (0 regressions) |

## Verification Checks

| Check | Result |
|-------|--------|
| `grep -c "bridgeState\." src/frontend/App.svelte` | 7 (property mutations, not reassignments) |
| `grep -rn "@html" src/frontend/` | 0 (no XSS risk) |
| `grep -rn "transition:" src/frontend/TallyBadge.svelte` | 0 (no animation) |
| `grep -rn "on:click" src/frontend/` | 0 (all using onclick= syntax) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Frontend tsconfig.json rootDir blocked ../core/events.ts import**
- **Found during:** Task 1 — `tsc --noEmit` after creating state.svelte.ts
- **Issue:** `src/frontend/tsconfig.json` had `"rootDir": "."` which restricted TypeScript to only process files within `src/frontend/`. The import `from '../core/events.js'` in `state.svelte.ts` resolves to `src/core/events.ts` — outside the rootDir. Error: `File 'src/core/events.ts' is not under 'rootDir'`.
- **Fix:** Removed `rootDir` from compiler options (unnecessary with `noEmit: true`; rootDir only affects output structure which we don't need). Added `"../core/**/*.ts"` to `include` so tsc can type-check the imported file.
- **Files modified:** `src/frontend/tsconfig.json`
- **Commit:** 3474bf9

## Known Stubs

| File | Content | Reason |
|------|---------|--------|
| src/frontend/MappingEditor.svelte | `<div><!-- Plan 04 --></div>` | Mapping editor UI is Plan 04 scope |
| src/frontend/ConnectionSettings.svelte | `<div><!-- Plan 04 --></div>` | Settings editor UI is Plan 04 scope |
| src/frontend/OverrideControls.svelte | `<div></div>` | Override toggle buttons are Plan 04 scope |
| src/frontend/TestControls.svelte | `<div></div>` | Test buttons are Plan 04 scope |

These stubs are intentional — Plan 04 fills them. The status dashboard goal (UI-02, UI-03, UI-05) is fully achieved by the 8 status components in this plan.

## Threat Flags

No new threat surface beyond the plan's threat model. All camera names and labels render via Svelte template auto-escaping (no `{@html}` used anywhere). WS snapshot is display-only. No new network endpoints in this plan (server-side unchanged).

## Commits

| Hash | Type | Message |
|------|------|---------|
| 3474bf9 | feat | feat(06-03): status dashboard frontend — 12 Svelte components |

## Self-Check: PASSED

Files exist:
- src/frontend/state.svelte.ts — FOUND
- src/frontend/App.svelte — FOUND
- src/frontend/TallyBadge.svelte — FOUND
- src/frontend/CameraCard.svelte — FOUND
- src/frontend/LatencyReadout.svelte — FOUND
- src/frontend/Header.svelte — FOUND
- src/frontend/DisconnectBanner.svelte — FOUND
- src/frontend/OverrideBanner.svelte — FOUND
- src/frontend/TallyGrid.svelte — FOUND
- src/frontend/ConnectionBadge.svelte — FOUND

Commits exist:
- 3474bf9 feat commit — FOUND
