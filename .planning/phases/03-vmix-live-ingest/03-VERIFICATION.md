---
phase: 03-vmix-live-ingest
verified: 2026-07-01T09:43:00Z
status: human_needed
score: 8/8
overrides_applied: 0
human_verification:
  - test: "Connect to a real vMix instance and confirm 'Tally state resolved' appears in pino stdout within 100ms of a live/preview switch"
    expected: "Structured JSON log line with correct bus.program/bus.preview values each time a vMix input is taken live or to preview"
    why_human: "End-to-end TCP connection + vMix push path cannot be verified without a live vMix instance; timing guarantee (<100ms) requires real-world measurement"
  - test: "Disconnect vMix's TCP link mid-session and confirm VmixConnector auto-reconnects and re-sends SUBSCRIBE TALLY"
    expected: "Log shows 'vMix TCP disconnected', then 'vMix TCP connected' within the node-vmix reconnect interval (10s), and tally push resumes"
    why_human: "Reconnect loop requires a real TCP socket; the unit test proves the code path but not the live transport behavior"
  - test: "Add a vMix input mid-session (causing roster length change) and confirm no all-off flash on connected cameras"
    expected: "No camera briefly shows 'off' tally during the roster re-sync window; tally is held and emitted correctly after fetchRoster completes"
    why_human: "D-02/D-03 no-flash guarantee is proven in unit tests but the real timing of the async fetchRoster call against live vMix cannot be confirmed without hardware"
---

# Phase 3: vMix Live Ingest — Verification Report

**Phase Goal:** The bridge connects to vMix, subscribes to tally push, and feeds correct per-input live state into the Core — observing intent before any command touches the ATEM.
**Verified:** 2026-07-01T09:43:00Z
**Status:** HUMAN_NEEDED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Server connects to vMix over TCP (port 8099) using configured host/port and issues SUBSCRIBE TALLY | VERIFIED | `VmixConnector.ts` line 99: `new ConnectionTCP(host, { port: tcpPort, autoReconnect: true, debug: false })`. `tcp.send("SUBSCRIBE TALLY")` at line 140 inside `handleConnect()`. VMIX-01 unit tests (2 tests) pass: subscribe-on-connect and re-subscribe-on-reconnect. |
| 2 | When vMix operator takes input live or to preview, server receives the push and Core's live layer updates in real time (no polling) | VERIFIED | `VmixConnector.ts` uses `tcp.on('tally', ...)` push subscription (line 108). `handleTally` calls `parseTallyString` and emits typed `'tally'` event (line 163). `tallyOrchestrator.ts` listens `connector.on('tally', ...)` (line 139) and calls `resolve()` synchronously (line 165). VMIX-02 tests pass: tally event emitted on push, rosterUpdated emitted after connect. |
| 3 | Each tally string position resolves to stable vMix input Number/Key; parser strips TALLY OK prefix; regression tests pass incl. empty roster and reorder/delete | VERIFIED | `parseTallyString.ts`: empty string guard at line 23, positional array at line 24-28. `buildRuntimeMapping.ts`: Key→positional bridge, D-04 silent drop at line 41. 11 parseTallyString tests + 9 buildRuntimeMapping tests all green. SC4 reorder test: `reorderedRoster` produces `camA.vmixInput=2`. D-04 drop test: `partialRoster` returns length-1 array. |
| 4 | Adding or deleting a vMix input mid-session does not shift tally to wrong camera | VERIFIED | `VmixConnector.ts`: roster length-change detected (D-02, lines 152-158), triggers `resync()` which re-fetches roster and emits updated `'rosterUpdated'` before emitting `'tally'` (D-03 no-flash, lines 171-182). D-02/D-03 tests pass: resync triggered on length change, tally held until async resync completes. `buildRuntimeMapping` anchors on GUID (`vmixKey`) not position — SC4 proven by test. |

**Score:** 4/4 roadmap truths verified

### Plan must_haves Truths (merged)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| M-01 | parseTallyString('') returns [] | VERIFIED | Line 23 `if (tallyString.length === 0) return []`. Test: "empty string returns []" passes. |
| M-02 | parseTallyString('1020') returns [1,0,2,0] | VERIFIED | Line 24-28. Test: "'1020' returns [1,0,2,0]" passes. |
| M-03 | Non-0/1/2 chars coerce to 0 without throwing | VERIFIED | Line 27: `return n === 0 || n === 1 || n === 2 ? n : 0`. Tests: 'X'→[0], '3'→[0] pass. |
| M-04 | parseRosterXml returns Map<vmixKey, vmixNumber> from XML | VERIFIED | Two-pass regex at lines 29-50. 12 parseRosterXml tests pass. |
| M-05 | parseRosterXml returns empty Map on malformed/empty XML without throwing | VERIFIED | Guard at line 25 (`if (!xml) return result`); regex finds no matches → empty Map. Test: malformed XML → empty Map passes. |
| M-06 | buildRuntimeMapping produces MappingEntry[] with positional vmixInput from Key-anchored entries | VERIFIED | Line 39: `roster.get(entry.vmixKey)`, line 42-46: pushes `{ vmixInput: vmixNumber, ... }`. Normal-roster test passes. |
| M-07 | buildRuntimeMapping silently drops entries whose vmixKey is absent from roster (D-04) | VERIFIED | Line 41: `if (vmixNumber === undefined) continue`. D-04 test with partialRoster returns length-1 array. |
| M-08 | Key reorder produces MappingEntry with updated vmixInput (SC4) | VERIFIED | reorderedRoster test: camA vmixInput=2, camB vmixInput=1 — passes. |
| M-09 | vmixHttpPort is optional on vmix connection sub-schema; existing configs without it parse as valid | VERIFIED | `schema.ts` line 35: `vmixHttpPort: z.number().int().min(1).max(65535).optional()`. 5 D-08 tests in schema.test.ts pass. |
| M-10 | VmixConnector connects to vMix over TCP at configured host:port (VMIX-01) | VERIFIED | Constructor line 99, ConnectionTCP instantiation. VMIX-01 tests pass. |
| M-11 | VmixConnector sends SUBSCRIBE TALLY in every 'connect' handler including after reconnect | VERIFIED | Line 107: `tcp.on("connect", () => void this.handleConnect())`. Line 140: `tcp.send("SUBSCRIBE TALLY")` inside handleConnect. Reconnect test passes (send called twice). |
| M-12 | VmixConnector emits 'tally' event with { rawTally, rosterLength } | VERIFIED | Lines 163, 182: `this.emit("tally", { rawTally, rosterLength: rawTally.length } satisfies TallyEventData)`. VMIX-02 tally push test passes. |
| M-13 | VmixConnector emits 'rosterUpdated' event with Map<string,number> after roster fetch | VERIFIED | Lines 136, 181: `this.emit("rosterUpdated", new Map(this.rosterMap))`. rosterUpdated test passes. |
| M-14 | VmixConnector does NOT import from core/ | VERIFIED | `grep -n "^import.*from.*core/" VmixConnector.ts` → empty. Comment at line 5 is not an import statement. |
| M-15 | VmixConnector triggers roster re-sync when TALLY string length changes (D-02) | VERIFIED | Lines 152-158: length-change check with sentinel guard. D-02 test: rosterUpdated emitted a second time after resync. |
| M-16 | During re-sync, last known tally is held — no all-off flash (D-03) | VERIFIED | Lines 157, 171-182: resync() does not emit 'tally' until after fetchRoster completes. D-03 test: tally not emitted synchronously during resync. |
| M-17 | VmixConnector.roster() returns copy of internal Map | VERIFIED | Line 190: `return new Map(this.rosterMap)`. Copy-mutation test passes. |
| M-18 | node-vmix and pino present in package.json dependencies | VERIFIED | `"node-vmix": "^1.7.1"` and `"pino": "^10.3.1"` in dependencies section. Note: pino 10.3.1 installed (plan specified 9.x); CLAUDE.md recommended 9.x. TypeScript compiles clean and all 140 tests pass with 10.x — functional compatibility confirmed. |
| M-19 | On each 'tally' event, orchestrator calls buildRuntimeMapping then resolve() | VERIFIED | tallyOrchestrator.ts lines 155-168: getMapping() → buildRuntimeMapping() → resolve(). |
| M-20 | Resolved ResolverOutput stored in-memory and accessible via getter | VERIFIED | Line 179: `this.currentState = newState`. Line 226: `currentDesiredState(): ResolverOutput | null`. |
| M-21 | Each tally state change logged via pino (structured: oldState, newState) | VERIFIED | Lines 182-199: `logger.info({ bus, cameras, rosterLength, prevBus }, "Tally state resolved")` when busChanged. |
| M-22 | Phase 4 can plug in via 'stateChanged' event or currentDesiredState() getter | VERIFIED | Line 209: `this.emit("stateChanged", stateCopy)`. Line 226: `currentDesiredState()`. |
| M-23 | Orchestrator reads persisted mapping from ConfigStore (D-11) | VERIFIED | Line 155: `this.configStore.getMapping()`. ConfigStoreReader interface exported at line 57. |
| M-24 | Orchestrator reads overrides as empty array for Phase 3 | VERIFIED | Line 168: `[] as OverrideEntry[]` passed to resolve(). |
| M-25 | Orchestrator does not call any ATEM functions | VERIFIED | No ATEM imports in any src/vmix/ file. grep confirms zero ATEM import lines. |
| M-26 | tallyOrchestrator.ts is the ONLY file in src/vmix/ that imports from src/core/ | VERIFIED | buildRuntimeMapping.ts has `import type { MappingEntry }` — type-only, erased at compile time (verbatimModuleSyntax). Runtime import boundary intact: only tallyOrchestrator.ts has value imports from core/. VmixConnector.ts has zero core/ imports. |

**Score:** 26/26 plan must_haves verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/vmix/parseTallyString.ts` | Pure tally string parser, exports parseTallyString | VERIFIED | 29 lines, exports `parseTallyString`, no imports |
| `src/vmix/parseTallyString.test.ts` | Regression tests for VMIX-03 tally indexing | VERIFIED | 11 tests, all green |
| `src/vmix/parseRosterXml.ts` | Pure XML roster parser + fetchRoster | VERIFIED | 83 lines, exports `parseRosterXml` and `fetchRoster` |
| `src/vmix/parseRosterXml.test.ts` | Fixture-driven tests for roster XML parsing | VERIFIED | 12 tests, all green, includes `numberBeforeKeyXml` A2 fixture |
| `src/vmix/buildRuntimeMapping.ts` | Pure Key→positional vmixInput bridge | VERIFIED | 49 lines, exports `buildRuntimeMapping` |
| `src/vmix/buildRuntimeMapping.test.ts` | SC4 Key-reorder and D-04 silent-drop tests | VERIFIED | 9 tests, all green |
| `src/config/schema.ts` | Extended with vmixHttpPort optional field | VERIFIED | `vmixConnection` sub-schema at line 27-37, `vmixHttpPort` at line 35 |
| `src/config/schema.test.ts` | Backward-compat tests for vmixHttpPort | VERIFIED | 5 D-08 tests added, all 32 schema tests green |
| `src/vmix/VmixConnector.ts` | EventEmitter wrapping ConnectionTCP | VERIFIED | 199 lines, exports `VmixConnector`, `TallyEventData`, `TcpConnection` |
| `src/vmix/VmixConnector.test.ts` | Unit tests for VMIX-01 and VMIX-02 | VERIFIED | 14 tests, all green |
| `src/vmix/tallyOrchestrator.ts` | Orchestrator wiring VmixConnector → resolve → state | VERIFIED | 236 lines, exports `TallyOrchestrator`, `ConfigStoreReader` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `buildRuntimeMapping.ts` | `core/resolver.ts` | `import type { MappingEntry }` | VERIFIED | Line 6: `import type { MappingEntry } from "../core/resolver.js"` — type-only (verbatimModuleSyntax, erased at compile) |
| `buildRuntimeMapping.ts` | `config/schema.ts` | `import type { PersistedMappingEntry }` | VERIFIED | Line 7: `import type { PersistedMappingEntry } from "../config/schema.js"` |
| `config/schema.ts` | vmixConnection sub-schema | `vmixHttpPort optional field` | VERIFIED | Lines 27-37: `vmixConnection` object with `vmixHttpPort: z.number().int().min(1).max(65535).optional()` |
| `VmixConnector.ts` | node-vmix ConnectionTCP | named ESM import | VERIFIED | Line 14: `import { ConnectionTCP } from "node-vmix"` |
| `VmixConnector.ts` | `parseTallyString.ts` | parseTallyString call in handleTally | VERIFIED | Line 148: `const rawTally = parseTallyString(tallyString)` |
| `VmixConnector.ts` | `parseRosterXml.ts` | fetchRoster call in handleConnect and resync | VERIFIED | Lines 130, 177: `this.rosterMap = await fetchRoster(...)` |
| `VmixConnector.ts` | pino Logger | injected Logger constructor parameter | VERIFIED | Line 15: `import type { Logger } from "pino"`, line 70: `private readonly logger: Logger` |
| `tallyOrchestrator.ts` | `core/resolver.ts` | resolve() function call | VERIFIED | Line 25: `import { resolve } from "../core/resolver.js"`, line 165: `resolve(data.rawTally, runtimeMapping, ...)` |
| `tallyOrchestrator.ts` | `buildRuntimeMapping.ts` | buildRuntimeMapping() call on each tally event | VERIFIED | Line 31: `import { buildRuntimeMapping }`, line 158: `buildRuntimeMapping(persisted, this.connector.roster())` |
| `tallyOrchestrator.ts` | `VmixConnector.ts` | connector.on('tally', ...) listener | VERIFIED | Line 139: `this.connector.on("tally", (data: TallyEventData) => this.handleTally(data))` |
| `tallyOrchestrator.ts` | pino logger | pino() instantiation | VERIFIED | Line 22: `import pino from "pino"`, line 114: `this.logger = logger ?? pino()` |

### Data-Flow Trace (Level 4)

These files emit structured data to the orchestrator (no UI rendering in this phase). The data flow is:

| Source | Data Variable | Produces Real Data | Status |
|--------|---------------|--------------------|--------|
| `parseTallyString(tallyString)` | `rawTally: number[]` | Yes — positional parse of live TCP push string | FLOWING |
| `buildRuntimeMapping(persisted, roster)` | `runtimeMapping: MappingEntry[]` | Yes — GUID lookup against live roster Map | FLOWING |
| `resolve(rawTally, runtimeMapping, [])` | `newState: ResolverOutput` | Yes — pure function produces per-camera state | FLOWING |
| `configStore.getMapping()` | `persisted: PersistedMappingEntry[]` | Deferred — configStore.ts not yet implemented (Phase 2 Plan 02-02 pending) | DEFERRED |

Note: `configStore.ts` does not exist yet (Phase 2 Plan 02-02 not executed). The orchestrator uses the `ConfigStoreReader` interface. The data flow from disk → orchestrator is intentionally disconnected until Phase 2 Plan 02-02 ships the concrete store. This is a known deferred item, not a gap — the `ConfigStoreReader` interface is the correct seam.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite passes (140 tests) | `npx vitest run` | 8 test files, 140 tests, 0 failures | PASS |
| TypeScript compiles clean | `npx tsc --noEmit` | No output (exit 0) | PASS |
| parseTallyString exports correctly | `grep -c "export function parseTallyString" src/vmix/parseTallyString.ts` | 1 | PASS |
| parseRosterXml exports both functions | `grep -c "export" src/vmix/parseRosterXml.ts` | 2 (parseRosterXml + fetchRoster) | PASS |
| buildRuntimeMapping exports correctly | `grep -c "export function buildRuntimeMapping" src/vmix/buildRuntimeMapping.ts` | 1 | PASS |
| TallyOrchestrator exports correctly | `grep -c "export class TallyOrchestrator" src/vmix/tallyOrchestrator.ts` | 1 | PASS |
| Only orchestrator has runtime core/ imports | `grep -rn "^import.*from.*core/" src/vmix/` | Only tallyOrchestrator.ts (3 lines) | PASS |
| No ATEM imports in vmix/ | `grep -rn "^.*import.*atem" src/vmix/` (case-insensitive) | 0 matches | PASS |
| All phase-3 commits present | `git log --oneline` | fdff989, 36fa665, d61da91, c99862c, 1e5bbf9 — all found | PASS |

### Probe Execution

No probe scripts declared or conventional probe files found for this phase. Step 7c: SKIPPED (no probe scripts).

### Requirements Coverage

| Requirement | Phase | Description | Status | Evidence |
|-------------|-------|-------------|--------|----------|
| VMIX-01 | Phase 3 | Server verbindet sich mit vMix über TCP-API (Port 8099) mit konfigurierbarem Host/Port | SATISFIED | `VmixConnector.ts` constructor: `new ConnectionTCP(host, { port: tcpPort })`. Confirmed by VMIX-01 unit tests. |
| VMIX-02 | Phase 3 | Server abonniert vMix-Tally und empfängt Live-/Preview-Zustandsänderungen in Echtzeit (Push) | SATISFIED | `SUBSCRIBE TALLY` sent inside `handleConnect()` on every connect/reconnect. Push-triggered `'tally'` event wired through to resolver. Confirmed by VMIX-02 unit tests. |
| VMIX-03 | Phase 3 | Server löst jede Tally-Position auf stabile vMix-Input-Identität (Number/Key) auf | SATISFIED | `parseTallyString` → positional array; `buildRuntimeMapping` → Key-GUID anchor; SC4 reorder test and D-04 silent-drop test proven. |

All 3 phase-3 requirements are satisfied by codebase evidence.

No orphaned requirements: REQUIREMENTS.md maps only VMIX-01, VMIX-02, VMIX-03 to Phase 3. All 3 are claimed by PLAN.md frontmatter and verified above.

### Anti-Patterns Found

No debt markers (TBD, FIXME, XXX) found in any `src/vmix/` or modified `src/config/schema.ts` files.

No placeholder implementations, empty handlers, or stub returns found. All exported functions are substantively implemented.

One notable observation (WARNING — informational):

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `package.json` | dependencies | pino 10.3.1 installed vs CLAUDE.md recommended 9.x | INFO | CLAUDE.md recommends `pino 9.x` but `^10.3.1` was installed. All 140 tests pass with 10.x; TypeScript compiles clean. The `^` range in package.json means future installs may pull newer minor versions. No functional regression observed — pino's Logger type interface is compatible. |

### Human Verification Required

#### 1. End-to-End Live Tally Path

**Test:** Start the server with a configured vMix host/port. In vMix, take an input live (program). Observe stdout pino JSON output.
**Expected:** A log line appears within 100ms of the vMix switch, containing `"msg":"Tally state resolved"` with `bus.program` equal to the vMix input number for the camera mapped in config.
**Why human:** End-to-end TCP connection + vMix push path cannot be verified without a live vMix instance. The 100ms timing guarantee (REL-01 prerequisite) requires real-world measurement. Unit tests prove the code path but not transport latency.

#### 2. Reconnect Re-subscribe Behavior

**Test:** With the server connected to a live vMix instance, kill and restart the vMix TCP API (or temporarily block the port). Wait for reconnect.
**Expected:** Log shows `"vMix TCP disconnected"` then `"vMix TCP connected"` within ~10 seconds (node-vmix fixed interval). After reconnect, tally push resumes and `SUBSCRIBE TALLY` is confirmed re-sent (detectable by tally events resuming on the next vMix switch).
**Why human:** Reconnect loop requires a real TCP socket; mock TCP in unit tests proves the code structure but not the live reconnect transport behavior. node-vmix's 10s interval is a documented behavioral constraint.

#### 3. Roster Re-sync No-Flash Guarantee

**Test:** With the server connected and at least 2 cameras mapped, add a new input in vMix (causing roster length change). Observe the cameras' tally indicators (or log output) during the re-sync window.
**Expected:** No camera briefly shows 'off' during the re-sync window. After the re-sync completes, tally is correct for all cameras including the new input's position. The `roster_resync` log event appears.
**Why human:** D-02/D-03 no-flash guarantee is proven in unit tests by checking event order and async microtask scheduling. The real timing of `fetchRoster` (HTTP call to vMix) against live vMix input adds cannot be confirmed without hardware — the HTTP call's actual duration under load determines whether the hold is effective in practice.

### Gaps Summary

No gaps. All 26 plan must_haves are VERIFIED. All 4 roadmap success criteria are VERIFIED. All 3 requirement IDs (VMIX-01, VMIX-02, VMIX-03) are satisfied by codebase evidence. TypeScript compiles clean. 140 tests pass.

The `configStore.ts` implementation is pending (Phase 2 Plan 02-02 not yet executed) — this is a deferred item that the orchestrator handles via the `ConfigStoreReader` interface. It is not a gap in Phase 3's deliverables.

Human verification is required for 3 live-hardware behaviors that cannot be confirmed programmatically.

---

_Verified: 2026-07-01T09:43:00Z_
_Verifier: Claude (gsd-verifier)_
