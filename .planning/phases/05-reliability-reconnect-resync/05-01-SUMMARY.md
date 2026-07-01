---
phase: 05-reliability-reconnect-resync
plan: 01
subsystem: vmix
tags: [reconnect, backoff, node-net, tdd, reliability]
dependency_graph:
  requires: [03-02]
  provides: [VMIX-04-raw-socket-backoff]
  affects: [src/vmix/VmixConnector.ts, src/vmix/VmixConnector.test.ts]
tech_stack:
  added: []
  removed: [node-vmix, axios (transitive)]
  patterns: [exponential-backoff-with-jitter, single-timer-invariant, raw-tcp-line-framing]
key_files:
  created: []
  modified:
    - src/vmix/VmixConnector.ts
    - src/vmix/VmixConnector.test.ts
    - package.json
    - package-lock.json
    - src/server.ts
decisions:
  - "Inline backoff formula in VmixConnector (not shared utility) — 2-line formula, cleaner per-connector context"
  - "shutdown() aliased to destroy() for backward compat with Phase 3 callers"
  - "silenceErrors() helper added to test file to prevent unhandled error throw on mockSocket during RED phase"
  - "connector.destroy() called at end of each Phase 3 test to prevent real-timer cross-test contamination"
  - "VMIX-01 reconnect test uses vi.useFakeTimers() to control backoff timer without real delay"
metrics:
  duration_minutes: 13
  completed_date: "2026-07-01"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 5
---

# Phase 5 Plan 01: VmixConnector Raw Socket Backoff Summary

Raw node:net Socket replacing node-vmix ConnectionTCP in VmixConnector, with exponential backoff reconnect loop (1s/30s/±25% jitter) and single-timer invariant.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add failing VMIX-04 backoff tests (TDD RED) | e6c3578 | src/vmix/VmixConnector.test.ts |
| 2 | Replace ConnectionTCP with node:net Socket + backoff (TDD GREEN) | 60a4cb2 | src/vmix/VmixConnector.ts, VmixConnector.test.ts, package.json, package-lock.json, src/server.ts |

## What Was Built

**VmixConnector rewrite (src/vmix/VmixConnector.ts):**
- Removed `import { ConnectionTCP } from 'node-vmix'` and `TcpConnection` interface
- Added `import { createConnection } from 'node:net'` and `import type { Socket }`
- New private fields: `socket`, `attempt`, `retryTimer`, `destroyed`, `lineBuffer`
- `createSocket()` private method: creates fresh socket on every attempt, registers handlers
- `backoffDelay()`: `min(1000 * 2^attempt, 30000) * (0.75 + Math.random() * 0.5)` (D-03)
- `scheduleReconnect()`: triggered from `'close'` handler ONLY (single-timer invariant)
- `'error'` handler: `sock.destroy()` + log — never calls `scheduleReconnect()`
- `'data'` handler: string-accumulation line buffer with `\r\n` framing
- `handleLine()`: dispatches `TALLY OK` lines to existing `handleTally()`, silently ignores rest
- `destroy()` public method: sets `destroyed=true`, clears `retryTimer`, destroys socket
- `shutdown()` preserved as alias to `destroy()` for Phase 3 caller compatibility

**Test suite (src/vmix/VmixConnector.test.ts):**
- Migrated Phase 3 tests from `tcpFactory` injection to `vi.mock('node:net')` approach
- Added T1–T8 VMIX-04 backoff tests: delay values, attempt reset, lineBuffer clear, single-timer invariant, destroy() cancellation
- All 22 tests pass: 14 Phase 3 (preserved) + 8 new VMIX-04

**package.json:** node-vmix removed (also removes axios + querystring transitive deps)

**src/server.ts:** Outdated comment updated (referenced node-vmix autoReconnect)

## Verification

```
npx vitest run src/vmix/VmixConnector.test.ts  → 22 tests PASS
npm test                                         → 159 tests PASS
npx tsc --noEmit                                 → 0 errors
grep -rn "node-vmix|ConnectionTCP" src/          → 0 non-comment matches
grep -c '"node-vmix"' package.json               → 0
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cross-test timer contamination from real backoff timers**
- **Found during:** Task 2 — after implementing raw socket, Phase 3 tests started failing intermittently
- **Issue:** Tests without `vi.useFakeTimers()` that fire `mockSocket.emit('close')` schedule a real `setTimeout` backoff timer. When the test ends without calling `connector.destroy()`, the timer fires during the NEXT test, calling `createSocket()` on the previous connector with the new test's mock socket — contaminating the new test's mock expectations.
- **Fix:** Added `connector.destroy()` at the end of all Phase 3 tests. Updated the VMIX-01 reconnect test to use `vi.useFakeTimers()` / `vi.runAllTimers()` for timer control.
- **Files modified:** src/vmix/VmixConnector.test.ts
- **Commit:** 60a4cb2

**2. [Rule 1 - Bug] Duplicate "vmix TCP connected" log in fetchAndEmitRoster()**
- **Found during:** Task 2 — duplicate log call (once in createSocket 'connect' handler, once in fetchAndEmitRoster)
- **Fix:** Removed duplicate log from fetchAndEmitRoster; single log in connect handler
- **Files modified:** src/vmix/VmixConnector.ts
- **Commit:** 60a4cb2

**3. [Rule 1 - Bug] Outdated server.ts comment referencing node-vmix**
- **Found during:** Task 2 verification grep
- **Issue:** Comment in server.ts said "VmixConnector auto-connects via node-vmix autoReconnect: true" — incorrect after removing node-vmix
- **Fix:** Updated comment to reference raw node:net Socket with exponential backoff
- **Files modified:** src/server.ts
- **Commit:** 60a4cb2

### Test Architecture Adaptation (not a deviation — planned pattern)

The plan specified using `vi.spyOn(netModule, 'createConnection')` for mocking. This fails in ESM because Node.js built-in module namespaces are not configurable. Switched to `vi.mock('node:net', ...)` (file-level hoisted mock), which is the correct ESM mocking pattern in Vitest. The Phase 3 tests were adapted from `tcpFactory` injection to work with the new `vi.mock` approach.

## Known Stubs

None — all code is production-ready. No hardcoded values, placeholders, or TODO comments in modified files.

## Threat Flags

No new threat surface beyond what was declared in the plan's threat model (T-05-01 through T-05-SC). The `lineBuffer` accumulation is pure ASCII (T-05-03: accepted), the backoff loop is capped at 30s with destroyed-flag halt (T-05-02: mitigated), and no new packages were installed (T-05-SC: node-vmix removed).

## Self-Check: PASSED

- [x] src/vmix/VmixConnector.ts exists and imports createConnection from 'node:net'
- [x] src/vmix/VmixConnector.test.ts contains "backoff reconnect — VMIX-04" describe block with T1–T8
- [x] package.json does not contain "node-vmix"
- [x] Commits e6c3578 and 60a4cb2 exist in git log
- [x] 22 VmixConnector tests pass, 159 total tests pass
- [x] npx tsc --noEmit exits 0
