// Encoders for the state commands the simulator sends to the client, and decoders
// for the control commands the client sends to the simulator.
//
// The simulator→client state commands (PrgI, PrvI, TlSr, _ver, _pin, _top, InPr)
// correspond to read-only classes in atem-connection (they have `deserialize` but
// no `serialize`), so we hand-encode them here. The byte layouts mirror those
// classes exactly; the e2e test round-trips them through the library's own
// `deserialize` to guarantee wire-correctness.

import { buildCommand } from './protocol.js';

// atem-connection ProtocolVersion.V8_1_1 — widely supported by the topology decoder.
export const PROTOCOL_VERSION = 131102;

// Tally bitfield values.
export const TALLY_PROGRAM = 0x01;
export const TALLY_PREVIEW = 0x02;

/** `_ver` — protocol version. Must be sent first; the client parses it to pick a decoder version. */
export function encodeVersion(version = PROTOCOL_VERSION) {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(version >>> 0, 0);
  return buildCommand('_ver', payload);
}

/** `_pin` — product identifier: 40-byte null-padded model name + u8 model id. */
export function encodeProductId(name = 'ATEM Simulator', model = 1) {
  const payload = Buffer.alloc(41);
  payload.write(name.slice(0, 40), 0, 'ascii');
  payload.writeUInt8(model & 0xff, 40);
  return buildCommand('_pin', payload);
}

/**
 * `_top` — device topology. Only `mixEffects` and `sources` are load-bearing for a
 * tally bridge; the rest is zero-filled. 24 bytes so the version>V8_0_1 decoder
 * branch (which reads up to offset 23) parses cleanly.
 */
export function encodeTopology({ mixEffects = 1, sources = 20 } = {}) {
  const payload = Buffer.alloc(24);
  payload.writeUInt8(mixEffects & 0xff, 0);
  payload.writeUInt8(sources & 0xff, 1);
  payload.writeUInt8(1, 2); // downstreamKeyers
  payload.writeUInt8(1, 3); // auxilliaries
  payload.writeUInt8(1, 5); // mediaPlayers
  payload.writeUInt8(1, 6); // multiviewers (present because version > V8_0_1)
  return buildCommand('_top', payload);
}

/**
 * `InPr` — input properties for one source. Gives the client a name/port-type so the
 * input list and tally helpers look realistic.
 */
export function encodeInputProperties({ id, longName, shortName, externalPortType = 0x0001 }) {
  const payload = Buffer.alloc(38);
  payload.writeUInt16BE(id & 0xffff, 0);
  payload.write((longName ?? `Camera ${id}`).slice(0, 19), 2, 'ascii');
  payload.write((shortName ?? `Cam${id}`).slice(0, 3), 22, 'ascii');
  payload.writeUInt8(0, 26); // areNamesDefault = false (custom names)
  payload.writeUInt16BE(0x0001, 28); // externalPorts bitmask
  payload.writeUInt16BE(externalPortType & 0xffff, 30); // 0x0001 = SDI
  payload.writeUInt8(0, 32); // internalPortType = external
  payload.writeUInt8(0x1f, 34); // sourceAvailability (all outputs)
  payload.writeUInt8(0x01, 35); // meAvailability (ME1)
  return buildCommand('InPr', payload);
}

/** `PrgI` — program input state for a mix-effect. */
export function encodeProgramInput(me, source) {
  const payload = Buffer.alloc(4);
  payload.writeUInt8(me & 0xff, 0);
  payload.writeUInt16BE(source & 0xffff, 2);
  return buildCommand('PrgI', payload);
}

/** `PrvI` — preview input state for a mix-effect. */
export function encodePreviewInput(me, source) {
  const payload = Buffer.alloc(4);
  payload.writeUInt8(me & 0xff, 0);
  payload.writeUInt16BE(source & 0xffff, 2);
  return buildCommand('PrvI', payload);
}

/**
 * `TlSr` — tally by source. `entries` is [{ source, value }] where value is a
 * bitfield (bit0 = program/red, bit1 = preview/green).
 */
export function encodeTallyBySource(entries) {
  const payload = Buffer.alloc(2 + entries.length * 3);
  payload.writeUInt16BE(entries.length, 0);
  entries.forEach((e, i) => {
    payload.writeUInt16BE(e.source & 0xffff, 2 + i * 3);
    payload.writeUInt8(e.value & 0xff, 4 + i * 3);
  });
  return buildCommand('TlSr', payload);
}

/** `InCm` — init complete. Zero payload. Flips the client to CONNECTED; send last. */
export function encodeInitComplete() {
  return buildCommand('InCm');
}

/** `Time` — timecode, used as a harmless keepalive. */
export function encodeTime(h, m, s, f) {
  const payload = Buffer.alloc(8);
  payload.writeUInt8(h & 0xff, 0);
  payload.writeUInt8(m & 0xff, 1);
  payload.writeUInt8(s & 0xff, 2);
  payload.writeUInt8(f & 0xff, 3);
  return buildCommand('Time', payload);
}

/** Decode the client's `CPgI`/`CPvI` (change program/preview input): u8 me @0, u16BE source @2. */
export function decodeChangeInput(payload) {
  return {
    me: payload.readUInt8(0),
    source: payload.readUInt16BE(2),
  };
}
