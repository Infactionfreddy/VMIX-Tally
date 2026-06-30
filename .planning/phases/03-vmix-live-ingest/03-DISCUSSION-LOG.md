# Phase 3: vMix Live Ingest - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 3-vmix-live-ingest
**Areas discussed:** Input roster sync, TCP transport, Connector integration

---

## Input Roster Sync

### Initial roster fetch

| Option | Description | Selected |
|--------|-------------|----------|
| HTTP XML fetch | GET vMix port 8088 — guaranteed to include Key (GUID), Number, Title | ✓ |
| TCP INPUTLIST command | Issue INPUTLIST over TCP port 8099 — may not include Key field | |
| Defer to researcher | Let researcher verify which has confirmed Key support | |

**User's choice:** HTTP XML fetch
**Notes:** Clean dual-transport split — TCP for tally events, HTTP for roster data.

### Mid-session roster reactivity

| Option | Description | Selected |
|--------|-------------|----------|
| Re-sync on TALLY length change | Re-fetch HTTP roster when tally string length changes | ✓ |
| Subscribe to vMix ACTS events | SUBSCRIBE ACTS over TCP; more semantically correct but needs verification | |
| Re-sync on connect only | Simpler; leaves SC4 partially unmet for mid-session changes | |

**User's choice:** Re-sync on TALLY length change

### Re-sync window behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Hold last known tally | Keep last resolved tally active until re-fetch completes — no flash | ✓ |
| Emit all-off while re-syncing | Zero tally during re-sync window; technically safer but operator-visible | |

**User's choice:** Hold last known tally

### Missing vmixKey behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Silently drop from runtime mapping | Camera gets no tally; persisted config unchanged; recovers if Key returns | ✓ |
| Log a warning + drop | Emit structured log event alongside the silent drop | |

**User's choice:** Silently drop
**Notes:** Mirrors Phase 1 D-10 unmapped-input behavior — consistency over noise.

---

## TCP Transport

### Transport library choice

| Option | Description | Selected |
|--------|-------------|----------|
| Raw net.Socket | ~40 lines, full reconnect control, no axios, leaner Windows packaging | |
| node-vmix library | ConnectionTCP + tally event; pulls axios transitively | ✓ |

**User's choice:** node-vmix library
**Notes:** Simplicity wins for Phase 3. Phase 5 evaluates whether node-vmix's reconnect API is sufficient; if not, transport can be replaced then.

### HTTP roster client

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal native fetch / http.get | Node 22 native fetch — no extra library | ✓ |
| Reuse axios | Only relevant if node-vmix is chosen; adds 500KB for one HTTP call path | |

**User's choice:** Native fetch

### Phase 5 reconnect seam

| Option | Description | Selected |
|--------|-------------|----------|
| Use node-vmix directly, replace in Phase 5 | Keep Phase 3 simple; Phase 5 decides | ✓ |
| Wrap node-vmix with reconnect hook now | Phase 5 plugs in via wrapper; more future-proof | |

**User's choice:** Use node-vmix directly

### vmixHttpPort config

| Option | Description | Selected |
|--------|-------------|----------|
| Separately configurable | New optional vmixHttpPort field in Phase 2 schema, default 8088 | ✓ |
| Derive from TCP port | HTTP port = TCP port − 11 (8099−11=8088); one less config field | |

**User's choice:** Separately configurable
**Notes:** Phase 3 extends src/config/schema.ts with an optional vmixHttpPort field on the vMix connection schema (backward-compatible addition, default 8088).

---

## Connector Integration

### Handoff pattern

| Option | Description | Selected |
|--------|-------------|----------|
| EventEmitter: raw tally + roster events | VmixConnector emits 'tally' and 'rosterUpdated'; orchestrator assembles | ✓ |
| Connector calls resolver directly | VmixConnector holds ConfigStore + Resolver references; couples vmix/ to core/ | |

**User's choice:** EventEmitter (emit raw tally + roster)

### Key→position translation location

| Option | Description | Selected |
|--------|-------------|----------|
| Separate translation module | buildRuntimeMapping() pure function in src/vmix/ — easily testable | ✓ |
| Inside VmixConnector | Connector emits already-translated MappingEntry[]; fewer moving parts | |

**User's choice:** Separate translation module

### Phase 3 orchestrator output

| Option | Description | Selected |
|--------|-------------|----------|
| Store as current state + log | Orchestrator stores ResolverOutput in memory, logs via pino; Phase 4 observes | ✓ |
| Stop at tally parsing | Phase 3 delivers parse + translation only; full resolver call is Phase 4's job | |

**User's choice:** Store as current state + log

### Integration test approach

| Option | Description | Selected |
|--------|-------------|----------|
| Inject pre-captured TALLY strings | Feed raw strings into parser/translation, bypassing node-vmix transport | ✓ |
| Mock TCP server | Spin up in-process TCP server; more realistic but heavier | |

**User's choice:** Pre-captured TALLY strings
**Notes:** STATE.md flagged this as important — real edge-case fixtures (reorder, delete) are a Phase 3 deliverable.

---

## Claude's Discretion

- Exact module filenames within `src/vmix/` (VmixConnector.ts, buildRuntimeMapping.ts, etc.)
- XML parsing approach for HTTP roster response (built-in DOMParser, fast-xml-parser, or regex scan)
- Whether VmixConnector extends EventEmitter directly or uses a typed emitter wrapper
- Whether in-memory current desired state is a simple property or a light observer pattern

## Deferred Ideas

- SUBSCRIBE ACTS for roster changes — more semantically correct but needs vMix API verification; deferred to Phase 5/research backlog
- Reconnect with backoff/jitter (VMIX-04) — Phase 5
- vMix ACTS/FUNCTION subscriptions beyond TALLY — v2
