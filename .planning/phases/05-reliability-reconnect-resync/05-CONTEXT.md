# Phase 5: Reliability — Reconnect + Resync - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Both TCP links (vMix port 8099 + ATEM Ethernet) survive drops mid-show. This phase
adds controlled reconnect loops with exponential backoff/jitter to both connectors
and ensures every reconnect ends with a correct re-assertion of current desired state.

**In scope:** Replace `node-vmix` `ConnectionTCP` with a raw `net.Socket` + custom
backoff loop in `VmixConnector` (preserving its event interface); add `'disconnected'`
handler and `'ready'` event to `AtemConnector` with isHydrated reset + backoff;
server.ts wires `'ready'` → re-assert; backoff utility (shared or inline, 1s/30s/±25%
jitter); cable-pull test documented in VERIFICATION.md.

**Out of scope (other phases):** Web UI indicators for connection health (Phase 6
UI-02), latency dashboard (Phase 6 UI-05), manual override (Phase 6), walk-test UI
(Phase 6).

</domain>

<decisions>
## Implementation Decisions

### ATEM Hydration Reset

- **D-01:** `AtemConnector` sets `isHydrated = false` on **every `'disconnected'`
  event** from `atem-connection` — no distinction between graceful shutdown and
  unexpected drops. On the next reconnect, the Phase 4 hydration flow (first
  `stateChanged` → flush `pendingState`) runs again from scratch. Simple, safe,
  no special-case logic.

### ATEM Re-Assert on Reconnect

- **D-02:** `AtemConnector` emits a **`'ready'`** event when `isHydrated` flips to
  `true` (both initial connect and every subsequent reconnect). `server.ts` listens:
  ```
  atemConnector.on('ready', () =>
    atemConnector.applyState(orchestrator.currentState, Date.now())
  )
  ```
  This re-asserts the full current desired state after every ATEM reconnect. The
  `Date.now()` timestamp is synthetic (no real tally event triggered this) — latency
  logging on this path is informational only.

### Backoff Parameters (both links)

- **D-03:** Both vMix (TCP) and ATEM links use **identical backoff parameters**:
  - Initial delay: **1 s**
  - Max delay: **30 s**
  - Jitter: **±25%** (multiply final delay by `1 + (Math.random() - 0.5) * 0.5`)
  - Formula: `min(initialDelay * 2^attempt, maxDelay) * (0.75 + Math.random() * 0.5)`
  
  Same parameters on both links — both are LAN devices, no reason for asymmetry.
  Keeps the backoff logic DRY (one utility function or inline — planner's choice).

### vMix Reconnect Transport Replacement

- **D-04:** Phase 5 **replaces `node-vmix` `ConnectionTCP` with a raw `node:net`
  `Socket`** in `VmixConnector`. The tally parsing layer (Phase 3: `parseTallyString`,
  `parseRosterXml`, `buildRuntimeMapping`) is **unchanged** — only the TCP connection
  mechanism is replaced. The `VmixConnector` event interface (`'tally'`,
  `'rosterUpdated'`) is **preserved** — upstream consumers (`TallyOrchestrator`) need
  no changes.

  Rationale: `node-vmix`'s reconnect interval is a hardcoded protected field and
  cannot be overridden without fragile monkey-patching. A raw `net.Socket` gives full
  control over the backoff loop and re-subscribe timing (D-07 Phase 3 seam resolved).

- **D-05:** The raw socket implementation handles newline-delimited framing manually
  (`data` event accumulates into a line buffer; lines are dispatched on `\r\n`).
  The `TALLY OK <digits>` line is passed to `parseTallyString` (unchanged from Phase 3).
  On `'connect'`: send `SUBSCRIBE TALLY\r\n` + call `fetchRoster()` (unchanged from
  Phase 3). On `'close'`/`'error'`: start backoff loop, do NOT call SUBSCRIBE again
  until next `'connect'`.

- **D-06:** The HTTP roster fetch (`fetchRoster()` via native fetch, Phase 3 D-06)
  is **unchanged**. It is triggered after each successful TCP reconnect, same as in
  Phase 3. No separate retry logic for the HTTP fetch — if it fails, `parseRosterXml`
  returns an empty Map and the orchestrator holds last known tally (Phase 3 D-03).

### Phase 4 Module Changes

- **D-07:** Phase 5 modifies **two existing modules** from Phase 4:
  - `src/vmix/VmixConnector.ts` — TCP transport replaced (D-04/D-05); event
    interface and constructor signature unchanged.
  - `src/atem/AtemConnector.ts` — adds `'disconnected'` handler (D-01), `'ready'`
    event emission (D-02), backoff loop around `atem.connect()`.
  
  No new module required for Phase 5. The backoff utility can be inlined or extracted
  to a small helper — Claude's discretion.

### Claude's Discretion

- Whether the backoff utility is a standalone `src/utils/backoff.ts` or inlined in
  each connector.
- Whether `node-vmix` package is removed from `package.json` in Phase 5 or left as a
  transitive dep. (If removed: `axios` dependency disappears too — leaner bundle.)
- Exact buffer-accumulation strategy for raw socket framing (string accumulation vs
  `Buffer` + `indexOf`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap (this phase)

- `.planning/REQUIREMENTS.md` — VMIX-04 (vMix backoff reconnect), ATEM-04 (ATEM
  reconnect + full state resync).
- `.planning/ROADMAP.md` §"Phase 5" — goal + 4 success criteria; depends on Phase 4.

### Phase 4 module contracts (what Phase 5 modifies)

- `.planning/phases/04-atem-output-walk-test-end-to-end-mvp-slice/04-CONTEXT.md` —
  D-03/D-04 (hydration gate, pendingState flush — Phase 5 resets isHydrated on
  disconnect); D-02 (fail-open startup — Phase 5 adds backoff); D-01 (server.ts
  'ready' listener is Phase 5's re-assert trigger).

### Phase 3 contracts (VmixConnector interface must be preserved)

- `.planning/phases/03-vmix-live-ingest/03-CONTEXT.md` — D-07 (this seam resolved
  here: raw socket replaces ConnectionTCP); D-09 (VmixConnector event interface
  preserved: 'tally' + 'rosterUpdated'); D-14 (re-resolve on 'rosterUpdated' still
  triggered after reconnect — same mechanism).

### Stack decisions

- `CLAUDE.md` §"Alternatives Considered" — `node:net` raw socket vs `node-vmix` for
  tally ingest: "~40 lines, full reconnect control, no axios, leaner Windows
  packaging. Strong, defensible option for a single-purpose production tool."

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (unchanged by Phase 5)

- `src/vmix/parseTallyString.ts` — unchanged; raw socket passes the same digit string.
- `src/vmix/parseRosterXml.ts` + `fetchRoster()` — unchanged; triggered after reconnect.
- `src/vmix/buildRuntimeMapping.ts` — unchanged.
- `src/core/tallyState.ts` `TallyStateReconciler` — unchanged; AtemConnector.applyState()
  still uses it.

### Modules Modified by Phase 5

- `src/vmix/VmixConnector.ts` — TCP internals replaced; public interface preserved.
- `src/atem/AtemConnector.ts` — 'disconnected' handler + 'ready' event + backoff loop added.
- `src/server.ts` — adds `atemConnector.on('ready', ...)` listener for re-assert.

### Integration Points

- **Phase 5 does not change any module interfaces** — only internal reconnect logic.
  TallyOrchestrator, server.ts event wiring, and all tests from Phases 3–4 continue
  to work unchanged at the API level.

</code_context>

<specifics>
## Specific Ideas

- **node-vmix removal:** If the raw socket replaces ConnectionTCP completely,
  `node-vmix` can be removed from `package.json` — which also removes the `axios`
  transitive dependency. Cleaner Windows packaging (CLAUDE.md). Researcher/planner
  should verify that no other Phase 3/4 code depends on node-vmix before removing.
- **SC3 (cable-pull test):** The verification plan must include a manual cable-pull
  procedure — unplug vMix or ATEM LAN cable, observe reconnect via pino logs, verify
  tally is correct after recovery. This cannot be automated in unit tests.
- **Backoff jitter formula must NOT use `Math.random()` in pure-function tests** —
  inject a seeded random for unit-testing the backoff sequence.

</specifics>

<deferred>
## Deferred Ideas

- **Connection health indicators in the web UI** — Phase 6 UI-02. Phase 5 logs
  reconnect events via pino; UI visualization is Phase 6.
- **Per-link configurable backoff parameters** — deferred, same parameters on both
  links is sufficient for v1.
- **vMix SUBSCRIBE ACTS for roster changes** — deferred from Phase 3; still deferred
  to v2. Raw socket does not change this analysis.

</deferred>

---

*Phase: 5-reliability-reconnect-resync*
*Context gathered: 2026-07-01*
