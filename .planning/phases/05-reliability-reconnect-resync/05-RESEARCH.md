# Phase 5: Reliability — Reconnect + Resync - Research

**Researched:** 2026-07-01
**Domain:** node:net raw TCP socket, exponential backoff with jitter, atem-connection reconnect lifecycle
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** `AtemConnector` sets `isHydrated = false` on every `'disconnected'` event from
`atem-connection` — no distinction between graceful shutdown and unexpected drops. On the
next reconnect, the Phase 4 hydration flow (first `stateChanged` → flush `pendingState`)
runs again from scratch.

**D-02:** `AtemConnector` emits a `'ready'` event when `isHydrated` flips to `true` (both
initial connect and every subsequent reconnect). `server.ts` listens:
```
atemConnector.on('ready', () =>
  atemConnector.applyState(orchestrator.currentState, Date.now())
)
```
Re-asserts the full current desired state after every ATEM reconnect. The `Date.now()`
timestamp is synthetic — latency logging on this path is informational only.

**D-03:** Both vMix (TCP) and ATEM links use identical backoff parameters:
- Initial delay: 1 s
- Max delay: 30 s
- Jitter: ±25% (multiply final delay by `1 + (Math.random() - 0.5) * 0.5`)
- Formula: `min(initialDelay * 2^attempt, maxDelay) * (0.75 + Math.random() * 0.5)`
Same parameters on both links — both are LAN devices.

**D-04:** Phase 5 replaces `node-vmix` `ConnectionTCP` with a raw `node:net` `Socket` in
`VmixConnector`. The tally parsing layer (`parseTallyString`, `parseRosterXml`,
`buildRuntimeMapping`) is unchanged. The `VmixConnector` event interface (`'tally'`,
`'rosterUpdated'`) is preserved — upstream consumers (`TallyOrchestrator`) need no changes.
Rationale: `node-vmix`'s reconnect interval is a hardcoded protected field and cannot be
overridden without fragile monkey-patching.

**D-05:** The raw socket implementation handles newline-delimited framing manually (`data`
event accumulates into a line buffer; lines are dispatched on `\r\n`). The `TALLY OK
<digits>` line is passed to `parseTallyString` (unchanged from Phase 3). On `'connect'`:
send `SUBSCRIBE TALLY\r\n` + call `fetchRoster()`. On `'close'`/`'error'`: start backoff
loop, do NOT call SUBSCRIBE again until next `'connect'`.

**D-06:** The HTTP roster fetch (`fetchRoster()` via native fetch, Phase 3 D-06) is
unchanged. Triggered after each successful TCP reconnect. No separate retry logic for the
HTTP fetch — if it fails, `parseRosterXml` returns an empty Map and the orchestrator holds
last known tally (Phase 3 D-03).

**D-07:** Phase 5 modifies two existing modules from Phase 4:
- `src/vmix/VmixConnector.ts` — TCP transport replaced (D-04/D-05); event interface and
  constructor signature unchanged.
- `src/atem/AtemConnector.ts` — adds `'disconnected'` handler (D-01), `'ready'` event
  emission (D-02), backoff loop around `atem.connect()`.

No new module required for Phase 5.

### Claude's Discretion

- Whether the backoff utility is a standalone `src/utils/backoff.ts` or inlined in each
  connector.
- Whether `node-vmix` package is removed from `package.json` in Phase 5 or left as a
  transitive dep. (If removed: `axios` dependency disappears too — leaner bundle.)
- Exact buffer-accumulation strategy for raw socket framing (string accumulation vs
  `Buffer` + `indexOf`).

### Deferred Ideas (OUT OF SCOPE)

- Web UI indicators for connection health (Phase 6 UI-02).
- Per-link configurable backoff parameters (deferred; same parameters on both links
  is sufficient for v1).
- vMix SUBSCRIBE ACTS for roster changes (still deferred to v2).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VMIX-04 | Server verbindet sich bei Verbindungsabbruch automatisch mit vMix neu (Backoff) | raw `node:net` Socket with backoff loop: `'close'`/`'error'` → schedule retry via `setTimeout`; `'connect'` → reset attempt counter, re-subscribe |
| ATEM-04 | Server verbindet sich bei Verbindungsabbruch automatisch mit dem ATEM neu und stellt den Soll-Zustand wieder her (Resync) | `atem-connection` `'disconnected'` event → reset `isHydrated`, start backoff; `'ready'` emission on hydration → `server.ts` re-asserts `orchestrator.currentState` |
</phase_requirements>

---

## Summary

Phase 5 is a pure reliability hardening pass. It modifies two existing modules
(`VmixConnector.ts` and `AtemConnector.ts`) and adds a small `server.ts` wiring change
— no new modules, no new public interfaces, no schema changes.

The core challenge is implementing a correct backoff loop with three invariants: (1) exactly
one pending retry timer at any time, (2) attempt counter resets on successful connect, and
(3) the loop terminates cleanly on explicit `destroy()`. A secondary challenge is the
atem-connection reconnect path: the library emits `'disconnected'` from an internal
worker thread (via `threadedclass`), and calling `atem.connect()` from inside the
`'disconnected'` handler is safe — the library's `AtemSocket._isDisconnecting` flag
is only set by explicit `disconnect()`, not by unexpected drops.

The `TallyStateReconciler.reset()` method was already built in Phase 1 specifically for
this reconnect path. `AtemConnector.applyState()` must call `reconciler.reset()` before
re-asserting state so that the reconciler treats the reconnect as a genuine state change
regardless of what was last sent before the drop.

**Primary recommendation:** Inline the backoff formula in each connector (not a shared
utility) — the formula is 2 lines and is simpler to test in context. Remove `node-vmix`
from `package.json` when replacing `ConnectionTCP`; this also removes `axios` and
`querystring` from the dependency tree.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| vMix TCP reconnect + backoff | `src/vmix/VmixConnector.ts` | — | TCP transport is encapsulated in VmixConnector; upstream consumers see no change |
| ATEM reconnect + backoff | `src/atem/AtemConnector.ts` | — | atem-connection lifecycle is owned by AtemConnector |
| Hydration reset on ATEM disconnect | `src/atem/AtemConnector.ts` | — | `isHydrated` is AtemConnector-private state |
| Re-assert desired state after reconnect | `src/server.ts` | `src/atem/AtemConnector.ts` | server.ts wires the 'ready' → applyState path; AtemConnector emits 'ready' |
| Backoff jitter formula | inlined in each connector | — | 2-line formula; no shared module needed for two call sites |
| reconciler.reset() on reconnect | `src/atem/AtemConnector.ts` | — | Must precede re-assert so reconciler treats reconnect as state change |

---

## Standard Stack

### Core

No new runtime packages are required for Phase 5.

| Component | Source | Purpose | Status |
|-----------|--------|---------|--------|
| `node:net` | Node.js built-in | Raw TCP socket replacing `node-vmix` `ConnectionTCP` | Already available — no install |
| `atem-connection` | Already installed (3.9.0) | ATEM reconnect — `'disconnected'` event + `connect()` call | Already in `package.json` |
| `node:events` `EventEmitter` | Built-in | Already used by `AtemConnector` (Phase 4 adds EventEmitter) | No change |

### Packages to Remove

| Package | Why Remove | Side Effect |
|---------|-----------|-------------|
| `node-vmix` | `ConnectionTCP` replaced by raw `node:net` | Removes `axios` + `querystring` transitive deps — leaner Windows packaging |

**Removal command:**
```bash
npm uninstall node-vmix
```

**Verify no remaining usages before removing:**
```bash
grep -rn "node-vmix\|ConnectionTCP" src/
```

### Supporting

| Item | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| `node:net` `Socket` | built-in | Newline-framed TCP client | Always — replaces `ConnectionTCP` |
| `TallyStateReconciler.reset()` | Phase 1 (already exists) | Force reconciler to treat reconnect re-assert as changed | Always, before every `applyState()` after ATEM reconnect |

---

## Package Legitimacy Audit

> No new packages are installed in Phase 5. One package (`node-vmix`) is removed.

| Package | Action | Reason |
|---------|--------|--------|
| `node-vmix` | REMOVE | `ConnectionTCP` replaced by raw `node:net`; no remaining usages |
| `atem-connection` | Unchanged | Already installed; Phase 5 uses existing events, no new API surface |

**Packages removed due to slopcheck verdict:** none — removal is intentional code
simplification, not a security response.

*No new packages to audit.*

---

## Architecture Patterns

### System Architecture Diagram (reconnect flow)

```
── VmixConnector (vMix TCP link) ──────────────────────────────────────────────

  net.Socket  ──connect──►  send 'SUBSCRIBE TALLY\r\n'
                             fetchRoster()  (HTTP, unchanged)
                             reset attempt counter

              ──data──►     line buffer accumulation
                             on '\r\n': extract line → parseTallyString()
                             emit 'tally' / detect length change → emit 'rosterUpdated'

              ──close/error►  mark connecting=false
                              schedule retry: setTimeout(reconnect, backoffDelay(attempt))
                              attempt++

  Backoff:    delay = min(1000 * 2^attempt, 30000) * (0.75 + Math.random() * 0.5)

── AtemConnector (ATEM Ethernet link) ─────────────────────────────────────────

  atem.connect()  ──stateChanged(first)──►  isHydrated = true
                                             flush pendingState if any
                                             emit 'ready'   ◄─── NEW Phase 5

  atem  ──'disconnected'──►  isHydrated = false   ◄─── NEW Phase 5
                              schedule retry: setTimeout(reconnect, backoffDelay(attempt))
                              attempt++

  'ready' event ──────────────────────────────────────────────────────────────►
                  server.ts: atemConnector.on('ready', () =>
                    atemConnector.applyState(orchestrator.currentState, Date.now()))
                    │
                    └─ AtemConnector: reconciler.reset()   ◄─── forces re-assert
                                      submit(desiredState) → changeProgramInput/changePreviewInput
```

### Recommended Project Structure (unchanged)

```
src/
├── core/            # unchanged — tallyState.ts reset() already exists
├── config/          # unchanged
├── vmix/
│   └── VmixConnector.ts   # MODIFIED: ConnectionTCP → node:net Socket + backoff loop
│                            # all other vmix/ files unchanged
└── atem/
    └── AtemConnector.ts   # MODIFIED: 'disconnected' handler + 'ready' event + backoff
src/server.ts              # MODIFIED: add atemConnector.on('ready', ...) listener
```

### Pattern 1: raw node:net Socket with backoff loop

**What:** Replace `ConnectionTCP` in `VmixConnector` with a self-managed `net.Socket`.
The backoff loop tracks `attempt: number` and a `retryTimer: ReturnType<typeof setTimeout> | null`.

**Critical invariants:**
1. Create a fresh `net.Socket` on every reconnect attempt — never call `socket.connect()`
   on a socket that has already emitted `'close'`. [VERIFIED: nodejs.org/api/net.html —
   "socket.connect() should only be used for reconnecting a socket after 'close' has been
   emitted or otherwise it may lead to undefined behavior."]
2. Call `socket.destroy()` on error before starting the retry timer — a socket in error
   state must be fully destroyed first.
3. A `destroyed` flag prevents backoff from firing after explicit `destroy()`.

```typescript
// Source: Node.js official docs (nodejs.org/api/net.html) + verified against
// net.Socket event semantics [VERIFIED: nodejs.org/api/net.html]

import { createConnection } from 'node:net';
import type { Socket } from 'node:net';

private socket: Socket | null = null;
private attempt = 0;
private retryTimer: ReturnType<typeof setTimeout> | null = null;
private destroyed = false;

private backoffDelay(): number {
  // D-03: 1s initial, 30s max, ±25% jitter
  const base = Math.min(1000 * Math.pow(2, this.attempt), 30_000);
  return base * (0.75 + Math.random() * 0.5);
}

private scheduleReconnect(): void {
  if (this.destroyed) return;
  const delay = this.backoffDelay();
  this.attempt++;
  this.logger.info({ attempt: this.attempt, delayMs: Math.round(delay) }, 'vmix TCP reconnecting');
  this.retryTimer = setTimeout(() => this.createSocket(), delay);
}

private createSocket(): void {
  this.retryTimer = null;
  if (this.destroyed) return;

  const sock = createConnection({ host: this.host, port: this.tcpPort });
  this.socket = sock;

  sock.on('connect', () => {
    this.attempt = 0;  // reset on successful connect
    this.lineBuffer = '';
    sock.write('SUBSCRIBE TALLY\r\n');
    void this.fetchAndEmitRoster();
    this.logger.info({ host: this.host, port: this.tcpPort }, 'vmix TCP connected');
  });

  sock.on('data', (chunk: Buffer) => {
    this.lineBuffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = this.lineBuffer.indexOf('\r\n')) !== -1) {
      const line = this.lineBuffer.slice(0, idx);
      this.lineBuffer = this.lineBuffer.slice(idx + 2);
      this.handleLine(line);
    }
  });

  sock.on('error', (err: Error) => {
    this.logger.warn({ err }, 'vmix TCP error');
    sock.destroy();  // must destroy before retry
  });

  sock.on('close', () => {
    this.logger.info({ host: this.host }, 'vmix TCP closed — scheduling reconnect');
    this.scheduleReconnect();
  });
}

destroy(): void {
  this.destroyed = true;
  if (this.retryTimer !== null) clearTimeout(this.retryTimer);
  this.socket?.destroy();
}
```

**Notes:**
- `'error'` always fires before `'close'` on error conditions [VERIFIED: nodejs.org/api/net.html].
  Guard against double-reconnect by only triggering `scheduleReconnect()` from `'close'`, not
  from `'error'`.
- `lineBuffer` must be an instance field (not local to any event handler) — it spans multiple
  `'data'` events for the same connection.
- String accumulation (`chunk.toString('utf8')`) is sufficient for the vMix protocol. The
  `TALLY OK <digits>` line is ASCII with no multi-byte characters. Buffer + `indexOf` is
  an equally valid alternative if the implementer prefers.

### Pattern 2: atem-connection reconnect loop

**What:** The `'disconnected'` event fires from `BasicAtem` immediately when the internal
worker thread detects connection loss (via the `threadedclass` `freezeLimit` timeout, default
600 ms) or when `socket.disconnect()` is called. The event originates from
`atemSocket.js` line 97/121 (`this.emit('disconnect')`) and is re-emitted as `'disconnected'`
from `BasicAtem` (`atem.js` line 58). [VERIFIED: installed
`node_modules/atem-connection/dist/atem.js` and `atemSocket.js`]

**Key finding — no built-in reconnect:** atem-connection 3.9.0 does NOT auto-reconnect after
`'disconnected'`. The socket process auto-restarts via `threadedclass` `autoRestart: true` and
calls `connect()` on restart, but that is worker-thread-level restart recovery, not user-space
backoff. The user must call `atem.connect(address, port)` manually to re-establish the ATEM
protocol handshake. [VERIFIED: node_modules/atem-connection/dist/lib/atemSocket.js]

```typescript
// Source: verified against installed atem-connection 3.9.0
// node_modules/atem-connection/dist/atem.js + atemSocket.js [VERIFIED]

private isHydrated = false;
private pendingState: ResolverOutput | null = null;
private attempt = 0;
private retryTimer: ReturnType<typeof setTimeout> | null = null;
private destroyed = false;

// In constructor — register lifecycle handlers:
this.atem.on('disconnected', () => {
  this.isHydrated = false;          // D-01: reset on every disconnect
  this.logger.warn({ event: 'atem_disconnected' }, 'ATEM disconnected — scheduling reconnect');
  this.scheduleReconnect();
});

this.atem.on('stateChanged', (_state, _paths) => {
  if (!this.isHydrated) {
    this.isHydrated = true;
    this.attempt = 0;               // reset on successful hydration
    this.logger.info({ event: 'atem_hydrated' }, 'ATEM hydrated');
    if (this.pendingState) {
      const s = this.pendingState;
      this.pendingState = null;
      void this.applyState(s, Date.now());  // flush pending (Phase 4 D-04)
    }
    this.emit('ready');             // D-02: signal re-assert to server.ts
  }
});

private backoffDelay(): number {
  // D-03: identical formula as VmixConnector
  const base = Math.min(1000 * Math.pow(2, this.attempt), 30_000);
  return base * (0.75 + Math.random() * 0.5);
}

private scheduleReconnect(): void {
  if (this.destroyed) return;
  const delay = this.backoffDelay();
  this.attempt++;
  this.logger.info({ attempt: this.attempt, delayMs: Math.round(delay) }, 'ATEM reconnecting');
  this.retryTimer = setTimeout(() => {
    this.retryTimer = null;
    if (!this.destroyed) {
      this.atem.connect(this.host).catch((err: unknown) => {
        this.logger.warn({ err }, 'ATEM connect() rejected');
      });
    }
  }, delay);
}
```

**Important:** Call `this.atem.connect(address)` — not `this.atem.disconnect()` first.
Calling `disconnect()` before `connect()` when already disconnected is a no-op that is
safe but unnecessary. The `_isDisconnecting` flag in `AtemSocket` is only set by explicit
`disconnect()`, not by unexpected drops, so calling `connect()` directly from the
`'disconnected'` handler will not hit the `'Disconnecting'` guard. [VERIFIED:
node_modules/atem-connection/dist/lib/atemSocket.js lines 25–41]

### Pattern 3: server.ts 'ready' wiring

**What:** The single new line in `server.ts` wires `'ready'` to re-assert.

```typescript
// Source: Phase 5 D-02 (05-CONTEXT.md)
atemConnector.on('ready', () => {
  const state = orchestrator.currentState;
  if (state !== null) {
    atemConnector.applyState(state, Date.now());
    logger.info({ event: 'atem_resynced' }, 'ATEM ready — re-asserted current desired state');
  }
});
```

**Why the null check:** `orchestrator.currentState` is `null` if no vMix tally has been
received yet (Phase 3 D-15: getter returns `ResolverOutput | null`). If ATEM reconnects
before any vMix tally arrives, the re-assert is a no-op — correct behavior. When the first
tally arrives, the normal `'stateChanged'` path pushes state to `applyState()`.

### Pattern 4: TallyStateReconciler.reset() in applyState()

**What:** `AtemConnector.applyState()` must call `reconciler.reset()` before submitting state
after a reconnect. The Phase 1 `reset()` method was built specifically for this path.

```typescript
// AtemConnector.applyState() — existing Phase 4 implementation gets one addition:
// On the first call after 'ready' fires, reconciler.reset() must be called FIRST
// so that submit() always reports changed:true, forcing ATEM to receive the command.

// The cleanest way: reset() in applyState() is idempotent and harmless if called
// when reconciler is already at null/null (initial state). The 'ready' handler
// can simply call applyState() directly — applyState() resets before submitting.
```

**Option A (recommended):** Have the `'ready'` event set a `needsResync: boolean` flag;
`applyState()` calls `reconciler.reset()` when `needsResync` is true, then clears it.

**Option B:** Have `applyState()` always call `reconciler.reset()` before submit — this is
safe (reset is a no-op when state is already null/null) and simpler. Phase 1 tests
confirm `reset()` followed by `submit()` always reports `changed:true` regardless of prior
state.

The planner chooses between A and B. Option B is simpler and the Phase 1 tests already
cover the invariant.

### Anti-Patterns to Avoid

- **Calling socket.connect() on a closed socket:** After `'close'` fires, the socket is
  in a terminal state. Always create a fresh `createConnection()` call — never reuse the
  socket object. [VERIFIED: nodejs.org/api/net.html]
- **Triggering scheduleReconnect() from both 'error' and 'close':** `'error'` always fires
  before `'close'` when there is an error. Triggering from both creates duplicate timers.
  Trigger only from `'close'`.
- **Forgetting lineBuffer is per-connection:** If `lineBuffer` is not cleared on reconnect,
  stale bytes from the previous connection corrupt the first TALLY line of the new session.
  Clear `lineBuffer = ''` in the `'connect'` handler.
- **Not clearing the retry timer on successful connect:** Leaving a pending timer active
  after a successful connect means a second connection attempt fires. Clear in the `'connect'`
  handler: `if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }`
  (Though with the recommended pattern above — timer fires `createSocket()` which returns early
  if socket is already connected — double-connect is harmless but wasteful. Explicit clear
  is cleaner.)
- **Testing backoff with Math.random() directly:** The jitter formula uses `Math.random()`,
  which makes the exact delay non-deterministic. Unit tests for the backoff sequence must
  inject a seeded/mocked random: `vi.spyOn(Math, 'random').mockReturnValue(0.5)` (returns
  the ±0% jitter case, i.e. plain `base` delay).
- **Calling atem.connect() after atem.destroy():** `destroy()` calls `ThreadedClassManager.destroy()`
  which removes the socket process. Subsequent `connect()` creates a new socket process.
  Avoid calling `connect()` after `destroy()` — use the `destroyed` guard.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Line framing for TCP stream | Custom delimiter parser class | `lineBuffer += chunk; indexOf('\r\n')` inline loop | The vMix protocol is \r\n-delimited ASCII; the inline pattern is 8 lines and has no edge cases at this scale |
| Reconnect library | `net-reconnect`, `reconnect` npm packages | Inline `scheduleReconnect()` method | Only 2 call sites; adding a dependency for ~15 lines is not justified; full control needed for the custom backoff parameters |
| ATEM state re-fetch after reconnect | Custom state query after reconnect | `atem-connection` `stateChanged` (hydration gate, Phase 4 D-03) | atem-connection delivers full state on initial `stateChanged` after connect — no manual query needed |

**Key insight:** Both reconnect loops are ~15 lines each. The correct abstraction for this
codebase is a private `scheduleReconnect()` method per connector, not a shared utility.
The backoff formula is identical, but the surrounding context (what happens on connect,
which handles to register) differs per connector.

---

## Common Pitfalls

### Pitfall 1: Double reconnect trigger from 'error' + 'close'

**What goes wrong:** Registering `scheduleReconnect()` on both `'error'` and `'close'`
schedules two timers. Both fire. Two sockets connect simultaneously. The second connection
wins, causing the first to close, which schedules yet another reconnect — infinite loop.

**Why it happens:** Node.js guarantees `'error'` fires before `'close'` when the socket
closes due to an error. Both events fire in sequence.

**How to avoid:** Only call `scheduleReconnect()` from `'close'`. In the `'error'` handler:
`sock.destroy()` (to ensure `'close'` fires) and log the error. Let `'close'` handle the
backoff. [VERIFIED: nodejs.org/api/net.html — "If the socket was destroyed due to errors,
the 'close' event will still fire after the 'error' event."]

**Warning signs:** pino logs showing `vmix TCP reconnecting` twice in rapid succession for
the same host; socket connection count growing over time.

### Pitfall 2: stale lineBuffer on reconnect

**What goes wrong:** After a TCP drop, the `lineBuffer` still holds a partial line from
the previous session. On reconnect, the first `SUBSCRIBE TALLY\r\n` acknowledgement
appears to be malformed because it is prefixed with old bytes. `parseTallyString` receives
junk, emits incorrect tally, potentially flips camera states.

**Why it happens:** `lineBuffer` is an instance field that survives socket recreation.

**How to avoid:** Set `this.lineBuffer = ''` in the `'connect'` handler, before issuing
`SUBSCRIBE TALLY`.

**Warning signs:** Incorrect tally digit count (tally length != roster length) immediately
after reconnect; `parseTallyString` tests passing but end-to-end tally wrong after cable-pull.

### Pitfall 3: applyState without reconciler.reset() on reconnect

**What goes wrong:** After ATEM reconnects, `applyState()` is called with the current
desired state. But `reconciler.lastSent` still holds the pre-disconnect state (e.g.,
`{ program: 2, preview: 3 }`). If the current desired state is identical, `submit()` reports
`changed: false` and no ATEM commands are issued. The ATEM is in unknown state after a
drop, and cameras may show wrong tally.

**Why it happens:** The `TallyStateReconciler` tracks "last sent," but "last sent" is
meaningless after a reconnect because the ATEM may have lost state during the drop.

**How to avoid:** Call `reconciler.reset()` before the re-assert `applyState()` call.
`reset()` returns the held state to `{ program: null, preview: null }`, guaranteeing the
next `submit()` always reports `changed: true` and commands are issued. Phase 1 tests
already verify this path (`tallyState.test.ts` lines 180–192). [VERIFIED: codebase —
`src/core/tallyState.ts` lines 109–118]

**Warning signs:** ATEM reconnect in pino logs, but no `atem_command_sent` log entries
following the `atem_ready` event.

### Pitfall 4: attempt counter not reset on successful connect

**What goes wrong:** Each reconnect increments `attempt`. If a brief disconnect happens
early (attempt=0 → 1 s backoff), then the link runs fine for hours, then drops again
(attempt=1 → 2 s backoff), then runs fine again, then drops again (attempt=2 → 4 s
backoff) — the backoff grows even though these are isolated independent drops.

**Why it happens:** `attempt` is only incremented, never reset.

**How to avoid:** Reset `this.attempt = 0` in the `'connect'` handler (vMix) and in the
hydration handler when `isHydrated` flips to `true` (ATEM). Every successful connection
starts the backoff sequence from 1 s.

**Warning signs:** Reconnect delays growing exponentially across separate, unrelated drops
during a long show.

### Pitfall 5: atem-connection 'disconnected' timing (600 ms freeze timeout)

**What goes wrong:** Operator unplugs the ATEM network cable. They expect immediate
`'disconnected'` event. Instead the event fires ~600 ms later (the `childProcessTimeout`
default in `AtemSocket`). The reconnect backoff starts from that point, not from cable-pull.

**Why it happens:** `atem-connection` uses `threadedclass` with `freezeLimit: 600`
(childProcessTimeout). The socket child process is considered frozen after 600 ms of no
response, at which point `'disconnect'` is emitted. This is not a bug — it is the designed
failure detection mechanism. [VERIFIED: node_modules/atem-connection/dist/atem.js line 42:
`childProcessTimeout: options?.childProcessTimeout || 600`]

**How to avoid:** Accept this behavior. Document it in the cable-pull test: the reconnect
log appears ~600 ms after the actual cable pull, not immediately. The 1 s initial backoff
means first retry is ~1.6 s after cable pull — well within operator expectations.

**Warning signs:** Test expecting `'disconnected'` to fire synchronously — it doesn't; it
fires in the next tick via the worker thread message bus.

---

## Code Examples

### Backoff formula (injectable random for testing)

```typescript
// Source: Phase 5 D-03 (05-CONTEXT.md)
// randomFn defaults to Math.random for production; inject Math.random mock in tests.
function backoffDelay(attempt: number, randomFn = Math.random): number {
  const base = Math.min(1000 * Math.pow(2, attempt), 30_000);
  return base * (0.75 + randomFn() * 0.5);
}
// Examples (with randomFn returning 0.5 — ±0% jitter):
// attempt=0 → 1000 ms, attempt=1 → 2000, attempt=2 → 4000, attempt=4 → 16000, attempt=5 → 30000
```

### node:net socket framing (TALLY OK line extraction)

```typescript
// Source: Node.js docs (nodejs.org/api/net.html) [VERIFIED]
// lineBuffer is an instance field, cleared in 'connect' handler.
sock.on('data', (chunk: Buffer) => {
  this.lineBuffer += chunk.toString('utf8');
  let idx: number;
  while ((idx = this.lineBuffer.indexOf('\r\n')) !== -1) {
    const line = this.lineBuffer.slice(0, idx);
    this.lineBuffer = this.lineBuffer.slice(idx + 2);
    if (line.startsWith('TALLY OK ')) {
      const digits = line.slice('TALLY OK '.length);
      const rawTally = parseTallyString(digits);
      // ... length-change detection + emit
    }
  }
});
```

### atem-connection 'disconnected' event — verified from installed library

```typescript
// Source: installed node_modules/atem-connection/dist/atem.js [VERIFIED]
// BasicAtem.constructor() registers:
this.socket.on('disconnect', () => {
  this._status = AtemConnectionStatus.CLOSED;
  this.dataTransferManager.stopCommandSending();
  this._rejectAllCommands();
  this.emit('disconnected');   // ← user-space event name is 'disconnected'
  this._state = undefined;
});
// Note: this.atem.state is undefined after 'disconnected' fires.
// AtemConnector must not call atem.state after disconnect.
```

### TallyStateReconciler.reset() verified path

```typescript
// Source: src/core/tallyState.ts lines 109–118 [VERIFIED: codebase]
reset(): void {
  // Deliberate no-emit — reset is a setup step, not a state transition.
  this.lastSent = { program: null, preview: null };
}
// After reset(), the next submit() with any non-null state reports changed:true.
// Phase 1 test (tallyState.test.ts lines 180–192) covers this invariant.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-vmix` `ConnectionTCP` with hardcoded reconnect | Raw `node:net` Socket with custom backoff | Phase 5 | Full control over retry timing, jitter, and re-subscribe sequencing |
| No ATEM reconnect (Phase 4 fail-open) | `'disconnected'` → backoff → `connect()` | Phase 5 | ATEM link survives cable pulls mid-show |
| No re-assert after reconnect | `'ready'` event → `applyState(currentState)` | Phase 5 | ATEM bus always reflects current vMix tally after any reconnect |

**Deprecated/outdated:**
- `node-vmix` `ConnectionTCP`: replaced by raw `node:net`; package removed from dependencies.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Calling `atem.connect()` from inside `'disconnected'` handler is safe (no double-connect guard blocks it) | Architecture Patterns (Pattern 2) | ATEM reconnect loop never fires — would need to use `setImmediate()` or `setTimeout(0)` instead. MEDIUM risk. [Partially VERIFIED: atemSocket.js `_isDisconnecting` is only set by explicit `disconnect()`, not by drops.] |
| A2 | `lineBuffer` as a string accumulator (not Buffer) handles vMix TCP bytes correctly | Architecture Patterns (Pattern 1) | UTF-8 multi-byte boundary split could corrupt a line. LOW risk — vMix TALLY OK lines are pure ASCII digits. |

**All other claims in this research were verified against the installed library source or official Node.js documentation.**

---

## Open Questions

1. **Does `AtemConnector` already extend `EventEmitter` after Phase 4?**
   - What we know: Phase 4 CONTEXT.md D-01 says `AtemConnector` does NOT hold a reference
     to `TallyOrchestrator` (one-way wiring). Phase 4 discretion deferred EventEmitter
     extension: "defer [AtemConnector extends EventEmitter] — Phase 5 may need it for
     reconnect events."
   - What's unclear: Whether the Phase 4 planner added `extends EventEmitter` or not.
     Phase 4 plans not yet executed, so the actual file does not exist.
   - Recommendation: Phase 5 Wave 0 task confirms whether `AtemConnector extends EventEmitter`
     is already in the Phase 4 plan; if not, the Phase 5 plan adds it. Either way, the
     Phase 5 modification is the same.

2. **Should `node-vmix` removal be a separate Wave 0 task or part of the VmixConnector rewrite?**
   - What we know: `node-vmix` is not yet installed (not in package.json). If Phase 3
     is executed before Phase 5, it will be in package.json and installed.
   - What's unclear: Phase execution order. If Phase 3 runs first, `node-vmix` is in
     the tree and must be removed. If Phases 3–5 are planned together, the planner can
     simply not add `node-vmix` to Phase 3's install step.
   - Recommendation: Plan Phase 5 assuming `node-vmix` will be present (installed by
     Phase 3). Include an `npm uninstall node-vmix` step. If Phase 3 was never installed,
     this is a no-op.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node:net` | `VmixConnector` raw socket | ✓ | Built-in (Node 22) | — |
| `atem-connection` | `AtemConnector` | ✓ | 3.9.0 | — |
| `vitest` | Test suite | ✓ | ^3 (package.json) | — |
| `node-vmix` | Phase 3 (to be removed) | ✗ | not installed yet | Removal is the goal |

**Missing dependencies with no fallback:** None — Phase 5 requires only built-ins and
packages already installed.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^3 |
| Config file | `vitest.config.ts` (exists — `include: ["src/**/*.test.ts"]`) |
| Quick run command | `npx vitest run src/vmix/VmixConnector.test.ts src/atem/AtemConnector.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VMIX-04 | Backoff sequence: attempt=0→1s, attempt=1→2s (mocked jitter) | unit | `npx vitest run src/vmix/VmixConnector.test.ts` | ❌ Wave 0 |
| VMIX-04 | attempt counter resets to 0 on successful connect | unit | `npx vitest run src/vmix/VmixConnector.test.ts` | ❌ Wave 0 |
| VMIX-04 | lineBuffer cleared on reconnect (no stale bytes) | unit | `npx vitest run src/vmix/VmixConnector.test.ts` | ❌ Wave 0 |
| VMIX-04 | no double-reconnect: 'error'+'close' triggers only one timer | unit | `npx vitest run src/vmix/VmixConnector.test.ts` | ❌ Wave 0 |
| ATEM-04 | ATEM 'disconnected' → isHydrated=false, 'ready' not emitted | unit | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ Wave 0 |
| ATEM-04 | ATEM reconnect → isHydrated=true → 'ready' emitted | unit | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ Wave 0 |
| ATEM-04 | reconciler.reset() called before re-assert (no missed command) | unit | `npx vitest run src/atem/AtemConnector.test.ts` | ❌ Wave 0 |
| ATEM-04 | cable-pull: disconnect → reconnect → correct tally re-asserted | manual | see VERIFICATION.md cable-pull procedure | manual only |
| VMIX-04 + ATEM-04 | destroy() cancels pending retry timer | unit | `npx vitest run src/vmix/VmixConnector.test.ts src/atem/AtemConnector.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/vmix/VmixConnector.test.ts src/atem/AtemConnector.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/vmix/VmixConnector.test.ts` — extend with backoff + reconnect tests (file exists from Phase 3; needs new test sections)
- [ ] `src/atem/AtemConnector.test.ts` — extend with 'disconnected'/'ready' + backoff tests (file created in Phase 4; needs new sections)
- [ ] No new test infrastructure needed — existing vitest config covers `src/**/*.test.ts`

*(Key note: The test files themselves are created/extended by Phase 4 and Phase 3 execution.
Phase 5 adds reconnect-specific test sections to existing test files.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | LAN-only tool; no user auth |
| V3 Session Management | no | TCP sessions managed by node:net + atem-connection |
| V4 Access Control | no | Single-operator LAN tool |
| V5 Input Validation | yes | `parseTallyString` already guards non-0/1/2 chars (Phase 3); raw socket receives same input — no change |
| V6 Cryptography | no | Plaintext LAN protocols by design |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed TALLY OK line (truncated, non-ASCII) | Tampering | `parseTallyString` already coerces unknown chars to `0` (Phase 3); raw socket path unchanged |
| Uncontrolled reconnect loop (CPU spike) | Denial of Service (self-inflicted) | Backoff max 30 s caps retry rate; `destroyed` flag halts on explicit shutdown |

---

## Sources

### Primary (HIGH confidence)

- Installed `node_modules/atem-connection/dist/atem.js` — `BasicAtem` constructor, `'disconnected'` emission from `socket.on('disconnect')`, `_onInitComplete` / `'connected'` timing, `connect()`/`disconnect()`/`destroy()` API
- Installed `node_modules/atem-connection/dist/lib/atemSocket.js` — `_isDisconnecting` flag semantics, `freezeLimit: childProcessTimeout || 600`, `autoRestart: true`, reconnect-on-restart behavior
- `nodejs.org/api/net.html` — `net.Socket` event lifecycle (`'connect'`, `'data'`, `'error'`, `'close'`), correct reconnect pattern (new socket per attempt), `'error'` fires before `'close'`
- `src/core/tallyState.ts` — `reset()` method contract, no-emit guarantee, Phase 5 re-assert path documented in JSDoc
- `src/core/tallyState.test.ts` lines 167–192 — test coverage for `reset()` + re-assert path

### Secondary (MEDIUM confidence)

- `github.com/Sofie-Automation/sofie-atem-connection` README (via WebFetch) — `'connected'`, `'disconnected'`, `stateChanged` event names confirmed; 5-second disconnect description (MEDIUM — that description refers to freeze detection timeout, actual value is 600 ms from source)
- `github.com/Sofie-Automation/sofie-atem-connection` `src/atem.ts` (via WebFetch) — `AtemOptions` interface: no reconnect options; `connect()`/`disconnect()`/`destroy()` API surface

### Tertiary (LOW confidence)

- WebSearch results for node:net reconnect patterns — used for pattern guidance only; all implementation details verified against official Node.js docs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — node:net is a built-in; atem-connection lifecycle verified from installed source
- Architecture: HIGH — all reconnect patterns derived from verified library source and official docs
- Pitfalls: HIGH — double-reconnect, stale lineBuffer, missing reset() all derived from verified source behavior

**Research date:** 2026-07-01
**Valid until:** 2026-09-01 (atem-connection 3.9.0 is current; node:net API is stable)
