// Low-level ATEM UDP wire protocol: the 12-byte transport header, packet flags,
// and the 8-byte command framing used inside payloads.
//
// All multi-byte fields are big-endian. Byte 0-1 packs the flags (top 5 bits)
// and the total packet length (low 11 bits). Reference: the client side of this
// exact protocol lives in atem-connection's lib/atemSocketChild.js — this module
// is the switcher (server) peer of that code.

export const ATEM_PORT = 9910;

// Packet ids are a 15-bit sequence (wrap at 32768), NOT 16-bit.
export const MAX_PACKET_ID = 32768;

// Flags occupy the top 5 bits of the u16 at offset 0 (value = flag << 11).
export const FLAG = {
  AckRequest: 0x01, // sender wants this reliable packet acked; sets packetId @10
  NewSessionId: 0x02, // hello / "connect accepted" — flips the client to Established
  IsRetransmit: 0x04, // this packet is a retransmission
  RetransmitRequest: 0x08, // sender requests a retransmit from id @6
  AckReply: 0x10, // this packet acknowledges id @4
};

const HEADER_LEN = 12;

/**
 * Build a 12-byte transport header.
 * @param {object} f
 * @param {number} f.flags    OR-ed FLAG values
 * @param {number} f.length   total datagram length incl. this 12-byte header
 * @param {number} f.sessionId
 * @param {number} [f.ackId]
 * @param {number} [f.retransmitId]
 * @param {number} [f.packetId]
 */
export function encodeHeader({ flags, length, sessionId, ackId = 0, retransmitId = 0, packetId = 0 }) {
  const buf = Buffer.alloc(HEADER_LEN);
  buf.writeUInt16BE(((flags << 11) | (length & 0x07ff)) & 0xffff, 0);
  buf.writeUInt16BE(sessionId & 0xffff, 2);
  buf.writeUInt16BE(ackId & 0xffff, 4);
  buf.writeUInt16BE(retransmitId & 0xffff, 6);
  buf.writeUInt16BE(0, 8);
  buf.writeUInt16BE(packetId & 0xffff, 10);
  return buf;
}

export function decodeHeader(buf) {
  return {
    flags: buf.readUInt8(0) >> 3,
    length: buf.readUInt16BE(0) & 0x07ff,
    sessionId: buf.readUInt16BE(2),
    ackId: buf.readUInt16BE(4),
    retransmitId: buf.readUInt16BE(6),
    packetId: buf.readUInt16BE(10),
  };
}

/**
 * Assemble a full datagram: 12-byte header + payload, with the length field set
 * to the exact byte count (the client drops any packet whose declared length
 * != the on-wire datagram size).
 */
export function buildPacket(headerFields, payload = Buffer.alloc(0)) {
  const length = HEADER_LEN + payload.length;
  const header = encodeHeader({ ...headerFields, length });
  return Buffer.concat([header, payload]);
}

/**
 * Frame a single command: 8-byte command header + payload.
 *   u16BE length (= 8 + payload.length) @0
 *   u16   0 (reserved)                  @2
 *   4 ASCII chars (opcode)              @4
 *   payload                             @8
 */
export function buildCommand(name, payload = Buffer.alloc(0)) {
  if (name.length !== 4) throw new Error(`command name must be 4 chars, got "${name}"`);
  const header = Buffer.alloc(8);
  header.writeUInt16BE(payload.length + 8, 0);
  header.write(name, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

/**
 * Parse concatenated commands out of a packet payload.
 * Returns [{ name, payload }] and silently stops on malformed framing.
 */
export function parseCommands(payload) {
  const out = [];
  let buf = payload;
  while (buf.length >= 8) {
    const length = buf.readUInt16BE(0);
    if (length < 8 || length > buf.length) break;
    const name = buf.toString('ascii', 4, 8);
    out.push({ name, payload: buf.subarray(8, length) });
    buf = buf.subarray(length);
  }
  return out;
}

/** Forward distance from a to b within the 15-bit sequence space. */
export function seqDistance(a, b) {
  return (b - a) & 0x7fff;
}

/** True if `id` is at or behind `ackId` (cumulative-ack window). */
export function isAtOrBehind(id, ackId) {
  return seqDistance(id, ackId) < MAX_PACKET_ID / 2;
}
