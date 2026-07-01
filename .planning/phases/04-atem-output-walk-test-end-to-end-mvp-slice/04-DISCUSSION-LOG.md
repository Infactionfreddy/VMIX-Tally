# Phase 4: ATEM Output + Walk-Test - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 04-atem-output-walk-test-end-to-end-mvp-slice
**Areas discussed:** Server-Einstiegspunkt + Verdrahtung, ATEM Hydration-Gate, Walk-Test-Trigger, Latenz-Messung

---

## Server-Einstiegspunkt + Verdrahtung

### Entry point location

| Option | Description | Selected |
|--------|-------------|----------|
| src/server.ts | Classic server bootstrap, creates all modules and wires them. | ✓ |
| src/index.ts | Ambiguous — module index vs server start. | |

**User's choice:** src/server.ts

### Wiring pattern

| Option | Description | Selected |
|--------|-------------|----------|
| AtemConnector subscribes to 'stateChanged' | server.ts wires via event listener. Loose coupling — AtemConnector knows no orchestrator. | ✓ |
| AtemConnector holds Orchestrator reference | Tighter coupling, harder to test in isolation. | |

**User's choice:** Event subscription — `orchestrator.on('stateChanged', state => atemConnector.applyState(state))`

### Startup behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-open: start, log errors, keep running | Server starts immediately; connection errors logged via pino. Phase 5 adds backoff. | ✓ |
| Wait for config before starting | Blocks on hardware availability — unnecessary for Phase 4. | |

**Decision captured:** D-01, D-02 in CONTEXT.md

---

## ATEM Hydration-Gate

### Hydration detection

| Option | Description | Selected |
|--------|-------------|----------|
| First 'stateChanged' event | Library semantics: state is populated when first stateChanged fires. | ✓ |
| Fixed timeout after 'connected' | Fragile on slow LANs or slow ATEMs. | |
| State.version field check | Depends on library internals — researcher must verify. | |

**User's choice:** First `atem-connection` `stateChanged` event

### Pre-hydration commands

| Option | Description | Selected |
|--------|-------------|----------|
| Queue latest state, flush on hydrate | pendingState stores most recent ResolverOutput. Flushed immediately on isHydrated=true. | ✓ |
| Ignore until hydrated, wait for next push | Startup window with unknown ATEM state — risky in production. | |

**Decision captured:** D-03, D-04 in CONTEXT.md

---

## Walk-Test-Trigger (VERIFY-01)

### Trigger mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Fastify + GET /walk-test | Introduces Fastify early; Phase 6 expands it. curl-triggerable. | ✓ |
| Stdin command | Unintuitive, hard to automate. | |

**User's choice:** Fastify `GET /walk-test` — Phase 4 introduces Fastify with this single route

### Walk-test behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Sequential, ~2s per camera, changeProgramInput | Each mapped camera on program 2s, then next. Last camera stays. Simple, visually clear. | ✓ |
| Manual list — operator switches in vMix | No automated sequence, full operator control. | |

**User's choice:** Sequential, ~2 s per camera, `changeProgramInput(0, atemSource)`

### Reconciler usage

| Option | Description | Selected |
|--------|-------------|----------|
| Bypass reconciler — direct AtemConnector | Walk-test is diagnostic, not live tally. No reconciler state pollution. | ✓ |
| Use Core override mechanism | Override management is Phase 6 scope (UI-04). Overkill for a diagnostic tool. | |

**Decision captured:** D-05, D-06, D-07 in CONTEXT.md

---

## Latenz-Messung (REL-01)

### Measurement approach

| Option | Description | Selected |
|--------|-------------|----------|
| pino-Log mit latencyMs-Feld | TallyOrchestrator stamps tallyReceivedAt; AtemConnector logs latencyMs at command send. | ✓ |
| In-Memory-Accumulator + GET /metrics | More comfortable but more code — Phase 6 UI-05 can do this later. | |

**User's choice:** pino structured logging with `latencyMs` field per command

### Timestamp propagation

| Option | Description | Selected |
|--------|-------------|----------|
| tallyReceivedAt in 'stateChanged' payload | { newState, tallyReceivedAt } — timestamp travels through the pipeline. Clean. | ✓ |
| Global Map / AsyncLocalStorage | Complex, error-prone in async code. | |

**User's choice:** `tallyReceivedAt: number` added to `'stateChanged'` event payload

### D-15 update

| Option | Description | Selected |
|--------|-------------|----------|
| Update Phase 3 CONTEXT.md D-15 | Phase 3 CONTEXT.md is the authoritative interface definition — update it. | ✓ |
| Only note in Phase 4 CONTEXT.md | Inconsistency between phase contexts — confusing for downstream agents. | |

**User's choice:** Phase 3 D-15 updated to reflect `{ newState: ResolverOutput, tallyReceivedAt: number }`

**Decision captured:** D-08, D-09 in CONTEXT.md

---

## Claude's Discretion

- Exact filenames within `src/atem/`
- Fastify port (3000 default, env `PORT`)
- Walk-test dwell time (1–2 s; 2 s recommended)
- Whether `AtemConnector` extends EventEmitter (defer to Phase 5)
- Mix-effect hardcoded as `0` (ME1)

## Deferred Ideas

- ATEM reconnect/backoff — Phase 5
- Latency dashboard — Phase 6 UI-05
- Manual override UI — Phase 6 UI-04
- GET /metrics for p50/p95 — Phase 6
