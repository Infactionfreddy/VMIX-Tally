---
phase: 05-reliability-reconnect-resync
verified: 2026-07-01T08:28:06Z
status: human_needed
score: 9/10
overrides_applied: 0
human_verification:
  - test: "Cable-pull test — vMix link drop"
    expected: "After pulling the network cable to vMix, pino logs show 'vmix TCP closed — scheduling reconnect' followed by 'vmix TCP reconnecting', then on cable reconnect 'vmix TCP connected' and fresh tally. Camera tally reflects the current vMix state after recovery."
    why_human: "Requires real vMix instance and physical network cable; cannot be simulated in unit tests."
  - test: "Cable-pull test — ATEM link drop"
    expected: "After pulling the network cable to the ATEM, pino logs show 'ATEM disconnected — scheduling reconnect' after ~600 ms (threadedclass freezeLimit), then on reconnect 'ATEM hydrated' followed by 'ATEM ready — re-asserted current desired state'. Camera tally reflects current state after recovery, not pre-drop state."
    why_human: "Requires real ATEM hardware and physical network cable; atem-connection's 'disconnected' event timing is hardware-dependent."
---

# Phase 5: Reliability — Reconnect + Resync Verification Report

**Phase Goal:** Both links survive drops mid-show: auto-reconnect with backoff/jitter, and on every reconnect the system re-asserts current desired state rather than replaying stale tally.
**Verified:** 2026-07-01T08:28:06Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After a vMix link drop, the server reconnects automatically using exponential backoff with jitter (no tight reconnect-storm loop), then re-fetches a full TALLY snapshot | VERIFIED | `VmixConnector.ts`: `backoffDelay()` uses `min(1000*2^attempt, 30_000) * (0.75+rand*0.5)`; `scheduleReconnect()` called only from `'close'` handler (single-timer invariant); `fetchAndEmitRoster()` called in `'connect'` handler. Tests T1–T8 all pass. |
| 2 | After an ATEM link drop, the server reconnects and re-asserts the full desired bus state on reconnect (does not trust bus persistence) | VERIFIED | `AtemConnector.ts`: `handleDisconnected()` calls `scheduleReconnect()`; `handleConnected()` sets `needsResync=true` before `emit('ready')`; `_dispatch()` calls `reconciler.reset()` then clears `needsResync`. `server.ts` wires `atem.on('ready', ...)` with `applyState(orchestrator.currentDesiredState(), ...)`. Tests T1–T10 all pass. |
| 3 | A cable-pull test on either endpoint results in tally reflecting current state after recovery, not pre-drop state | ? UNCERTAIN | Software path verified by unit tests (T6: command issued despite same-state after reconciler.reset(); needsResync flag guarantees ATEM receives command). End-to-end with real hardware requires human verification. |
| 4 | No ATEM command is sent in the connected-but-not-yet-hydrated window | VERIFIED | `AtemConnector.applyState()` gates all dispatch through `if (!this.isHydrated) { this.pendingState = newState; return; }`. `isHydrated` set to `false` in `handleDisconnected()` before any reconnect attempt; set to `true` only in `handleConnected()`. Test T1 confirms applyState stores as pending and does not dispatch after disconnect. |
| 5 | Reconnect delay grows exponentially (1s, 2s, 4s…) with ±25% jitter, capped at 30s, on both connectors | VERIFIED | Both `VmixConnector.backoffDelay()` and `AtemConnector.backoffDelay()` use identical formula: `Math.min(1000 * Math.pow(2, this.attempt), 30_000) * (0.75 + Math.random() * 0.5)`. VmixConnector T1 (1000ms@attempt=0), T2 (30000ms@attempt=5); AtemConnector T9 (1000ms@attempt=0), T10 (attempt resets). |
| 6 | Each vMix reconnect starts fresh: lineBuffer cleared, SUBSCRIBE TALLY re-sent, roster re-fetched | VERIFIED | `VmixConnector.createSocket()` 'connect' handler: `this.attempt = 0`, `this.lineBuffer = ""`, `sock.write("SUBSCRIBE TALLY\r\n")`, `void this.fetchAndEmitRoster()`. Test T4 verifies lineBuffer cleared; VMIX-01 re-subscribe test verifies SUBSCRIBE TALLY re-sent. |
| 7 | Error and close events never schedule two concurrent retry timers (single-timer invariant) | VERIFIED | `VmixConnector`: 'error' handler calls `sock.destroy()` only — no `scheduleReconnect()`. `scheduleReconnect()` called from 'close' only. Tests T5 (error fires: zero new timers), T6 (error+close: exactly one timer). |
| 8 | Attempt counter resets to 0 on every successful TCP connect (VmixConnector) | VERIFIED | `VmixConnector` 'connect' handler line 137: `this.attempt = 0`. Test T3 verifies that after reconnect the next close produces a 1000ms delay (attempt=0). |
| 9 | Calling destroy() stops reconnect loop and cancels pending timer on both connectors | VERIFIED | `VmixConnector.destroy()`: sets `this.destroyed = true`, `clearTimeout(retryTimer)`, `this.socket?.destroy()`. `AtemConnector.destroy()`: identical pattern + `void this.atem.destroy()`. Tests T7, T8 (VmixConnector), T8 (AtemConnector) all pass. |
| 10 | reconciler.reset() is called before re-assert so ATEM always receives the command | VERIFIED | `AtemConnector._dispatch()` lines 183–186: `if (this.needsResync) { this.reconciler.reset(); this.needsResync = false; }` — runs before `reconciler.submit()`. `needsResync` set in `handleConnected()` BEFORE `emit('ready')`. Test T5 (resetSpy called before applyState), T6 (command issued despite identical state). |

**Score:** 9/10 truths verified (Truth #3 UNCERTAIN pending hardware cable-pull test)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/vmix/VmixConnector.ts` | Raw node:net Socket replacing node-vmix ConnectionTCP, with backoff loop | VERIFIED | `import { createConnection } from "node:net"`. No `node-vmix` or `ConnectionTCP` imports. Contains `backoffDelay()`, `scheduleReconnect()`, `createSocket()`, `destroy()`. 296 lines, fully substantive. |
| `src/vmix/VmixConnector.test.ts` | Unit tests for VMIX-04 backoff behavior | VERIFIED | Describe block "backoff reconnect — VMIX-04" with 8 tests (T1–T8). All 22 tests in file pass. |
| `src/atem/AtemConnector.ts` | AtemConnector extends EventEmitter with 'disconnected' backoff + 'ready' event | VERIFIED | `extends EventEmitter`. Contains `scheduleReconnect()`, `backoffDelay()`, `destroy()`, `needsResync` flag. 262 lines. |
| `src/atem/AtemConnector.test.ts` | Unit tests for ATEM-04 reconnect + resync behavior | VERIFIED | Describe block "ATEM reconnect + resync — ATEM-04" with 10 tests (T1–T10). All 18 tests in file pass. |
| `src/server.ts` | `atemConnector.on('ready', ...)` re-assert listener | VERIFIED | Lines 116–125: `atem.on("ready", () => { const state = orchestrator.currentDesiredState(); if (state !== null) { atem.applyState(state, Date.now()); logger.info({ event: 'atem_resynced' }, ...) } })`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `VmixConnector.createSocket()` | `parseTallyString()` | `handleLine()` on 'data' event | VERIFIED | `handleLine()` dispatches `TALLY OK` prefix to `handleTally()` which calls `parseTallyString()`. |
| `VmixConnector.scheduleReconnect()` | `setTimeout` | `backoffDelay()` | VERIFIED | `scheduleReconnect()` calls `this.backoffDelay()` and passes result to `setTimeout(() => this.createSocket(), delay)`. |
| `AtemConnector 'connected' handler` | `emit('ready')` | `isHydrated` flip | VERIFIED | `handleConnected()` sets `isHydrated = true`, then `needsResync = true`, then `this.emit("ready")`. Ordering is correct and tested. |
| `server.ts 'ready' listener` | `atemConnector.applyState()` | `orchestrator.currentDesiredState()` | VERIFIED | `atem.on("ready", ...)` calls `orchestrator.currentDesiredState()` with null guard, then `atem.applyState(state, Date.now())`. Logs `{ event: 'atem_resynced' }`. |
| `AtemConnector._dispatch()` | `reconciler.reset()` | `needsResync` flag | VERIFIED | `_dispatch()` checks `if (this.needsResync)`, calls `reconciler.reset()`, sets `needsResync = false`, then calls `reconciler.submit()`. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| VMIX-04 | 05-01-PLAN.md | After a vMix link drop, server reconnects automatically using exponential backoff with jitter; re-fetches TALLY snapshot | SATISFIED via unit tests; hardware deferred | VmixConnector T1–T8 all green. `node-vmix` removed from `package.json`. No `ConnectionTCP` references in `src/`. Hardware cable-pull deferred to production. |
| ATEM-04 | 05-02-PLAN.md | After an ATEM link drop, server reconnects and re-asserts full desired bus state; no command in connected-but-not-hydrated window | SATISFIED via unit tests; hardware deferred | AtemConnector T1–T10 all green. `server.ts` 'ready' wiring confirmed. Hardware cable-pull deferred to production. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No debt markers (TBD/FIXME/XXX), no stubs, no placeholder returns found in any Phase 5 modified file. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All VmixConnector tests pass (22 tests incl. T1–T8) | `npx vitest run src/vmix/VmixConnector.test.ts` | 22/22 passed, 0 failed | PASS |
| All AtemConnector tests pass (18 tests incl. T1–T10) | `npx vitest run src/atem/AtemConnector.test.ts` | 18/18 passed, 0 failed | PASS |
| Full test suite regression-free (169 tests across 10 files) | `npx vitest run` | 169/169 passed, 0 failed | PASS |
| TypeScript compiles cleanly | `npx tsc --noEmit` | exit 0, no output | PASS |
| node-vmix removed from package.json | `grep -c '"node-vmix"' package.json` | 0 | PASS |
| No ConnectionTCP references in src/ | `grep -rn "ConnectionTCP" src/` | no output | PASS |

### Probe Execution

Step 7c: SKIPPED — no probe scripts found in `scripts/*/tests/probe-*.sh`; not a migration/tooling phase.

### Human Verification Required

#### 1. Cable-pull test — vMix link drop (VMIX-04 hardware path)

**Test:** With the bridge server running and connected to real vMix, unplug the network cable between the server and vMix. Wait ~2 seconds. Reconnect the cable.

**Expected:**
- Pino logs during disconnect: `"vmix TCP closed — scheduling reconnect"`, followed by `"vmix TCP reconnecting"` entries with `attempt` and `delayMs` fields showing increasing delays
- Pino logs after reconnect: `"vmix TCP connected"` immediately followed by fresh tally data
- Camera tallies reflect the current vMix live/preview state after recovery — not pre-drop state

**Why human:** Requires real vMix instance on Windows and a physical Ethernet cable. The node:net socket reconnect loop and SUBSCRIBE TALLY re-subscription are exercised by unit tests, but the end-to-end hardware path (OS TCP stack teardown, vMix server behaviour on reconnect, actual tally correctness) cannot be verified programmatically.

#### 2. Cable-pull test — ATEM link drop (ATEM-04 hardware path)

**Test:** With the bridge server running and connected to real ATEM, unplug the network cable between the server and ATEM. Wait ~2 seconds (atem-connection 'disconnected' fires after ~600 ms threadedclass freeze). Reconnect the cable.

**Expected:**
- Pino logs during disconnect: `{"event":"atem_disconnected","msg":"ATEM disconnected — scheduling reconnect"}`
- Pino logs after reconnect: `{"event":"atem_hydrated","host":"...","msg":"ATEM hydrated"}` followed by `{"event":"atem_resynced","msg":"ATEM ready — re-asserted current desired state"}`
- Camera tallies show correct red/green state matching current vMix state — not the pre-drop state (critical: this proves reconciler.reset() + re-assert works end-to-end)

**Why human:** Requires real ATEM hardware. The ~600 ms disconnect detection delay is a hardware timing property of atem-connection's threadedclass transport. The SDI tally passthrough to Blackmagic cameras can only be verified with real cameras on SDI return.

### Gaps Summary

No software gaps. All unit-testable aspects of VMIX-04 and ATEM-04 are verified:

- VmixConnector raw node:net socket with backoff: VERIFIED (T1–T8 green)
- AtemConnector disconnected backoff + ready event + needsResync path: VERIFIED (T1–T10 green)
- server.ts 'ready' re-assert wiring with null guard: VERIFIED by code inspection and `atem_resynced` log confirmed
- Full test suite: 169/169 green, TypeScript clean

The single open item is Truth #3 — end-to-end cable-pull behavior — which requires real hardware. This was explicitly planned as a hardware-deferred item in the Phase 5 plans (05-02-PLAN.md Task 3: "Cable-pull verification — manual — requires real hardware").

---

_Verified: 2026-07-01T08:28:06Z_
_Verifier: Claude (gsd-verifier)_
