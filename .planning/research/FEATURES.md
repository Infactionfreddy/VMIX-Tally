# Feature Research

**Domain:** Tally-bridge / tally-routing software for live multi-camera video production (vMix switcher → ATEM-as-tally-distributor → Blackmagic SDI cameras)
**Researched:** 2026-06-29
**Confidence:** HIGH (core tally semantics, vMix TCP API, ATEM bus model verified against official docs and the reference open-source product Tally Arbiter)

## Domain Framing

This is a narrow, opinionated tally bridge — not a general tally hub. The reference product in the
space is **Tally Arbiter** (MIT, josephdadams), which is a *many-source → many-output arbiter*. Our
project is deliberately the opposite: **one source (vMix), one transport (ATEM bus), one camera family
(Blackmagic SDI)**. So Tally Arbiter defines the feature *vocabulary* (sources, mapping, connection
status, bus arbitration, web dashboard), but most of its breadth is explicitly out of scope.

Key technical truths that shape the feature list:

- **vMix TCP API (`SUBSCRIBE TALLY`, port 8099)** pushes a single string of per-input states where
  `0=off, 1=program, 2=preview`, padded to the input count. This is *main-mix tally only* — it does
  not expose overlays/PiP/multi-bus state. This perfectly matches the "main-PGM-only" v1 scope and is
  the reason that constraint is cheap rather than a limitation we're imposing. (HIGH)
- **ATEM tally is derived from its PGM/PVW bus** and embedded as ancillary data in *every* SDI output.
  To make a camera go red, the server must put that camera's ATEM input on the **Program bus**; for
  green, on the **Preview bus** (PGM takes priority over PVW). The ATEM's *video* is irrelevant — only
  the bus state matters. This makes "set ATEM program/preview" the single load-bearing output action. (HIGH)

## Feature Landscape

### Table Stakes (Users Expect These)

Missing any of these makes the bridge unusable in a live show.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| vMix TCP tally subscription (real-time PGM/PV push) | The whole product is reading vMix live state with low latency | MEDIUM | `SUBSCRIBE TALLY` on 8099; parse padded `0/1/2` string. Polling HTTP/XML (8088) would blow the <100ms budget — TCP push is the correct path |
| ATEM connection + set Program/Preview bus | The only way to produce per-camera SDI tally | MEDIUM | Use `atem-connection`. Must drive both PGM and PVW buses, not just PGM, or green tally never appears |
| Configurable vMix-input → ATEM-input mapping | vMix input numbers rarely equal ATEM input numbers; without it nothing lines up | MEDIUM | The core "mixing" function. Per-row: vMix input ↔ ATEM input ↔ friendly camera label. Up to 8 rows for v1 |
| Live status dashboard (which camera is red/green right now) | Operator must trust the bridge at a glance during a show | MEDIUM | WebSocket push to browser. Mirror of internal tally state, one tile per camera. This is the "is it working?" surface |
| Connection status for vMix and ATEM (green/red, reconnecting) | A dark tally with no explanation is the #1 live-failure scenario; operators need to know *which* link died | LOW–MEDIUM | Tally Arbiter convention: green=connected, red=error. Show per-endpoint state + last-update timestamp |
| Auto-reconnect on vMix or ATEM drop | Networks and switchers hiccup mid-show; manual restart is unacceptable live | MEDIUM | Backoff reconnect loop per connection; on reconnect, re-subscribe (vMix) and re-assert current bus state (ATEM) |
| Connection setup UI (IP/port for vMix + ATEM) | Show-to-show the IPs change; editing a config file at the desk is error-prone | LOW | Form + validation + "test connection". Feeds config persistence |
| Config persistence across restart | Re-entering mapping + IPs every launch is a non-starter in production | LOW | Single JSON/config file on disk. Load on boot, save on change |
| State reconciliation on (re)connect | After any reconnect the ATEM bus must match current vMix tally, not a stale state | MEDIUM | On ATEM reconnect, push current desired buses; on vMix reconnect, treat first TALLY frame as truth. Prevents "stuck red" after a blip |

### Differentiators (Competitive Advantage)

Not strictly required for a working show, but high value for this specific bridge use case and cheap-ish.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Manual per-camera tally override (force red/green/off) | Lets the operator test SDI wiring + camera tally before talent arrives, and force-light a camera on demand | LOW–MEDIUM | Already in PROJECT scope. Must be clearly visually distinct from live state and auto-clear or be explicitly "sticky" so it can't be forgotten on air |
| Latency / freshness indicator (time since last vMix update; measured switch→ATEM delay) | The product's headline promise is <100ms; showing it builds trust and surfaces a degrading network early | MEDIUM | Timestamp deltas are cheap; true end-to-end measurement (vMix event → ATEM ack) is the harder, more valuable version |
| Per-mapping-row live indicator + unmapped-input warning | Instantly shows a vMix input that's live but has no ATEM target (silent tally failure) | LOW | Catches the most common config mistake: a camera with no mapping that simply never lights |
| "ATEM tally output health" hint | ATEM produces tally even with no real video; easy for users to wire the SDI tally feed wrong | LOW | Documentation + a UI note: tally rides ancillary data on *every* ATEM SDI out; the return feed to cameras must come from the ATEM, video content irrelevant |
| Activity/event log (connects, drops, switches) | Post-show debugging of "camera 3 didn't light at 14:02" | LOW | Append-only in-memory + optional file. Tally Arbiter exposes logs for source errors; mirror that |
| Mapping import/export | Reuse a venue's mapping across machines / back it up | LOW | Falls out of config persistence for near-free |

### Anti-Features (Deliberately NOT in v1)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Overlay / PiP / multi-source tally (multiple inputs live at once) | "Real" broadcast tally lights every visible source | vMix TCP `TALLY` doesn't expose overlay state at all — would require XML polling + bus arbitration logic, breaking the latency budget and simplicity. PROJECT explicitly defers it | v1: main-PGM input only. Document as a v2 path via XML API + arbitration |
| ESP32 / W5500 hardware tally lamps | Generic tally projects (incl. Tally Arbiter) drive microcontroller lights | The whole point of using the ATEM is *native SDI tally* on Blackmagic cameras — no per-camera hardware. Building hardware re-introduces the problem the bridge solves | Native SDI return-channel tally via ATEM. ESP-IDF in the workspace is incidental, not in scope |
| Driving / remote-controlling vMix | "If we already talk to vMix, let it switch too" | Turns a read-only observer into a control surface; the operator switches in vMix. Adds risk and scope with no tally value | Read vMix only (`SUBSCRIBE TALLY`). Never send switching commands |
| Using ATEM video output as program/broadcast feed | "We have an ATEM, why not mix on it" | ATEM is a tally distributor here; vMix is the real program. Routing the ATEM as program contradicts the entire architecture | ATEM video output ignored; only its PGM/PVW bus + SDI ancillary tally are used |
| Many-source arbitration (Ross, OBS, TSL, OSC, NewTek...) | Tally Arbiter supports 18+ sources | Massive surface area irrelevant to a vMix-only shop; this product wins by being narrow and reliable | Single source: vMix. Point users at Tally Arbiter if they need a hub |
| Multiple ATEM / multiple vMix endpoints | Large multi-room facilities | 8 cameras on one ATEM and one vMix covers the target. N×M endpoint management multiplies connection/reconnect/mapping complexity | One vMix + one ATEM in v1. Revisit only if a concrete multi-room need appears |
| Cloud relay / remote tally over internet | Tally Arbiter pushes tally to cloud for remote access | Adds auth, transport, and failure modes irrelevant to a single-venue LAN bridge | Local-network web UI only |
| User accounts / auth / roles | "Production software should have logins" | Single-operator LAN tool; auth is friction with no payoff at this scale | Trusted LAN, no auth in v1 |

## Feature Dependencies

```
vMix TCP tally subscription ───┐
                               ├──requires──> internal tally-state model ──drives──> ATEM set PGM/PVW bus
vMix↔ATEM input mapping ───────┘                       │
                                                       ├──renders──> Live status dashboard (WebSocket)
                                                       └──renders──> per-row live + unmapped warnings

Connection setup UI ──requires──> Config persistence ──requires──> mapping import/export (free)

Auto-reconnect ──requires──> per-connection lifecycle ──requires──> State reconciliation on (re)connect
                                                                          (re-assert ATEM bus / re-trust vMix)

Manual override ──conflicts──> live vMix-driven state  (must define precedence: override wins, visibly)

Latency indicator ──enhances──> Live status dashboard
Activity log ──enhances──> Connection status + auto-reconnect (explains drops)
```

### Dependency Notes

- **Everything routes through one internal tally-state model.** vMix push + mapping + manual override all
  write to a single per-camera desired-state, and the ATEM driver + dashboard both read from it. Build this
  abstraction first; it's the spine.
- **Mapping is a hard prerequisite for the ATEM driver.** Without vMix→ATEM input translation the driver
  has no target. Mapping and the state model belong in the earliest phase.
- **Auto-reconnect requires state reconciliation, not just a reconnect loop.** Reconnecting without
  re-asserting bus state leaves cameras stuck on stale tally — the reconnect feature is incomplete without it.
- **Manual override conflicts with live state by definition.** A precedence rule is mandatory:
  override takes priority and is rendered distinctly, so an operator can never leave a forced tally on air
  unknowingly. Auto-expiry or an explicit "release all overrides" control mitigates this.
- **Config persistence underpins both connection setup and mapping.** It's low complexity but blocks the
  usability of two table-stakes features, so it's an early dependency despite being "boring."

## MVP Definition

### Launch With (v1) — maps directly to PROJECT "Active" requirements

- [ ] vMix TCP `SUBSCRIBE TALLY` connection + parse PGM/PV — the live signal source
- [ ] ATEM connection (`atem-connection`) + set Program/Preview bus per mapped input — the output
- [ ] Internal per-camera tally-state model — the spine all features read/write
- [ ] vMix-input → ATEM-input mapping (up to 8), with camera labels — the core "mix" function
- [ ] Live status dashboard (red/green per camera, WebSocket) — operator trust surface
- [ ] Connection status for vMix + ATEM (connected/error/reconnecting) — fault visibility
- [ ] Connection setup UI (IP/port for both) — show-to-show configurability
- [ ] Config persistence (mapping + endpoints, JSON on disk) — survive restarts
- [ ] Auto-reconnect + state reconciliation on reconnect — live-safe resilience
- [ ] Manual per-camera override with clear precedence/visual distinction — pre-show testing + control

### Add After Validation (v1.x)

- [ ] Latency / freshness indicator (start with "time since last update", then true end-to-end) — once core is trusted, prove the <100ms claim
- [ ] Per-row unmapped-input live warning — add once real mappings expose the mistake
- [ ] Activity/event log + export — add when first real-show debugging is needed
- [ ] Mapping import/export — add when a second deployment machine appears

### Future Consideration (v2+)

- [ ] Overlay / PiP / multi-source tally via vMix XML API + bus arbitration — only if shows need multi-live tally; large scope, breaks simplicity
- [ ] Multiple ATEM / vMix endpoints — only for multi-room facilities
- [ ] Additional sources (OBS, TSL, OSC) — only if scope broadens from "vMix bridge" to "tally hub" (at which point Tally Arbiter may be the better tool)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| vMix TCP tally subscription | HIGH | MEDIUM | P1 |
| ATEM set PGM/PVW bus | HIGH | MEDIUM | P1 |
| Internal tally-state model | HIGH | MEDIUM | P1 |
| vMix↔ATEM mapping (8) + labels | HIGH | MEDIUM | P1 |
| Live status dashboard | HIGH | MEDIUM | P1 |
| Connection status (both endpoints) | HIGH | LOW | P1 |
| Connection setup UI | HIGH | LOW | P1 |
| Config persistence | HIGH | LOW | P1 |
| Auto-reconnect + reconciliation | HIGH | MEDIUM | P1 |
| Manual per-camera override | MEDIUM | LOW | P1 |
| Latency / freshness indicator | MEDIUM | MEDIUM | P2 |
| Unmapped-input live warning | MEDIUM | LOW | P2 |
| Activity/event log | MEDIUM | LOW | P2 |
| Mapping import/export | LOW | LOW | P3 |
| Overlay/PiP tally | MEDIUM | HIGH | P3 (v2) |
| Multiple endpoints | LOW | HIGH | P3 (v2) |

**Priority key:** P1 = must have for launch · P2 = should have, add post-validation · P3 = future

## Competitor Feature Analysis

| Feature | Tally Arbiter (reference) | vMix native tally | Our bridge |
|---------|---------------------------|-------------------|------------|
| vMix as source | Yes (one of 18+ sources) | N/A (it *is* vMix) | Yes — sole source, via TCP push |
| Per-camera SDI tally on Blackmagic | Indirect (drives external lights/MCUs) | No native SDI-to-BMD path | **Yes — via ATEM bus → SDI ancillary** (the core differentiator) |
| Input→output mapping | Yes (device assignments / bus arbitration) | vMix input == its own tally | Yes — explicit vMix→ATEM input map |
| Web dashboard | Yes (tablet/phone tally pages) | Limited (vMix UI tally) | Yes — live red/green status |
| Connection status (green/red) | Yes | N/A | Yes — per endpoint + reconnecting |
| Manual override | Messaging/producer comms | No | Yes — per-camera force red/green/off |
| Auto-reconnect | Yes | N/A | Yes + state reconciliation |
| Many sources / arbitration | Yes (its whole reason to exist) | No | **No — deliberately single-source** |
| Hardware tally lights (ESP32/blink(1)/GPO) | Yes | GPI via SWTALGPI8 | **No — native SDI instead** |
| Overlay/multi-bus tally | Partial (per-source) | vMix multi-bus exists in XML | **No in v1** — main PGM only |

**Our wedge:** Tally Arbiter is a broad arbiter that drives *external* lights; it does not natively turn
vMix state into *Blackmagic SDI return-channel* tally. This bridge does exactly that one thing, using the
ATEM the operator already owns as the SDI tally injector — no extra per-camera hardware.

## Sources

- [Tally Arbiter](https://tallyarbiter.com/) — reference open-source tally system, feature vocabulary
- [Tally Arbiter Sources docs](https://josephdadams.github.io/TallyArbiter/docs/usage/sections/sources/) — per-source config, connection status (green/red) convention, device mapping
- [Tally Arbiter GitHub](https://github.com/josephdadams/TallyArbiter) — MIT, supported sources/outputs
- [Tally Arbiter Setup Guide — Cue Light blog](https://cuelight.io/blog/tally-arbiter-setup-guide) — real-world usage and a simpler-alternative framing
- [vMix TCP API](https://wp.vmix.com/help28/TCPAPI.html) — `SUBSCRIBE TALLY`, port 8099, `0/1/2` padded tally format (HIGH)
- [node-vmix](https://github.com/jensstigaard/node-vmix) — Node.js vMix TCP tally library reference
- [How ATEM Tally Works (1SourceVideo PDF)](https://1sourcevideo.com/shop/pub/media/manuals/How-ATEM-Tally-Works.pdf) — tally as ancillary data on all SDI outputs (HIGH)
- [ATEM-Tally-SDI — SPCoast](https://www.spcoast.com/pages/ATEM-Tally-SDI.html) — PGM/PVW bus → red/green, PGM priority over PVW
- [Ross Video — role of tally systems](https://www.rossvideo.com/blog/the-crucial-role-of-tally-light-systems-in-live-broadcasting/) — production expectations, control-system framing
- [Blackmagic SWTALGPI8 GPI & Tally Interface](https://www.bhphotovideo.com/c/product/766076-REG/Blackmagic_Design_SWTALGPI8_GPI_Tally_Interface.html) — ATEM tally hardware context

---
*Feature research for: vMix→ATEM tally-bridge*
*Researched: 2026-06-29*
