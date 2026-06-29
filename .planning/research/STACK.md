# Stack Research

**Domain:** vMix→ATEM tally bridge — Node.js server + real-time web UI, co-located with vMix on Windows
**Researched:** 2026-06-29
**Confidence:** HIGH for ATEM/vMix protocol libraries and web layer; MEDIUM for Windows packaging/service approach (multiple valid paths)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js (LTS) | 22.x LTS (or 24.x) | Runtime | LTS line, native `node:test`, stable WebSocket. `atem-connection` 3.9 requires modern Node. Pin to LTS for production stability. |
| `atem-connection` | 3.9.0 | Control ATEM program/preview bus, read state | The de-facto standard. Maintained by **Sofie Automation / NRK** (the same broadcast-automation org behind CasparCG tooling) — repo `Sofie-Automation/sofie-atem-connection`, last publish 2026-02-18. Actively released (3.7→3.8→3.9 across 2025). TypeScript, reverse-engineered BMD protocol, full state model. No real competitor. |
| `node-vmix` | 1.7.1 | vMix TCP API client (push tally) + HTTP fallback | Maintained by **jensstigaard** (the most active author in the vMix-JS space). Wraps the TCP socket and emits a parsed `tally` event from `SUBSCRIBE TALLY`. Saves you writing/maintaining the line-protocol parser. See caveat below re: `axios` dependency. |
| `ws` | 8.21.0 | WebSocket server for the web UI | The standard, minimal, fastest Node WS library. No abstraction tax, no fallbacks you don't need on a LAN. Server and a co-located/LAN browser both speak native WebSocket — Socket.IO's reconnection/fallback machinery is unnecessary weight here. |
| `fastify` | 5.9.0 | HTTP server (serve static UI + REST for config) | Faster and lighter than Express, first-class schema validation for the config/mapping endpoints, clean plugin model (`@fastify/static`, `@fastify/websocket` wraps `ws`). Express 5 is fine too — see alternatives. |
| `lowdb` | 7.0.1 | Persist input mapping + connection config | The mapping for ≤8 cameras is a tiny JSON document. lowdb = a typed JSON file with atomic writes, zero native build step, trivially hand-editable/inspectable. SQLite is overkill for this data shape and adds a native dependency to the Windows build. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@fastify/static` | latest 8.x | Serve the built web UI | Always — serves `dist/` UI from the same process/port as the API + WS. |
| `@fastify/websocket` | latest 11.x | Bind `ws` into Fastify's lifecycle | If you want WS on the same Fastify server/port instead of a standalone `ws` server. |
| `zod` | 4.x | Validate config / mapping payloads from the UI | Recommended — guard against malformed mapping (input out of range, duplicate ATEM input) before persisting. |
| `pino` | 9.x | Structured logging (comes with Fastify) | Always — live production tool; you want timestamped connection/reconnect logs. |
| `vite` | 8.1.0 | Build the frontend bundle | Build-time only. Bundles the UI to static `dist/` files Fastify serves. |

### Frontend (web UI)

| Choice | Version | Why |
|--------|---------|-----|
| **Preact + htm** OR **Svelte** | Preact 10.29, Svelte 5.x | The UI is small: mapping table, live status grid (red/green per camera), connection form, manual override toggles. A full React/Vue SPA is overkill. **Preact** (3KB, React-like) or **Svelte** (compiles away, tiny runtime, great for live-status reactivity) both fit. Vanilla JS + `ws` is also defensible for this scope — choose Svelte if you want reactive live-status with least hand-written DOM code. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript 5.x | Type safety across protocol code | `atem-connection` and `node-vmix` ship types; the state shapes (program/preview/tally) are error-prone to handle untyped. Strongly recommended. |
| `tsx` / `tsup` | Run/bundle TS server | `tsx` for dev (no build step), `tsup` or `esbuild` to bundle the server to a single JS for packaging. |
| `vitest` | Tests for mapping logic | The vMix-tally → ATEM-input mapping is the one piece of pure logic worth unit-testing. |
| `concurrently` 10.x | Run server + Vite dev in parallel | Dev convenience. |

## Installation

```bash
# Core runtime deps
npm install atem-connection node-vmix ws fastify @fastify/static @fastify/websocket lowdb zod

# Frontend (pick one framework)
npm install -D vite
npm install preact htm        # OR: npm install -D svelte && npm install -D @sveltejs/vite-plugin-svelte

# Dev / build
npm install -D typescript tsx tsup vitest concurrently
```

## Key API Shapes (verified)

### atem-connection — program / preview / tally

```ts
import { Atem } from 'atem-connection'
const atem = new Atem()
atem.on('connected', () => { /* atem.state is now populated */ })
atem.on('stateChanged', (state, paths) => { /* react to bus changes if needed */ })
atem.connect('192.168.x.x')              // default ATEM port handled internally

await atem.changeProgramInput(inputId)   // sets PGM bus → RED SDI tally on that input's camera
await atem.changePreviewInput(inputId)   // sets PVW bus → GREEN SDI tally
// Read current state: atem.state.video.mixEffects[0].programInput / .previewInput
```
- ATEM derives tally from its PGM/PVW buses; setting these buses is exactly how you drive per-camera SDI tally. No separate "tally" API call needed.
- `changeProgramInput`/`changePreviewInput` return promises that resolve when the command is acked; `state` updates arrive shortly after via `stateChanged`.
- Mix-effect index argument (`mixEffect`, default 0) targets ME1 — correct for an 8-input single-ME setup.
- **Confidence: HIGH** (official README + Sofie maintainership).

### node-vmix — TCP tally subscription

```ts
import { ConnectionTCP } from 'node-vmix'
const vmix = new ConnectionTCP('vmix-host')  // port 8099
vmix.on('connect', () => vmix.send('SUBSCRIBE TALLY'))
vmix.on('tally', (tally) => {
  // tally is the parsed list; each input: 0 = off, 1 = program (live), 2 = preview
})
```
- vMix TCP API (port 8099): `TALLY` returns `TALLY OK 0121...` where each digit = `0` off / `1` program / `2` preview. `SUBSCRIBE TALLY` pushes updates on every change until `UNSUBSCRIBE` or disconnect — this is the low-latency push path that meets <100 ms.
- Also available: `SUBSCRIBE ACTS` (activators, 0/1 states) if you later need finer per-input/overlay state than the tally bus exposes.
- **Caveat:** node-vmix sends commands with no response/feedback channel on TCP (fire-and-forget); design reconnect/health around socket `connect`/`close`/`error` events, not command acks.
- **Confidence: HIGH** (official vMix help28 TCP API docs + node-vmix docs).

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `node-vmix` | **Raw `net.Socket` + hand-written line parser** | If you want zero deps and to avoid node-vmix's `axios` dependency (pulled in for its HTTP module). The TCP tally protocol is simple enough (newline-delimited `TALLY OK <digits>`) to parse in ~40 lines. Choose this if you want full control over the reconnect/parse loop and a leaner dependency tree. Strong, defensible option for a single-purpose production tool. |
| `node-vmix` | `vmix-js-utils` (same author) | If you also need rich XML state parsing of the full vMix data model. For tally-only, node-vmix is leaner. |
| `lowdb` 7 | `better-sqlite3` 12.11 | If config grows to relational data (event logs, multi-profile history, many switchers). Adds a native build step — undesirable for simple Windows packaging. Not warranted for an ≤8-input mapping. |
| `ws` | `socket.io` 4.8 | If the UI must traverse proxies/older browsers needing long-poll fallback, or you want rooms/auto-reconnect baked in. On a LAN co-located with vMix, native WS is sufficient and lighter. |
| `fastify` 5 | `express` 5.2.1 | If the team strongly prefers Express's ubiquity/ecosystem. Functionally fine; Fastify chosen for speed, built-in schema validation, and pino logging. |
| Preact/Svelte | Vanilla JS + `ws` | If you want zero frontend build tooling. Viable given the small UI, but the live red/green status grid is cleaner with a reactive framework. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Random/unmaintained `atem-*` npm packages | Many early ATEM libs are abandoned forks. `Sofie-Automation/sofie-atem-connection` (published as `atem-connection`) is the single actively-maintained, broadcast-grade implementation. | `atem-connection` 3.9.0 |
| vMix **HTTP/XML polling** (port 8088) as the primary tally source | Polling adds latency and load; fails the <100 ms end-to-end requirement. | vMix **TCP API** (8099) with `SUBSCRIBE TALLY` push |
| `pkg` (vercel/pkg) for packaging | Effectively deprecated — last release 2024-02, no longer maintained, lags new Node versions. | Node.js **SEA** (single executable app) or ship Node + script as a Windows service |
| SQLite/`better-sqlite3` for the mapping config | Native addon = harder Windows packaging; relational engine for a single small JSON document is overkill. | `lowdb` JSON file |
| Socket.IO as a default | Unneeded fallback/transport machinery for a LAN tool with a modern browser. | `ws` |

## Windows Packaging & Run (vMix is Windows-only; server co-located)

vMix runs only on Windows, so the bridge typically runs on the **same machine** (or same LAN). Recommended distribution, in order of preference:

1. **Run as a Windows service** (most robust for "live in production"): install Node.js LTS, ship the bundled server JS, register it as an auto-start service so it survives reboots and restarts on crash.
   - **NSSM** (Non-Sucking Service Manager) — battle-tested, wraps any exe/node script as a service. Simplest reliable path. (External tool, not npm.)
   - **`node-windows`** (1.0.0-beta.8) — npm-native service install, but on a long-running beta; usable but less proven than NSSM.
   - **PM2** (7.0.1) with `pm2-windows-startup` — good process management + auto-restart + logs, if you prefer a Node-native supervisor.
2. **Node.js SEA (Single Executable Application)** — built-in, Stability 1.1 "Active development", produces a standalone `.exe` on Windows. Good for a no-Node-install handoff, but: caveats with native addons and ESM/snapshot combos. atem-connection historically used worker threads/`threadedclass` — verify the bundled SEA loads cleanly before relying on it. **MEDIUM confidence** for this specific app.
3. **Plain `npm start` + a `.bat`/Task Scheduler entry** — simplest for a single operator's own machine; least resilient.

**Recommendation:** bundle the server with `tsup`/esbuild to a single JS file, run on installed Node.js LTS, and register with **NSSM** for production reliability and auto-restart. Treat SEA as a nicety for zero-install distribution once the worker-thread bundling is verified.
- **Confidence: MEDIUM** (multiple valid approaches; NSSM/PM2/node-windows all current, choice is operational preference).

## Stack Patterns by Variant

**If you want the leanest possible dependency tree:**
- Replace `node-vmix` with a raw `net.Socket` + a small `TALLY OK <digits>` parser, and `ws` standalone instead of via Fastify.
- Because: this is a single-purpose tool; fewer deps = simpler, more auditable Windows build and reconnect control.

**If the operator wants a zero-install handoff (no Node on the target machine):**
- Use Node.js SEA to produce one `.exe`; verify atem-connection's worker threads bundle correctly first.
- Because: avoids requiring a Node install on the production PC.

**If config/state grows beyond a small mapping (logs, multiple profiles, audit history):**
- Move from `lowdb` to `better-sqlite3`.
- Because: relational queries and concurrent writes outgrow a single JSON file.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `atem-connection@3.9.0` | Node.js 18+/20+/22 LTS | Pin Node LTS; 3.x uses modern JS + (historically) worker threads — relevant when bundling/SEA-packaging. |
| `node-vmix@1.7.1` | axios ^1.7, Node 16+ | Pulls `axios` transitively for its HTTP module even if you only use TCP — factor into bundle size / avoid via raw socket if undesired. |
| `ws@8.21` | Node 10+ | Fully native; no issues with Fastify 5 / `@fastify/websocket` 11. |
| `fastify@5.9` | Node 20+ | Fastify 5 dropped older Node; align with chosen LTS. |
| `lowdb@7` | ESM-only | v7 is pure ESM — your server must be ESM (`"type": "module"`) or use dynamic import. Plan module format accordingly (also affects SEA snapshot options). |
| `vite@8` | Node 20.19+/22.12+ | Build-time only; align dev Node with LTS. |

## Sources

- npm registry (`npm view`) — verified current versions/publish dates for atem-connection 3.9.0, node-vmix 1.7.1, ws 8.21.0, socket.io 4.8.3, fastify 5.9.0, express 5.2.1, lowdb 7.0.1, better-sqlite3 12.11.1, vite 8.1.0, pkg 5.8.1 (last 2024), node-windows 1.0.0-beta.8, pm2 7.0.1 — **HIGH**
- `Sofie-Automation/sofie-atem-connection` README (GitHub) — atem-connection connect/changeProgramInput/changePreviewInput/stateChanged API, maintainership — **HIGH**
- vMix official TCP API docs (vmix.com/help28/TCPAPI.html) — SUBSCRIBE TALLY, TALLY `0/1/2` digit meaning, ACTS, push semantics — **HIGH**
- `jensstigaard/node-vmix` docs (GitHub + jensstigaard.github.io) — ConnectionTCP, `tally` event, no-feedback caveat, axios dep — **HIGH**
- Node.js SEA docs (nodejs.org) — Stability 1.1, Windows `.exe` output, native-addon/ESM caveats — **HIGH**

---
*Stack research for: vMix→ATEM tally bridge (Node.js server + web UI, Windows-co-located)*
*Researched: 2026-06-29*
