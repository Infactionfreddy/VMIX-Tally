# Project Research Summary

**Project:** vMix → ATEM Tally-Bridge
**Domain:** Real-time broadcast tally bridge (vMix switcher → ATEM-as-tally-distributor → Blackmagic SDI cameras), Node.js server + live web UI
**Researched:** 2026-06-29
**Confidence:** HIGH

## Executive Summary

This is a narrow, single-purpose **tally bridge**: a Node.js server that reads vMix's live/preview state and drives a Blackmagic ATEM's program/preview bus so the ATEM injects correct red/green SDI tally into Blackmagic cameras over the SDI return channel. The reference product in the space (Tally Arbiter) defines the vocabulary — sources, mapping, connection status, web dashboard — but this project deliberately inverts its breadth: **one source (vMix), one transport (ATEM bus), one camera family (Blackmagic SDI)**. The way experts build this is a single-process, event-driven **mediator**: two long-lived client connections (vMix in, ATEM out) feed a central in-memory state store that owns the canonical "desired tally state" and projects it to a browser over WebSocket. There is no database in the hot path; persistence is config-only (mapping table + connection settings as a JSON file).

The single most important architectural decision is to use a **canonical desired-state mediator, not direct command pass-through.** vMix tally events must mutate a central state object; the Core then resolves a complete desired ATEM bus state (resolution order: **live → apply mapping → apply override last**), and the ATEM connector reconciles actual→desired, sending a command only on a diff. This one pattern buys idempotent commands, clean override precedence, and trivial resync after a reconnect. The recommended stack reflects mature, broadcast-grade choices: **`atem-connection`** (Sofie/NRK, the only actively-maintained ATEM library) to drive the bus, **`node-vmix` or a raw `net.Socket`** for the vMix TCP `SUBSCRIBE TALLY` push path, and **`ws` + `fastify` + `lowdb`** for the web/config layer, written as an **ESM** project (lowdb 7 is ESM-only).

The key risks are correctness and reliability, not throughput (the system caps at 8 cameras). Five cross-cutting risks shape requirements: (1) **The three-way mapping chain** — vMix input → ATEM input number → the camera's *internal Camera ID* — where software has zero visibility into the camera-side ID, making a per-input **"walk test" verification feature MVP-critical** as the only way to validate the wiring. (2) The vMix TCP tally string is **positional and 1000-padded, not identity-stable**, so mapping must anchor to vMix input Number/Key (off-by-one and reorder-delete bugs otherwise). (3) Switching must use **instant cuts (`changeProgramInput`) only — never auto/mix transitions**, which briefly light two cameras red. (4) **Resync-on-reconnect** is mandatory: after a drop, tally state is *unknown*, not last-known, so the system must re-fetch full state and re-assert the bus on every reconnect. (5) Manual override and live updates both write the same bus, requiring a **single-writer reconciler with an override layer** to prevent races.

## Key Findings

### Recommended Stack

The stack is mature and well-supported (see `STACK.md`). The two protocol libraries are settled choices with no real competition: `atem-connection` is the de-facto, broadcast-grade ATEM implementation, and the vMix TCP `SUBSCRIBE TALLY` push path (port 8099) is the only way to meet the <100 ms latency budget — HTTP/XML polling (8088) is explicitly rejected for the hot path. The web/config layer is intentionally lean for a LAN tool. The project must be **ESM** (`"type": "module"`) because lowdb 7 is ESM-only — this also affects any future SEA packaging. Windows packaging is the one MEDIUM-confidence area (NSSM service recommended; SEA a nice-to-have once worker-thread bundling is verified).

**Core technologies:**
- **`atem-connection` 3.9** — control ATEM PGM/PVW bus, read state — the only actively maintained, broadcast-grade ATEM library (Sofie/NRK). Has built-in reconnect (~5 s).
- **`node-vmix` 1.7** *(or raw `net.Socket`)* — vMix TCP `SUBSCRIBE TALLY` push client — low-latency state source; raw socket is a defensible lean alternative (~40-line parser, avoids the `axios` transitive dep).
- **`ws` 8.21** — WebSocket server for live status push to the browser — minimal/fastest, no Socket.IO fallback machinery needed on a LAN.
- **`fastify` 5.9** — HTTP server (static SPA + REST config) — fast, built-in schema validation for mapping/config, pino logging.
- **`lowdb` 7** — persist mapping + connection config — a tiny typed JSON file with atomic writes; SQLite is overkill. **ESM-only.**
- **`zod`, `vite`, TypeScript, `vitest`** — payload validation, frontend build (Preact/Svelte or vanilla), type safety on protocol state, unit tests for the resolver.

### Expected Features

From `FEATURES.md`: this is a tally bridge, not a tally hub. Everything routes through one internal per-camera tally-state model — build that spine first. The MVP maps almost 1:1 to PROJECT.md's Active requirements, with one critical addition surfaced by pitfalls research: a **walk-test / tally-verification feature** is MVP-critical, not optional.

**Must have (table stakes):**
- vMix TCP `SUBSCRIBE TALLY` subscription + parse PGM/PV — the live signal source
- ATEM connection + set Program/Preview bus per mapped input — the output (drives both PGM *and* PVW, or green never appears)
- Internal per-camera tally-state model — the spine every feature reads/writes
- Configurable vMix-input → ATEM-input mapping (≤8) with camera labels — the core "mix" function
- Live status dashboard (red/green per camera, WebSocket) — operator trust surface
- Per-endpoint connection status (connected/error/reconnecting) + last-update time — fault visibility
- Connection setup UI (IP/port for both) + config persistence (JSON on disk)
- Auto-reconnect **with state reconciliation on reconnect** — live-safe resilience
- Manual per-camera override with clear precedence + visible/sticky distinction
- **Per-input "walk test" verification** — the only way to validate the un-introspectable Camera-ID link (MVP-critical)

**Should have (competitive, v1.x):**
- Latency / freshness indicator (time-since-last-update → true measured end-to-end p95) — proves the <100 ms claim
- Per-row unmapped-input live warning — catches the silent "camera never lights" config mistake
- Activity/event log + export — post-show debugging ("camera 3 didn't light at 14:02")
- Mapping import/export — near-free from config persistence

**Defer (v2+):**
- Overlay / PiP / multi-source tally via vMix XML API + bus arbitration — breaks latency budget + simplicity
- Multiple ATEM / vMix endpoints — only for multi-room facilities
- Additional sources (OBS, TSL, OSC) — that's Tally Arbiter's job, not this bridge's

### Architecture Approach

From `ARCHITECTURE.md`: a single-process, event-driven **hub-and-spoke / mediator**. Connectors never talk to each other — everything flows through a central Core that owns the canonical desired state. The Core resolver is a **pure function** (`(vMixTally, mapping, override) → desiredAtemState`), making the trickiest logic (mapping, PGM-only rule, override merge) trivially unit-testable with zero I/O. Build order is dependency-driven: Core resolver first (against fakes), then config, then vMix-in (observe correct intent before risking ATEM commands), then ATEM-out, then status-UI, then control-UI.

**Major components:**
1. **vMix Connector** — owns TCP socket to :8099, `SUBSCRIBE TALLY`, parses `TALLY OK <digits>` → per-input states, owns its own reconnect FSM (raw socket = you own the loop).
2. **Core / Resolver (mediator)** — canonical state: live tally layer + override layer; applies mapping + debounce; computes the single desired ATEM bus state; emits to ATEM connector and UI. Pure, no I/O.
3. **ATEM Connector** — `atem-connection` wrapper; reconciles actual→desired via `changeProgramInput`/`changePreviewInput` (idempotent, diff-before-send); reflects library reconnect events into an FSM.
4. **Web UI Server** — Fastify static SPA + `ws` status push + REST/WS config/override ingress; a thin projection — never drives the ATEM directly (override goes *through* the Core).
5. **Config Store** — the only disk-touching component; load on boot, atomic write-temp-then-rename on change.

### Critical Pitfalls

Top items from `PITFALLS.md` (the highest-risk, requirements-shaping ones):

1. **Camera ID vs. ATEM SDI input mismatch (#1, highest risk)** — ATEM tally is an *addressed broadcast* down every SDI out; each camera self-selects by its internal Camera ID, which software cannot introspect or validate. **Avoid:** model mapping as an explicit three-column chain (vMix input → ATEM input # → expected Camera ID), document "set each camera's ID to its ATEM SDI input number," and ship a **walk-test** that drives one ATEM input to program at a time so the operator confirms the right physical camera lights.
2. **vMix tally string is positional + 1000-padded, not identity-stable (#2)** — slicing the `TALLY OK ` header wrong = off-by-one; positions shift when inputs are added/deleted mid-show. **Avoid:** anchor mapping to vMix input **Number/Key** (fetch from XML at config time), use the TCP string only as a fast state signal, and unit-test against captured real strings.
3. **ATEM transitions flash two cameras red (#4)** — an auto/mix transition reports both old and new input as program. **Avoid:** instant **cut semantics only** (`changeProgramInput`), never `autoTransition`; verify green/preview tally actually emits on the target ATEM model; leave keyers/DSK/aux untouched.
4. **Reconnect storms + stale state (#5)** — a dropped link means *unknown* state, not last-known; naive retry hammers the device and replays stale tally. **Avoid:** exponential backoff + jitter (cap ~5–10 s); on (re)connect, re-fetch full state and re-assert desired bus before resuming; gate ATEM commands behind "connected AND state hydrated."
5. **Manual override races with live updates (#6)** — two writers to one bus, last-writer-wins nondeterministically. **Avoid:** a single-writer reconciler with a separate override layer applied last (override wins, visibly sticky, explicitly released) — the reconciler must exist *before* override is added.
6. **Blowing the <100 ms budget (#7)** — caused by XML polling, per-event XML refetch, command thrash, or hot-path blocking. **Avoid:** TCP push only; diff/coalesce before sending; keep the hot path non-blocking; measure p95, don't assume.

## Implications for Roadmap

Based on combined research, suggested phase structure (dependency-driven, mirroring the architecture build order). The Core resolver is the keystone with zero external dependencies — build and de-risk it first against fakes.

### Phase 1: Core State + Resolver (the spine)
**Rationale:** Pure logic, zero I/O, depends on nothing — the part most likely to harbor bugs (mapping, PGM-handling, override precedence). Building it first lets every connector develop against a stable, tested contract.
**Delivers:** `tallyState` store (live + override layers), pure `resolver(vmixTally, mapping, override) → desiredAtemState`, typed event contracts, debounce/coalesce, config schema.
**Addresses:** internal tally-state model; mapping data shape (the three-column chain); override precedence (`live → mapping → override`).
**Avoids:** Pitfall #6 (single authoritative desired-state with override layer designed in from the start); Anti-Pattern 1 (no direct pass-through).

### Phase 2: Config Store
**Rationale:** Tiny and "boring," but it blocks the usability of two table-stakes features (connection setup + mapping). Everything downstream needs real persisted mapping/settings.
**Delivers:** `lowdb` JSON load-on-boot / atomic-write-on-change; zod/schema validation; mapping import/export falls out near-free.
**Uses:** `lowdb` 7 (ESM), `zod`. **Implements:** Config Store component.

### Phase 3: vMix Connector + Parser + Identity Model
**Rationale:** Ingest before egress — observe correct *intent* before risking commands to a live ATEM. First end-to-end "we see tally" milestone.
**Delivers:** TCP socket to :8099, `SUBSCRIBE TALLY`, `TALLY OK <digits>` parser, connection FSM + owned reconnect loop, vMix-Number/Key identity resolution (XML at config time), capture-and-replay test fixtures.
**Uses:** `node-vmix` or raw `net.Socket`. **Implements:** vMix Connector.
**Avoids:** Pitfall #2 (off-by-one / position-as-identity); Pitfall #3 (per-input mirroring, program-wins precedence); Anti-Pattern 3 (no XML polling in hot path).

### Phase 4: ATEM Connector + Walk-Test Verification
**Rationale:** Completes the hot path (vMix take → camera red) and pairs it with the highest-risk verification feature. The walk test belongs here because it's the only way to validate the un-introspectable Camera-ID chain on real hardware.
**Delivers:** `atem-connection` wrapper, diff-before-send reconciler, `changeProgramInput`/`changePreviewInput` (cut-only), connection FSM reflecting library events, resync-on-reconnect, **per-input walk-test mode**, hot-path latency instrumentation (timestamp tally-in → command-sent).
**Uses:** `atem-connection` 3.9. **Implements:** ATEM Connector.
**Avoids:** Pitfall #1 (walk test validates Camera-ID wiring); Pitfall #4 (cut-only, green verified on hardware); Pitfall #7 (diff/coalesce, measured latency); Anti-Pattern 2 (ATEM as tally distributor only).

### Phase 5: Reliability — Reconnect + Resync Hardening
**Rationale:** Auto-reconnect is a requirement, but it's incomplete without state reconciliation; harden both endpoints once both connectors exist. (May be folded into Phases 3–4 as each connector's FSM is built, then validated end-to-end here.)
**Delivers:** backoff + jitter on both links, full-state resync on (re)connect, "connected AND hydrated" command gating, safe outage behavior (freeze vs clear, loud DISCONNECTED), cable-pull test passing.
**Avoids:** Pitfall #5 (reconnect storm + stale state).

### Phase 6: Web UI — Status First, Then Control
**Rationale:** Status-UI before control-UI so the operator can watch the system during connector bring-up; the richest surface benefits from a settled Core contract. Manual override must route *through* the Core (single writer).
**Delivers:** live red/green status grid, per-endpoint connection status + last-update time, latency/health readout; then mapping editor (showing the 3-way chain), connection setup, **manual override (sticky, visibly distinct, release control)**, unmapped-input warnings.
**Uses:** `ws`, `fastify`, `@fastify/static`, Preact/Svelte/vanilla, `vite`. **Implements:** Web UI Server.
**Avoids:** Pitfall #6 (override through Core, visibly sticky); UX pitfalls (loud disconnect, Camera-ID requirement surfaced, latency readout).

### Phase 7: Packaging & Production Deploy (Windows)
**Rationale:** "Live in production" needs survive-reboot / restart-on-crash behavior; deferred last since approach is operational, not architectural.
**Delivers:** `tsup`/esbuild server bundle, NSSM service registration (auto-start, auto-restart), structured pino logs off the hot path; optionally Node SEA `.exe` once worker-thread bundling is verified.
**Uses:** NSSM, `tsup`. (MEDIUM-confidence area.)

### Phase Ordering Rationale

- **Dependency order from architecture:** Core resolver (no deps) → Config → vMix-in → ATEM-out → reliability → UI → packaging. Connectors develop against a stable, pre-tested Core contract.
- **Ingest before egress:** observing correct intent (vMix tally → resolved desired state) before issuing commands to live ATEM hardware de-risks the irreversible-on-air step.
- **Verification paired with output:** the walk test ships with the ATEM connector because Camera-ID validation is the single highest-risk item and is meaningless without real bus control.
- **Status-UI before control-UI:** gives operator visibility during bring-up and lets the latency claim be validated before the override surface (which must route through the settled Core).

### Research Flags

Phases likely needing deeper research during planning (`/gsd:plan-phase --research-phase <N>`):
- **Phase 4 (ATEM Connector + walk test):** MEDIUM-confidence lifecycle details — `connected`-before-`state` ordering, `changePreviewInput` green-tally behavior, and cut-vs-transition derivation must be verified against the *installed* library version and the *actual* ATEM model. Walk-test UX for an un-introspectable link is non-obvious.
- **Phase 3 (vMix Connector):** the positional-string identity model and overlay/multi-program edge cases warrant capturing real tally fixtures and confirming Number/Key reconciliation behavior.
- **Phase 7 (Windows packaging):** MEDIUM confidence — NSSM vs SEA vs node-windows is an operational choice; SEA + atem-connection worker-thread bundling needs verification.

Phases with standard patterns (can likely skip research-phase):
- **Phase 1 (Core/resolver):** pure TypeScript logic, well-understood; spec it from ARCHITECTURE.md.
- **Phase 2 (Config Store):** trivial lowdb JSON persistence, established pattern.
- **Phase 6 (Web UI):** standard Fastify + ws + small SPA; well-documented.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Protocol libraries (atem-connection, vMix TCP API) verified against official/maintainer docs and npm; only Windows packaging is MEDIUM (multiple valid paths). |
| Features | HIGH | Core tally semantics, vMix TCP format, and ATEM bus model verified against official docs and the reference product (Tally Arbiter). |
| Architecture | HIGH | vMix TCP protocol and atem-connection API both verified against official sources; mediator/desired-state pattern is standard for this class of bridge. |
| Pitfalls | MEDIUM-HIGH | vMix format + ATEM tally mechanics verified against vendor docs; atem-connection lifecycle/transition-tally specifics are MEDIUM and must be confirmed against the installed library + real ATEM during integration. |

**Overall confidence:** HIGH

### Gaps to Address

- **Camera-ID link is un-introspectable.** Software cannot validate which physical camera lights for a given ATEM input. **Handle:** make it a first-class config dimension and ship the walk test in MVP (Phase 4); document the "Camera ID = ATEM SDI input number" rule in UI + docs.
- **atem-connection lifecycle details (MEDIUM).** `connected`-before-`state` hydration ordering and `changePreviewInput` green-tally behavior vary. **Handle:** verify against the installed library version and the actual ATEM model early in Phase 4; gate commands on a hydration flag.
- **Green/preview tally per ATEM model/mode.** May behave differently in cut-bus vs program/preview mode. **Handle:** verify on target hardware in Phase 4; add to the "looks done but isn't" checklist.
- **Overlay/multi-program reality vs simplified scope.** The tally string can report multiple program inputs (and overlay-on-program may report `2`). **Handle:** mirror per-input state faithfully, define program-wins precedence, and surface the policy in the UI (Phase 3) rather than collapsing to "the one program input."
- **<100 ms budget is unproven until measured.** **Handle:** instrument tally-in→command-sent p95 in Phase 4 and surface it in the UI; validate on the real LAN under rapid switching, not "feels fast."
- **Windows packaging (MEDIUM).** **Handle:** default to NSSM service in Phase 7; treat SEA as optional pending worker-thread bundling verification.

## Sources

### Primary (HIGH confidence)
- vMix TCP API (official) — https://wp.vmix.com/help28/TCPAPI.html — `SUBSCRIBE TALLY`, port 8099, `0/1/2` padded-to-input-count format, push semantics, ~1011-byte max
- Sofie `atem-connection` (README + API docs + npm) — https://github.com/nrkno/sofie-atem-connection , https://www.npmjs.com/package/atem-connection — `connect`, `changeProgramInput`/`changePreviewInput(input, me=0)`, `connected`/`disconnected`/`stateChanged`/`error` events, internal ~5 s reconnect
- "How ATEM Tally Works" (1 Source Video) — https://1sourcevideo.com/shop/pub/media/manuals/How-ATEM-Tally-Works.pdf — tally addressed by Camera ID matching SDI input, broadcast identically on all SDI outs incl. aux
- Tally Arbiter (reference product) — https://tallyarbiter.com/ , https://github.com/josephdadams/TallyArbiter — feature vocabulary, connection-status convention, device mapping
- npm registry — verified current versions/publish dates for atem-connection 3.9.0, node-vmix 1.7.1, ws 8.21.0, fastify 5.9.0, lowdb 7.0.1, vite 8.1.0

### Secondary (MEDIUM confidence)
- node-vmix (jensstigaard) — https://github.com/jensstigaard/node-vmix — `ConnectionTCP`, `tally` event, no-feedback TCP caveat, axios transitive dep
- ATEM SDI getting started (Blackmagic) — https://www.blackmagicdesign.com/products/atemsdi/gettingstarted — program bus always live, cut-bus vs program/preview mode
- vMix forums — overlay tally reporting `2` instead of `1` — https://forums.vmix.com/posts/t15916-Overlay-Tallys-and-the-vMix-API
- Node.js SEA docs — https://nodejs.org — Stability 1.1, Windows `.exe`, native-addon/ESM caveats; NSSM/PM2/node-windows for service install

### Tertiary (LOW confidence / needs validation)
- atem-connection transition-tally + `connected`-before-`state` ordering — must be confirmed against installed library version and real ATEM model during Phase 4

---
*Research completed: 2026-06-29*
*Ready for roadmap: yes*
