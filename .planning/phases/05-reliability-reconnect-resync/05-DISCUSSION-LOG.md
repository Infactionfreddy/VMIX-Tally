# Phase 5: Reliability — Reconnect + Resync - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 05-reliability-reconnect-resync
**Areas discussed:** Hydration-Gate Reset, ATEM Resync Trigger, Backoff-Parameter, vMix Reconnect Transport

---

## Hydration-Gate Reset bei ATEM-Disconnect

| Option | Description | Selected |
|--------|-------------|----------|
| Bei jedem 'disconnected'-Event | isHydrated=false on every disconnect. Simple, safe. | ✓ |
| Nur bei unerwarteten Drops | Distinguishes graceful vs unexpected. More complex. | |

**Decision captured:** D-01 in CONTEXT.md

---

## ATEM Resync — wer triggert Re-Assert

| Option | Description | Selected |
|--------|-------------|----------|
| AtemConnector 'ready' Event → server.ts | AtemConnector emits 'ready' on hydration; server.ts calls applyState(orchestrator.currentState). | ✓ |
| server.ts pollt currentState nach Reconnect | Polling-based, less clean. | |

**Decision captured:** D-02 in CONTEXT.md

---

## Backoff-Parameter

### Values

| Option | Description | Selected |
|--------|-------------|----------|
| 1s initial, 30s max, ±25% jitter | Standard LAN backoff. Fast enough for production, safe against reconnect storms. | ✓ |
| 500ms initial, 10s max | More aggressive, higher load on extended outages. | |

### Symmetry

| Option | Description | Selected |
|--------|-------------|----------|
| Gleiche Parameter für beide Links | DRY, no reason for asymmetry on same LAN. | ✓ |
| Separate Parameter | More flexible, more complexity. | |

**Decision captured:** D-03 in CONTEXT.md

---

## vMix Reconnect — node-vmix vs Raw Socket

| Option | Description | Selected |
|--------|-------------|----------|
| Raw net.Socket + custom backoff loop | Full control, no monkey-patching, cleans up axios dep. Resolves Phase 3 D-07 seam. | ✓ |
| node-vmix Monkey-Patch | Fragile, depends on library internals. | |
| Wrapper: destroy + recreate ConnectionTCP | Middleground. Still no backoff control without workarounds. | |

**Follow-up — HTTP roster fetch:**

| Option | Description | Selected |
|--------|-------------|----------|
| Unchanged — triggered after each reconnect | fetchRoster() called on 'connect', same as Phase 3. | ✓ |
| Add HTTP retry logic | Extra complexity, not needed on LAN. | |

**Decision captured:** D-04, D-05, D-06 in CONTEXT.md

---

## Claude's Discretion

- Backoff utility inline vs `src/utils/backoff.ts`
- Whether node-vmix is removed from package.json (removes axios dep)
- Raw socket framing strategy (string accumulation vs Buffer)
