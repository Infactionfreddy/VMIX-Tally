# Pitfalls Research

**Domain:** vMix→ATEM SDI tally bridge for live video production (Node.js server)
**Researched:** 2026-06-29
**Confidence:** MEDIUM-HIGH (vMix TCP API format and ATEM tally mechanics verified against official/vendor docs; atem-connection lifecycle details MEDIUM — verify against current library source during build)

## Critical Pitfalls

### Pitfall 1: Camera ID vs. ATEM SDI input mismatch — tally derived correctly but lights the wrong (or no) camera

**What goes wrong:**
The whole bridge can be wired and switching the ATEM program bus perfectly, yet the red light appears on the wrong camera or no camera at all. ATEM tally is **not** addressed by "which output cable goes to which camera." Each Blackmagic camera lights its own tally based on the **Camera ID / "Set" number configured in the camera body**, matched against the ATEM input number that is currently on the program/preview bus. If a camera is set to "Camera 3" but is physically cabled to ATEM SDI input 5, putting input 5 on program will light *no* camera (or whichever camera is set to "3"). The tally and camera-control ancillary data is broadcast identically down **every** SDI output (program and aux alike); the camera self-selects by its ID. So the mapping that actually matters is a three-way chain: vMix input → ATEM input number → camera's internal Camera ID.

**Why it happens:**
Developers reason about tally as "route the signal to the camera," but ATEM tally is an addressed broadcast. The camera ID is a physical setting on each camera that the software has zero visibility into and cannot validate.

**How to avoid:**
- Make the mapping explicitly three-column in the config model and UI: `vMix input → ATEM input number → expected Camera ID`. Document that Camera ID must be set on each camera to match its ATEM SDI input number.
- Add a setup-verification mode: drive one ATEM input to program at a time ("walk the inputs") so the operator can confirm the right physical camera lights up. This is the only way to validate the un-introspectable camera-ID link.
- In docs/UI, state the rule plainly: "Set each camera's ID to the ATEM SDI input number it is plugged into."

**Warning signs:**
- Tally lights the wrong camera consistently by a fixed offset → ID/input numbering mismatch.
- No camera lights at all despite ATEM program bus changing → camera IDs not set or set to numbers with no ATEM input.
- Multiview/UI shows correct state but cameras don't react → confirms it's a camera-side ID issue, not a software bug.

**Phase to address:**
Mapping/config phase + a dedicated tally-verification/walk-test feature. This is the single highest-risk item; the verification feature should be in the MVP.

---

### Pitfall 2: vMix tally string is 1000-padded, 1-indexed by input *position*, not by input key/GUID — off-by-one and reorder bugs

**What goes wrong:**
`SUBSCRIBE TALLY` / `TALLY` returns a string like `TALLY OK 0121000...` where each character is one input's state (`0`=off, `1`=program, `2`=preview), padded out to the total number of inputs (up to 1000 chars, max ~1011 bytes). Two classes of bug: (a) **off-by-one** — the string after `TALLY OK ` is positional and developers disagree on whether "position 1" is the first character; mis-slicing the header or treating it as 0-based shifts every camera by one. (b) **Position is not identity** — the position in the tally string corresponds to the input's *current ordinal position* in vMix, which changes when the operator adds/removes/reorders inputs. If you mapped "vMix input 3" by string position, a deleted input 1 silently shifts everyone.

**Why it happens:**
The TCP tally string is the low-latency path, but it only carries positional state, not the stable input key/GUID. The richer identity (Number, Key/GUID, Title) lives in the HTTP/XML API. Developers wire the fast path and assume positions are stable identities.

**How to avoid:**
- Parse defensively: strip exactly the `TALLY OK ` prefix, treat the remainder as a 1-based positional list, and unit-test against captured real strings (including the all-zeros and short-roster cases).
- Anchor the mapping to vMix **input Number** (and ideally also fetch Key/GUID from the XML API at startup/config time) rather than raw string offset. Use the TCP tally string only as a fast state signal, reconciling positions to your configured input numbers.
- On any vMix roster change, re-fetch the input list from the XML API and re-derive position→input-number alignment.

**Warning signs:**
- Everything works until the operator adds or deletes an input mid-show, then every tally is off by one.
- Tally is consistently shifted by one camera from day one → header-slice off-by-one.

**Phase to address:**
vMix integration phase (parser + identity model). Capture-and-replay test fixtures of real tally strings belong here.

---

### Pitfall 3: Overlay/PiP and multi-program inputs corrupt single-input assumptions in the tally string

**What goes wrong:**
The project explicitly scopes to "only the main PGM input gets tally," but the vMix tally string does not respect that simplification — multiple inputs can show `1` (program) simultaneously when overlays/PiP are active, and there is a documented vMix history where an input on an overlay layer that is on program reports `2` (preview) instead of `1` (program). If the code assumes "exactly one input is program," it will either light multiple cameras, light the wrong one, or miss the overlaid one.

**Why it happens:**
Tally is a per-input state, not a single "what's live" value. Live production routinely has lower-thirds, PiP, and multi-view layouts that put several inputs live at once.

**How to avoid:**
- Treat the tally string as N independent per-input states and faithfully mirror each to its mapped ATEM input. Do **not** collapse to "the one program input."
- Decide and document the conflict policy when more inputs are live than the ATEM/cameras can represent (out of scope says overlays are simplified — be explicit that overlaid sources may not get tally, and surface that in the UI rather than guessing).
- Be aware program and preview can briefly both apply to one input during transitions; define precedence (program/red wins over preview/green).

**Warning signs:**
- A camera used in a lower-third/PiP never shows red → overlay state not mirrored.
- Two cameras red when operator expects one → multi-program not reconciled with the simplified model.

**Phase to address:**
vMix integration / mapping phase — define the per-input mirroring model and the program-wins precedence rule up front.

---

### Pitfall 4: Treating the ATEM "real cut" as harmless without handling transitions and the always-live program bus

**What goes wrong:**
The architecture is sound: the ATEM video output is unused, so `changeProgramInput()` causing a "real cut" on the ATEM does not affect the broadcast (vMix is the real program). **But** the program bus is *always live and instant* — and tally is derived from it. Two real risks remain: (1) If you ever trigger a **transition/auto** instead of a hard cut on the ATEM, the ATEM will report *both* the old and new input as program for the duration of the transition (mix), briefly lighting two cameras red. (2) Setting preview to drive green tally is only meaningful in program/preview mode; in "cut bus" mode the preview bus may behave differently, so green tally can be inconsistent across ATEM models/modes.

**Why it happens:**
Developers think "ATEM output is unused, so anything I do to the ATEM is free." Mostly true for video, but tally is a *derivative of bus state*, so transition behavior and bus mode directly shape the tally you emit.

**How to avoid:**
- Always use direct **cut** semantics: set program input via `changeProgramInput()` (instant), never `autoTransition`/`performAutoTransition`. Avoid touching transition style/rate.
- Set the ATEM (where configurable) to a known mode; rely on `changePreviewInput()` for green and `changeProgramInput()` for red, and verify on the target ATEM model that preview reliably emits green tally.
- Keep the ATEM otherwise untouched — don't drive keyers, DSK, fade-to-black, or aux routing, all of which can perturb derived tally.

**Warning signs:**
- Two cameras flash red simultaneously for ~1s on every switch → an auto/mix transition is being triggered instead of a cut.
- Green/preview tally missing or erratic on some ATEM models → bus mode / preview-tally derivation mismatch.

**Phase to address:**
ATEM integration phase — lock down cut-only semantics and verify red+green derivation on the actual ATEM hardware.

---

### Pitfall 5: Reconnect storms and stale state after vMix or ATEM drops

**What goes wrong:**
Auto-reconnect is a requirement, but naive implementations create a reconnect storm (tight retry loop hammering a powered-off ATEM/vMix, flooding logs, spiking CPU) or — worse for live — restore a connection but act on **stale tally state**, leaving a camera red after the source is no longer live, or going dark on all cameras during the gap. atem-connection emits frequent `reconnect` attempts when the device is off; the bridge must also handle the inverse: a reconnect that completes mid-show must resync the full current state, not replay old events.

**Why it happens:**
Reconnect is often bolted on as "retry the socket," ignoring that tally is stateful: a dropped connection means *unknown* state, not *last-known* state. And both endpoints can flap independently.

**How to avoid:**
- Use exponential backoff with a cap (e.g. 1s→max 5–10s) and jitter; never a tight loop. atem-connection has built-in reconnect — configure it rather than re-implementing, and rate-limit your own vMix reconnects.
- On (re)connect to vMix, immediately request a full `TALLY` snapshot and re-derive all states from scratch before resuming event-driven updates. On atem-connection `connected`, read full `state` before issuing commands.
- Define a safe behavior during outage: decide whether to **freeze** last tally or **clear** all tally, and surface "DISCONNECTED" prominently in the UI so the operator isn't trusting stale lights.
- Guard ATEM commands behind a "connected AND state hydrated" flag to avoid the connected-but-not-yet-synced race.

**Warning signs:**
- CPU/log spike when a device is off → no backoff.
- A camera stays red after a cut following a brief disconnect → stale-state replay, no resync.
- Commands sent immediately on `connected` are dropped/ignored → acting before state hydration.

**Phase to address:**
Reliability/reconnect phase, but the resync-on-connect contract must be designed into both integrations from the start.

---

### Pitfall 6: Manual override races with live updates and gets stomped (or stomps live)

**What goes wrong:**
The manual per-camera override (for testing) and the live vMix→ATEM update both write to the same ATEM bus. Without arbitration: a live update arriving 20ms after the operator sets a manual override silently reverts it; or a forgotten manual override masks a real live change, sending a wrong tally during an actual show. Because both paths are async event-driven, the last writer wins nondeterministically.

**Why it happens:**
Two independent sources of truth (operator intent + vMix state) mutate one shared output with no defined precedence or ownership model.

**How to avoid:**
- Model a single authoritative "desired tally state" with an explicit override layer: live updates write the base layer; manual override writes an override layer that takes precedence and is clearly time-bounded or explicitly released.
- Make override state visible and sticky in the UI ("Camera 3: MANUAL OVERRIDE — release"), so it can't be silently forgotten into a live show.
- Funnel all ATEM writes through one serialized state-reconciler (single writer), not from two code paths directly.

**Warning signs:**
- Manual test override flickers off the moment vMix changes anything → no precedence layer.
- A camera shows wrong tally during a real show and an old test override is found enabled → override not surfaced/auto-released.

**Phase to address:**
UI/override phase, but the single-writer state-reconciler architecture must exist before override is added.

---

### Pitfall 7: Blowing the <100ms budget via the wrong vMix path or per-change ATEM thrash

**What goes wrong:**
The end-to-end budget is vMix-switch → camera-light < 100ms. Easy ways to miss it: (a) using the HTTP/XML polling API (port 8088) instead of the TCP push API (8099) — polling adds the poll interval as latency; (b) re-fetching the full XML state on every tally event (XML parse + network round-trip per change); (c) sending redundant ATEM commands for unchanged inputs, risking command rate issues; (d) Node.js event-loop blocking (sync XML parsing, large logging) inserting jitter.

**Why it happens:**
The XML API is easier to reason about (full structured state) so developers lean on it; and "just resend everything" is simpler than diffing.

**How to avoid:**
- Use the TCP `SUBSCRIBE TALLY` push path as the realtime trigger (the project already decided this — enforce it). Use the XML API only at startup/config time for identity resolution, never in the hot path.
- Diff incoming tally against current desired state and send the ATEM only the inputs that actually changed; debounce/coalesce bursts within a few ms.
- Keep the hot path non-blocking: no synchronous heavy parsing or disk logging per event.
- Measure it: timestamp tally-in to command-sent and log p95; don't assume <100ms, verify on the real LAN.

**Warning signs:**
- Tally feels "laggy"/sluggish under rapid switching → polling or per-event XML refetch.
- Latency degrades as input count grows → per-event full-state work.

**Phase to address:**
Latency is a cross-cutting concern; instrument it in the ATEM integration phase and add a measurement/diagnostic readout to the UI.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Map by tally-string position instead of resolving vMix input Number/Key | Less code, no XML API call | Off-by-one + silent breakage on input reorder/delete mid-show | Never for production; OK in a throwaway spike |
| Poll HTTP/XML (8088) instead of TCP push (8099) | Simpler full-state model | Misses <100ms budget; laggy under rapid cuts | Only as a fallback when TCP unavailable |
| Resend all ATEM inputs on every tally event | No diffing logic | Command thrash, latency growth, possible rate issues | Acceptable at 8 inputs *if* coalesced; avoid as default |
| Two code paths (live + override) writing ATEM directly | Fast to build override | Race conditions, stomped overrides in live show | Never — use single-writer reconciler |
| Tight reconnect loop | Trivial to write | Reconnect storm, CPU/log flood | Never — always backoff+jitter |
| Assume exactly one program input | Matches "simplified" scope | Breaks on overlay/PiP/multi-program | Only if UI clearly states overlaid sources get no tally |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| vMix TCP API (8099) | Treating tally string position as stable input identity | Resolve to vMix input Number/Key via XML at config time; position is volatile |
| vMix TCP API | Mis-slicing `TALLY OK ` header → off-by-one | Strip exact prefix; unit-test against captured strings incl. empty roster |
| vMix overlay tally | Assuming overlaid-on-program input reports `1` | It may report `2`; mirror per-input state, define program-wins precedence |
| atem-connection | Sending commands on `connected` before `state` is hydrated | Gate commands on connected AND state read; read full state first |
| atem-connection | Using auto/transition to set program | Use `changeProgramInput()` (instant cut) only; never autoTransition |
| ATEM tally addressing | Assuming the SDI cable routing selects the camera | Tally is broadcast on all SDI outs; camera self-selects by its Camera ID = ATEM input number |
| ATEM aux vs program out | Thinking only program out carries tally | All SDI outs (incl. aux) carry identical tally/control ancillary data; HDMI/downconverted/legacy-multiview do not |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Per-event XML refetch | Latency grows, jitter | TCP push for state; XML only at config | Immediately under rapid cutting |
| No command diffing/coalescing | ATEM command thrash, possible drops | Diff vs desired state, coalesce bursts | Rapid multi-input changes (overlays) |
| Synchronous parse/log in hot path | Periodic latency spikes >100ms | Async, minimal hot-path work | Under load + verbose logging |
| Polling instead of push | Constant ~poll-interval latency floor | SUBSCRIBE TALLY | Always present, hidden until measured |

*Scale note: project caps at 8 cameras/inputs, so raw throughput is not the risk — latency/jitter and correctness are. Do not over-engineer for 1000-input scale.*

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Binding web UI / control server to all interfaces with no auth | Anyone on the production LAN can flip tally / change mapping mid-show | Bind to localhost or trusted subnet; add at least a basic gate; document network assumptions |
| Trusting vMix/ATEM IPs from untrusted UI input without validation | Connection attempts to arbitrary hosts; confusion in multi-instance setups | Validate IP/port input; constrain to expected LAN |
| Verbose logging of full state to disk in hot path | Latency + disk fill during long shows | Rate-limit/structured logging off the hot path |

*Security is secondary here (closed production LAN), but an unauthenticated control surface that can change what's "live-lit" is a real operational hazard mid-show.*

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Connection status hidden or only "connected/not" | Operator trusts stale tally after a silent drop | Prominent per-endpoint status (vMix + ATEM) with last-update time; loud DISCONNECTED state |
| Manual override not visibly sticky | Forgotten test override sends wrong tally in a real show | Persistent "MANUAL" badge per camera + one-click release; optional auto-expiry |
| Mapping UI hides the Camera-ID requirement | Operator can't diagnose "wrong camera lit" | Show the 3-way chain (vMix→ATEM input→Camera ID) and a "walk inputs" verify button |
| No latency/health readout | "Feels laggy" with no way to confirm | Surface measured p95 tally→command latency in UI |

## "Looks Done But Isn't" Checklist

- [ ] **Tally mapping:** Often missing the Camera-ID dimension — verify a real Blackmagic camera lights with a per-input walk test, not just that the ATEM bus changed.
- [ ] **vMix tally parsing:** Often missing reorder/delete handling — verify tally stays correct after adding/removing a vMix input mid-session.
- [ ] **Reconnect:** Often missing state resync — verify that after pulling and restoring the vMix/ATEM network cable, tally reflects *current* state, not pre-drop state.
- [ ] **Override:** Often missing precedence/release — verify a live vMix change does not silently clear an active manual override, and that override is visible.
- [ ] **Latency:** Often unmeasured — verify p95 < 100ms on the actual LAN under rapid switching, not just "feels fast."
- [ ] **Overlay/multi-program:** Often missing — verify behavior (and UI messaging) when two inputs are program simultaneously.
- [ ] **Green/preview tally:** Often assumed — verify preview actually emits green on the target ATEM model/mode, not just program/red.
- [ ] **Cut vs transition:** Verify switches are instant cuts (no two-cameras-red flash) — confirms no auto-transition is being triggered.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Camera-ID/input mismatch | LOW | Reconfigure camera IDs (or mapping table) to match ATEM input numbers; re-run walk test |
| Off-by-one tally parse | LOW | Fix header slice/indexing; add captured-string regression test |
| Position-as-identity breakage | MEDIUM | Re-architect mapping to resolve vMix input Number/Key; re-test reorder/delete |
| Stale state after reconnect | MEDIUM | Add full-state resync on (re)connect for both endpoints; gate commands on hydration |
| Override race | MEDIUM | Introduce single-writer reconciler with explicit override layer |
| Missed <100ms budget | MEDIUM-HIGH | Move to TCP push, add diffing/coalescing, profile hot path; may require event-flow rework |
| Two-cameras-red on switch | LOW | Switch from auto-transition to direct changeProgramInput cut |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Camera-ID vs SDI input mismatch (#1) | Mapping/config + walk-test feature (MVP) | Per-input walk test lights the correct physical camera |
| vMix tally indexing/off-by-one (#2) | vMix integration | Regression tests on captured tally strings; reorder/delete test |
| Overlay/multi-program (#3) | vMix integration / mapping | Two-input-program scenario behaves per documented policy |
| ATEM cut vs transition & bus mode (#4) | ATEM integration | No double-red flash on switch; green verified on target ATEM |
| Reconnect storm / stale state (#5) | Reliability/reconnect | Cable-pull test resyncs to current state; backoff observed |
| Override vs live race (#6) | UI/override (after reconciler exists) | Live change does not stomp visible override |
| <100ms latency (#7) | ATEM integration + UI diagnostics | Measured p95 < 100ms under rapid switching on real LAN |

## Sources

- vMix TCP API official docs — TALLY / SUBSCRIBE TALLY format, 0/1/2 states, 1000-padding, ~1011-byte max, UTF8 `\r\n`: https://sd3.vmix.com/help29/TCPAPI.html and https://wp.vmix.com/help28/TCPAPI.html
- vMix forums — overlay tally reporting `2` instead of `1` bug/limitation: https://forums.vmix.com/posts/t15916-Overlay-Tallys-and-the-vMix-API , https://forums.vmix.com/posts/t26990-TCP-API-Tally-bug--FIXED , https://forums.vmix.com/posts/t22524-TCP-API-TALLY-needs-to-be-improved
- node-vmix (reference implementation of TCP tally parsing): https://github.com/jensstigaard/node-vmix
- atem-connection (Sofie) library — connected/stateChanged/error events, changeProgramInput, built-in reconnect: https://www.npmjs.com/package/atem-connection , https://github.com/nrkno/sofie-atem-connection
- "How ATEM Tally Works" (1 Source Video) + Blackmagic forum/docs — tally addressed by Camera ID matching SDI input, broadcast on all SDI outs incl. aux, HDMI/downconvert/legacy-multiview carry no tally: https://1sourcevideo.com/shop/pub/media/manuals/How-ATEM-Tally-Works.pdf , https://heretorecord.com/blog/control-hdmi-blackmagic-cameras-from-an-atem-sdi-switcher/
- ATEM SDI getting started — program bus always live / cut-bus vs program-preview mode, SDI program return carries camera control: https://www.blackmagicdesign.com/products/atemsdi/gettingstarted
- Confidence note: atem-connection lifecycle/transition-tally specifics are MEDIUM (training + general docs); verify `changePreviewInput` green-tally behavior and `connected`-before-`state` ordering against the installed library version and the actual ATEM model during the integration phase.

---
*Pitfalls research for: vMix→ATEM SDI tally bridge*
*Researched: 2026-06-29*
