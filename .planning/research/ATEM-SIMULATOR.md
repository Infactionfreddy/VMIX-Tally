# ATEM Switcher Simulator — Implementation Spec (Research)

**Goal:** A Node.js program that speaks the real Blackmagic ATEM UDP control protocol (port 9910) well enough that the `atem-connection` npm client (Sofie/NRK) connects to it as if it were real ATEM hardware, accepts program/preview-input change commands, and emits tally state back — so a vMix→ATEM tally bridge can be tested without hardware.

**Status:** RESEARCH ONLY. This document is an implementation spec, not an implementation.

**Library version inspected:** `atem-connection@3.9.0`, installed into the scratchpad. All file paths below are relative to:
`<scratchpad>/node_modules/atem-connection/dist/`
Upstream source: https://github.com/Sofie-Automation/sofie-atem-connection (repo recently renamed from `nrkno/sofie-atem-connection`).

---

## 0. Executive summary / TL;DR

- The cleanest approach is **reuse `atem-connection`'s own command codec classes** for serialization, and **hand-roll a tiny UDP transport + handshake state machine** (the library's transport is client-only and tightly coupled to a worker thread, so it cannot be reused server-side as-is). The codecs are trivially reusable from the same npm package.
- The client only requires **one** state command to flip to `CONNECTED`: **`InCm`** (InitComplete). It transitions to `Established` (transport-level) the moment we reply to its hello with the **`NewSessionId`** flag set. Everything between hello and `InCm` is optional for *connecting*, but a realistic minimal set is needed so the client's `state` object is populated enough that the bridge can read program/preview/tally.
- **Unknown command codes are silently skipped** by the client parser (logged at `debug`, never an error). This drastically reduces what the simulator must implement. `TlIn` (tally-by-index) has **no decoder class** in the client and is ignored; tally is consumed by downstream code via the state model and/or `TlSr`.
- A close prior-art reference exists: **`jonknoll/pyAtemSim`** (Python, MIT) — a working ATEM server/simulator. It is the best reference for a real captured handshake + state dump. Not a drop-in for a Node project, but directly portable in concept.

---

## 1. Existing emulators / prior art

| Project | URL | Lang / License | Reusable? |
|---|---|---|---|
| **pyAtemSim** | https://github.com/jonknoll/pyAtemSim | Python, **MIT** | **Best reference.** A real ATEM *server*/simulator: implements UDP handshake, multi-client, and a state dump replayed from a captured `default_config.xml`. Files: `atem_server.py`, `atem_packet.py`, `atem_commands.py`, `client_manager.py`, `raw_commands.py`. Not a Node drop-in, but the protocol logic and the captured command dump are directly portable. `raw_commands.py` is effectively a real wireshark-captured state dump (`_ver`, `_pin`, `_top`, `_mvp`, `InPr`, `PrgI`, `PrvI`, `TlIn`, `TlSr`, …). Early-stage but functional. |
| **LibAtem / AtemUtils** | https://github.com/LibAtem/AtemUtils | C#, see repo | Contains a "fake ATEM" that **replays a wireshark capture** of an init back to any connecting client. Great for capturing/validating a known-good handshake byte stream. Not a Node drop-in; replay-only (won't react to commands), but excellent for byte-level reference. |
| **LibAtem/AtemProxy** | https://github.com/LibAtem/AtemProxy | C#, see repo | Proxy that decodes commands a client sends to a real ATEM — useful to *observe* what `atem-connection` emits (e.g. `CPgI`/`CPvI`) if you ever get hardware. |
| **LibAtem** | https://github.com/LibAtem/LibAtem | C# (.NET), see repo | Reference client; best community protocol implementation outside Sofie. Reference only. |
| **Dev1an/Atem-Simulator** | https://github.com/Dev1an/Atem-Simulator | Swift, license unspecified | macOS GUI app on top of `Swift-Atem`. 73★, last release 2019-11, dormant. Native app, **not** a network service you can run headless in CI. Reference only. |
| **Sofie ATEM Connection** | https://github.com/Sofie-Automation/sofie-atem-connection | TS, **MIT** | The client we must satisfy. **Reuse its codecs** (see §2). Has no server/emulator helper. |
| **atem-connection-test-generator** | https://github.com/LibAtem/atem-connection-test-generator | TS | Generates serialization unit-test fixtures for atem-connection — a source of known command byte vectors useful as golden test data. |
| **OpenSwitcher / OpenSwitcher protocol docs** | https://openswitcher.org/ , https://docs.openswitcher.org/ | GPL (lib), docs | Best independent protocol docs (PyATEMMax/openswitcher lineage). Reference for command field layouts. |
| **julusian protocol docs** | https://atem.julusian.dev/protocol | docs | By the atem-connection maintainer. Canonical-ish header/flag definitions (incomplete in places; cross-check with the library source, which is authoritative). |
| **node-atem spec** | https://github.com/miyukki/node-atem/blob/master/specification.md | docs | Older but readable header + command-framing notes. |
| **Skaarhoj ATEM lib** | https://github.com/kasperskaarhoj/SKAARHOJ-Open-Engineering (`ArduinoLibs/ATEM/ATEM.cpp`) | C++ | The original reverse-engineering; stale (≤FW 7.5) but the conceptual origin of the handshake. |

**Conclusion on prior art:** No drop-in Node emulator exists. `pyAtemSim` is the closest working *server* and the best behavioral reference; LibAtem/AtemUtils is the best byte-level capture reference. For a Node project that must satisfy `atem-connection`, reusing that same package's codec classes is strictly easier and guaranteed wire-compatible.

---

## 2. Reusing atem-connection's own codecs

The package ships compiled JS + d.ts in `dist/`. The command classes are exported from `atem-connection` (root) under `Commands`, and individually from `commands/`. The simulator can `require('atem-connection')` and use the same encode/decode logic the client uses — guaranteeing wire compatibility.

### 2.1 What is reusable vs. not

- **Reusable directly:** all command (de)serialization classes (`serialize(version)` / `static deserialize(buf, version)`), the `CommandParser` (`lib/atemCommandParser.js`), and the enums/state helpers.
- **NOT reusable for the server side:** the transport. `lib/atemSocketChild.js` is the *client* handshake (it *sends* the hello, expects `NewSessionId` back). `lib/atemSocket.js` wraps it in a `threadedclass` worker. There is **no server/emulator helper** in the package. The simulator must implement its own UDP server + handshake (small; see §3).

### 2.2 Packet building helper (reusable)

- `lib/packetBuilder.js` → class **`PacketBuilder`** (`new PacketBuilder(maxPacketSize, protocolVersion)`).
  - `addCommand(cmd)` — serializes a command and writes the **8-byte command header**: `writeUInt16BE(payload.length + 8, off+0)` (length incl. header) and `write(rawName, off+4, 4)` (4-char ASCII name). Bytes 2–3 of the command header are left **zero** (the client ignores them; historically "checksum?"). Payload copied at `off+8`.
  - `getPackets()` — returns an array of `Buffer` payloads (each already a concatenation of framed commands, capped at `maxPacketSize`).
  - **This is exactly the framing the simulator needs for its state-dump payloads.** Feed those payload buffers into the simulator's own packet header (§3). Note `DEFAULT_MAX_PACKET_SIZE` is exported from the package root; ATEM uses ~1400-byte payloads — keeping payloads under ~1416 bytes total is safe.

### 2.3 The exact command classes to use

All paths under `dist/`. Each writable/readable class exposes a static `rawName` (the 4-char opcode) and `serialize(version)` / `static deserialize(buf, version)`.

| Purpose | Opcode | Class | File | Notes |
|---|---|---|---|---|
| **Program set** (client→sim) | `CPgI` | `ProgramInputCommand` | `commands/MixEffects/ProgramInputCommand.js` | Payload 4 B: `u8 mixEffect @0`, `u16BE source @2`. **Simulator must DECODE this.** Class has `serialize` (client side); to decode, just read those offsets manually, or instantiate via the parser then read `.mixEffect`/`.properties.source` — note the *writable* class has no `deserialize`; decode manually. |
| **Program state** (sim→client) | `PrgI` | `ProgramInputUpdateCommand` | same file | `serialize` not provided (it's a read class). **Simulator must ENCODE this manually**: 4 B `u8 me @0`, `u16BE source @2`. Client decodes via `deserialize` → `state.video.mixEffects[me].programInput`. |
| **Preview set** (client→sim) | `CPvI` | `PreviewInputCommand` | `commands/MixEffects/PreviewInputCommand.js` | Payload 4 B identical layout. Decode manually. |
| **Preview state** (sim→client) | `PrvI` | `PreviewInputUpdateCommand` | same file | Encode manually, same 4-B layout → `state.video.mixEffects[me].previewInput`. |
| **Tally by source** (sim→client) | `TlSr` | `TallyBySourceCommand` | `commands/TallyBySourceCommand.js` | Read-only class (`deserialize` only). Encode manually: `u16BE count @0`, then per source: `u16BE source @(2+i*3)`, `u8 value @(4+i*3)` where `value` bit0=program, bit1=preview. |
| **Tally by index** | `TlIn` | *(none)* | — | **No decoder class exists in atem-connection.** Client logs `Unknown command TlIn` at debug and ignores it. Optional to send; harmless. Layout (from pyAtemSim/openswitcher): `u16BE count @0`, then `u8` per input (bit0=program, bit1=preview). |
| **Init complete** (sim→client) | `InCm` | `InitCompleteCommand` | `commands/InitCompleteCommand.js` | **Zero payload.** This is the trigger that flips the client to `CONNECTED`. |
| **Topology** (sim→client) | `_top` | `TopologyCommand` | `commands/DeviceProfile/topologyCommand.js` | Defines ME count + source count etc. **Required** so `state.info.capabilities` exists (otherwise `PrgI`/`PrvI` `applyToState` throw `InvalidIdError` — caught, but program/preview never populate). Layout below in §4. |
| **Version** (sim→client) | `_ver` | `VersionCommand` | `commands/DeviceProfile/versionCommand.js` | `u32BE version @0`. **Must be sent first**; the client uses it to set `CommandParser.version`, which affects how later commands decode. Use a value from the `ProtocolVersion` enum (see §2.4). |
| **Product id** (sim→client) | `_pin` | `ProductIdentifierCommand` | `commands/DeviceProfile/productIdentifierCommand.js` | 41 B: null-terminated string @0..40 (model name), `u8 model @40`. Read-only class; encode manually. |
| **Input properties** (sim→client) | `InPr` | `InputPropertiesUpdateCommand` | `commands/Inputs/InputPropertiesCommand.js` | Populates `state.inputs[id]` (long/short name, port types). Needed for a realistic input list and for the library's `listVisibleInputs` tally derivation. Layout in §4. Read class; encode manually. |
| **Aux source** (optional) | `AuxS` / `CAuS` | `AuxSourceUpdateCommand` / `AuxSourceCommand` | `commands/AuxSourceCommand.js` | Only if aux routing is exercised. |
| **Time** (optional) | `Time` | `TimeCommand` | `commands/TimeCommand.js` | Periodic timecode; cosmetic. |

### 2.4 Protocol version

`enums/index.js` → `ProtocolVersion`:
```
V7_2   = 131094 (0x00020016)  // CommandParser default / minimum supported
V7_5_2 = 131099
V8_0   = 131100
V8_0_1 = 131101
V8_1_1 = 131102
V9_4   = 131103
V9_6   = 131104 (0x00020020)
```
Recommend the simulator advertise **`V8_1_1` (131102)** via `_ver` — it is widely supported by the topology decoder (`v230offset` branch) and avoids edge cases. The `_top` decoder reads an extra multiviewer byte when `version > V8_0_1`, so the simulator's `_top` payload layout must match the advertised version (see §4).

### 2.5 The client-side parse loop (authoritative framing reference)

`lib/atemSocket.js` `_parseCommands(buffer)`:
```js
while (buffer.length > 8) {
  const length = buffer.readUInt16BE(0);     // command length incl. 8-B header
  const name   = buffer.toString('ascii', 4, 8); // 4-char opcode @ offset 4
  if (length < 8) break;                     // malformed guard
  const ctor = commandFromRawName(name);
  if (ctor && typeof ctor.deserialize === 'function') {
     const cmd = ctor.deserialize(buffer.slice(8, length), version); // payload @ offset 8
     if (cmd instanceof VersionCommand) version = cmd.properties.version; // _ver sets version
     ...
  } else {
     emit('debug', `Unknown command ${name}`); // <-- unknown = ignored, NOT an error
  }
  buffer = buffer.slice(length);
}
```
Implications for the simulator:
- Command header = **8 bytes**: `u16BE length @0` (total incl. header), bytes 2–3 = 0, `4 ASCII chars @4`, payload @8. (Identical to `PacketBuilder` output.)
- `length` must equal `8 + payload.length` and be ≤ remaining buffer, else the loop breaks/misframes. Get this exactly right or the whole packet's command stream desyncs.
- Multiple commands are concatenated back-to-back in one payload.
- **Unknown opcodes are skipped, never fatal.** Send extra/odd commands freely.

### 2.6 How the client reaches CONNECTED

`atem.js` (`BasicAtem._mutateState`):
```js
const initComplete = commands.find((cmd) => cmd instanceof Commands.InitCompleteCommand);
if (initComplete) { this._status = AtemConnectionStatus.CONNECTED; this._onInitComplete(); } // emits 'connected'
```
`_onInitComplete()` → `emit('connected')`. `applyToState` errors are caught (line ~159): `InvalidIdError` → `debug`, other → `error` event, but neither aborts the connection. So the **only** hard requirement to report connected is to deliver a parseable `InCm` command inside a properly-acked reliable packet.

---

## 3. The UDP wire / handshake protocol

Authoritative source: `lib/atemSocketChild.js` (the client). The simulator is the *peer* of this code; everything below is derived from it.

### 3.1 The 12-byte packet header

All multi-byte fields are **big-endian**. Bytes 0–1 pack flags (top 5 bits) and length (low 11 bits):

| Offset | Size | Field | Meaning |
|---|---|---|---|
| 0 | u16BE | `flags<<11 | length` | High 5 bits = flags; low 11 bits = **total packet length** incl. 12-B header. Read length as `readUInt16BE(0) & 0x07FF`; read flags as `readUInt8(0) >> 3`. |
| 2 | u16 | **Session Id** | Connection id. Client copies whatever the server sends here and reuses it. |
| 4 | u16 | **Acked Packet Id** | Set when `AckReply` flag present (this packet acknowledges that id). |
| 6 | u16 | **Retransmit "from" Packet Id** | Set when `RetransmitRequest` flag present. |
| 8 | u16 | (unknown / reserved) | Left 0. Client does not read it. |
| 10 | u16 | **Packet Id** (local sequence) | Set when `AckRequest` flag present; increments per reliable packet. |
| 12+ | — | Payload (framed commands) | |

Length field is **11 bits** (max 2047), masked with `0x07FF`. The client *rejects* any packet where `(readUInt16BE(0) & 0x07FF) !== rinfo.size` (the on-wire UDP datagram size must equal the declared length) — see `_receivePacket`: `if (length !== rinfo.size) return;`. **The simulator must set the length field to the exact datagram byte count.**

### 3.2 Flag bits (`PacketFlag`, from `atemSocketChild.js`)

These occupy the top 5 bits of byte 0 (i.e. value `flag << 11` in the u16 at offset 0; or `flag << 3` if you think of byte 0 alone):

| Flag | Value | Used by |
|---|---|---|
| `AckRequest` | `0x01` | Sender wants this reliable packet acked. Sets Packet Id @10. |
| `NewSessionId` | `0x02` | **The hello-response flag.** When the client sees this, it transitions `SynSent → Established` and acks. (a.k.a. "Hello/SYN-ACK / Connect".) |
| `IsRetransmit` | `0x04` | This packet is a retransmission. |
| `RetransmitRequest` | `0x08` | Sender requests retransmit from id @6. |
| `AckReply` | `0x10` | This packet acknowledges id @4. |

Concretely, byte 0 high bits:
- AckRequest packet: `flags=0x01` → byte0 top = `0x08` → header u16 = `0x0800 | length`.
- AckReply packet: `flags=0x10` → byte0 top = `0x80` → header u16 = `0x8000 | length`.
- Hello-response (NewSessionId): `flags=0x02` → byte0 top = `0x10` → header u16 = `0x1000 | length`. (Real ATEM hello-responses are 20-byte packets; see §3.3.)

### 3.3 The client's HELLO packet (what the simulator receives first)

`atemSocketChild.js` exports the exact fixed 20-byte buffer the client sends on connect:
```
COMMAND_CONNECT_HELLO =
10 14 53 ab 00 00 00 00 00 3a 00 00 01 00 00 00 00 00 00 00
```
Decode: byte0 `0x10` → flags `0x10>>3 = 0x02` = **NewSessionId**; length `0x1014 & 0x07FF = 0x14 = 20`. Session id `0x53ab` (a provisional/random client id). The remaining 8 bytes are a fixed hello payload (the client never varies it; `0x003a...0100...`). The simulator should treat **any 20-byte packet with the NewSessionId flag** as a connect request.

### 3.4 The handshake the simulator must perform

```
CLIENT                                   SIMULATOR (server)
  | --- HELLO (20B, NewSessionId) ----->  |  detect connect
  |                                        |  allocate a real session id (e.g. 0x0001..0x7FFF)
  | <-- HELLO-RESPONSE (20B, NewSessionId) |  flags=NewSessionId, sessionId=<assigned>
  |    client sets _connectionState=Established, copies sessionId, acks
  | --- ACK (12B, AckReply) ----------->  |  (client acks the hello-response's packetId)
  |                                        |
  | <== state dump (reliable, AckRequest, sessionId, packetId=1,2,3...) ==
  |     _ver, _pin, _top, InPr*, PrgI, PrvI, TlSr, ... , InCm
  | --- ACK(s) (AckReply, ackId=N) ----->  |  client acks each reliable packet
  |    on receiving InCm: status=CONNECTED, emit('connected')
  |                                        |
  | <==> steady state: keepalive pings, command exchange ==>
```

**Hello-response details (critical):**
- Must carry the **`NewSessionId`** flag. That single flag is what flips the client from `SynSent` to `Established` (`_receivePacket`: `if (flags & PacketFlag.NewSessionId) { _connectionState = Established; _lastReceivedPacketId = remotePacketId; _sendAck(remotePacketId); return; }`).
- Real ATEMs respond with a **20-byte** packet echoing a hello payload and carrying the *assigned* session id at bytes 2–3, with a non-zero packet id at bytes 10–11 (the client acks whatever id is there). A safe, capture-derived hello-response body (used by pyAtemSim / LibAtem replays) is:
  ```
  10 14 <sessId hi> <sessId lo> 00 00 00 00 00 00 00 03 00 00 00 00 02 00 00 00
  ```
  (20 bytes; flags byte `0x10`=NewSessionId, length `0x14`=20, sessionId @2-3, packetId `0x0003` @10-11, trailing payload `02 00 00 00` = "connection accepted" marker observed in captures.) Exact trailing bytes are not validated by the client; only the flag and length matter to `atem-connection`. **Match a real capture if you also want to satisfy stricter clients** (LibAtem checks the payload).
- After this, **the simulator owns the session id** for the rest of the connection and stamps it into byte 2–3 of every packet.

### 3.5 Acks and reliable delivery (what the simulator must implement)

From `atemSocketChild.js`:
- **Server→client reliable packets** (state dump, state updates) must set `AckRequest` and an incrementing **Packet Id @10**, starting at 1, wrapping at `MAX_PACKET_ID = 1<<15 = 32768` (15-bit, not 16). The client requires packet ids to arrive **strictly in sequence**: it only processes a packet whose `remotePacketId === (lastReceivedPacketId + 1) % MAX_PACKET_ID`. **Out-of-order/gap = the command payload is dropped** (client may re-ack but won't apply). So the simulator must send reliable packets in id order and not skip ids.
- The **client acks** the simulator by sending `AckReply` with `Acked Packet Id @4`. The client batches: it sends an ack after `MAX_PACKET_PER_ACK = 16` packets or after a 5 ms timer (`_sendOrQueueAck`). The simulator should track in-flight packets and **retransmit** any not acked within ~60 ms (`IN_FLIGHT_TIMEOUT`), setting the `IsRetransmit` flag, up to `MAX_PACKET_RETRIES = 10`.
- The client may send **`RetransmitRequest`** (flag `0x08`, "from" id @6) if it detects a gap; the simulator should resend from that id. (Note the client's own quirk: it sometimes asks for id `MAX_PACKET_ID` meaning 0 — mirror `fromId % MAX_PACKET_ID`.)
- **Client→server command packets** (e.g. `CPgI`, `CPvI`) arrive with `AckRequest` set and their own packet ids; the simulator **must ack them** (send `AckReply`, ackId = client's packet id) or the client will retransmit and eventually reset. A 12-byte ack is sufficient.
- **Keepalive:** the client resets the connection if it hears nothing for `CONNECTION_TIMEOUT = 5000 ms` (`startTimers`/`restartConnection`). The simulator must send *something* on the session at least every few seconds — easiest is to periodically send a reliable no-op (e.g. a `Time` command, or just re-send an idempotent state command) so `_lastReceivedAt` keeps updating, and to promptly ack client traffic.

### 3.6 The 12-byte ACK packet the simulator sends

Mirror `_sendAck`:
```
byte0-1: (AckReply<<11) | 12   == 0x800C
byte2-3: sessionId
byte4-5: ackedPacketId (the client packet id being acknowledged)
byte6-11: 0
```
No payload.

### 3.7 Per-command framing inside payloads (recap)

8-byte command header + payload, repeated:
```
u16BE length (= 8 + payloadLen)  @0
u16   0 (reserved/"checksum?")   @2
4 ASCII chars (opcode)           @4
payload                          @8
```
Use `PacketBuilder` (§2.2) to produce these payload buffers, then prepend the 12-byte transport header.

---

## 4. Minimum viable state dump

The client reaches `CONNECTED` on `InCm` alone, but for the tally bridge to read meaningful state, send the following (in this order, across one or more reliable packets, `InCm` **last**):

1. **`_ver`** (`u32BE` = `131102` for V8_1_1) — **must be first**; sets the parser version. Without it, later commands decode against the V7_2 default and `_top` may misparse.
2. **`_pin`** product identifier — 41 B: `<model name string, null-padded, 40 B>` + `u8 model`. Lets the client log a model and sets `state.info.power`. (Model byte: pick a small ATEM, e.g. `Model.TVS` / TelevisionStudio. Exact enum in `enums/index.js` → `Model`.)
3. **`_top` topology** — **required** so `state.info.capabilities` exists; otherwise `PrgI`/`PrvI`/`AuxS` `applyToState` throw `InvalidIdError` (caught, but program/preview never land in state). Decoder (`topologyCommand.js`) with `v230offset = (version > V8_0_1) ? 1 : 0` (so `=1` for V8_1_1). Byte layout the simulator must emit (≥ 23 bytes recommended so the `length>20` branch reads cleanly):
   - `u8 mixEffects @0` (e.g. `1`)
   - `u8 sources @1` (e.g. `10` — total input count incl. internals; must be ≥ the highest source id you reference)
   - `u8 downstreamKeyers @2`, `u8 auxilliaries @3`, `u8 mixMinusOutputs @4`, `u8 mediaPlayers @5`
   - `u8 multiviewers @6` (present because `v230offset=1`), `u8 serialPorts @(6+1=7)`, `u8 maxHyperdecks @8`, `u8 DVEs @9`, `u8 stingers @10`, `u8 superSources @11`
   - `u8 talkbackChannels @(12+1=13)`, `u8 cameraControl @(17+1=18)`
   - if `length>20`: `u8 advancedChromaKeyers @(21+1=22)`, `u8 onlyConfigurableOutputs @23`
   - **`mixEffects` and `sources` are the load-bearing fields** for the bridge. Set `mixEffects=1` (or 2) and `sources` ≥ your max input id.
4. **`InPr` input properties** — one per input you expose (1..N plus internals like Black=0, Bars=1000, Color1=2001, etc., as needed). Populates `state.inputs[id]` so name/port-type are available and so the library's `listVisibleInputs` tally helper (`lib/tally.js`) works. Encode (read-class layout from `InputPropertiesCommand.js`):
   - `u16BE inputId @0`
   - long name: null-terminated, 20 B @2
   - short name: null-terminated, 4 B @22
   - `u8 areNamesDefault @26`
   - `u16BE externalPorts @28` (bitmask), `u16BE externalPortType @30`
   - `u8 internalPortType @32`, `u8 sourceAvailability @34`, `u8 meAvailability @35`
   - (≥ 36 bytes payload)
   For a minimal sim, a handful of camera inputs (ids 1–4) with `externalPortType=SDI`, `internalPortType=0` (external) is enough.
5. **`PrgI`** per ME — `u8 me`, `u16BE source` → `state.video.mixEffects[me].programInput`.
6. **`PrvI`** per ME — same layout → `previewInput`.
7. **`TlSr`** tally-by-source — `u16BE count`, then `{u16BE source, u8 value}` per source (bit0=PGM, bit1=PVW). (Optional but recommended so any consumer reading raw tally has data; the library itself derives visible tally from state too.)
8. *(optional)* `AuxS`, `Time`, `_mvp` (multiviewer config), etc. — only if exercised.
9. **`InCm`** — zero payload. **Send last.** Flips client to `CONNECTED` → `emit('connected')`.

**Absolute bare minimum to merely connect without error:** a valid hello-response + one reliable packet containing **just `InCm`**, properly acked. **Practical minimum for the tally bridge:** `_ver`, `_top` (with `mixEffects`/`sources`), `PrgI`, `PrvI`, then `InCm` (add `InPr` + `TlSr` for realism).

**Runtime behavior after connect:** when the simulator receives `CPgI`/`CPvI` from the client, it should update its internal state and **send back the corresponding `PrgI`/`PrvI`** (and recomputed `TlSr`/`TlIn`) as a new reliable packet (next packet id) so the client's `state` updates and `stateChanged` fires. This closes the loop: bridge sets program → sim echoes `PrgI` → bridge sees tally change.

---

## 5. Recommended build approach

### 5.1 Ranked recommendation

1. **(Recommended) Reuse `atem-connection` codecs + hand-rolled UDP transport/handshake.**
   - Pros: zero wire-format risk for command bodies (same package the client uses); only the (small, well-understood) transport is custom; pure Node, runs headless in CI; full control over reactive behavior (echo `PrgI`/`PrvI`, compute tally). The transport state machine is ~200 lines and fully specified by `atemSocketChild.js` (§3).
   - Cons: must implement ack/retransmit/keepalive/sequence correctly (the riskiest part). For program/preview/tally you encode `PrgI`/`PrvI`/`TlSr` manually (read-classes lack `serialize`) — trivial 4-B / variable layouts.
   - Effort: ~1–2 days.

2. **(Fallback / bootstrap) Port `pyAtemSim` to Node, or run it as-is alongside.** Use `pyAtemSim` (MIT) directly to validate that `atem-connection` connects at all, and to capture a real handshake + state dump byte stream as golden fixtures. Then either port its logic or run it as the test double if a Python dependency in the test harness is acceptable. Good de-risking step before/with option 1.

3. **(Not recommended) Fork an existing emulator.** Dev1an/Atem-Simulator (Swift GUI) and LibAtem/AtemUtils (C#, replay-only) don't fit a Node test harness and aren't reactive. Replay tools won't respond to `CPgI`/`CPvI`, so they can't test a bridge's round-trip tally.

### 5.2 Component breakdown

- **UDP server** — `dgram.createSocket('udp4')`, bind `0.0.0.0:9910`. One socket; demux clients by `rinfo.address:port` + session id (support ≥1 client; multi-client optional).
- **Session / handshake state machine** (per client) — states `Closed → HelloReceived → Established`. On 20-byte NewSessionId hello: assign session id, send hello-response (NewSessionId, 20 B), then begin state dump. Mirror constants from `atemSocketChild.js`: `MAX_PACKET_ID=32768`, ack-after-16-or-5ms, retransmit @60 ms ×10, 5 s keepalive.
- **Reliable-send layer** — outgoing packet-id counter (start 1, wrap 32768), in-flight queue with timers, retransmit on timeout or `RetransmitRequest`, set `AckRequest`/`IsRetransmit` flags, stamp session id + packet id. Handle inbound `AckReply` (clear in-flight) and inbound `AckRequest` (send `AckReply`).
- **State model** — `{ version, model, topology{mixEffects, sources}, inputs[], mixEffects[{programInput, previewInput}], tally }`. Seedable from a small config (input list, initial PGM/PVW).
- **State serializer / dump builder** — uses `PacketBuilder` for command framing; emits the §4 ordered dump ending in `InCm`. Manual encoders for `PrgI`, `PrvI`, `TlSr`, `_ver`, `_pin`, `_top`, `InPr`, `InCm` (codecs/layouts in §2.3 / §4).
- **Command dispatch (inbound)** — parse the client's payload with the same 8-byte framing (`u16 len @0`, `name @4`, payload @8). On `CPgI` → set `mixEffects[me].programInput`; on `CPvI` → set previewInput. Ignore everything else. After a mutation, push a reliable packet with the updated `PrgI`/`PrvI` and recomputed `TlSr` (+ optional `TlIn`).
- **Tally derivation** — minimal: PGM tally = the input currently in `programInput` (per ME); PVW = `previewInput`. For higher fidelity, reuse `lib/tally.js` `listVisibleInputs(mode, state, me)` (handles keyers/transitions/supersource) by constructing a compatible state object — optional. Encode result into `TlSr` (per-source bitfield) / `TlIn` (per-index).
- **Console visualization** — log connection lifecycle, inbound `CPgI`/`CPvI`, and a PGM/PVW/tally table to stdout.
- **Simple web tally page** — tiny HTTP + WebSocket (or SSE) server pushing `{program, preview, tally[]}` to a browser that renders red/green per input. Reads the same in-memory state model.

### 5.3 Riskiest unknowns / gotchas

- **Packet length must equal datagram size.** Client drops any packet where `(u16@0 & 0x07FF) !== udpSize`. Off-by-one here = silent failure.
- **Strict in-order packet ids.** Client only applies a packet whose id is exactly `last+1`. Skipping/duplicating ids (or wrapping at 65536 instead of 32768) breaks the state dump silently. Wrap at **32768**.
- **Hello-response must set NewSessionId (0x02)** and be the assigned session id. Forgetting the flag = client stays in `SynSent` and times out after 5 s. Some stricter clients (LibAtem) also validate the 20-byte hello-response payload — match a real capture (from `pyAtemSim`/AtemUtils) if cross-client compatibility matters; `atem-connection` itself does not validate the body.
- **`_ver` ordering + topology version coupling.** Send `_ver` first; ensure the `_top` byte layout matches the advertised version's `v230offset`.
- **Acking inbound client packets + keepalive.** Miss either and the client resets every ~5 s (looks like flapping "connected/disconnected").
- **`PrgI`/`PrvI`/`TlSr` have no `serialize` in the package** (they're decode-only) — must hand-encode (layouts in §2.3). Validate against the package's own `deserialize` (round-trip) and/or fixtures from `atem-connection-test-generator`.
- **Retransmit semantics quirk** — client may request retransmit "from id 32768" meaning 0; apply `fromId % 32768`.

### 5.4 Validation plan

- Encode each `PrgI`/`PrvI`/`TlSr`/`_top`/`InPr` buffer, then feed it through the package's matching `static deserialize(buf, version)` in a unit test and assert the decoded fields — guarantees the simulator's hand-rolled encoders are wire-correct.
- End-to-end: spin up the simulator, point a real `new Atem(); atem.connect('127.0.0.1')` at it, assert `'connected'` fires, then `atem.changeProgramInput(2)` and assert the simulator receives `CPgI` and that `atem.state.video.mixEffects[0].programInput === 2` after the echoed `PrgI`.
- Cross-check the handshake/state-dump byte stream against a `pyAtemSim` capture or LibAtem/AtemUtils replay as golden reference.

---

## Appendix — key source file map (in `node_modules/atem-connection/dist/`)

- Transport/handshake (client; the peer spec): `lib/atemSocketChild.js` — `COMMAND_CONNECT_HELLO`, `PacketFlag`, `ConnectionState`, `_receivePacket`, `_sendAck`, `_retransmitFrom`, all timing constants.
- Parent socket + command framing loop: `lib/atemSocket.js` — `_parseCommands` (8-byte command header, offsets 0/4/8).
- Packet/command builder (reusable): `lib/packetBuilder.js` — `PacketBuilder.addCommand` (writes `len@0`, `name@4`, payload@8).
- Command parser/registry: `lib/atemCommandParser.js` — `CommandParser`, `commandFromRawName`, version handling.
- Connect→CONNECTED logic: `atem.js` — `_mutateState` (finds `InitCompleteCommand` → `_status=CONNECTED`), `_onInitComplete` (`emit('connected')`), `AtemConnectionStatus`.
- Tally derivation helper (reusable): `lib/tally.js` — `listVisibleInputs(mode, state, me)`.
- Command codecs:
  - `commands/MixEffects/ProgramInputCommand.js` (`CPgI`/`PrgI`)
  - `commands/MixEffects/PreviewInputCommand.js` (`CPvI`/`PrvI`)
  - `commands/TallyBySourceCommand.js` (`TlSr`)
  - `commands/InitCompleteCommand.js` (`InCm`)
  - `commands/DeviceProfile/topologyCommand.js` (`_top`)
  - `commands/DeviceProfile/versionCommand.js` (`_ver`)
  - `commands/DeviceProfile/productIdentifierCommand.js` (`_pin`)
  - `commands/Inputs/InputPropertiesCommand.js` (`CInL`/`InPr`)
  - `commands/AuxSourceCommand.js` (`CAuS`/`AuxS`), `commands/TimeCommand.js` (`Time`)
- Enums: `enums/index.js` — `ProtocolVersion`, `Model`, `InternalPortType`, `ExternalPortType`, etc.

## Appendix — sources

- atem-connection (client we must satisfy): https://github.com/Sofie-Automation/sofie-atem-connection
- pyAtemSim (Python ATEM simulator, MIT — best reference): https://github.com/jonknoll/pyAtemSim
- LibAtem / AtemUtils (C# fake-ATEM replay): https://github.com/LibAtem/AtemUtils
- LibAtem/AtemProxy: https://github.com/LibAtem/AtemProxy
- LibAtem (.NET client): https://github.com/LibAtem/LibAtem
- atem-connection-test-generator (golden fixtures): https://github.com/LibAtem/atem-connection-test-generator
- Dev1an/Atem-Simulator (Swift GUI): https://github.com/Dev1an/Atem-Simulator
- OpenSwitcher docs: https://docs.openswitcher.org/  ·  https://openswitcher.org/
- julusian protocol docs (header/flags): https://atem.julusian.dev/protocol
- node-atem specification: https://github.com/miyukki/node-atem/blob/master/specification.md
- Skaarhoj ATEM (original RE): https://github.com/kasperskaarhoj/SKAARHOJ-Open-Engineering/blob/master/ArduinoLibs/ATEM/ATEM.cpp
- Blackmagic forum, "ATEM ethernet protocol": https://forum.blackmagicdesign.com/viewtopic.php?f=12&t=140253
