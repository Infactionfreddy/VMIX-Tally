# Phase 3: vMix Live Ingest - Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 9 new files + 1 modified file
**Analogs found:** 9 / 10 (1 file has no close analog — new territory)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/vmix/parseTallyString.ts` | utility (pure function) | transform | `src/core/resolver.ts` — `coerceTally` + digit-array logic | role-match (pure transform) |
| `src/vmix/parseTallyString.test.ts` | test | — | `src/core/resolver.test.ts` | exact (fixture-driven describe/it) |
| `src/vmix/parseRosterXml.ts` | utility (pure function) | transform | `src/core/resolver.ts` — `coerceMapping` coercion pattern | role-match (pure transform) |
| `src/vmix/parseRosterXml.test.ts` | test | — | `src/config/schema.test.ts` | role-match (fixture objects, safeParse-style assertions) |
| `src/vmix/buildRuntimeMapping.ts` | utility (pure function) | transform | `src/core/resolver.ts` — `coerceMapping` + `vmixToEntry` lookup | exact (pure function, Map lookup, silent-drop) |
| `src/vmix/buildRuntimeMapping.test.ts` | test | — | `src/core/resolver.test.ts` | exact (baseMapping fixtures, edge-case coverage) |
| `src/vmix/VmixConnector.ts` | service (EventEmitter) | event-driven | `src/core/tallyState.ts` — `TallyStateReconciler extends EventEmitter` | role-match (EventEmitter subclass, typed events, no I/O except itself) |
| `src/vmix/VmixConnector.test.ts` | test | — | `src/core/tallyState.test.ts` | role-match (EventEmitter spy pattern with `vi.fn()`) |
| `src/vmix/tallyOrchestrator.ts` | orchestrator | event-driven | `src/core/tallyState.ts` (event consumer) + `src/core/resolver.ts` (function caller) | partial-match (no prior orchestrator exists) |
| `src/config/schema.ts` (modify) | config schema | — | itself (backward-compatible extension) | exact — extend existing `connection` sub-schema |

---

## Pattern Assignments

### `src/vmix/parseTallyString.ts` (utility, transform)

**Analog:** `src/core/resolver.ts` — `coerceTally` and the `safeTally[entry.vmixInput - 1]` indexing pattern

**Imports pattern** (`src/core/resolver.ts` lines 1–13):
```typescript
// No imports for pure utilities — zero I/O, zero external deps.
// Only import types when needed from sibling modules.
import type {
  CameraId,
  CameraTallyState,
  // ...
} from "./events.js";
```
- Pure utility files import nothing except types. `parseTallyString.ts` needs no imports at all.
- `.js` extension required on all local imports (NodeNext module resolution).

**Core pure-function pattern** (`src/core/resolver.ts` lines 68–73 — `coerceTally`):
```typescript
function coerceTally(raw: VmixTally | null | undefined): readonly number[] {
  if (!Array.isArray(raw)) return [];
  return raw;
}
```
Apply same early-return-on-empty defensive stance to `parseTallyString`:
```typescript
export function parseTallyString(tallyString: string): number[] {
  if (tallyString.length === 0) return [];
  return [...tallyString].map((ch) => {
    const n = Number(ch);
    return n === 0 || n === 1 || n === 2 ? n : 0;
  });
}
```

**1-based indexing contract** (`src/core/resolver.ts` line 197):
```typescript
const raw = safeTally[entry.vmixInput - 1]; // 1-based vmixInput → 0-based array
```
`parseTallyString` returns `number[]` where `array[i]` = state of vMix input `i+1`. This is the invariant the resolver already relies on.

**Defensive total-function stance** (`src/core/resolver.ts` lines 196–199):
```typescript
const raw = safeTally[entry.vmixInput - 1];
const state = typeof raw === "number" && isFinite(raw) ? raw : 0;
```
All unknown values coerce to 0 (off) — never throw. Apply same: non-`0/1/2` chars coerce to `0`.

---

### `src/vmix/parseTallyString.test.ts` (test)

**Analog:** `src/core/resolver.test.ts` (lines 1–54)

**File header pattern** (`src/core/resolver.test.ts` lines 1–8):
```typescript
// Exhaustive resolver test suite: one test per precedence tier and edge case.
// Covers D-04..D-13, SC1, SC2 (live never mutated), SC3, SC5.
// Run: npx vitest run src/core/resolver.test.ts

import { describe, it, expect } from "vitest";
import { resolve } from "./resolver.js";
import type { MappingEntry, OverrideEntry } from "./resolver.js";
```
- Top comment: one-line purpose + decision refs + run command.
- Import from `"./module.js"` (NodeNext `.js` extension on local imports).
- Import `{ describe, it, expect }` (no `vi` unless spying).

**Fixture pattern** (`src/core/resolver.test.ts` lines 12–22):
```typescript
const baseMapping: MappingEntry[] = [
  { vmixInput: 1, atemSource: 1, cameraId: "camA" },
  { vmixInput: 2, atemSource: 2, cameraId: "camB" },
  // ...
];
const allOff = [0, 0, 0, 0];
```
- Fixtures are top-level `const` (not inside `beforeEach`).
- Use `structuredClone` only when mutation is needed (see schema.test.ts line 46).

**Test naming pattern** (`src/core/resolver.test.ts` lines 27–53):
```typescript
describe("SC1 — resolve returns one well-formed ResolverOutput", () => {
  it("SC1: basic live-program returns cameras+bus+contended with correct shapes", () => {
    const result = resolve([1, 0, 0, 0], baseMapping, []);
    expect(result).toEqual({ ... });
  });
});
```
- `describe` label: `"<ID> — <human description>"` — decision or SC reference first.
- `it` label: `"<ID>: <behavior under test>"`.

---

### `src/vmix/parseRosterXml.ts` (utility, transform)

**Analog:** `src/core/resolver.ts` — `coerceMapping` pattern (pure function, Map construction, silent-drop)

**Imports pattern:**
```typescript
// No runtime imports — pure function returning a Map.
// Uses Node 22 built-in RegExp / String methods only.
```
`parseRosterXml` is pure with zero imports. `fetchRoster` (in same file or companion) uses `fetch` (Node 22 built-in, no import needed).

**Core Map-construction pattern** (`src/core/resolver.ts` lines 161–170):
```typescript
const cameraToEntry = new Map<CameraId, MappingEntry>();
for (const entry of safeMapping) {
  cameraToEntry.set(entry.cameraId, entry);
}

const vmixToEntry = new Map<number, MappingEntry>();
for (const entry of safeMapping) {
  vmixToEntry.set(entry.vmixInput, entry);
}
```
Apply same pattern — build `Map<string, number>` (vmixKey → vmixNumber) via `for...of` with `map.set(key, val)`.

**Safe-degradation pattern** (`src/core/resolver.ts` lines 154–158):
```typescript
if (safeMapping.length === 0) {
  return { cameras: {}, bus: { program: null, preview: null }, contended: [] };
}
```
`fetchRoster` returns `new Map()` on any network or parse error — same safe-degradation pattern.

---

### `src/vmix/parseRosterXml.test.ts` (test)

**Analog:** `src/config/schema.test.ts` (fixture-object driven, safeParse-style grouping)

**Fixture-as-string pattern** (adapt from `src/config/schema.test.ts` lines 14–38):
```typescript
// src/config/schema.test.ts
const baseConfig: PersistedConfig = {
  version: 1,
  settings: { vmix: null, atem: null },
  mapping: [],
};
```
For `parseRosterXml.test.ts`, top-level fixtures are XML strings:
```typescript
const singleInputXml = `<vmix><inputs><input key="abc-123" number="1" title="Camera 1"/></inputs></vmix>`;
const emptyRosterXml = `<vmix><inputs></inputs></vmix>`;
```

**Describe grouping by scenario** (`src/config/schema.test.ts` lines 44–60):
```typescript
describe("D-08 — partial and empty mapping", () => {
  it("D-08: empty mapping (0 entries) is valid", () => { ... });
  it("D-08: 3-entry mapping is valid", () => { ... });
});
```
Group by scenario: `"normal roster"`, `"empty roster"`, `"attribute order variants"`, `"malformed XML"`.

---

### `src/vmix/buildRuntimeMapping.ts` (utility, transform)

**Analog:** `src/core/resolver.ts` — the full `resolve()` function's Map-lookup + silent-drop loop (lines 161–204)

**Imports pattern** (`src/core/resolver.ts` lines 6–13):
```typescript
import type {
  CameraId,
  CameraTallyState,
  CameraTallyMap,
  DesiredAtemBusState,
  ContendedInput,
  ResolverOutput,
} from "./events.js";
```
`buildRuntimeMapping` imports types only — two cross-module type imports with `.js` extensions:
```typescript
import type { MappingEntry } from '../core/resolver.js';
import type { PersistedMappingEntry } from '../config/schema.js';
```

**Core Map-lookup + silent-drop pattern** (`src/core/resolver.ts` lines 175–204):
```typescript
const vmixToEntry = new Map<number, MappingEntry>();
for (const entry of safeMapping) {
  vmixToEntry.set(entry.vmixInput, entry);
}
// ...
for (const entry of safeMapping) {
  const raw = safeTally[entry.vmixInput - 1];
  // ...
}
```
Adapt: iterate `persisted[]`, call `roster.get(entry.vmixKey)` — if `undefined`, `continue` (D-04 silent drop):
```typescript
export function buildRuntimeMapping(
  persisted: PersistedMappingEntry[],
  roster: Map<string, number>,
): MappingEntry[] {
  const result: MappingEntry[] = [];
  for (const entry of persisted) {
    const vmixNumber = roster.get(entry.vmixKey);
    if (vmixNumber === undefined) continue; // D-04: silently drop missing keys
    result.push({ vmixInput: vmixNumber, atemSource: entry.atemSource, cameraId: entry.cameraId });
  }
  return result;
}
```

**JSDoc pattern** (`src/core/resolver.ts` lines 144–148):
```typescript
/**
 * Resolve the desired ATEM bus state and per-camera tally map.
 *
 * @param tally   vMix positional tally array (index = vMix input, value = 0|1|2).
 * @param mapping vMix-input → {atemSource, cameraId} mapping for all cameras.
 * @param overrides Per-camera sticky force overrides (program | preview | off).
 * @returns ResolverOutput — never throws (D-13).
 */
```
All exported functions carry a JSDoc block with `@param` + `@returns` + decision refs in the body comments.

---

### `src/vmix/buildRuntimeMapping.test.ts` (test)

**Analog:** `src/core/resolver.test.ts` (exact match — same pure function, same fixture pattern)

**Baseline fixture pattern** (`src/core/resolver.test.ts` lines 12–22):
```typescript
const baseMapping: MappingEntry[] = [
  { vmixInput: 1, atemSource: 1, cameraId: "camA" },
  { vmixInput: 2, atemSource: 2, cameraId: "camB" },
  { vmixInput: 3, atemSource: 3, cameraId: "camC" },
  { vmixInput: 4, atemSource: 4, cameraId: "camD" },
];
```
For `buildRuntimeMapping.test.ts`, define top-level fixtures:
```typescript
const persistedEntries: PersistedMappingEntry[] = [
  { vmixKey: "key-guid-1", atemSource: 1, cameraId: "camA" },
  { vmixKey: "key-guid-2", atemSource: 2, cameraId: "camB" },
];
// roster with normal numbering
const normalRoster = new Map([["key-guid-1", 1], ["key-guid-2", 2]]);
// reorder fixture: same keys, swapped numbers (SC4 test)
const reorderedRoster = new Map([["key-guid-1", 2], ["key-guid-2", 1]]);
```

**Edge-case test pattern** (`src/core/resolver.test.ts` lines 27–53):
```typescript
describe("SC1 — resolve returns one well-formed ResolverOutput", () => {
  it("SC1: basic live-program returns cameras+bus+contended ...", () => {
    const result = resolve([1, 0, 0, 0], baseMapping, []);
    expect(result).toEqual({ ... });
  });
});
```
Required test groups (from D-12 + SC4):
- `"normal mapping — key found in roster → correct vmixInput"`
- `"Key reorder (SC4) — same key at different position → correct vmixInput"`
- `"deleted key (D-04) — key absent from roster → silently dropped"`
- `"empty persisted mapping → empty result"`
- `"empty roster → all entries silently dropped"`

---

### `src/vmix/VmixConnector.ts` (service, EventEmitter)

**Analog:** `src/core/tallyState.ts` — `TallyStateReconciler extends EventEmitter`

**EventEmitter subclass pattern** (`src/core/tallyState.ts` lines 1–57):
```typescript
import { EventEmitter } from "node:events";
import type { DesiredAtemBusState } from "./events.js";

export class TallyStateReconciler extends EventEmitter {
  private lastSent: DesiredAtemBusState;

  constructor() {
    super();
    // D-11 safe default
    this.lastSent = { program: null, preview: null };
  }
  // ...
}
```
Apply exactly:
```typescript
import { EventEmitter } from "node:events";
import { ConnectionTCP } from "node-vmix";
import { parseTallyString } from "./parseTallyString.js";
import { fetchRoster } from "./parseRosterXml.js";
import type { Logger } from "pino";

export class VmixConnector extends EventEmitter {
  private tcp: ConnectionTCP;
  private rosterMap: Map<string, number> = new Map();
  private currentRosterLength = -1;

  constructor(
    private host: string,
    private tcpPort: number,
    private httpPort: number,
    private logger: Logger,
  ) {
    super();
    // ... register listeners
  }
}
```

**Private method pattern** (`src/core/tallyState.ts` lines 71–96):
```typescript
submit(desired: DesiredAtemBusState): ChangeReport {
  const programChanged = this.lastSent.program !== desired.program;
  // ...
  this.lastSent = { program: desired.program, preview: desired.preview };
  this.emit("change", payload);
  return report;
}
```
Private async methods use `private async handleConnect(): Promise<void>` pattern. `void this.resync(rawTally)` for fire-and-forget async calls from sync handlers.

**Emit pattern** (`src/core/tallyState.ts` lines 92–95):
```typescript
const payload: ChangeEventPayload = {
  state: { ...this.lastSent },
  report,
};
this.emit("change", payload);
```
- Define typed payload interface before the class.
- Pass a structured object, not bare primitives.
- Emit a copy (spread `{}`) not a reference to internal state.

**Log-on-transition pattern** (`src/core/tallyState.ts` — no logging, but established in CLAUDE.md):
Use pino at all state transitions:
```typescript
this.logger.info({ host: this.host, port: this.tcpPort }, 'vMix TCP connected');
this.logger.info({ event: 'vmix_disconnected' }, 'vMix TCP disconnected');
this.logger.warn({ err }, 'vMix TCP error');
```
Structured first arg (object), human message second arg — pino convention.

**Public accessor returns copy** (`src/core/tallyState.ts` lines 103–105):
```typescript
current(): DesiredAtemBusState {
  return { ...this.lastSent };
}
```
`roster(): Map<string, number>` returns `new Map(this.rosterMap)` — never expose the internal Map directly.

---

### `src/vmix/VmixConnector.test.ts` (test)

**Analog:** `src/core/tallyState.test.ts` (EventEmitter spy pattern)

**Spy setup pattern** (`src/core/tallyState.test.ts` lines 1–8):
```typescript
import { describe, it, expect, vi } from "vitest";
import { TallyStateReconciler } from "./tallyState.js";
```
`vi` is imported only when event spies are needed. Import the class under test with `.js` extension.

**Event spy pattern** (`src/core/tallyState.test.ts` lines 19–31):
```typescript
it("first submit from null/null reports changed:true ...", () => {
  const reconciler = new TallyStateReconciler();
  const listener = vi.fn();
  reconciler.on("change", listener);

  const report = reconciler.submit({ program: 1, preview: 2 });

  expect(report).toEqual({ changed: true, program: true, preview: true });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith({ state: { ... }, report: { ... } });
});
```
For `VmixConnector.test.ts` — mock `ConnectionTCP` (inject or stub), then:
```typescript
const connector = new VmixConnector("192.168.1.1", 8099, 8088, mockLogger);
const tallyListener = vi.fn();
connector.on("tally", tallyListener);
// inject TALLY string directly via the internal handler (bypass TCP transport — D-12)
// assert tallyListener.toHaveBeenCalledWith({ rawTally: [...], rosterLength: N })
```

**No-mutation ownership test** (`src/core/tallyState.test.ts` lines 120–130):
```typescript
it("mutating the object returned by current() does not affect subsequent current() calls", () => {
  const reconciler = new TallyStateReconciler();
  reconciler.submit({ program: 1, preview: 2 });
  const snapshot = reconciler.current();
  (snapshot as { program: number | null }).program = 99;
  expect(reconciler.current()).toEqual({ program: 1, preview: 2 });
});
```
Apply same for `connector.roster()` — verify returned Map is a copy.

---

### `src/vmix/tallyOrchestrator.ts` (orchestrator, event-driven)

**Analog:** Partial — `src/core/tallyState.ts` as an event consumer model; no exact analog exists in the codebase.

**Closest analog — event listener registration** (`src/core/tallyState.test.ts` lines 19–31):
```typescript
reconciler.on("change", listener);
```
The orchestrator is the first module that consumes EventEmitter events from another module. Pattern:
```typescript
connector.on("tally", ({ rawTally }) => {
  const runtimeMapping = buildRuntimeMapping(persisted, connector.roster());
  const output = resolve(rawTally, runtimeMapping, []);
  // store + log
});
connector.on("rosterUpdated", (_roster) => {
  // roster is already held inside VmixConnector; rebuild mapping on next tally
});
```

**In-memory state pattern** (`src/core/tallyState.ts` lines 51–56):
```typescript
export class TallyStateReconciler extends EventEmitter {
  private lastSent: DesiredAtemBusState;

  constructor() {
    super();
    this.lastSent = { program: null, preview: null };
  }
```
The orchestrator holds `currentState: ResolverOutput | null = null` in-memory. Phase 4 reads this via a public getter that returns a copy.

**Pino logger initialization** (no existing example in codebase yet — CLAUDE.md convention):
```typescript
import pino from "pino";
const logger = pino(); // or accept Logger injection for testability
```
Prefer constructor injection of `Logger` type for testability (same pattern as `VmixConnector`).

**Cross-module import order** (`src/core/resolver.ts` lines 6–13 as style guide):
1. Node builtins (`node:events`, `node:*`)
2. Third-party (`node-vmix`, `pino`)
3. Local project imports (relative `.js` paths)
4. Type-only imports (`import type`) last or co-located with their value imports using `import { type X, Y }`

---

### `src/config/schema.ts` (modification — add `vmixHttpPort`)

**Analog:** itself — backward-compatible extension of the existing `connection` sub-schema

**Existing connection sub-schema to extend** (`src/config/schema.ts` lines 11–16):
```typescript
const connection = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  })
  .nullable();
```

**Extension pattern — optional field with default (D-08):**
Add `vmixHttpPort` as an optional field to the `settings.vmix` sub-object only. Since `connection` is shared between `vmix` and `atem`, either:
- Make `connection` a base schema and compose `vmixConnection = connection.extend({ vmixHttpPort: z.number().int().min(1).max(65535).optional() })`, OR
- Add `vmixHttpPort` directly to the top-level `settings.vmix` shape by splitting `connection` into two variants.

The **safest backward-compatible pattern** (no existing stored config breaks):
```typescript
const vmixConnection = z
  .object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    vmixHttpPort: z.number().int().min(1).max(65535).optional(), // D-08: default 8088
  })
  .nullable();
```
Then update `settings` to use `vmixConnection` for the `vmix` key and keep the original `connection` for `atem`. At runtime, callers apply `?? 8088` when reading `vmixHttpPort`.

**Optional field pattern** (`src/config/schema.ts` lines 41–44):
```typescript
vmixNumber: z.number().int().positive().optional(),
vmixTitle: z.string().optional(),
```
Consistent with existing optional fields — use `.optional()` (not `.default()`). The default value `8088` is applied by the consumer at read time, not stored in schema default, keeping the JSON file clean.

**Test for backward-compatible default** (add to `src/config/schema.test.ts`):
```typescript
it("D-08 Phase3: vmixHttpPort absent is valid (backward-compatible, defaults to 8088 at read time)", () => {
  const cfg = { settings: { vmix: { host: "192.168.1.1", port: 8099 }, atem: null }, mapping: [] };
  const result = schema.safeParse(cfg);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.settings.vmix?.vmixHttpPort).toBeUndefined();
  }
});

it("D-08 Phase3: vmixHttpPort: 8088 explicit value accepted", () => {
  const cfg = { settings: { vmix: { host: "192.168.1.1", port: 8099, vmixHttpPort: 8088 }, atem: null }, mapping: [] };
  const result = schema.safeParse(cfg);
  expect(result.success).toBe(true);
});
```

---

## Shared Patterns

### Module system: ESM + NodeNext `.js` extensions
**Source:** `tsconfig.json` (`"module": "NodeNext"`) + all existing source files
**Apply to:** All new `src/vmix/*.ts` files

Every local import uses the `.js` extension even though the file is `.ts`:
```typescript
import { parseTallyString } from "./parseTallyString.js";
import type { MappingEntry } from "../core/resolver.js";
import type { PersistedMappingEntry } from "../config/schema.js";
```
Node built-ins use the `node:` prefix:
```typescript
import { EventEmitter } from "node:events";
```

### Strict TypeScript: `noUncheckedIndexedAccess`
**Source:** `tsconfig.json` line 9 — `"noUncheckedIndexedAccess": true`
**Apply to:** All new files, especially `parseTallyString.ts` and `buildRuntimeMapping.ts`

Array index access returns `T | undefined`. Guard with nullish coalescing:
```typescript
// Pattern from resolver.ts line 198:
const raw = safeTally[entry.vmixInput - 1];
const state = typeof raw === "number" && isFinite(raw) ? raw : 0;
```
Similarly in `parseRosterXml.ts` regex match groups:
```typescript
const key = m[1];                    // string | undefined with noUncheckedIndexedAccess
const num = parseInt(m[2] ?? '', 10); // guard with ?? ''
if (key && !isNaN(num) && num > 0) { ... }
```

### Defensive total-function stance (D-13 carries into vmix/)
**Source:** `src/core/resolver.ts` lines 68–109 (all three `coerce*` helpers)
**Apply to:** `parseTallyString.ts`, `parseRosterXml.ts`, `buildRuntimeMapping.ts`, `VmixConnector.ts`

Pattern: malformed input → safe fallback, never throw:
```typescript
// coerceTally (resolver.ts line 70-73):
function coerceTally(raw: VmixTally | null | undefined): readonly number[] {
  if (!Array.isArray(raw)) return [];
  return raw;
}
```
Every public function that accepts external data (network bytes, XML strings, tally strings) must guard at the entry point and return a safe empty/null value on error.

### Verbatim module syntax
**Source:** `tsconfig.json` line 11 — `"verbatimModuleSyntax": true`
**Apply to:** All new files

Type-only imports must use `import type`:
```typescript
import type { Logger } from "pino";          // type-only → import type
import { EventEmitter } from "node:events";  // value import → plain import
```
Mixing is allowed with the inline `type` keyword:
```typescript
import { type MappingEntry, resolve } from "../core/resolver.js";
```

### Test file conventions
**Source:** `src/core/tallyState.test.ts` + `src/core/resolver.test.ts` + `src/config/schema.test.ts`
**Apply to:** All `src/vmix/*.test.ts` files

1. Top comment: purpose + decision refs + `Run:` command.
2. Imports: `{ describe, it, expect }` from `"vitest"` (add `vi` only when using spies).
3. Top-level `const` fixtures — no `beforeEach` unless state must be reset per test.
4. `structuredClone(fixture)` when a test needs a mutated copy.
5. `describe` label: `"<ID> — <human description>"`, `it` label: `"<ID>: <behavior>"`.
6. `expect(result).toEqual(...)` for structural equality; `.toBe(...)` for primitives.
7. Import from `"./module.js"` (not `"./module"` or `"./module.ts"`).

### pino structured logging
**Source:** CLAUDE.md + RESEARCH.md (no existing pino usage in codebase yet — first instance in Phase 3)
**Apply to:** `VmixConnector.ts`, `tallyOrchestrator.ts`

```typescript
import pino from "pino";
// OR accept as constructor parameter for testability:
import type { Logger } from "pino";

// Usage — structured object first, message second:
logger.info({ host, port }, "vMix TCP connected");
logger.warn({ err, event: "roster_fetch_failed" }, "HTTP roster fetch failed — holding last state");
logger.info({ rawTally, rosterLength }, "tally changed");
```

### Cross-module boundary: vmix/ must not import from core/ except in orchestrator
**Source:** CONTEXT.md D-09 + RESEARCH.md anti-patterns section
**Apply to:** `VmixConnector.ts`, `parseTallyString.ts`, `parseRosterXml.ts`, `buildRuntimeMapping.ts`

Only `tallyOrchestrator.ts` may import from `../core/`. All other `src/vmix/` files are self-contained or import types only from `../core/resolver.js` and `../config/schema.js`. `VmixConnector.ts` must NOT import `resolve` or any `core/` module.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/vmix/tallyOrchestrator.ts` | orchestrator | event-driven | No prior orchestrator exists in the codebase. Closest is the EventEmitter consumer test in `tallyState.test.ts`, but the pattern of wiring events → pure function → in-memory state is new territory for this project. Use RESEARCH.md Pattern 5 (length-change re-sync) and the VmixConnector skeleton from RESEARCH.md §Code Examples. |

---

## Metadata

**Analog search scope:** `src/core/`, `src/config/` (all 8 existing source files read)
**Files scanned:** 8
**Pattern extraction date:** 2026-07-01
