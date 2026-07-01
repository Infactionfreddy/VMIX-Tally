---
phase: 03-vmix-live-ingest
plan: 02
subsystem: vmix
tags: [node-vmix, tcp, eventemitter, tally, roster, reconnect, pino, testing]

dependency_graph:
  requires:
    - phase: 03-01
      provides: parseTallyString, fetchRoster, parseRosterXml — pure functions consumed by VmixConnector
  provides:
    - VmixConnector: EventEmitter wrapping ConnectionTCP, emits typed 'tally' and 'rosterUpdated' events
    - TallyEventData interface: { rawTally: number[], rosterLength: number }
    - TcpConnection interface: testability seam for ConnectionTCP injection
    - node-vmix 1.7.1 installed in package.json
  affects:
    - 03-03 (tallyOrchestrator wires VmixConnector events to buildRuntimeMapping + resolver)
    - 04-xx (ATEM phase: tallyOrchestrator feeds resolved bus state to AtemConnector)

tech-stack:
  added:
    - node-vmix 1.7.1 (TCP SUBSCRIBE TALLY client — ConnectionTCP)
  patterns:
    - tcpFactory constructor injection: optional factory param defaults to real ConnectionTCP; tests inject mock (avoids vi.mock ESM hoisting)
    - EventEmitter subclass with private async handlers using void operator on async methods
    - Length-sentinel pattern: currentRosterLength=-1 resets on every connect, forces fresh comparison without false resync
    - T-03-11 no-op stub: host.length<3 logs error and assigns no-op TcpConnection instead of crashing (ApiUrlError guard)

key-files:
  created:
    - src/vmix/VmixConnector.ts
    - src/vmix/VmixConnector.test.ts
  modified:
    - package.json (node-vmix added to dependencies)
    - package-lock.json

key-decisions:
  - "tcpFactory injection preferred over vi.mock('node-vmix') — avoids ESM module hoisting complexity with CJS interop"
  - "TcpConnection interface exported (not just internal) — enables test mocking without importing ConnectionTCP in tests"
  - "currentRosterLength sentinel=-1 on every connect — prevents false D-02 resync on first tally push after reconnect"
  - "No-op stub for host.length<3 guard (T-03-11) — logs error, assigns stub TcpConnection; cleaner than try/catch around constructor"

patterns-established:
  - "EventEmitter subclass: void this.asyncMethod() in sync event callback to prevent unhandled promise rejections"
  - "TcpFactory injection: (host, port) => TcpConnection optional constructor param for testable TCP wrappers"
  - "Length-change resync gate: D-02 check skipped when sentinel=-1 (first post-connect push)"

requirements-completed: [VMIX-01, VMIX-02]

duration: ~12min
completed: 2026-07-01
---

# Phase 03 Plan 02: VmixConnector EventEmitter Summary

**node-vmix TCP SUBSCRIBE TALLY client wrapped in an EventEmitter that emits typed 'tally' and 'rosterUpdated' events, with roster re-sync on length change and no all-off flash (D-02/D-03)**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-01T07:17:00Z
- **Completed:** 2026-07-01T07:29:31Z
- **Tasks:** 2 (Task 1: install deps, Task 2: implementation + tests)
- **Files modified:** 4

## Accomplishments

- node-vmix 1.7.1 installed and verified importable as named ESM from CJS interop
- VmixConnector EventEmitter wraps ConnectionTCP via tcpFactory injection — connects to vMix over TCP, sends SUBSCRIBE TALLY inside every 'connect' handler (including after reconnect)
- Emits typed 'tally' { rawTally, rosterLength } on every push and 'rosterUpdated' Map copy on connect and after roster re-sync
- Roster re-sync on tally length change (D-02): holds tally emission until async fetchRoster completes (D-03 — no all-off flash)
- 14 unit tests covering VMIX-01, VMIX-02, D-02/D-03, roster copy ownership, T-03-11 host guard
- Full test suite: 140 tests passing (0 regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install node-vmix 1.7.1** — `d61da91` (chore)
2. **Task 2: VmixConnector + tests** — `c99862c` (feat)

## Files Created/Modified

- `src/vmix/VmixConnector.ts` — EventEmitter subclass: TcpConnection interface, TallyEventData interface, VmixConnector class with handleConnect/handleTally/resync private methods
- `src/vmix/VmixConnector.test.ts` — 14 unit tests: VMIX-01 subscribe/reconnect, VMIX-02 tally events, D-02/D-03 resync, roster copy, T-03-11 host guard
- `package.json` — node-vmix 1.7.1 added to dependencies
- `package-lock.json` — updated lockfile

## Decisions Made

**tcpFactory injection over vi.mock:** node-vmix is CJS; mocking it via vi.mock in an ESM project requires `__mocks__` directory + hoisting. Constructor injection with an optional `tcpFactory` parameter is simpler, avoids module mock machinery, and the plan explicitly approved this approach.

**TcpConnection interface exported:** Exported as a public interface (not just used internally) so test files can type mock objects without importing `ConnectionTCP`. This also makes the testability seam explicit.

**Length sentinel -1 on every connect:** `currentRosterLength` resets to -1 on each `connect` event. The first tally push after any connect always sets the length and emits without triggering a D-02 resync — this prevents false resyncs after reconnect when the roster hasn't actually changed.

**No-op stub for T-03-11:** Instead of try/catch around `new ConnectionTCP(...)`, the constructor checks `host.length < 3` early, logs an error, and assigns a `{ on: noop, send: noop, shutdown: noop }` stub. This keeps the TCP field always initialized and avoids TypeScript definite assignment complexity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Exported TcpConnection interface**

- **Found during:** Task 2 (writing VmixConnector tests)
- **Issue:** The plan specifies a tcpFactory parameter but doesn't mention exporting a TcpConnection interface. Without a named interface, tests must import ConnectionTCP just to type the mock, re-introducing the CJS coupling the factory was meant to avoid.
- **Fix:** Exported `TcpConnection` interface alongside `TallyEventData` and `VmixConnector`. Tests import only the interface (no ConnectionTCP import needed).
- **Files modified:** `src/vmix/VmixConnector.ts`
- **Committed in:** c99862c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical testability interface)
**Impact on plan:** Additive only — adds an exported interface. No logic changes, no scope creep.

## Issues Encountered

None. The tcpFactory injection pattern compiled and tested cleanly on first attempt. node-vmix CJS → ESM named import worked without type augmentation shims (skipLibCheck covers any declaration file gaps).

## User Setup Required

None — no external service configuration required. node-vmix is a client library; the actual vMix instance is external but no setup is needed to install/test the connector.

## Known Stubs

None. VmixConnector is fully implemented with no placeholders. The connector will not produce events until connected to a real vMix instance, but the code path is complete.

## Threat Flags

No new threat surface beyond the plan's threat model. All T-03-xx mitigations confirmed:

- T-03-07: parseTallyString coerces unknown chars to 0 (implemented in Plan 01)
- T-03-10: fetchRoster has AbortSignal.timeout(5000) (implemented in Plan 01); if it hangs, SUBSCRIBE TALLY is delayed to the next reconnect
- T-03-11: host.length < 3 guard implemented — logs error, no ApiUrlError crash

## Next Phase Readiness

- VmixConnector is ready for tallyOrchestrator (Plan 03) to wire up: listen to 'tally' and 'rosterUpdated' events and feed them through `buildRuntimeMapping` + resolver
- The connector accepts any Logger (pino-compatible) — tallyOrchestrator creates the pino instance and injects it
- Test suite at 140 tests, clean TypeScript

---
*Phase: 03-vmix-live-ingest*
*Completed: 2026-07-01*

## Self-Check

### Files exist:
- src/vmix/VmixConnector.ts — FOUND
- src/vmix/VmixConnector.test.ts — FOUND
- package.json (modified) — FOUND

### Commits exist:
- d61da91 — Task 1 (install node-vmix) — to verify
- c99862c — Task 2 (VmixConnector + tests) — to verify

## Self-Check: PASSED
