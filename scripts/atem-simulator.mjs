#!/usr/bin/env node
/**
 * Minimal ATEM BMD UDP protocol simulator for local dev/testing.
 *
 * Implements enough of the BMD ATEM protocol for atem-connection 3.9.0 to
 * connect, hydrate ('connected' event), and receive bus-change commands.
 *
 * Protocol traced from node_modules/atem-connection/dist/lib/atemSocketChild.js
 *
 * Flow:
 *   1. Client → Server: HELLO (flags=NewSessionId, 20 bytes)
 *   2. Server → Client: NewSessionId response (12 bytes, assigns session ID)
 *   3. Server → Client: _ver + InCm commands → triggers atem.emit('connected')
 *   4. Client ↔ Server: ACK exchange for each command packet
 *   5. Client → Server: CPgI/CPvI commands when AtemConnector calls applyState()
 *   6. Server → Client: keepalive every 2 s (prevents 5 s reconnect timeout)
 *
 * Usage:
 *   node scripts/atem-simulator.mjs
 */

import { createSocket } from 'node:dgram';

// ---------------------------------------------------------------------------
// PacketFlag constants — must match atem-connection PacketFlag enum
// ---------------------------------------------------------------------------

const PF = {
  AckRequest: 1,    // Server ← client commands; triggers ACK from receiver
  NewSessionId: 2,  // Connection handshake (HELLO / HELLO-ACK)
  IsRetransmit: 4,
  RetransmitRequest: 8,
  AckReply: 16,     // ACK for a received AckRequest packet
};

const MAX_PACKET_ID = 1 << 15;  // 15-bit wrap
const UDP_PORT = 9910;

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

const socket = createSocket('udp4');

let clientInfo = null;  // { address: string, port: number }
const SESSION_ID = 0x1000;  // arbitrary session ID we assign to the client
let serverPacketId = 0;     // our outgoing packet counter
let lastClientPacketId = 0; // last remotePktId we received from client (for ACKs)

// ---------------------------------------------------------------------------
// Packet encoding helpers
// ---------------------------------------------------------------------------

/**
 * Decode the 12-byte ATEM packet header.
 * Byte layout (from atemSocketChild.js _receivePacket):
 *   [0-1]: (flags << 11) | length  → flags = byte[0]>>3, length = word & 0x07ff
 *   [2-3]: session ID
 *   [4-5]: ackPacketId (receiver's last-seen packet for AckReply)
 *   [6-9]: unused
 *   [10-11]: remotePacketId (sender's outgoing sequence number)
 *   [12+]: command payload
 */
function decodeHeader(buf) {
  return {
    flags: buf.readUInt8(0) >> 3,
    length: buf.readUInt16BE(0) & 0x07ff,
    sessionId: buf.readUInt16BE(2),
    ackPacketId: buf.readUInt16BE(4),
    remotePacketId: buf.readUInt16BE(10),
    payload: buf.slice(12),
  };
}

/**
 * Build an ATEM UDP packet.
 * flags: one or more PF.* values OR'd together.
 */
function buildPacket(flags, ackId, packetId, payload) {
  const totalLen = 12 + (payload ? payload.length : 0);
  const buf = Buffer.alloc(totalLen, 0);
  buf.writeUInt16BE((flags << 11) | totalLen, 0);
  buf.writeUInt16BE(SESSION_ID, 2);
  buf.writeUInt16BE(ackId, 4);
  buf.writeUInt16BE(packetId, 10);
  if (payload) payload.copy(buf, 12);
  return buf;
}

/**
 * Build a single ATEM command block (8-byte header + data).
 * Each command inside a packet payload:
 *   [0-1]: command length (header + data)
 *   [2-3]: 0x00 0x00
 *   [4-7]: 4-char ASCII name
 *   [8+]:  data bytes
 */
function buildCommand(name, data) {
  const dataLen = data ? data.length : 0;
  const buf = Buffer.alloc(8 + dataLen, 0);
  buf.writeUInt16BE(8 + dataLen, 0);
  Buffer.from(name, 'ascii').copy(buf, 4);
  if (data) data.copy(buf, 8);
  return buf;
}

// ---------------------------------------------------------------------------
// Sending helpers
// ---------------------------------------------------------------------------

function sendRaw(pkt) {
  if (!clientInfo) return;
  socket.send(pkt, 0, pkt.length, clientInfo.port, clientInfo.address);
}

function sendNewSessionId() {
  // Response to HELLO: sets ConnectionState.Established on the client.
  // remotePacketId=0 because this is the "first" packet from server perspective.
  const pkt = buildPacket(PF.NewSessionId, 0, 0, null);
  sendRaw(pkt);
  console.log(`[ATEM] → NewSessionId response (session 0x${SESSION_ID.toString(16)})`);
}

function sendAck(packetId) {
  const pkt = buildPacket(PF.AckReply, packetId, 0, null);
  sendRaw(pkt);
}

function sendCommandPacket(commands) {
  const payload = Buffer.concat(commands);
  serverPacketId = (serverPacketId + 1) % MAX_PACKET_ID;
  const pkt = buildPacket(PF.AckRequest, lastClientPacketId, serverPacketId, payload);
  sendRaw(pkt);
  console.log(`[ATEM] → Commands pktId=${serverPacketId} payload=${payload.toString('hex')}`);
}

// ---------------------------------------------------------------------------
// Initial state dump — sends _ver + InCm to trigger atem.emit('connected')
//
// _ver (VersionCommand): sets commandParser.version in atem-connection.
//   Format: 4 bytes — [major_hi, major_lo, minor_hi, minor_lo]
//   Version 2.30 = 0x0218
//
// InCm (InitCompleteCommand): zero-data, rawName='InCm'.
//   atem.js line 175-178: finds InitCompleteCommand → calls _onInitComplete()
//   → emits 'connected' → AtemConnector.handleConnected() → isHydrated=true
// ---------------------------------------------------------------------------

function sendInitialStateDump() {
  const verData = Buffer.alloc(4, 0);
  verData.writeUInt16BE(0x0218, 0);  // protocol version 2.30
  const verCmd = buildCommand('_ver', verData);  // 12 bytes

  // InCm (InitCompleteCommand) is exactly 8 bytes — but atem-connection's
  // _parseCommands has `while (buffer.length > 8)` which skips the last
  // command when it is exactly 8 bytes. Pad InCm to 9 bytes; the deserializer
  // (InitCompleteCommand.deserialize) ignores its input so the extra zero is harmless.
  const inCmCmd = buildCommand('InCm', Buffer.alloc(1, 0));  // 9 bytes

  sendCommandPacket([verCmd, inCmCmd]);
  console.log('[ATEM] → _ver + InCm sent — atem-connection will emit "connected"');
}

// ---------------------------------------------------------------------------
// Command parsing — log what the server receives from our AtemConnector
//
// CPgI (ProgramInputCommand.rawName): changeProgramInput
//   4 bytes: [mixEffect(1), 0x00, source_hi, source_lo]
//
// CPvI (PreviewInputCommand.rawName): changePreviewInput
//   4 bytes: same layout
// ---------------------------------------------------------------------------

function parseAndLogCommands(payload) {
  let buf = payload;
  while (buf.length >= 8) {
    const len = buf.readUInt16BE(0);
    if (len < 8 || len > buf.length) break;
    const name = buf.toString('ascii', 4, 8);
    const data = buf.slice(8, len);
    if (name === 'CPgI') {
      const me = data.readUInt8(0);
      const src = data.readUInt16BE(2);
      console.log(`[ATEM] ← PROGRAM INPUT  ME=${me}  source=${src}`);
    } else if (name === 'CPvI') {
      const me = data.readUInt8(0);
      const src = data.readUInt16BE(2);
      console.log(`[ATEM] ← PREVIEW INPUT  ME=${me}  source=${src}`);
    } else {
      console.log(`[ATEM] ← command: ${name} (${data.length}b data)`);
    }
    buf = buf.slice(len);
  }
}

// ---------------------------------------------------------------------------
// Packet handler
// ---------------------------------------------------------------------------

socket.on('message', (buf, rinfo) => {
  if (buf.length < 12) return;  // too short to be valid

  const { flags, length, remotePacketId, payload } = decodeHeader(buf);

  // HELLO: client initiating a new session (NewSessionId flag, 20-byte packet)
  if (flags & PF.NewSessionId) {
    clientInfo = { address: rinfo.address, port: rinfo.port };
    serverPacketId = 0;
    lastClientPacketId = 0;
    console.log(`[ATEM] HELLO from ${rinfo.address}:${rinfo.port}`);

    // Step 1: Accept the session
    sendNewSessionId();

    // Step 2: Send initial state (after brief delay so client finishes processing step 1)
    setTimeout(sendInitialStateDump, 50);
    return;
  }

  // Ignore packets before handshake
  if (!clientInfo) return;

  // AckRequest: client sent us commands (bus changes etc.)
  if (flags & PF.AckRequest) {
    lastClientPacketId = remotePacketId;
    if (payload.length >= 8) {
      parseAndLogCommands(payload);
    }
    // Always ACK to clear in-flight queue and prevent client retransmit
    sendAck(remotePacketId);
  }

  // AckReply: client ACK'd our packet — nothing to do for the simulator
  if (flags & PF.AckReply) {
    // client acknowledged one of our packets — no action needed
  }
});

socket.on('error', (err) => {
  console.error(`[ATEM] Socket error: ${err.message}`);
});

// ---------------------------------------------------------------------------
// Keepalive: send AckReply every 2 s.
// atemSocketChild.js CONNECTION_TIMEOUT = 5000 ms — if nothing arrives for
// 5 s the client calls restartConnection(). Keepalive prevents that.
// ---------------------------------------------------------------------------

setInterval(() => {
  if (!clientInfo) return;
  // AckReply with our latest knowledge of client's last packet ID
  sendAck(lastClientPacketId);
}, 2000);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

socket.bind(UDP_PORT, '0.0.0.0', () => {
  console.log(`[ATEM] Simulator listening on UDP port ${UDP_PORT}`);
});

console.log('ATEM Simulator running. Waiting for atem-connection client...\n');
