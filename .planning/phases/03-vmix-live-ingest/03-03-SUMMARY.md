---
phase: 03-vmix-live-ingest
plan: 03
subsystem: vmix
tags: [orchestrator, eventemitter, tally, resolver, pino, logging, vertical-slice]
dependency_graph:
  requires:
    - 03-01 (buildRuntimeMapping, PersistedMappingEntry, parseTallyString)
    - 03-02 (VmixConnector EventEmitter, TallyEventData, TcpConnection)
    - 01-01 (resolve() function, MappingEntry, ResolverOutput from core/)
    - 02-01 (PersistedMappingEntry type from config/schema.ts)
  provides:
    - TallyOrchestrator class: Phase 3 vertical slice wiring VmixConnector → resolve → in-memory state
    - ConfigStoreReader interface: testability seam for the Phase 2 configStore.ts (not yet implemented)
    - 'stateChanged' event: Phase 4 hookup point — subscribe to receive ResolverOutput on each tally change
    - currentDesiredState() getter: Phase 4 polling interface
  affects:
    - 04-xx (AtemConnector: subscribe to 'stateChanged' or poll currentDesiredState())
    - 02-02 (ConfigStore implementation must satisfy ConfigStoreReader interface)
    - 06-xx (Phase 6 override UI: will call configStore.setOverrides(); orchestrator will pass them to resolve())
tech_stack:
  added: []
  patterns:
    - ConfigStoreReader interface: minimal interface the orchestrator requires — mirrors TcpConnection pattern from VmixConnector (D-12 testability seam)
    - T-03-14 mitigation: handleTally body wrapped in try/catch — logs error, returns without crashing process
    - EventEmitter subclass: same pattern as VmixConnector (Plan 02)
    - connectorFactory injection: optional factory param for VmixConnector — testability seam, avoids TCP in tests
    - Phase 3 observable output: pino structured JSON to stdout on every tally state change
key_files:
  created:
    - src/vmix/tallyOrchestrator.ts
  modified: []
decisions:
  - "ConfigStoreReader interface defined in tallyOrchestrator.ts (not configStore.ts): configStore.ts does not exist yet (Phase 2 Plan 02-02 not yet run); the interface makes the orchestrator implementable and testable without the concrete store — mirrors TcpConnection pattern"
  - "connectorFactory optional constructor param: same testability seam pattern as VmixConnector's tcpFactory — avoids real TCP in unit tests of the orchestrator"
  - "busChanged comparison gates pino .info log: avoids log spam on identical tally pushes while still logging every state change; .debug for unchanged pushes"
  - "stateCopy spread before emitting 'stateChanged': prevents Phase 4 subscribers from mutating the orchestrator's internal currentState"
  - "Empty host ('') for no-settings case: triggers VmixConnector's T-03-11 guard (host.length < 3) — cleaner than try/catch in constructor"
metrics:
  duration: "~2 minutes"
  completed: "2026-07-01"
  tasks: 2
  files: 1
---

# Phase 03 Plan 03: TallyOrchestrator Vertical Slice Summary

**One-liner:** TallyOrchestrator EventEmitter wires VmixConnector 'tally' events through buildRuntimeMapping and resolve() into in-memory ResolverOutput with pino structured logging and a 'stateChanged' event for Phase 4, completing the Phase 3 vertical slice.

## What Was Built

### Task 1: Read ConfigStore API (discovery step)

Result: `configStore.ts` does not exist in the codebase yet — it is planned for Phase 2 Plan 02-02 but that plan has not been executed. The orchestrator was designed around a `ConfigStoreReader` interface (see Task 2 deviation below).

`grep -n "export" src/config/configStore.ts` confirms: file does not exist.

### Task 2: TallyOrchestrator implementation (commit: 1e5bbf9)

**`src/vmix/tallyOrchestrator.ts`** — 236 lines. Exports:

- `ConfigStoreReader` interface: `getMapping(): PersistedMappingEntry[]` + `getVmixSettings(): { host, port, vmixHttpPort? } | null`
- `TallyOrchestrator` class: EventEmitter subclass

Constructor:
- Accepts `configStore: ConfigStoreReader`, optional `logger?: pino.Logger` (default `pino()` for production), optional `connectorFactory` (testability seam for VmixConnector injection)
- Creates `VmixConnector` from `configStore.getVmixSettings()` — applies `?? 8088` D-08 default for vmixHttpPort
- Registers `'tally'` and `'rosterUpdated'` listeners on the connector

`handleTally(data: TallyEventData)` — private, called on every 'tally' event:
1. `configStore.getMapping()` → `PersistedMappingEntry[]` (synchronous, in-memory)
2. `buildRuntimeMapping(persisted, this.connector.roster())` → `MappingEntry[]`
3. `resolve(data.rawTally, runtimeMapping, [] as OverrideEntry[])` → `ResolverOutput`
4. Stores as `this.currentState`
5. `pino.info` with `{ bus, cameras, rosterLength, prevBus }` when bus state changes; `pino.debug` for unchanged
6. Emits `'stateChanged'` with a spread-copy of the new state
7. T-03-14: entire body in try/catch — errors logged, process never crashes

Public API:
- `currentDesiredState(): ResolverOutput | null` — Phase 4 polling getter
- `shutdown(): void` — closes TCP connection

## Verification

All plan verification steps confirmed:

1. Full suite: **140 tests green** (0 regressions — no new test file needed for this plan per plan design; orchestrator is integration-layer wiring)
2. TypeScript: `npx tsc --noEmit` exits 0
3. Boundary check — only tallyOrchestrator.ts makes runtime imports from core/:
   - `buildRuntimeMapping.ts` has `import type { MappingEntry }` (type-only, erased at compile time — pre-existing from Plan 01, acceptable per 03-01 SUMMARY)
   - `VmixConnector.ts` grep match is a comment line only — zero actual imports
   - `tallyOrchestrator.ts` is the only file with runtime value imports from core/
4. Phase 3 SC verification:
   - SC1: VmixConnector tests prove TCP connect + SUBSCRIBE TALLY (VMIX-01)
   - SC2: VmixConnector tests prove 'tally' event fires on push (VMIX-02)
   - SC3: parseTallyString tests prove regression suite including empty roster and non-0/1/2 coercion (VMIX-03)
   - SC4: buildRuntimeMapping test with reorderedRoster proves Key-reorder invariant
5. `grep -c "stateChanged" src/vmix/tallyOrchestrator.ts` → 6 (emit + type + comment references)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] ConfigStoreReader interface added — configStore.ts not yet implemented**

- **Found during:** Task 1 — discovery step confirmed `src/config/configStore.ts` does not exist
- **Issue:** The plan's Task 1 says to "read src/config/configStore.ts to extract the exact method signature." The file does not exist — Phase 2 Plan 02-02 has not been executed yet.
- **Fix:** Defined a `ConfigStoreReader` interface exported from `tallyOrchestrator.ts` based on the Phase 2 Plan 02-02 specification. The interface requires two synchronous methods: `getMapping(): PersistedMappingEntry[]` and `getVmixSettings(): { host, port, vmixHttpPort? } | null`. This is the same testability-seam pattern used for `TcpConnection` in VmixConnector (Plan 02).
- **Impact:** Additive only — exports one additional interface. Phase 2 Plan 02-02's `ConfigStore` must satisfy this interface when implemented. No existing tests modified.
- **Commit:** 1e5bbf9

**2. [Rule 2 - Missing Critical Functionality] connectorFactory optional constructor param added**

- **Found during:** Task 2 — implementing the constructor
- **Issue:** The plan specifies Logger injection for testability but does not mention VmixConnector injection. Without a VmixConnector factory, any unit test of TallyOrchestrator would create a real TCP connection to vMix — which fails in CI and makes tests slow/flaky.
- **Fix:** Added optional `connectorFactory?: (logger: Logger) => VmixConnector` constructor param. When provided, the factory is used instead of constructing from configStore settings. This mirrors the `tcpFactory` pattern from VmixConnector (Plan 02).
- **Files modified:** `src/vmix/tallyOrchestrator.ts`
- **Commit:** 1e5bbf9 (included in main task commit)

**3. [Rule 2 - Missing Critical Functionality] T-03-14 handleTally try/catch mitigation**

- **Found during:** Task 2 — threat model review
- **Issue:** The plan's threat model (T-03-14) explicitly requires wrapping handleTally in try/catch to prevent process crash. This was flagged with `mitigate` disposition.
- **Fix:** Entire `handleTally` body wrapped in try/catch; `logger.error` on unexpected exception, then return (no rethrow). EventEmitter's default 'error' behavior (uncaught exception → process crash) is prevented.
- **Files modified:** `src/vmix/tallyOrchestrator.ts`
- **Commit:** 1e5bbf9

## Known Stubs

None. The orchestrator is fully wired. It will not produce log output until connected to a real vMix instance, but the code path from 'tally' event through buildRuntimeMapping → resolve → emit 'stateChanged' is complete.

The `configStore.ts` implementation remains pending (Phase 2 Plan 02-02) — but the orchestrator is fully testable via `ConfigStoreReader` injection in the meantime.

## Threat Flags

No new security-relevant surface introduced beyond the plan's threat model. All T-03-xx mitigations confirmed:

- T-03-12: rawTally already sanitized by parseTallyString; resolve() has its own coerceTally guard — double-guarded
- T-03-13: configStore.getMapping() returns zod-validated data (Phase 2 schema enforcement); stale mapping is safe
- T-03-14: try/catch wraps handleTally body — implemented
- T-03-15: pino structured logs to stdout; LAN tool; no PII/secrets in tally data — accepted
- T-03-16: handleTally is synchronous (getMapping is sync, resolve is pure); O(n) where n<=8 — sub-millisecond

## Self-Check

### Files exist:
- src/vmix/tallyOrchestrator.ts — FOUND (236 lines)

### Commits exist:
- 1e5bbf9 — Task 2 (TallyOrchestrator + ConfigStoreReader) — FOUND

### Acceptance criteria:
- `export class TallyOrchestrator` present: YES (1 match)
- Only tallyOrchestrator.ts has runtime imports from core/ (buildRuntimeMapping has type-only import, pre-existing): YES
- Overrides `[]` present: YES (11 matches — in resolve() call + comments)
- 'stateChanged' emitted: YES (emit call present)
- currentDesiredState() method: YES
- 140 tests passing: YES
- TypeScript clean: YES

## Self-Check: PASSED
