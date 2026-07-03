#!/usr/bin/env node
/**
 * Full ATEM BMD UDP protocol simulator.
 *
 * Compatible with both atem-connection 3.9 (tally bridge) and
 * ATEM Software Control (Blackmagic's desktop application).
 *
 * Initialization sequence sent to each new client:
 *   _ver, _pin, _top, InPr × 10, PrgI, PrvI, TlSr, InCm
 *
 * Supports multiple simultaneous clients. When any client sends CPgI/CPvI,
 * state updates and PrgI + PrvI + TlSr broadcast to all connected clients.
 *
 * Simulates: "ATEM Television Studio HD" — 1 ME, 8 external inputs, Black, ColorBars.
 *
 * Usage:
 *   node scripts/atem-simulator.mjs
 */

import { createSocket } from 'node:dgram';

// ---------------------------------------------------------------------------
// Packet flag constants (PacketFlag enum from atemSocketChild.js)
// ---------------------------------------------------------------------------
const PF = {
  AckRequest:      1,   // sender requires ACK from receiver
  NewSessionId:    2,   // handshake HELLO / HELLO-ACK
  IsRetransmit:    4,
  RetransmitRequest: 8,
  AckReply:        16,  // pure ACK packet
};

const MAX_PACKET_ID = 1 << 15;
const UDP_PORT = 9910;

// ---------------------------------------------------------------------------
// Protocol version: V8_0 = 131100 = 0x0002001C
//
// Must be <= V8_0_1 (131101) so topology command uses the simpler layout
// without the extra multiviewers byte at offset 6.
//
// VersionCommand reads readUInt32BE(0), not readUInt16BE — previous simulator
// had a bug writing writeUInt16BE(0x0218, 0) which left bytes 2-3 as 0x0000,
// creating version 0x02180000 >> V8_0_1, triggering the multiviewers offset.
// ---------------------------------------------------------------------------
const PROTOCOL_VERSION = 131100;   // V8_0 = 0x0002001C

// ---------------------------------------------------------------------------
// Switcher state — single ME, program/preview bus
// ---------------------------------------------------------------------------
const state = {
  program: { 0: 1 },   // ME0 program = source 1
  preview: { 0: 2 },   // ME0 preview = source 2
};

// ---------------------------------------------------------------------------
// Input table: [inputId, longName(≤20), shortName(≤4), internalPortType, isExternal, sourceAvailability, meAvailability]
//
// InternalPortType enum values (from atem-connection dist/enums):
//   0 = External, 1 = Black, 2 = ColorBars, 3 = ColorGenerator
//   4 = MediaPlayerFill, 128 = MEOutput, 129 = Auxiliary
//
// sourceAvailability bitmask: 1=Aux, 2=Multiview, 4=SSSArt, 8=SSBox, 16=KeySource → 31=all standard
// meAvailability bitmask:     1=Me1, 2=Me2, …
// ---------------------------------------------------------------------------
const INPUTS = [
  [0,    'Black',      'Blk',  1, false, 31, 1],
  [1,    'Input 1',    'In1',  0, true,  31, 1],
  [2,    'Input 2',    'In2',  0, true,  31, 1],
  [3,    'Input 3',    'In3',  0, true,  31, 1],
  [4,    'Input 4',    'In4',  0, true,  31, 1],
  [5,    'Input 5',    'In5',  0, true,  31, 1],
  [6,    'Input 6',    'In6',  0, true,  31, 1],
  [7,    'Input 7',    'In7',  0, true,  31, 1],
  [8,    'Input 8',    'In8',  0, true,  31, 1],
  [1000, 'Color Bars', 'Bars', 2, false, 3,  0],
];

// ---------------------------------------------------------------------------
// Multi-client session tracking
// ---------------------------------------------------------------------------
const sessions = new Map();   // key: `${addr}:${port}` → Session object
let nextSessionId = 0x1000;

function sessionKey(addr, port) { return `${addr}:${port}`; }

function createSession(addr, port) {
  const session = {
    address: addr,
    port,
    sessionId: nextSessionId++ & 0xffff,
    serverPacketId: 0,
    lastClientPacketId: 0,
    lastSeen: Date.now(),
    initialized: false,  // set true after init dump sent; prevents broadcast during handshake
  };
  sessions.set(sessionKey(addr, port), session);
  return session;
}

const socket = createSocket('udp4');

// ---------------------------------------------------------------------------
// Low-level send helpers
// ---------------------------------------------------------------------------

/**
 * Send a pure ACK packet (AckReply, no payload, outgoing packetId=0).
 * ackingPacketId = the remote's packet we are acknowledging (goes to bytes 4-5).
 */
function sendAck(session, ackingPacketId) {
  const buf = Buffer.alloc(12, 0);
  buf.writeUInt16BE((PF.AckReply << 11) | 12, 0);
  buf.writeUInt16BE(session.sessionId, 2);
  buf.writeUInt16BE(ackingPacketId, 4);
  // bytes 10-11 stay 0 (no outgoing sequence for ACK-only)
  socket.send(buf, 0, 12, session.port, session.address);
}

/**
 * Send a NewSessionId handshake response.
 * Assigns our session ID to the client; no payload, no outgoing packetId.
 */
function sendNewSessionId(session) {
  const buf = Buffer.alloc(12, 0);
  buf.writeUInt16BE((PF.NewSessionId << 11) | 12, 0);
  buf.writeUInt16BE(session.sessionId, 2);
  socket.send(buf, 0, 12, session.port, session.address);
}

/**
 * Send a data packet containing one or more command blocks.
 * Increments the session's outgoing packet counter.
 */
function sendCommandsTo(session, commands) {
  const payload = Buffer.concat(commands);
  session.serverPacketId = (session.serverPacketId + 1) % MAX_PACKET_ID;
  const totalLen = 12 + payload.length;
  const buf = Buffer.alloc(totalLen, 0);
  buf.writeUInt16BE((PF.AckRequest << 11) | totalLen, 0);
  buf.writeUInt16BE(session.sessionId, 2);
  buf.writeUInt16BE(session.lastClientPacketId, 4);   // ACK client's last packet in same packet
  buf.writeUInt16BE(session.serverPacketId, 10);
  payload.copy(buf, 12);
  socket.send(buf, 0, buf.length, session.port, session.address);
}

/** Broadcast a list of command blocks to all fully-initialized sessions. */
function broadcastCommands(commands) {
  for (const session of sessions.values()) {
    if (session.initialized) sendCommandsTo(session, commands);
  }
}

// ---------------------------------------------------------------------------
// Command block builder
// Each ATEM command: [cmdLen(2), 0x00, 0x00, name(4), data(n)]
// Total = 8 + dataLen bytes.
// ---------------------------------------------------------------------------
function buildCmd(name, data) {
  const dataLen = data ? data.length : 0;
  const buf = Buffer.alloc(8 + dataLen, 0);
  buf.writeUInt16BE(8 + dataLen, 0);
  Buffer.from(name, 'ascii').copy(buf, 4);
  if (data) data.copy(buf, 8);
  return buf;
}

// ---------------------------------------------------------------------------
// State command builders
// ---------------------------------------------------------------------------

function cmdVer() {
  const d = Buffer.alloc(4);
  d.writeUInt32BE(PROTOCOL_VERSION, 0);
  return buildCmd('_ver', d);
}

function cmdPin() {
  // 41 bytes: 40-char null-terminated product name + 1-byte model enum
  // Model.TVSHD = 8 ("ATEM Television Studio HD")
  const d = Buffer.alloc(41, 0);
  Buffer.from('ATEM Television Studio HD', 'ascii').copy(d, 0);
  d.writeUInt8(8, 40);
  return buildCmd('_pin', d);
}

function cmdTop() {
  // TopologyCommand layout with v230offset=0 (PROTOCOL_VERSION <= V8_0_1):
  //   0: mixEffects       1: sources       2: downstreamKeyers  3: auxilliaries
  //   4: mixMinusOutputs  5: mediaPlayers
  //   6: serialPorts      7: maxHyperdecks 8: DVEs              9: stingers
  //  10: superSources    [11: gap]         12: talkbackChannels
  //  ...
  //  17: cameraControl   ...
  //  21: advancedChromaKeyers   22: onlyConfigurableOutputs
  const d = Buffer.alloc(23, 0);
  d.writeUInt8(1, 0);   // mixEffects = 1
  d.writeUInt8(10, 1);  // sources (informational — InPr defines actual inputs)
  d.writeUInt8(1, 2);   // downstreamKeyers = 1
  d.writeUInt8(1, 3);   // auxilliaries = 1
  d.writeUInt8(1, 5);   // mediaPlayers = 1
  d.writeUInt8(1, 17);  // cameraControl = 1
  return buildCmd('_top', d);
}

function cmdInPr(inputId, longName, shortName, internalPortType, isExternal, sourceAvail, meAvail) {
  // InputPropertiesUpdateCommand (rawName 'InPr') layout — 36 bytes:
  //   0-1:  inputId (uint16BE)
  //   2-21: longName (null-terminated UTF-8, 20 bytes)
  //  22-25: shortName (null-terminated UTF-8, 4 bytes)
  //    26:  areNamesDefault (uint8)
  //    27:  padding
  // 28-29: externalPorts bitmask (uint16BE)
  // 30-31: externalPortType (uint16BE)  1=SDI
  //    32:  internalPortType (uint8)
  //    33:  padding
  //    34:  sourceAvailability (uint8)
  //    35:  meAvailability (uint8)
  const d = Buffer.alloc(36, 0);
  d.writeUInt16BE(inputId, 0);
  Buffer.from(longName, 'utf8').copy(d, 2, 0, 19);   // max 19 chars + null
  Buffer.from(shortName, 'utf8').copy(d, 22, 0, 3);  // max 3 chars + null
  d.writeUInt8(1, 26);                               // areNamesDefault = true
  if (isExternal) {
    d.writeUInt16BE(0x0001, 28);  // externalPorts bitmask (has one external port)
    d.writeUInt16BE(0x0001, 30);  // externalPortType = 1 (SDI)
  }
  d.writeUInt8(internalPortType, 32);
  d.writeUInt8(sourceAvail, 34);
  d.writeUInt8(meAvail, 35);
  return buildCmd('InPr', d);
}

function cmdPrgI(me, source) {
  const d = Buffer.alloc(4, 0);
  d.writeUInt8(me, 0);
  d.writeUInt16BE(source, 2);
  return buildCmd('PrgI', d);
}

function cmdPrvI(me, source) {
  const d = Buffer.alloc(4, 0);
  d.writeUInt8(me, 0);
  d.writeUInt16BE(source, 2);
  return buildCmd('PrvI', d);
}

function cmdTlSr() {
  // TallyBySourceCommand (rawName 'TlSr') layout:
  //   0-1: sourceCount (uint16BE)
  //   for each source: [sourceId(2), flags(1)]  flags: 0x01=pgm, 0x02=pvw
  const tally = new Map();
  for (const src of Object.values(state.program)) {
    if (src > 0) tally.set(src, (tally.get(src) ?? 0) | 0x01);
  }
  for (const src of Object.values(state.preview)) {
    if (src > 0) tally.set(src, (tally.get(src) ?? 0) | 0x02);
  }
  const entries = [...tally.entries()];
  const d = Buffer.alloc(2 + entries.length * 3, 0);
  d.writeUInt16BE(entries.length, 0);
  for (let i = 0; i < entries.length; i++) {
    d.writeUInt16BE(entries[i][0], 2 + i * 3);
    d.writeUInt8(entries[i][1], 4 + i * 3);
  }
  return buildCmd('TlSr', d);
}

function cmdInCm() {
  // InitCompleteCommand — empty payload BUT atem-connection's _parseCommands has
  // `while (buffer.length > 8)` which skips the LAST command when it is exactly
  // 8 bytes. Pad InCm to 9 bytes so it survives. InitCompleteCommand.deserialize()
  // ignores its input so the extra zero byte is harmless.
  return buildCmd('InCm', Buffer.alloc(1, 0));
}

// ---------------------------------------------------------------------------
// Initial state dump — sent to each new client after handshake
// ---------------------------------------------------------------------------
function sendInitialStateDump(session) {
  const commands = [
    cmdVer(),
    cmdPin(),
    cmdTop(),
    ...INPUTS.map(([id, ln, sn, ipt, ext, sa, ma]) => cmdInPr(id, ln, sn, ipt, ext, sa, ma)),
    cmdPrgI(0, state.program[0]),
    cmdPrvI(0, state.preview[0]),
    cmdTlSr(),
    cmdInCm(),
  ];
  sendCommandsTo(session, commands);
  session.initialized = true;
  console.log(`[ATEM] → init dump (${commands.length} cmds, ${Buffer.concat(commands).length}B) to ${session.address}:${session.port} (session 0x${session.sessionId.toString(16)})`);
}

// ---------------------------------------------------------------------------
// Incoming command parser
// ---------------------------------------------------------------------------
function decodeHeader(buf) {
  return {
    flags:          buf.readUInt8(0) >> 3,
    length:         buf.readUInt16BE(0) & 0x07ff,
    remotePacketId: buf.readUInt16BE(10),
    payload:        buf.slice(12),
  };
}

function handleCommands(payload, session) {
  let buf = payload;
  let changed = false;
  while (buf.length >= 8) {
    const len = buf.readUInt16BE(0);
    if (len < 8 || len > buf.length) break;
    const name = buf.toString('ascii', 4, 8);
    const data = buf.slice(8, len);

    if (name === 'CPgI') {
      const me = data.readUInt8(0);
      const src = data.readUInt16BE(2);
      state.program[me] = src;
      changed = true;
      console.log(`[ATEM] ← PROGRAM  ME=${me}  source=${src}`);
    } else if (name === 'CPvI') {
      const me = data.readUInt8(0);
      const src = data.readUInt16BE(2);
      state.preview[me] = src;
      changed = true;
      console.log(`[ATEM] ← PREVIEW  ME=${me}  source=${src}`);
    } else {
      console.log(`[ATEM] ← ${name}  (${data.length}B)`);
    }
    buf = buf.slice(len);
  }

  if (changed) {
    // Broadcast updated bus state + tally to all clients (tally bridge + ATEM SC)
    broadcastCommands([
      cmdPrgI(0, state.program[0]),
      cmdPrvI(0, state.preview[0]),
      cmdTlSr(),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Packet handler
// ---------------------------------------------------------------------------
socket.on('message', (buf, rinfo) => {
  if (buf.length < 12) return;
  const { flags, remotePacketId, payload } = decodeHeader(buf);

  if (flags & PF.NewSessionId) {
    const existing = sessions.get(sessionKey(rinfo.address, rinfo.port));
    if (existing) {
      console.log(`[ATEM] Re-HELLO from ${rinfo.address}:${rinfo.port} — resetting session`);
    } else {
      console.log(`[ATEM] HELLO from ${rinfo.address}:${rinfo.port}`);
    }
    const session = createSession(rinfo.address, rinfo.port);
    sendNewSessionId(session);
    setTimeout(() => sendInitialStateDump(session), 50);
    return;
  }

  const session = sessions.get(sessionKey(rinfo.address, rinfo.port));
  if (!session) return;

  session.lastSeen = Date.now();

  if (flags & PF.AckRequest) {
    session.lastClientPacketId = remotePacketId;
    if (payload.length >= 8) {
      handleCommands(payload, session);
    }
    sendAck(session, remotePacketId);
  }
  // AckReply from client: no action needed
});

socket.on('error', (err) => {
  console.error(`[ATEM] Socket error: ${err.message}`);
});

// ---------------------------------------------------------------------------
// Keepalive: AckReply to each client every 2 s; prune stale sessions (> 30 s).
// atemSocketChild.js CONNECTION_TIMEOUT = 5000 ms — keepalive prevents reconnect.
// ---------------------------------------------------------------------------
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.lastSeen > 30_000) {
      console.log(`[ATEM] Session ${key} timed out — removed`);
      sessions.delete(key);
    } else {
      sendAck(session, session.lastClientPacketId);
    }
  }
}, 2000);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
socket.bind(UDP_PORT, '0.0.0.0', () => {
  console.log(`[ATEM] Simulator listening on UDP ${UDP_PORT}`);
  console.log('[ATEM] Model: ATEM Television Studio HD (1 ME, 8 inputs, Black, ColorBars)');
  console.log('[ATEM] Clients: atem-connection tally bridge + ATEM Software Control\n');
});
