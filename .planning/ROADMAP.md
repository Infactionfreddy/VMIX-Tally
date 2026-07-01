# Roadmap: vMix → ATEM Tally-Bridge

## Overview

Build a single-process Node.js bridge that mirrors vMix's live/preview state onto an ATEM's program/preview bus so Blackmagic cameras get correct red/green SDI tally in under 100 ms. The journey is dependency-driven: forge the pure desired-state resolver (the keystone, zero I/O) first, give it real persisted config, then wire ingest (vMix) before egress (ATEM). Phase 4 lands the first observable end-to-end slice — vMix take → real camera lights red — paired with the MVP-critical walk-test that validates the un-introspectable Camera-ID chain. Reliability (reconnect + resync) then hardens both links, and the web UI closes the loop with status-first, then control surfaces (mapping editor, manual override) routed through the Core's single writer.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Core Resolver + Tally State Spine** - Pure desired-state resolver (live → mapping → override) with single-writer diff reconciler, no I/O (completed 2026-06-29)
- [ ] **Phase 2: Config Persistence + Mapping Model** - Persisted vMix/ATEM settings and identity-anchored vMix→ATEM input mapping (≤8)
- [ ] **Phase 3: vMix Live Ingest** - TCP SUBSCRIBE TALLY push client, defensive parser, stable input-identity resolution
- [ ] **Phase 4: ATEM Output + Walk-Test (end-to-end MVP slice)** - Cut-only ATEM bus control driving real red/green tally, walk-test verification, <100 ms latency proven
- [ ] **Phase 5: Reliability — Reconnect + Resync** - Backoff/jitter reconnect on both links with full-state resync, hydration-gated commands
- [ ] **Phase 6: Web UI — Status then Control** - Live red/green dashboard, connection health, latency readout, then mapping editor, connection setup, manual override

## Phase Details

### Phase 1: Core Resolver + Tally State Spine

**Goal**: A pure, fully-tested desired-state engine that owns canonical per-camera tally and resolves the single correct ATEM bus state with no external I/O.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04
**Success Criteria** (what must be TRUE):

  1. Given a vMix tally array, a mapping, and an override, the resolver returns exactly one desired `{program, preview}` ATEM bus state (verified by unit tests).
  2. Resolution precedence is observably `live → mapping → override last`: an active override wins over live, and clearing it instantly reveals current live state (live never mutated).
  3. Only the main PGM/PVW input drives tally; overlay/PiP/multi-program states are mirrored per-input with program-wins precedence, never collapsed to one input.
  4. The reconciler emits an ATEM command only when desired differs from last-sent (idempotent diff), proven by a no-op-on-unchanged test.
  5. Canonical state models every camera as exactly one of off / program / preview.

**Plans**: 3 plans

- [x] 01-01-PLAN.md — Project foundation (strict-TS ESM + vitest) + typed output contract (per-camera map, ATEM bus, contended sidecar)
- [x] 01-02-PLAN.md — Keystone resolver: full precedence chain (override→live-program→preview→off, lowest-ATEM-# arbitration) + exhaustive D-04..D-13 tests
- [x] 01-03-PLAN.md — Single-writer diff reconciler (last-sent ownership, no-op-on-unchanged, per-field change report)

### Phase 2: Config Persistence + Mapping Model

**Goal**: vMix/ATEM connection settings and the vMix-input → ATEM-input mapping survive restarts, anchored to stable identities rather than volatile string positions.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CFG-01, CFG-02, MAP-01
**Success Criteria** (what must be TRUE):

  1. User can define a mapping of each vMix input to an ATEM input/camera (up to 8) anchored on vMix input Number/Key, not raw string offset.
  2. After a server restart, the previously saved vMix/ATEM IP/port settings are still present.
  3. After a server restart, the previously saved input mapping is still present and intact.
  4. Config writes are atomic (write-temp-then-rename) so a crash mid-save never corrupts the stored mapping or settings.

**Plans**: TBD

### Phase 3: vMix Live Ingest

**Goal**: The bridge connects to vMix, subscribes to tally push, and feeds correct per-input live state into the Core — observing intent before any command touches the ATEM.
**Mode:** mvp
**Depends on**: Phase 1, Phase 2
**Requirements**: VMIX-01, VMIX-02, VMIX-03
**Success Criteria** (what must be TRUE):

  1. Server connects to vMix over TCP (port 8099) using the configured host/port and issues `SUBSCRIBE TALLY`.
  2. When the vMix operator takes an input live or to preview, the server receives the push and the Core's live layer updates in real time (no polling).
  3. Each tally string position resolves to a stable vMix input Number/Key; the parser strips the `TALLY OK ` prefix correctly and passes captured-string regression tests (incl. empty roster and reorder/delete).
  4. Adding or deleting a vMix input mid-session does not shift tally to the wrong camera.

**Plans**: 3 plans
Plans:
**Wave 1**

- [ ] 03-01-PLAN.md — Pure-function contracts (parseTallyString, parseRosterXml, buildRuntimeMapping) + vmixHttpPort schema extension

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 03-02-PLAN.md — Install node-vmix + pino; VmixConnector EventEmitter (TCP + HTTP roster, typed events)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 03-03-PLAN.md — tallyOrchestrator wiring VmixConnector → resolve → in-memory ResolverOutput + pino logging

### Phase 4: ATEM Output + Walk-Test (end-to-end MVP slice)

**Goal**: Close the hot path — a vMix take lights the correct real Blackmagic camera red (and preview green) via cut-only ATEM bus control — and ship the walk-test that validates the Camera-ID chain.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: ATEM-01, ATEM-02, ATEM-03, VERIFY-01, REL-01
**Success Criteria** (what must be TRUE):

  1. Server connects to the ATEM via its Ethernet protocol at the configured IP and gates commands on connected-AND-hydrated.
  2. When vMix takes a mapped input live, the correct camera shows red SDI tally via a hard cut (`changeProgramInput`) — never an auto/mix transition, so two cameras never flash red.
  3. When vMix puts a mapped input to preview, the correct camera shows green SDI tally (`changePreviewInput`), verified on the target ATEM model.
  4. User can run a per-input walk-test that drives each mapped ATEM input to program in turn, confirming the right physical camera lights.
  5. Measured p95 latency from vMix tally-in to ATEM command-sent stays under 100 ms under rapid switching on the real LAN.

**Plans**: TBD

### Phase 5: Reliability — Reconnect + Resync

**Goal**: Both links survive drops mid-show: auto-reconnect with backoff/jitter, and on every reconnect the system re-asserts current desired state rather than replaying stale tally.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: VMIX-04, ATEM-04
**Success Criteria** (what must be TRUE):

  1. After a vMix link drop, the server reconnects automatically using exponential backoff with jitter (no tight reconnect-storm loop), then re-fetches a full TALLY snapshot.
  2. After an ATEM link drop, the server reconnects and re-asserts the full desired bus state on reconnect (does not trust bus persistence).
  3. A cable-pull test on either endpoint results in tally reflecting current state after recovery, not pre-drop state.
  4. No ATEM command is sent in the connected-but-not-yet-hydrated window.

**Plans**: TBD

### Phase 6: Web UI — Status then Control

**Goal**: The operator gets a live trust surface — who is red/green, link health, latency — then control: configure connections, edit mapping (showing the 3-way chain), and force/release per-camera override through the Core.
**Mode:** mvp
**Depends on**: Phase 2, Phase 4, Phase 5
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):

  1. User sees a real-time dashboard showing which camera is currently red and which is green, pushed over WebSocket.
  2. User sees prominent per-endpoint connection status/health for vMix and ATEM, with a loud DISCONNECTED state and last-update time.
  3. User sees a latency/freshness indicator for the tally pipeline.
  4. User can configure vMix and ATEM IP/port in the web UI (persisted via Phase 2).
  5. User can manually force tally for a single camera — sticky, visually distinct, one-click releasable — routed through the Core so a live vMix change cannot silently stomp it.

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core Resolver + Tally State Spine | 3/3 | Complete   | 2026-06-29 |
| 2. Config Persistence + Mapping Model | 1/3 | In Progress|  |
| 3. vMix Live Ingest | 0/3 | Not started | - |
| 4. ATEM Output + Walk-Test | 0/TBD | Not started | - |
| 5. Reliability — Reconnect + Resync | 0/TBD | Not started | - |
| 6. Web UI — Status then Control | 0/TBD | Not started | - |
