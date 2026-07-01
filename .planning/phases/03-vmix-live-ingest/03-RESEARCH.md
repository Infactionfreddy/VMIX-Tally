# Phase 3: vMix Live Ingest - Research

**Researched:** 2026-07-01
**Domain:** vMix TCP tally push client, HTTP XML roster fetch, pure-function tally parser
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** On initial connect, fetch the vMix input roster via HTTP GET to vMix port 8088
(`http://{host}:{httpPort}/api`). HTTP XML response includes `key` (GUID), `number`,
and `title` per input. TCP port 8099 is used only for TALLY push — dual-transport split:
HTTP for roster data, TCP for tally events.

**D-02:** Re-sync the roster when the TALLY string length changes (character count = input
count). Immediately re-fetch HTTP roster and rebuild the Key→position lookup. Satisfies SC4.

**D-03:** During the re-sync window (TALLY length changed, HTTP re-fetch in-flight): hold the
last known tally state. No all-off flash, no stale camera flicker.

**D-04:** When a `vmixKey` from persisted config is not found in the refreshed roster:
silently drop it from the runtime mapping. No loud error. Persisted config unchanged.

**D-05:** Use `node-vmix` library (`ConnectionTCP`) for the TCP connection and TALLY push
subscription. Axios transitive dependency accepted.

**D-06:** HTTP roster fetch uses Node 22 native `fetch` — no axios on this path.

**D-07 (Phase 5 seam):** Phase 3 uses node-vmix directly (no reconnect backoff wrapper).
Phase 5 evaluates whether node-vmix's reconnect API suffices or needs replacement.

**D-08:** vMix HTTP port is separately configurable — new optional `vmixHttpPort` field
(default: 8088) added to `src/config/schema.ts`. Backward-compatible optional field.

**D-09:** `VmixConnector` (in `src/vmix/`) is an EventEmitter that emits:
- `'tally'` → `{ rawTally: number[], rosterLength: number }`
- `'rosterUpdated'` → `Map<string, number>` (Key→Number after roster fetch)

`VmixConnector` does NOT import from `core/` or call the resolver directly.

**D-10:** Key→position translation lives in a separate pure function
`buildRuntimeMapping(persisted: PersistedMappingEntry[], roster: Map<string, number>): MappingEntry[]`
in `src/vmix/`. Silently drops entries not found in roster (D-04). Pure function, easily
unit-tested.

**D-11:** The Phase 3 orchestrator listens to VmixConnector events, calls
`buildRuntimeMapping`, calls `resolve(tally, mapping, overrides)`, and stores the latest
`ResolverOutput` in memory as "current desired state." Logs each change via pino.
Phase 4 plugs in by observing this in-memory state to send ATEM commands.

**D-12:** Phase 3 integration tests inject pre-captured TALLY strings directly into the
parser/translation logic, bypassing the node-vmix transport layer. Fixtures must cover:
empty roster, normal tally, vMix Number reorder (same Key, different position), and
mid-session delete (Key disappears from roster, length changes).

### Claude's Discretion

- Exact module filenames within `src/vmix/` (e.g. `VmixConnector.ts`,
  `buildRuntimeMapping.ts`, `tallyOrchestrator.ts` — or a single `index.ts` facade).
- XML parsing approach for HTTP roster response (Node's built-in DOMParser [not available
  in Node 22], `fast-xml-parser`, or regex scan — all defensible; see research below).
- Whether `VmixConnector` extends `EventEmitter` directly or uses a typed emitter wrapper.
- Whether the in-memory "current desired state" in the orchestrator is a simple property
  or uses a simple observer pattern for Phase 4 hookup.

### Deferred Ideas (OUT OF SCOPE)

- SUBSCRIBE ACTS for roster change events (Phase 5/research backlog)
- Reconnect with backoff/jitter (VMIX-04, Phase 5)
- vMix ACTS/FUNCTION subscriptions beyond TALLY (v2)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VMIX-01 | Server verbindet sich mit vMix über die TCP-API (Port 8099) mit konfigurierbarem Host/Port | `ConnectionTCP(host, { port })` constructor — verified from node-vmix source |
| VMIX-02 | Server abonniert vMix-Tally und empfängt Live-/Preview-Zustandsänderungen in Echtzeit (Push) | `SUBSCRIBE TALLY\r\n` over TCP → push on every change; no polling needed |
| VMIX-03 | Server löst jede Tally-Position auf eine stabile vMix-Input-Identität (Number/Key) auf | HTTP roster fetch provides Key↔Number; `buildRuntimeMapping` resolves Key→vmixInput |
</phase_requirements>

---

## Summary

Phase 3 adds the first network-touching module to the project: `src/vmix/`. The domain
splits cleanly into three sub-problems: (1) a TCP client that subscribes to vMix tally
push, (2) an HTTP client that fetches the input roster once per session-start (and on
roster-length-change) to build a stable Key→Number lookup, and (3) a pure-function layer
that resolves each incoming tally digit-string through the roster lookup and into the
resolver's `MappingEntry[]` contract.

The node-vmix `ConnectionTCP` class is a CJS module (confirmed importable via named ESM
import in Node 22 with `"module": "NodeNext"`). Its `tally` event emits a **raw string**
after stripping the `TALLY OK ` prefix — the parser receives digits like `"0120"` where
position `i` corresponds to vMix input number `i+1` (0-based string index, 1-based input
number). This is the critical tally indexing fact: the resolver's `vmixInput` field is
1-based and uses `safeTally[entry.vmixInput - 1]` internally, so the parser must produce a
`number[]` where `array[0]` holds the state of vMix input 1.

The vMix HTTP API at port 8088 returns XML with `<input key="..." number="..." title="..."/>`
elements. The `key` attribute is a GUID (e.g. `26cae087-b7b6-4d45-98e4-de03ab4feb6b`);
`number` is the 1-based sequential input number that matches the tally string position.
Node 22 does **not** expose a built-in `DOMParser` — the XML parsing must use either
`fast-xml-parser`, a regex scan over the input elements, or a custom line-parser. All
three are defensible at this data shape; research recommends regex or fast-xml-parser
(see Architecture Patterns).

**Primary recommendation:** Implement `VmixConnector` as an `EventEmitter` subclass in
`src/vmix/VmixConnector.ts`; keep `buildRuntimeMapping` as a separate pure function in
`src/vmix/buildRuntimeMapping.ts`; keep the orchestrator in `src/vmix/tallyOrchestrator.ts`.
Use regex-based XML parsing for zero additional dependencies; if it proves brittle in
testing, `fast-xml-parser` is the clean fallback.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TCP tally subscription (SUBSCRIBE TALLY) | `src/vmix/` (VmixConnector) | — | Only network-touching module; isolated from core/ and config/ |
| HTTP roster fetch (Key→Number XML) | `src/vmix/` (VmixConnector) | — | Dual-transport: HTTP for data, TCP for events — both in vmix/ |
| TALLY string parser (digits → `number[]`) | `src/vmix/` (pure function) | — | Stateless transform; no I/O; pure function enables isolated testing |
| Key→vmixInput translation (buildRuntimeMapping) | `src/vmix/` (pure function) | — | Bridges config/ Key-anchor to core/ positional vmixInput; pure |
| Resolver call (`resolve(tally, mapping, overrides)`) | `src/vmix/` (orchestrator) | `src/core/` | vmix/ orchestrator calls resolve(); core/ owns the function |
| In-memory desired state storage | `src/vmix/` (orchestrator) | — | Phase 4 reads this; kept in vmix/ until Phase 6 adds WebSocket push |
| Config access (vmixHttpPort, persisted mapping) | `src/config/` | `src/vmix/` (consumer) | config/ is the only disk-touching module; vmix/ reads via ConfigStore |
| Logging | `src/vmix/` (pino logger) | — | Per CLAUDE.md; pino must be installed as a standalone dep (Fastify not yet added) |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node-vmix` | 1.7.1 | TCP SUBSCRIBE TALLY push client | Only maintained vMix TCP client in Node.js; `ConnectionTCP` wraps framing, line-splitting, event routing — verified from source [VERIFIED: npm registry + GitHub source] |
| `pino` | 9.x (latest 9.7.0) | Structured logging | Per CLAUDE.md; live-production tool needs timestamped logs; install standalone (Fastify not yet in project) [ASSUMED — version from npm, not verified for this phase specifically] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fast-xml-parser` | 5.9.3 | Parse HTTP XML roster response | If regex scan proves fragile in fixtures (e.g. multi-line XML, attributes in unusual order); 81M weekly downloads, MIT, 9 years old [VERIFIED: npm registry] |
| Node 22 `fetch` (built-in) | native | HTTP GET to `http://{host}:8088/api` | No extra dep needed; D-06 locks this choice [VERIFIED: Node.js 22 docs] |
| `node:events` `EventEmitter` | built-in | Base class for VmixConnector | Already used in `src/core/tallyState.ts`; no extra dep [VERIFIED: existing codebase] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node-vmix` | Raw `net.Socket` + hand-rolled `TALLY OK ` line parser | Eliminates axios transitive dep; gives full reconnect control; ~40 lines. D-05 chose node-vmix for reduced maintenance surface. CLAUDE.md documents this as a strong, defensible alternative. |
| regex XML scan | `fast-xml-parser` | fast-xml-parser is more robust for attribute ordering and multi-line XML; regex is zero-dep and sufficient for vMix's consistent `<input key="..." number="..." title="..."/>` format |
| regex XML scan | Node 22 `--experimental-vm-modules` + JSDOM | JSDOM is a large dependency; overkill for a roster fetch |
| `pino` standalone | `console.log` | console.log has no log levels, no JSON structure, no timestamps — not appropriate for a production server |

**Installation (new deps for Phase 3):**
```bash
npm install node-vmix pino
npm install --save-dev @types/pino
```

**Note:** `fast-xml-parser` is optional — only install if regex approach is not chosen.
```bash
npm install fast-xml-parser   # optional, only if regex XML approach not used
```

**Version verification (run before installing):**
```bash
npm view node-vmix version      # → 1.7.1
npm view pino version           # → 9.x
npm view fast-xml-parser version # → 5.9.3
```

---

## Package Legitimacy Audit

> slopcheck was not installable in this environment. All packages manually verified via
> npm registry, download counts, and source repository inspection.

| Package | Registry | Age | Downloads/wk | Source Repo | slopcheck | Disposition |
|---------|----------|-----|--------------|-------------|-----------|-------------|
| `node-vmix` | npm | ~6 yrs (2020-01-29) | 311 | github.com/jensstigaard/node-vmix | unavailable | Approved [ASSUMED — low-download domain-specific tool; legitimate for the vMix ecosystem] |
| `pino` | npm | ~10 yrs | millions | github.com/pinojs/pino | unavailable | Approved [ASSUMED — widely adopted Node.js logger; fastify depends on it] |
| `fast-xml-parser` | npm | ~9 yrs (2017-01-28) | 81.8M | github.com/NaturalIntelligence/fast-xml-parser | unavailable | Approved if chosen [VERIFIED: npm registry — 195 versions, MIT, 81M weekly downloads confirms legitimacy] |

**Packages removed due to slopcheck [SLOP] verdict:** none

**Packages flagged as suspicious [SUS]:** none

**Note on node-vmix download count (311/wk):** Low weekly downloads are expected for a
niche vMix-ecosystem library. This is the same situation as `atem-connection` — a
broadcast-automation specialist tool with a known, identifiable author (jensstigaard,
36 published versions from 2020 to 2024). The GitHub repository is active and the package
is the primary vMix Node.js client in the ecosystem. Treating the low download count as
suspicious would incorrectly penalise domain-specific tooling.

*Since slopcheck was unavailable, the planner should add a `checkpoint:human-verify`
before the `npm install node-vmix` task.*

---

## Architecture Patterns

### System Architecture Diagram

```
vMix (TCP port 8099)
  │  TALLY OK 0120...\r\n  (push on every take)
  ▼
ConnectionTCP (node-vmix)
  │  'tally' event → raw digit string (e.g. "0120")
  ▼
VmixConnector (EventEmitter, src/vmix/)
  ├─ parseTallyString(str) → number[]          [pure]
  ├─ detects length change → triggers roster re-fetch
  │
  ├─ emits 'tally'         → { rawTally: number[], rosterLength: number }
  └─ emits 'rosterUpdated' → Map<vmixKey, vmixNumber>
            │
            ▼
  HTTP GET http://{host}:{httpPort}/api (Node fetch, port 8088)
  ← XML response with <input key="GUID" number="N" title="..."/>
  ← parseRosterXml() → Map<string, number>  [pure]
            │
            ▼
tallyOrchestrator (src/vmix/)
  ├─ reads persisted mapping from ConfigStore (config/)
  ├─ buildRuntimeMapping(persisted, roster) → MappingEntry[]  [pure]
  ├─ resolve(rawTally, runtimeMapping, overrides) → ResolverOutput  (core/)
  ├─ stores currentState: ResolverOutput  (in-memory)
  └─ logs changes via pino
            │
            ▼
  currentState (ResolverOutput)
  ← Phase 4 reads this to send ATEM commands
```

### Recommended Project Structure

```
src/
├── config/          # disk-touching (Phase 2) — DO NOT import from vmix/
├── core/            # pure resolver + events (Phase 1) — DO NOT import from vmix/ or config/
└── vmix/            # NEW Phase 3 — only network-touching module
    ├── VmixConnector.ts          # EventEmitter; wraps ConnectionTCP; emits 'tally' + 'rosterUpdated'
    ├── VmixConnector.test.ts     # inject pre-captured TALLY strings, mock HTTP fetch
    ├── buildRuntimeMapping.ts    # pure: (PersistedMappingEntry[], Map<key,number>) → MappingEntry[]
    ├── buildRuntimeMapping.test.ts  # pure function fixtures: reorder, delete, empty roster
    ├── parseTallyString.ts       # pure: string → number[] (split digits, guard non-0/1/2)
    ├── parseTallyString.test.ts  # captured TALLY string fixtures
    ├── parseRosterXml.ts         # pure: string → Map<vmixKey, vmixNumber>
    ├── parseRosterXml.test.ts    # fixture XML strings
    └── tallyOrchestrator.ts      # wires VmixConnector → buildRuntimeMapping → resolve → log
```

### Pattern 1: ConnectionTCP Instantiation and Subscription

**What:** Instantiate with autoReconnect enabled (default); register all listeners before
the constructor's internal `setTimeout(0)` fires the first connect attempt.

**When to use:** In `VmixConnector` constructor.

```typescript
// Source: node-vmix source + verified ESM import test (Node 22)
import { ConnectionTCP } from 'node-vmix';

// Named ESM import from CJS node-vmix works in Node 22 / NodeNext — verified.
// node-vmix has no "exports" field in package.json; falls back to "main" (CJS interop).

const tcp = new ConnectionTCP(host, {
  port: 8099,              // default, but explicit is better
  autoReconnect: true,     // default; Phase 5 may replace with custom backoff
  debug: false,
});

// Register listeners BEFORE setTimeout(0) fires auto-connect
tcp.on('connect', async () => {
  // Re-fetch roster on EVERY connect (initial + after reconnect)
  await fetchAndBuildRoster();
  // Re-subscribe on EVERY connect (initial + after reconnect)
  tcp.send('SUBSCRIBE TALLY');
});

tcp.on('tally', (tallyString: string) => {
  // tallyString = raw string with 'TALLY OK ' already stripped by node-vmix
  // e.g. "0120" → input1=off, input2=program, input3=preview, input4=off
  const rawTally = parseTallyString(tallyString);
  // ...
});

tcp.on('close', () => {
  // node-vmix fires close on disconnect; autoReconnect kicks in automatically
  // Phase 3: log the disconnect. No manual reconnect logic needed.
});

tcp.on('error', (err: Error) => {
  // node-vmix sets _isConnected = false on error
  // Log; do not throw
});
```

### Pattern 2: TALLY String Parser (pure function)

**What:** Strip is already done by node-vmix. The parser's job is to split the digit
string into a `number[]`, guard non-numeric characters, and return an empty array for
empty input (empty roster edge case).

**Critical indexing fact:** `string[i]` → `vmixInput: i+1` (0-based string, 1-based input
number). The resolver uses `safeTally[entry.vmixInput - 1]`, so this array is correct.

```typescript
// Source: derived from resolver.ts vmixInput indexing + vMix TCP API docs
// [VERIFIED: node-vmix source _emitTallyMessage; CITED: vmix.com/help28/TCPAPI.html]

/**
 * Parse the tally digit string emitted by node-vmix's 'tally' event.
 * node-vmix already strips 'TALLY OK ' — input here is the bare digit string.
 *
 * Returns number[] where array[i] = state of vMix input (i+1):
 *   0 = off, 1 = program, 2 = preview
 *
 * Edge cases:
 *   - Empty string (no inputs in vMix) → []
 *   - Non-numeric character → treated as 0 (off)
 *   - Character other than '0'/'1'/'2' → treated as 0 (defensive total-function)
 */
export function parseTallyString(tallyString: string): number[] {
  if (tallyString.length === 0) return [];
  return [...tallyString].map((ch) => {
    const n = Number(ch);
    return n === 0 || n === 1 || n === 2 ? n : 0;
  });
}
```

### Pattern 3: HTTP Roster Fetch (native fetch + regex XML parse)

**What:** GET `http://{host}:{httpPort}/api` — returns XML. Parse `<input>` elements to
extract `key` (GUID) and `number` (1-based integer).

**Why regex is defensible here:** vMix HTTP API returns consistent single-line `<input>`
elements with stable attribute order `key="..." number="..." type="..." title="..."`.
The roster fetch is not parsing arbitrary XML — just extracting two attributes from a
well-known stable format.

```typescript
// Source: vMix HTTP API docs (vmix.com/help28/DeveloperAPI.html)
// [CITED: vmix.com/help28/DeveloperAPI.html]

/**
 * Fetch the vMix input roster from the HTTP API.
 * Returns a Map<vmixKey, vmixNumber> for Key→Number lookup.
 * Returns an empty Map on any fetch or parse error (safe degradation).
 */
export async function fetchRoster(
  host: string,
  httpPort: number,
): Promise<Map<string, number>> {
  const url = `http://${host}:${httpPort}/api`;
  let xml: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return new Map();
    xml = await res.text();
  } catch {
    return new Map();
  }
  return parseRosterXml(xml);
}

/**
 * Pure function: parse vMix HTTP API XML into a Key→Number map.
 * Uses regex over the known stable input element format.
 */
export function parseRosterXml(xml: string): Map<string, number> {
  // Source: vMix API XML format: <input key="GUID" number="N" .../>
  const map = new Map<string, number>();
  // Match: key attribute before number attribute (stable vMix attribute order)
  for (const m of xml.matchAll(/<input\b[^>]*\bkey="([^"]+)"[^>]*\bnumber="(\d+)"/g)) {
    const key = m[1];
    const num = parseInt(m[2] ?? '', 10);
    if (key && !isNaN(num) && num > 0) {
      map.set(key, num);
    }
  }
  return map;
}
```

**Note:** If attribute order in vMix XML is not guaranteed (e.g. `number` before `key`),
the regex must be split into two passes or replaced with `fast-xml-parser`. The
`parseRosterXml.test.ts` fixture should include both attribute orderings to catch this.

### Pattern 4: buildRuntimeMapping (pure function)

**What:** Bridge between persisted Key-anchored mapping (Phase 2) and resolver's
positional `vmixInput: number` (Phase 1). This is the D-03 seam resolution point.

```typescript
// Source: resolver.ts MappingEntry contract + schema.ts PersistedMappingEntry
// [VERIFIED: existing codebase]

import type { MappingEntry } from '../core/resolver.js';
import type { PersistedMappingEntry } from '../config/schema.js';

/**
 * Resolve persisted Key-anchored entries to positional runtime entries.
 *
 * For each persisted entry, looks up the current vmixNumber by vmixKey.
 * If the key is not found in the roster (input deleted from vMix — D-04):
 * silently drops the entry.
 *
 * @param persisted - From ConfigStore: the Key-anchored mapping entries
 * @param roster    - Current Map<vmixKey, vmixNumber> from HTTP fetch
 * @returns MappingEntry[] — positional vmixInput values for the resolver
 */
export function buildRuntimeMapping(
  persisted: PersistedMappingEntry[],
  roster: Map<string, number>,
): MappingEntry[] {
  const result: MappingEntry[] = [];
  for (const entry of persisted) {
    const vmixNumber = roster.get(entry.vmixKey);
    if (vmixNumber === undefined) continue; // D-04: silently drop missing keys
    result.push({
      vmixInput: vmixNumber,    // positional: matches tally string position
      atemSource: entry.atemSource,
      cameraId: entry.cameraId,
    });
  }
  return result;
}
```

### Pattern 5: Length-Change Re-sync (roster change detection)

**What:** On each incoming tally string, check whether the string length differs from the
stored `rosterLength`. If it changed: immediately trigger an HTTP re-fetch to rebuild the
Key→Number map. During the re-fetch window, hold the last known tally state (D-03).

```typescript
// [ASSUMED — pattern design; no official API for roster-change notification]
let currentRosterLength = 0;
let pendingResync = false;
let lastKnownTally: number[] = [];

tcp.on('tally', async (tallyString: string) => {
  const rawTally = parseTallyString(tallyString);

  if (rawTally.length !== currentRosterLength) {
    // Roster changed (input added or deleted)
    if (!pendingResync) {
      pendingResync = true;
      // D-03: hold last known state during resync
      const freshRoster = await fetchRoster(host, httpPort);
      rosterMap = freshRoster;
      currentRosterLength = rawTally.length;
      pendingResync = false;
      // Now process the buffered tally with the fresh roster
      processTally(rawTally, freshRoster);
      return;
    }
    // Still resyncing: hold last known tally (D-03)
    return;
  }

  lastKnownTally = rawTally;
  processTally(rawTally, rosterMap);
});
```

### Anti-Patterns to Avoid

- **Importing `core/` from `vmix/`:** `VmixConnector` must not import the resolver or any
  `core/` module directly. The orchestrator (`tallyOrchestrator.ts`) is the only vmix/
  file that calls `resolve()`. Keeps the dependency graph acyclic.

- **Parsing the TALLY string before stripping 'TALLY OK ':** node-vmix already strips it.
  The tally listener receives the bare digit string. Do not double-strip.

- **Sending SUBSCRIBE TALLY before 'connect' fires:** node-vmix's `_sendMessageToSocket`
  writes even when not connected (socket buffers or silently fails). Send `SUBSCRIBE TALLY`
  only inside the `'connect'` handler to guarantee it is re-sent after every reconnect.

- **Treating string position as 0-based input number:** Position `i` → input `i+1`.
  The resolver uses `safeTally[entry.vmixInput - 1]` — vmixInput is always 1-based.

- **Using DOMParser for XML parsing:** `DOMParser` is `undefined` in Node 22. Attempting
  `new DOMParser()` throws at runtime. Use regex or `fast-xml-parser`.

- **Not handling the empty roster case:** vMix with zero inputs sends `TALLY OK ` (note
  the trailing space). node-vmix strips the prefix including the space, emitting `""`.
  `parseTallyString("")` must return `[]`, not crash.

- **Assuming SUBSCRIBE lasts across reconnects:** node-vmix's reconnect calls
  `socket.connect()` — it does NOT replay the SUBSCRIBE command. Must re-send
  `SUBSCRIBE TALLY` in every `'connect'` event handler.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TCP framing (CRLF line splitting) | Custom `Buffer` + CRLF accumulator | `node-vmix` `ConnectionTCP` | Already handles partial chunks, fragment reassembly, multi-message buffers correctly |
| XML parsing with full DOM API | JSDOM or custom DOM | regex scan or `fast-xml-parser` | DOMParser unavailable in Node 22; JSDOM is a 30MB+ dependency; vMix XML is shallow |
| vMix TCP protocol parsing | Custom line parser for TALLY/VERSION/ACTS routing | `node-vmix` message routing | node-vmix already routes by message type via switch; handles TALLY vs XML vs ACTS correctly |

**Key insight:** The hand-roll case (raw `net.Socket`) is documented in CLAUDE.md as a
strong alternative, not a pitfall. If Phase 5 needs finer reconnect control than node-vmix
provides, Phase 5 can replace the transport. For Phase 3, node-vmix's built-in framing
and event routing are the value proposition.

---

## Common Pitfalls

### Pitfall 1: TALLY String Position Is 0-Based, Input Number Is 1-Based

**What goes wrong:** Code uses `tallyString[vmixNumber]` instead of
`tallyString[vmixNumber - 1]`, causing every camera to track the wrong input state.

**Why it happens:** The tally string is a natural 0-based array; vMix input numbers
are 1-based (Input 1 is the first input). The offset is easy to forget.

**How to avoid:** `parseTallyString` returns a `number[]` where `array[i]` = state of
input `i+1`. The resolver already uses `safeTally[entry.vmixInput - 1]` — align with it.

**Warning signs:** Camera 1's tally state matches Camera 2's real state, off by exactly 1.

### Pitfall 2: SUBSCRIBE TALLY Not Re-Sent After Reconnect

**What goes wrong:** After a disconnect, node-vmix reconnects automatically (10s fixed
interval), but tally push stops because the subscription was not re-established.

**Why it happens:** node-vmix reconnects via `socket.connect()` — it replays nothing.
A one-time `connection.send('SUBSCRIBE TALLY')` in the connect handler is not called again.

**How to avoid:** Put `tcp.send('SUBSCRIBE TALLY')` inside the `'connect'` event handler
(not in a one-time setup function). This fires on every successful connect.

**Warning signs:** Tally stops updating after a network blip; `connected()` returns true
but `'tally'` events stop firing.

### Pitfall 3: node-vmix Reconnect Uses Fixed 10s Interval, No Jitter

**What goes wrong:** If many instances try to reconnect simultaneously (not relevant for
a single-PC deployment, but worth knowing), they all retry at exactly 10s intervals.

**Why it happens:** `_reconnectionIntervalTimeout = 10000` (fixed constant, no backoff,
no jitter). This is a known Phase 3→5 seam (D-07).

**How to avoid:** Accepted for Phase 3. Phase 5 evaluates replacing the transport if
backoff/jitter is needed. Do not try to wrap node-vmix's reconnect in Phase 3.

**Warning signs:** N/A for single-instance deployment. Flag for Phase 5 planning.

### Pitfall 4: Empty Roster Sends `'TALLY OK '` (Trailing Space)

**What goes wrong:** Parser receives `""` (empty string after node-vmix strips prefix
including the trailing space). A `string.split("")` on `""` yields `[""]` in some
implementations — not the expected empty array.

**Why it happens:** `"".split("")` in JavaScript → `[]` (correct). But if the parser uses
`Array.from(str)` on a truly empty string, it also yields `[]`. The risk is other split
strategies.

**How to avoid:** Guard `if (tallyString.length === 0) return []` as the first line
of `parseTallyString`. Include an `empty roster` test fixture.

**Warning signs:** All cameras show off-state when vMix has no inputs — this is actually
correct behavior, but confirm the parser doesn't throw.

### Pitfall 5: HTTP Roster Fetch Uses Same Port as TCP

**What goes wrong:** Connecting the HTTP fetch to port 8099 (TCP API) instead of 8088
(HTTP API). Both ports respond but with completely different protocols.

**Why it happens:** vMix has two separate API ports; the TCP port (8099) is better-known
because it's the tally push path.

**How to avoid:** D-08 adds `vmixHttpPort` (default 8088) as a separate config field.
Always use `httpPort` for HTTP fetch and `port` (8099) for TCP connection.

**Warning signs:** HTTP fetch returns garbled data or connection refused.

### Pitfall 6: node-vmix `_setHost` Validation Throws on Short Hostnames

**What goes wrong:** Constructing `new ConnectionTCP(host)` when `host.length < 3` throws
`ApiUrlError` synchronously. A 2-character hostname like `"1."` would crash the process.

**Why it happens:** node-vmix guards `host.length < 3` and throws in the constructor.

**How to avoid:** Zod schema already validates `host: z.string().min(1)`. Adding a
practical minimum of 3 characters in the schema (or validating before constructing) would
match node-vmix's guard. For Phase 3, document that host must be at least 3 characters;
a real vMix hostname (`192.168.x.x`, `localhost`, DNS name) always satisfies this.

**Warning signs:** Process exits on startup with `ApiUrlError: Invalid host provided`.

---

## Code Examples

### Full VmixConnector Skeleton (Verified Patterns)

```typescript
// src/vmix/VmixConnector.ts
// Source: node-vmix source (connection-tcp.ts), verified ESM import in Node 22
import { EventEmitter } from 'node:events';
import { ConnectionTCP } from 'node-vmix';
import { parseTallyString } from './parseTallyString.js';
import { fetchRoster } from './parseRosterXml.js';
import type { Logger } from 'pino';

export interface TallyEventData {
  rawTally: number[];
  rosterLength: number;
}

export class VmixConnector extends EventEmitter {
  private tcp: ConnectionTCP;
  private rosterMap: Map<string, number> = new Map();
  private currentRosterLength = -1; // -1 = not yet known

  constructor(
    private host: string,
    private tcpPort: number,
    private httpPort: number,
    private logger: Logger,
  ) {
    super();
    this.tcp = new ConnectionTCP(host, {
      port: tcpPort,
      autoReconnect: true, // Phase 5 seam (D-07): may be replaced with custom transport
    });
    this.tcp.on('connect', () => this.handleConnect());
    this.tcp.on('tally', (str: string) => this.handleTally(str));
    this.tcp.on('close', () => this.logger.info({ event: 'vmix_disconnected' }, 'vMix TCP disconnected'));
    this.tcp.on('error', (err: Error) => this.logger.warn({ err }, 'vMix TCP error'));
  }

  private async handleConnect(): Promise<void> {
    this.logger.info({ host: this.host, port: this.tcpPort }, 'vMix TCP connected');
    // Re-fetch roster on every connect (initial + reconnect)
    this.rosterMap = await fetchRoster(this.host, this.httpPort);
    this.currentRosterLength = -1; // reset so next tally triggers fresh check
    this.emit('rosterUpdated', new Map(this.rosterMap));
    // Re-subscribe on every connect
    this.tcp.send('SUBSCRIBE TALLY');
  }

  private handleTally(tallyString: string): void {
    const rawTally = parseTallyString(tallyString);
    if (rawTally.length !== this.currentRosterLength && this.currentRosterLength !== -1) {
      // Length change: roster re-sync needed (D-02)
      // D-03: emit last known tally (handled by not emitting until resync completes)
      void this.resync(rawTally);
      return;
    }
    this.currentRosterLength = rawTally.length;
    this.emit('tally', { rawTally, rosterLength: rawTally.length } satisfies TallyEventData);
  }

  private async resync(rawTally: number[]): Promise<void> {
    this.rosterMap = await fetchRoster(this.host, this.httpPort);
    this.currentRosterLength = rawTally.length;
    this.emit('rosterUpdated', new Map(this.rosterMap));
    this.emit('tally', { rawTally, rosterLength: rawTally.length } satisfies TallyEventData);
  }

  roster(): Map<string, number> {
    return new Map(this.rosterMap);
  }

  shutdown(): void {
    this.tcp.shutdown();
  }
}
```

### Test Fixture Patterns

```typescript
// src/vmix/parseTallyString.test.ts
// [ASSUMED — test structure; no official fixture source]
import { describe, it, expect } from 'vitest';
import { parseTallyString } from './parseTallyString.js';

describe('parseTallyString', () => {
  it('empty string → empty array (empty vMix roster)', () => {
    expect(parseTallyString('')).toEqual([]);
  });

  it('"0" → [0] (1 input, off)', () => {
    expect(parseTallyString('0')).toEqual([0]);
  });

  it('"1020" → [1,0,2,0] (input1=pgm, input3=preview)', () => {
    expect(parseTallyString('1020')).toEqual([1, 0, 2, 0]);
  });

  it('position 0 = input 1 (indexing contract)', () => {
    // "10" → input1=program, input2=off
    const result = parseTallyString('10');
    expect(result[0]).toBe(1); // input 1 → position 0
    expect(result[1]).toBe(0); // input 2 → position 1
  });

  it('non-0/1/2 characters coerced to 0 (defensive)', () => {
    // vMix should never send these, but guard defensively
    expect(parseTallyString('X')).toEqual([0]);
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTTP polling `GET /api` as primary tally | TCP `SUBSCRIBE TALLY` push | vMix TCP API existed since help24 | HTTP polling adds 100–500ms latency; TCP push is sub-10ms delivery |
| Matching vMix inputs by position (fragile) | Key (GUID) anchor from HTTP API | Key exposed since at least help21 | Roster reorder/delete no longer shifts tally to wrong camera |
| node-vmix ConnectionHTTP for roster | Native `fetch` (Node 18+) | Node 18 added fetch | Removes axios from the HTTP path entirely |

**Deprecated/outdated:**
- vMix HTTP polling as primary tally source: per CLAUDE.md, this is explicitly out of
  scope. Polling fails the < 100 ms requirement.
- `node-vmix` version < 1.7.1: earlier versions may not have all the events documented
  here. Pin to exactly 1.7.1 (already in CLAUDE.md).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pino` 9.x is the correct standalone version to install | Standard Stack | Wrong version installed; mild — fix during execution |
| A2 | vMix HTTP XML attribute order is stable (key before number) | Architecture Patterns — parseRosterXml | Regex fails to parse roster; cameras all get no tally. Mitigation: test fixture must include reversed-order attributes |
| A3 | vMix sends `TALLY OK ` (with trailing space) on empty roster, so node-vmix emits `""` | Pitfall 4 | Empty-roster handling broken if prefix format differs; LOW risk — documented in vMix TCP API spec |
| A4 | Length-change detection (D-02) is sufficient for all mid-session roster changes | Architecture Patterns — Pattern 5 | If vMix reorders inputs WITHOUT changing the roster length (different Key at same position), tally shifts incorrectly until next reconnect. DEFERRED — SUBSCRIBE ACTS (deferred to Phase 5) is the correct fix |
| A5 | `node-vmix` CJS named import works in NodeNext ESM project without `allowSyntheticDefaultImports` or special config | Standard Stack | TypeScript compile error at import site; VERIFIED empirically in Node 22 but tsconfig-specific behavior |
| A6 | vMix input `number` attribute in XML is always equal to the tally string 1-based position | Architecture Patterns | If vMix uses sparse numbering (gaps), the tally position would not match the input number. Research found no evidence of sparse numbering in normal operation — treat as confirmed but note for testing with real vMix |

**Assumption A4 is the most significant risk.** If vMix allows reordering inputs without
changing the roster count (e.g. moving Input 3 to position 1 without adding/deleting),
the length-change detection will not trigger a re-sync, and cameras will show wrong tally
until reconnect. The Key-based approach in `buildRuntimeMapping` handles this correctly
given an up-to-date roster, but the roster won't refresh unless length changes. This is a
known trade-off per D-02; Phase 5 / SUBSCRIBE ACTS is the mitigation.

---

## Open Questions (RESOLVED)

1. **Does vMix use sparse input numbering (gaps in the number sequence)?**
   - What we know: vMix `number` attribute is documented as sequential; all examples show
     contiguous 1, 2, 3...
   - What's unclear: Whether deleting input 2 (keeping 1 and 3) shifts the remaining
     inputs to fill the gap, or leaves number=3 unchanged.
   - Recommendation: Capture a real `GET /api` XML response during testing to confirm.
     The `parseRosterXml` fixture should include this scenario.
   - RESOLVED: Plans use Key-based identity (`buildRuntimeMapping` anchors on GUID, not
     number position), so sparse numbering only affects the tally-position lookup — which
     the SC4 regression fixture covers. Remaining risk captured in A6 assumption; confirmed
     during Phase 4 real-hardware testing.

2. **Does node-vmix's socket survive reconnect after a hard disconnect?**
   - What we know: node-vmix creates one `Socket` instance; after `close` it calls
     `socket.connect()` again. TCP sockets can be re-connected after close (not destroy).
   - What's unclear: If vMix crashes and OS closes the connection with RST, the socket
     may be in an error state where `connect()` returns `ECONNRESET` or similar.
   - Recommendation: Phase 3 tests with real vMix during Phase 4 integration. Phase 5
     fully owns reconnect reliability.
   - RESOLVED: Phase 5 owns full reconnect reliability (D-07). Phase 3 scope is
     correct-behaviour-on-connect; node-vmix's built-in 10s auto-reconnect is acceptable
     for Phase 3. No Phase 3 plan changes required.

3. **Does pino 9.x need any special configuration for `"type": "module"` ESM projects?**
   - What we know: pino 9.x ships ESM support; should work without extra config.
   - Recommendation: Verify `import pino from 'pino'` works at first task execution.
   - RESOLVED: pino 9.x ships full ESM support. Plan 03-02 Task 1 runs `npx tsc --noEmit`
     immediately after install to catch any import issues in-task. No pre-planning
     configuration required.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v22.23.0 | — |
| npm | Package install | Yes | 10.9.8 | — |
| vitest | Test runner | Yes (devDep) | 3.2.6 | — |
| tsx | Dev run TS | Yes | 4.22.4 | — |
| `node-vmix` | TCP connection | NOT installed | 1.7.1 | — |
| `pino` | Structured logging | NOT installed | 9.x | console.log (development only) |
| vMix software | Integration test | Unknown | — | Unit tests bypass transport (D-12) |
| ATEM hardware | Phase 4 only | N/A for Phase 3 | — | N/A |

**Missing dependencies with no fallback:**
- `node-vmix` and `pino` must be installed before Phase 3 implementation begins.

**Missing dependencies with fallback:**
- vMix software: all Phase 3 tests inject pre-captured TALLY strings and mock HTTP
  responses (D-12). No live vMix required for unit/integration tests.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.2.6 |
| Config file | `vitest.config.ts` (exists, scoped to `src/**/*.test.ts`) |
| Quick run command | `npx vitest run src/vmix/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VMIX-01 | ConnectionTCP constructed with configured host/port | unit (mock) | `npx vitest run src/vmix/VmixConnector.test.ts` | No — Wave 0 |
| VMIX-01 | vmixHttpPort schema extension is backward-compatible | unit | `npx vitest run src/config/schema.test.ts` | No (new test in existing file) |
| VMIX-02 | 'tally' event fires when SUBSCRIBE TALLY push arrives | unit (inject string) | `npx vitest run src/vmix/parseTallyString.test.ts` | No — Wave 0 |
| VMIX-02 | SUBSCRIBE TALLY re-sent on reconnect (every 'connect') | unit (mock) | `npx vitest run src/vmix/VmixConnector.test.ts` | No — Wave 0 |
| VMIX-03 | parseTallyString: empty roster → [] | unit | `npx vitest run src/vmix/parseTallyString.test.ts` | No — Wave 0 |
| VMIX-03 | parseTallyString: position 0 = input 1 (indexing) | unit | `npx vitest run src/vmix/parseTallyString.test.ts` | No — Wave 0 |
| VMIX-03 | buildRuntimeMapping: Key reorder → correct vmixInput | unit | `npx vitest run src/vmix/buildRuntimeMapping.test.ts` | No — Wave 0 |
| VMIX-03 | buildRuntimeMapping: deleted Key → silently dropped | unit | `npx vitest run src/vmix/buildRuntimeMapping.test.ts` | No — Wave 0 |
| VMIX-03 | parseRosterXml: produces correct Map<key, number> | unit | `npx vitest run src/vmix/parseRosterXml.test.ts` | No — Wave 0 |
| SC4 | Length-change triggers roster re-sync; last tally held during window | unit (mock) | `npx vitest run src/vmix/VmixConnector.test.ts` | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/vmix/`
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green + `tsc --noEmit` clean before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/vmix/parseTallyString.ts` + `src/vmix/parseTallyString.test.ts`
- [ ] `src/vmix/parseRosterXml.ts` + `src/vmix/parseRosterXml.test.ts`
- [ ] `src/vmix/buildRuntimeMapping.ts` + `src/vmix/buildRuntimeMapping.test.ts`
- [ ] `src/vmix/VmixConnector.ts` + `src/vmix/VmixConnector.test.ts`
- [ ] `src/vmix/tallyOrchestrator.ts`
- [ ] Schema extension: `vmixHttpPort` optional field + new invariant test in `src/config/schema.test.ts`
- [ ] Install: `npm install node-vmix pino` (+ `@types/pino` if needed)
- [ ] `tsc --noEmit` must pass after schema extension

*(Existing infrastructure — vitest config, tsconfig, `src/core/`, `src/config/` — is
complete. No framework setup needed.)*

---

## Security Domain

> `security_enforcement` absent in config — treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | vMix TCP/HTTP APIs have no auth — LAN-only tool per CLAUDE.md |
| V3 Session Management | No | TCP connection is a persistent socket, not a user session |
| V4 Access Control | No | Single-operator LAN tool; no users |
| V5 Input Validation | Yes | Tally string: guard non-`0/1/2` chars; XML roster: parse defensively; length cap (1000 max per vMix docs) |
| V6 Cryptography | No | No crypto in Phase 3; HTTP (not HTTPS) to localhost/LAN is acceptable |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed TALLY string (unexpected chars, very long) | Tampering | `parseTallyString` guards: coerce unknown chars to 0; slice at 1000 if needed |
| HTTP roster XML injection (if vMix is on untrusted segment) | Tampering | regex/fast-xml-parser does not evaluate XML entities; no exec path through XML |
| Unbounded `number[]` from 1000-input TALLY string | Denial of Service | Resolver already caps at mapping size (≤8 entries); process-level no-op for large tally |
| node-vmix `socket.write` throws on closed socket | Availability | Wrapped in error handler; Phase 3 treats SUBSCRIBE failure as recoverable on next reconnect |

---

## Sources

### Primary (HIGH confidence)
- `node-vmix` 1.7.1 source (`src/modules/connection-tcp.ts`) — downloaded and read directly from npm tarball. Confirmed: `tally` event emits raw string after `TALLY OK ` strip; CJS format; ESM named import verified in Node 22; reconnect interval is 10s fixed.
- `vmix.com/help28/TCPAPI.html` (accessed via `wp.vmix.com/help28/`) — SUBSCRIBE TALLY wire format, `TALLY OK <digits>` format, push semantics, 1000-input max.
- `vmix.com/help28/DeveloperAPI.html` — HTTP API port 8088, `GET /api` URL, XML `<input key="GUID" number="N" title="..."/>` element format.
- `src/core/resolver.ts` (existing codebase) — `VmixTally`, `MappingEntry`, `safeTally[entry.vmixInput - 1]` indexing confirms 1-based vmixInput.
- `src/config/schema.ts` (existing codebase) — `PersistedMappingEntry` shape that `buildRuntimeMapping` consumes.

### Secondary (MEDIUM confidence)
- npm registry API (`api.npmjs.org/downloads`) — node-vmix: 311/wk, fast-xml-parser: 81.8M/wk.
- `jensstigaard.github.io/node-vmix/` — constructor options reference (docs incomplete but confirmed by source).

### Tertiary (LOW confidence)
- vMix forums (forums.vmix.com) — corroborating evidence for TALLY indexing; no specific claim relied upon from forums alone.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — node-vmix source read directly; ESM import verified in Node 22
- Wire protocol: HIGH — official vMix TCP API docs; node-vmix source confirms strip logic
- HTTP XML format: HIGH — official vMix HTTP API docs; XML attribute names confirmed
- Tally indexing (0-based string → 1-based input): HIGH — cross-confirmed from resolver.ts existing code + vMix API description
- Architecture patterns: HIGH — derived from verified protocol + existing codebase contracts
- XML attribute order stability (A2): MEDIUM — official docs show consistent order but not guaranteed

**Research date:** 2026-07-01
**Valid until:** 2026-09-01 (node-vmix is stable; vMix TCP API documented since v24; low drift risk)
