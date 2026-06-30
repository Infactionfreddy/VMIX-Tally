# Phase 3: vMix Live Ingest - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

The vMix TCP connector — connects to vMix, subscribes to tally push, and feeds
correct per-input live state into the Core. This is the first I/O-touching module
in the project (Core and Config are pure/disk-only; vMix ingest is the first
network-attached module).

**In scope:** node-vmix TCP connection + SUBSCRIBE TALLY subscription; HTTP XML
roster fetch (Key→Number mapping); TALLY string parser (strip `TALLY OK ` prefix,
produce positional `number[]`); Key→position translation (buildRuntimeMapping);
orchestrator that calls the resolver, stores current ResolverOutput in memory,
and logs state changes; mid-session roster re-sync on TALLY length change;
schema extension for `vmixHttpPort`; regression tests with pre-captured TALLY
fixtures (empty roster, reorder, delete).

**Out of scope (other phases):** ATEM connection or commands (Phase 4), reconnect
with backoff/jitter (Phase 5), web UI or WebSocket push (Phase 6), vMix HTTP
polling as a primary tally source (explicitly out per CLAUDE.md — TCP push only).

</domain>

<decisions>
## Implementation Decisions

### Input Roster Sync

- **D-01:** On initial connect, fetch the vMix input roster via **HTTP GET to
  vMix port 8088** (e.g. `http://{host}:{httpPort}/api`). The HTTP XML response
  is guaranteed to include `vmixKey` (GUID), `vmixNumber`, and `vmixTitle` per
  input. The TCP API (port 8099) is used only for TALLY push — dual-transport
  split: HTTP for roster data, TCP for tally events.

- **D-02:** During a running session, **re-sync the roster when the TALLY string
  length changes** (character count = input count). A length change means an
  input was added or deleted; Phase 3 immediately re-fetches the HTTP roster and
  rebuilds the Key→position lookup. This satisfies SC4 ("add/delete mid-session
  does not shift tally to the wrong camera").

- **D-03:** During the re-sync window (TALLY length changed, HTTP re-fetch
  in-flight): **hold the last known tally state**. No all-off flash, no stale
  camera flicker. Safe for live production.

- **D-04:** When a `vmixKey` from the persisted config is **not found** in the
  refreshed vMix input roster (input was deleted from vMix): **silently drop it
  from the runtime mapping**. That camera gets no tally (same as D-10 from Phase
  1 — unmapped input is ignored). The persisted config is unchanged; if the
  operator re-adds an input with the same Key it becomes active again. No loud
  error logged for this case.

### TCP Transport

- **D-05:** Use **`node-vmix` library** (`ConnectionTCP`) for the TCP connection
  and TALLY push subscription. `node-vmix` wraps the socket, handles framing, and
  emits a parsed `tally` event. Trade-off accepted: axios is a transitive
  dependency (node-vmix uses it for its HTTP module even when only TCP is used).

- **D-06:** The **HTTP roster fetch uses Node 22 native `fetch`** — no axios on
  this path. One GET to `http://{host}:{httpPort}/api`, parse the XML response.
  Keeps the HTTP path lean; avoids pulling axios transitively for the roster logic.

- **D-07 (Phase 5 seam):** Phase 3 uses node-vmix **directly** (no wrapper that
  adds reconnect hooks). If Phase 5 needs controlled backoff/jitter that cannot
  be achieved via node-vmix's existing reconnect API, Phase 5 may replace the
  transport. This is a deliberate "keep Phase 3 simple" decision; Phase 5 evaluates
  the seam with full information.

- **D-08:** The vMix HTTP port is **separately configurable** — a new optional
  `vmixHttpPort` field (default: 8088) added to the vMix connection schema in
  `src/config/schema.ts`. This extends the Phase 2 schema without breaking
  existing stored configs (optional field, safe backward-compatible addition).

### Connector Integration

- **D-09:** `VmixConnector` (in `src/vmix/`) is an **EventEmitter** that emits:
  - `'tally'` → `{ rawTally: number[], rosterLength: number }` — the positional
    tally array (one entry per vMix input, 0/1/2) from the TALLY OK push.
  - `'rosterUpdated'` → `Map<string, number>` — current Key→Number mapping
    after a roster fetch.
  
  `VmixConnector` knows only the vMix protocol. It does NOT import from `core/`
  or call the resolver directly — that would couple vmix/ to core/.

- **D-10:** Key→position translation lives in a **separate pure function**
  `buildRuntimeMapping(persisted: PersistedMappingEntry[], roster: Map<string,
  number>): MappingEntry[]` in `src/vmix/` (or `src/vmix/buildRuntimeMapping.ts`).
  For each persisted entry, looks up the current `vmixNumber` by `vmixKey`; if
  not found, silently drops the entry (D-04). Returns the resolver's `MappingEntry[]`
  (positional `vmixInput: number`). Pure function, easily unit-tested with fixture data.

- **D-11:** The Phase 3 **orchestrator** (e.g. `src/vmix/tallyOrchestrator.ts` or
  similar — naming at Claude's discretion) listens to VmixConnector events, calls
  `buildRuntimeMapping`, calls `resolve(tally, mapping, overrides)`, and stores the
  latest `ResolverOutput` in memory as "current desired state". It logs each change
  via pino. Phase 4 plugs in by observing this in-memory state to send ATEM commands.
  In Phase 3 alone, the observable behavior is: tally changes are resolved and logged.

- **D-12:** Phase 3 **integration tests inject pre-captured TALLY strings directly**
  into the parser/translation logic, bypassing the node-vmix transport layer. Test
  fixtures must cover: empty roster (`TALLY OK `), normal tally with camera on program
  and preview, vMix Number reorder (same Key, different position), and mid-session
  delete (Key disappears from roster, length changes). STATE.md flagged this as
  important — capturing realistic edge-case fixtures is a key deliverable.

### Claude's Discretion

- Exact module filenames within `src/vmix/` (e.g. `VmixConnector.ts`,
  `buildRuntimeMapping.ts`, `tallyOrchestrator.ts` — or a single `index.ts` façade).
- The XML parsing approach for the HTTP roster response (Node's built-in DOMParser,
  `fast-xml-parser`, or a regex scan for `<input key="..." number="..."/>` — all
  defensible given the simple data shape needed).
- Whether `VmixConnector` extends `EventEmitter` directly or uses a typed emitter
  wrapper (`EventEmitter3`, `mitt`, or typed overloads on the native emitter).
- Whether the in-memory "current desired state" in the orchestrator is a simple
  property or uses a simple observer pattern for Phase 4 hookup.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap (this phase)

- `.planning/REQUIREMENTS.md` — VMIX-01 (TCP connect, configurable host/port),
  VMIX-02 (subscribe tally, receive push in real time), VMIX-03 (resolve each
  tally position to stable vMix Key, regression tests, reorder/delete).
- `.planning/ROADMAP.md` §"Phase 3" — goal + 4 success criteria; phase depends on
  Phase 1 and Phase 2.

### Phase 2 config schema (must be extended for vmixHttpPort)

- `src/config/schema.ts` — `PersistedMappingEntry` (vmixKey anchor, D-01), the
  connection sub-schema (host + port) that Phase 3 extends with optional
  `vmixHttpPort` (D-08). **Must NOT break existing valid configs** — extension must
  be backward-compatible (optional field with default 8088).
- `.planning/phases/02-config-persistence-mapping-model/02-CONTEXT.md` §`<decisions>`
  D-01/D-02 (vmixKey is the stable match key; vmixNumber is a display hint), D-03
  (positional-vmixInput seam — this is the seam Phase 3 resolves), D-10 (reject
  whole save on constraint violation).

### Phase 1 resolver contract (what Phase 3 feeds)

- `src/core/resolver.ts` — `MappingEntry { vmixInput: number, atemSource: number,
  cameraId: string }` (the positional contract that `buildRuntimeMapping` must
  produce), `VmixTally = readonly number[]` (the tally array Phase 3 produces).
- `src/core/events.ts` — `ResolverOutput` (what the orchestrator stores and logs),
  `CameraTallyMap`, `DesiredAtemBusState`.

### Stack decisions

- `CLAUDE.md` §"Recommended Stack" — node-vmix 1.7.1 rationale, axios transitive
  dependency caveat, node-vmix vs raw socket comparison; §"Key API Shapes" — vMix
  TCP API SUBSCRIBE TALLY protocol, `TALLY OK <digits>` format, TALLY push
  semantics, port 8099.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/core/resolver.ts` — `resolve(tally, mapping, overrides)` is the function
  Phase 3's orchestrator calls on each TALLY push. The `VmixTally` type and
  `MappingEntry` interface are exported from here; `buildRuntimeMapping` must
  produce entries that match `MappingEntry` exactly.
- `src/config/schema.ts` — `PersistedMappingEntry` (with `vmixKey`, `atemSource`,
  `cameraId`) is the shape Phase 3's `buildRuntimeMapping` consumes from the config
  store. Phase 3 extends this schema by adding optional `vmixHttpPort` to the
  connection sub-schema.

### Established Patterns

- Strict-TS ESM project (`"type": "module"`), vitest for tests, no build/dist step
  (pure source). node-vmix (ESM-compatible) and native fetch both fit cleanly.
- `config/` is the ONLY disk-touching module; `core/` is pure. Phase 3 introduces
  `vmix/` as the ONLY network-touching module. `core/` must not import from `vmix/`
  or `config/`.
- Defensive total-function stance (D-13 from Phase 1) carries into the vMix layer:
  a malformed TALLY OK string, an empty roster, or a failed HTTP fetch must never
  crash the process — degrade to safe state.
- pino is the project logger (comes with Fastify, established in CLAUDE.md). Use it
  for roster-sync events, tally-change logs, and HTTP/TCP connection state changes.

### Integration Points

- **Consumes:** `ConfigStore` (Phase 2) for persisted mapping + vmixHttpPort;
  `resolve()` (Phase 1) for the live tally→desired-state step.
- **Produces:** In-memory `ResolverOutput` (current desired state) that Phase 4
  will observe to send ATEM commands.
- **D-03 seam resolution:** Phase 3 is the layer that bridges the persisted
  Key-anchored mapping (Phase 2) and the resolver's positional `vmixInput: number`
  (Phase 1). The `buildRuntimeMapping` pure function is the exact resolution point.

</code_context>

<specifics>
## Specific Ideas

- **Key reorder regression test:** persist a mapping (Key→Camera), simulate a vMix
  Number reorder (same Key now at a different position in the roster), push a TALLY
  string reflecting the new position, and assert the correct camera still resolves
  to program/preview. This is the SC4 test — the reason Key-anchoring was chosen.
- **TALLY length-change re-sync test:** simulate an input delete (roster shrinks by
  one, TALLY string shortens), assert the connector initiates a re-sync and holds
  last tally during the window.
- The `vmixHttpPort` schema extension in Phase 3 should be verified with a
  `tsc --noEmit` + `vitest --run` pass that includes a new invariant test for the
  backward-compatible default.
- Pre-captured TALLY strings (real fixtures) are a Phase 3 deliverable — they serve
  as regression tests for edge cases that are hard to reproduce synthetically (e.g.
  vMix roster with deleted inputs mid-string).

</specifics>

<deferred>
## Deferred Ideas

- **SUBSCRIBE ACTS for roster change events** — more semantically correct than
  length-change detection, but depends on verifying which ACTS events fire on roster
  changes; deferred to Phase 5/research backlog.
- **Reconnect with backoff/jitter** (VMIX-04) — explicitly Phase 5. Phase 3 ships
  direct node-vmix usage; Phase 5 evaluates whether node-vmix's reconnect API
  suffices or whether the transport needs replacement.
- **vMix ACTS/FUNCTION subscriptions beyond TALLY** — future feature for richer
  vMix state (e.g. recording status, overlay states); deferred to v2.

None of the above is in Phase 3 scope — discussion stayed within the vMix ingest
boundary.

</deferred>

---

*Phase: 3-vmix-live-ingest*
*Context gathered: 2026-07-01*
