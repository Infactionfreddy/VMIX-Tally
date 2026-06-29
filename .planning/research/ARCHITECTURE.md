# Architecture Research

**Domain:** Real-time broadcast tally bridge (vMix → ATEM), Node.js server with live web UI
**Researched:** 2026-06-29
**Confidence:** HIGH (vMix TCP protocol and atem-connection API both verified against official sources)

## Standard Architecture

This is a **single-process, event-driven bridge**: two long-lived TCP/UDP client connections (vMix in, ATEM out) feed a central in-memory state store, which projects to a web UI over WebSocket. There is no database in the hot path; persistence is config-only (mapping table + connection settings). The design is a classic **hub-and-spoke / mediator**: connectors never talk to each other directly — everything flows through a central core that owns the canonical tally state.

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                          INGRESS (sources)                            │
├──────────────────────────────────────────────────────────────────────┤
│   ┌────────────────────┐                                              │
│   │  vMix Connector    │  TCP 8099, SUBSCRIBE TALLY                   │
│   │  - parse TALLY OK… │  push: per-input 0/1/2                       │
│   │  - conn state FSM  │                                              │
│   └─────────┬──────────┘                                              │
├─────────────┼────────────────────────────────────────────────────────┤
│             ▼                CORE (mediator)                          │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │  Tally State Store + Resolver                                 │   │
│   │  - canonical desired state per ATEM input (PGM/PV/off)        │   │
│   │  - mapping: vMix input # → ATEM input #                       │   │
│   │  - override layer (merged on top of live)                     │   │
│   │  - debounce / coalesce                                        │   │
│   │  - emits "desired ATEM bus state" + "UI status"              │   │
│   └─────────┬───────────────────────────────────┬────────────────┘   │
├─────────────┼───────────────────────────────────┼────────────────────┤
│             ▼          EGRESS (sinks)            ▼                    │
│   ┌────────────────────┐              ┌────────────────────────┐      │
│   │  ATEM Connector    │              │  Web UI Server         │      │
│   │  - atem-connection │              │  - WS push (status)    │      │
│   │  - changeProgram/  │              │  - REST/WS (config,    │      │
│   │    PreviewInput    │              │    override, conn cfg) │      │
│   │  - conn state FSM  │              │  - serves static SPA   │      │
│   └────────────────────┘              └───────────┬────────────┘      │
├───────────────────────────────────────────────────┼──────────────────┤
│                        PERSISTENCE                 │                  │
│   ┌──────────────────────────────────────────────┐│  Browser SPA     │
│   │  Config Store (mapping + IP/port settings)   ││  (mapping editor,│
│   │  flat JSON file on disk                      ││   live status,   │
│   └──────────────────────────────────────────────┘│   override panel)│
└────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **vMix Connector** | Own the TCP socket to vMix:8099. Send `SUBSCRIBE TALLY\r\n`. Parse `TALLY OK <digits>` lines into `{inputIndex → 0\|1\|2}`. Emit `tallyChanged` events. Own its own connection state machine + reconnect. Never touches ATEM or mapping. | Node `net.Socket`, line buffer split on `\r\n`, EventEmitter |
| **ATEM Connector** | Own the connection to the ATEM via `atem-connection`. Translate "desired bus state" into `changeProgramInput(input, me=0)` / `changePreviewInput(input, me=0)` calls. Surface `connected`/`disconnected`/`stateChanged`. Idempotent: only sends commands when desired ≠ actual. | `atem-connection` `Atem` instance, wraps its events |
| **Core / Resolver** | The mediator. Holds canonical state: live vMix tally + manual overrides. Applies mapping (vMix input → ATEM input), main-PGM-only rule, debounce. Computes the single **desired ATEM bus state**. Emits to ATEM Connector and to UI server. | Plain TS module + EventEmitter, pure functions for resolution |
| **Web UI Server** | HTTP server for static SPA + REST/WS endpoints. Pushes live status to browsers over WebSocket. Receives config edits, manual overrides, connection settings. Validates input, forwards to Core / Config Store. | `ws` (or `socket.io`) + `express`/`fastify` for REST + static |
| **Config Store** | Persist mapping table and connection settings (vMix/ATEM IP+port). Load on boot, write on change. | Single JSON file, atomic write (write-temp-then-rename) |

## Recommended Project Structure

```
src/
├── core/
│   ├── tallyState.ts        # canonical state store (live + override layers)
│   ├── resolver.ts          # pure: (vMixTally, mapping, override) → desiredAtemState
│   ├── debounce.ts          # coalescing of rapid changes
│   └── events.ts            # typed event contracts between modules
├── connectors/
│   ├── vmix/
│   │   ├── vmixConnector.ts # socket lifecycle + SUBSCRIBE TALLY
│   │   ├── tallyParser.ts   # "TALLY OK 0121…" → number[]
│   │   └── connectionFsm.ts # disconnected→connecting→connected→reconnecting
│   └── atem/
│       ├── atemConnector.ts # atem-connection wrapper, command dispatch
│       └── connectionFsm.ts # mirrors atem-connection events into our FSM
├── web/
│   ├── server.ts            # http + static SPA
│   ├── ws.ts                # WebSocket status push + override/config in
│   └── rest.ts              # REST endpoints for config (optional twin of ws)
├── config/
│   ├── configStore.ts       # load/save JSON, atomic write
│   └── schema.ts            # mapping + connection settings types/validation
├── app.ts                   # wiring: instantiate, subscribe, start
└── index.ts                 # entrypoint
public/                      # built SPA (mapping editor, status, override)
config.json                  # persisted mapping + connection settings
```

### Structure Rationale

- **`core/` knows nothing about sockets or HTTP.** The resolver is a pure function — trivially unit-testable, the part most likely to harbor logic bugs (mapping, override precedence, PGM-only rule).
- **`connectors/` are symmetric and isolated.** Each owns exactly one external system and one connection FSM. They expose events in, commands in/events out — never reach across to the other connector.
- **`web/` is a thin projection layer.** It subscribes to Core state and forwards UI intents back. It must never drive the ATEM directly; manual override goes *through* the Core so precedence stays in one place.
- **`config/` is the only thing that touches disk.** Keeps the hot path allocation-free and the persistence concern testable in isolation.

## Architectural Patterns

### Pattern 1: Mediator with Canonical Desired-State (not command pass-through)

**What:** vMix events do not translate directly into ATEM commands. They mutate a canonical state object; the Core then computes a complete *desired ATEM bus state* and the ATEM Connector reconciles actual→desired (sending a command only on a diff).
**When to use:** Whenever multiple inputs (live tally + manual override + reconnect-resync) can affect the same output. That is exactly this system.
**Trade-offs:** Slightly more code than a direct `onTally → changeProgramInput`. Pays for itself immediately: idempotent commands, clean override merge, trivial resync after an ATEM reconnect (just re-push desired state).

**Example:**
```typescript
// resolver.ts — pure, no I/O
function resolveDesired(
  vmixTally: number[],          // index = vMix input, value = 0|1|2
  mapping: Record<number, number>, // vMixInput -> atemInput
  override: Override | null,
): DesiredAtemState {
  // main-PGM-only: pick the single vMix input currently in program (==1)
  const pgmVmix = vmixTally.findIndex(v => v === 1);
  let program = pgmVmix >= 0 ? mapping[pgmVmix + 1] : undefined;
  let preview = mapping[vmixTally.findIndex(v => v === 2) + 1];

  if (override?.active) {            // override wins
    program = override.program ?? program;
    preview = override.preview ?? preview;
  }
  return { program, preview };
}
```

### Pattern 2: Per-Connector State Machine

**What:** Each connector models its link as an explicit FSM: `disconnected → connecting → connected → reconnecting → connected`, with backoff timers on the reconnect edge. Connection state is first-class data that the Core and UI both observe.
**When to use:** Any long-lived network client where the UI must show link health and the system must auto-recover. Required here.
**Trade-offs:** Note the libraries differ in what they give you: `atem-connection` already runs internal reconnection (it fires `disconnected` only after it fails to recover within ~5s), so the ATEM FSM mostly *reflects* library events. The vMix connector is a raw `net.Socket` — you own the reconnect loop (exponential backoff, capped) entirely.

**Example:**
```typescript
// vMix: you own reconnect; ATEM: you reflect library events
socket.on('close', () => { fsm.to('reconnecting'); scheduleReconnect(); });
atem.on('connected',    () => fsm.to('connected'));
atem.on('disconnected', () => fsm.to('reconnecting')); // lib retries internally
```

### Pattern 3: Layered State Merge for Override (override on top of live)

**What:** Keep live vMix-derived state and manual override as **separate layers**. The resolved output = live, with override applied last. Override is not written into the live state — it shadows it. Clearing the override instantly reveals current live state.
**When to use:** When a human needs to force a tally (testing) without corrupting the source-of-truth feed.
**Trade-offs:** None significant; the alternative (mutating live state with override values) loses the original and breaks the moment vMix sends its next update.

## Data Flow

### Event → Command Flow (the hot path, <100 ms budget)

```
vMix operator takes input live
    ↓  (TCP push, no polling)
vMix Connector: receives "TALLY OK 0121…\r\n"
    ↓  tallyParser → number[]
Core: update live layer → resolver(live, mapping, override) → desiredAtemState
    ↓  (debounce/coalesce burst transitions)
ATEM Connector: diff vs last-sent → changeProgramInput(atemInput, 0)
    ↓                              changePreviewInput(atemInput, 0)
ATEM sets PGM/PV bus → SDI return channel → camera red/green tally
```

Latency notes for the <100 ms budget: vMix TCP push and the ATEM command are both sub-frame; the only self-inflicted latency is debounce. **Keep debounce small (~20–40 ms)** — enough to coalesce a take's burst of TALLY lines, well within budget.

### State → UI Flow

```
Core state change (tally OR connection FSM transition)
    ↓  emit("status", snapshot)
Web UI Server: broadcast snapshot over WebSocket to all clients
    ↓
Browser SPA: re-render live status (which camera red/green, link health)
```

### Config / Override → Core Flow (reverse)

```
Browser: edit mapping / toggle override / set IP:port
    ↓  WS message or REST POST
Web UI Server: validate → forward
    ├─ mapping/conn → Config Store (persist JSON) → Core reloads mapping
    └─ override     → Core override layer → re-resolve → ATEM Connector
```

### Key Data Flows

1. **Tally propagation:** vMix push → parse → live layer → resolve → diff → ATEM command. One-directional, latency-critical.
2. **Status projection:** any Core/FSM change → WS broadcast → browser. One-directional, latency-tolerant.
3. **Control ingress:** browser → server → Core/Config. Reverse direction; override re-enters the hot path via re-resolve.
4. **Reconnect resync:** ATEM `connected` (re)fires → ATEM Connector re-pushes full desired state (don't assume bus survived the drop).

## Suggested Build Order (dependency-driven)

The Core resolver is the keystone and has zero external dependencies, so build it early and against fakes. Connectors can then be developed against the stable Core contract.

1. **Core state + resolver (pure)** — no I/O. Unit-test mapping, PGM-only, override merge. *Depends on: nothing.* De-risks the trickiest logic first.
2. **Config Store** — load/save JSON mapping + settings. *Depends on: schema.* Lets everything else read real mapping.
3. **vMix Connector + parser + FSM** — prove ingest against a real vMix (or a fake TCP server replaying `TALLY OK` lines). *Depends on: Core contract.* This is the first end-to-end "we see tally" milestone.
4. **ATEM Connector + FSM** — drive a real ATEM (or `atem-connection` against hardware/sim). *Depends on: Core desired-state contract.* Completes the hot path: vMix take → camera red.
5. **Web UI Server (status push first)** — read-only live status over WS. *Depends on: Core events.* Gives operator visibility, validates latency.
6. **Web UI control (config + override)** — mapping editor, connection setup, manual override. *Depends on: 2, 4, 5.* Last because it's the richest surface and benefits from a settled Core contract.

Rationale: vMix-in before ATEM-out so you can observe correct *intent* before risking commands to live ATEM hardware; status-UI before control-UI so you can watch the system during connector bring-up.

## Override-vs-Live Precedence Model (for the roadmap)

**Override is a layer that shadows live state; it does not replace or mutate it.** Resolution order is `live → apply mapping → apply override last`. Consequences the roadmap should bake in:

- **Override wins** while active (per-camera or global). This is correct for the "testing" use case in PROJECT.md.
- **Clearing override is instantaneous** — the next resolve returns pure live state, because live was never overwritten.
- **Override survives vMix updates** — incoming TALLY mutates the live layer only; the override layer is untouched, so a flickering vMix feed can't fight a held override.
- **Scope it per ATEM input** so one forced camera doesn't blank the others. Model override as `{ atemInput → forcedState }`, merged over the resolved live map.

## Scaling Considerations

This system is fixed-scale by design (≤8 cameras, one vMix, one ATEM, a handful of UI clients). "Scale" here means robustness, not throughput.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 vMix / 1 ATEM / ≤8 cams (target) | Single process is correct. No DB, no queue, no clustering. In-memory state is the source of truth. |
| Many UI clients (dozens) | WS broadcast is fine; snapshots are tiny. No change needed. |
| Multiple ATEMs / multi-ME (future) | The `me` parameter on `changeProgramInput(input, me)` already supports multiple mix-effects; desired-state would key by `(atemDevice, me)`. Resolver stays pure. |

### Scaling Priorities

1. **First "bottleneck" is reliability, not load:** a dropped vMix or ATEM link mid-show. Mitigation: robust per-connector FSM + backoff + resync-on-reconnect (see Pattern 2).
2. **Second is event storms:** a vMix project with many inputs sending frequent TALLY lines. Mitigation: debounce/coalesce in Core; diff before sending ATEM commands so no-op transitions never hit the wire.

## Anti-Patterns

### Anti-Pattern 1: Wiring vMix events straight to ATEM commands

**What people do:** `vmix.on('tally', t => atem.changeProgramInput(map[t]))` with no central state.
**Why it's wrong:** No place to merge overrides, no idempotency (re-sends identical commands), nothing to resync after an ATEM reconnect, and the PGM-only rule gets smeared across handlers. State becomes implicit and unrecoverable.
**Do this instead:** Route everything through the Core's canonical desired-state and reconcile (Pattern 1).

### Anti-Pattern 2: Treating the ATEM as a real switcher

**What people do:** Worrying about ATEM transitions, AUTO/CUT, downstream keyers, or using its video output.
**Why it's wrong:** Per PROJECT.md the ATEM is a *tally distributor only* — its video output is unused. Tally is derived purely from which input sits on the PGM/PV bus. Cut directly to the bus input; ignore transitions entirely.
**Do this instead:** Use only `changeProgramInput` / `changePreviewInput` (direct bus set). Do not trigger transitions; do not read or rely on ATEM program video.

### Anti-Pattern 3: Polling vMix HTTP/XML (port 8088) for tally

**What people do:** Poll the XML API on a timer because it's easier to parse.
**Why it's wrong:** Polling adds latency and load and can't meet <100 ms reliably; you'll either poll too slow (miss the budget) or too fast (hammer vMix).
**Do this instead:** `SUBSCRIBE TALLY` over TCP 8099 — push-based, sub-frame. (HTTP/XML is acceptable only as a one-time bootstrap to learn input count/names, not for live tally.)

### Anti-Pattern 4: Mutating live state with override values

**What people do:** Write the forced value into the live tally array.
**Why it's wrong:** The original live value is lost; clearing the override can't restore it, and the next vMix update collides unpredictably.
**Do this instead:** Keep override as a separate layer merged last (precedence model above).

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| **vMix** | TCP client to `:8099`, send `SUBSCRIBE TALLY\r\n`, read `\r\n`-terminated UTF-8 lines. Response `TALLY OK <digits>`: digit per input, `0`=off `1`=program `2`=preview, padded to input count (≤1000). | Updates may begin *before* the `SUBSCRIBE OK` ack arrives — buffer/parse defensively. Read-only; never send switching commands (PROJECT.md). |
| **ATEM** | `atem-connection` (`Atem` class). `connect(ip, port?)`; `changeProgramInput(input, me=0)` / `changePreviewInput(input, me=0)` return promises acked by the ATEM. | Library auto-reconnects internally; fires `disconnected` only after ~5 s of failed recovery. On `connected`, re-push desired state (don't trust bus persistence). Handle the `error` event or Node will exit. |
| **Browser SPA** | WebSocket for live status push + control ingress; HTTP for static assets and optional REST config twin. | Snapshots are small; broadcast to all clients. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| vMix Connector ↔ Core | Events in (`tallyChanged`, `connectionStateChanged`) | Connector emits parsed data; Core owns interpretation. |
| Core ↔ ATEM Connector | Desired-state in → connector diffs & dispatches commands; conn-state events out | Connector is a dumb reconciler; all logic lives in Core. |
| Core ↔ Web Server | Status snapshots out; config/override intents in | Web layer never touches connectors directly. |
| Web Server ↔ Config Store | Read on boot, write on change | Only disk-touching path; atomic writes. |

## Sources

- vMix TCP API (official, port 8099, `SUBSCRIBE TALLY`, `TALLY OK <0/1/2 digits>` padded to input count) — https://wp.vmix.com/help28/TCPAPI.html — HIGH
- Sofie `atem-connection` API (`connect`, `changeProgramInput(input, me=0)`, `changePreviewInput(input, me=0)`, `connected`/`disconnected`/`stateChanged`/`error` events, internal ~5 s reconnect) — https://sofie-automation.github.io/sofie-atem-connection/classes/Atem.html and package README — HIGH
- atem-connection on npm — https://www.npmjs.com/package/atem-connection — HIGH
- PROJECT.md (domain constraints: ATEM-as-tally-distributor, PGM-only, <100 ms, ≤8 cams, read-only vMix) — HIGH

---
*Architecture research for: vMix → ATEM real-time tally bridge*
*Researched: 2026-06-29*
