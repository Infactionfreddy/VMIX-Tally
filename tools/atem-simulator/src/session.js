// Per-client connection: the handshake state machine plus the reliable-delivery
// layer (incrementing packet ids, acks, retransmits, keepalive). This is the
// server-side mirror of atem-connection's lib/atemSocketChild.js.

import { EventEmitter } from 'node:events';
import {
  FLAG,
  MAX_PACKET_ID,
  buildPacket,
  parseCommands,
  isAtOrBehind,
  seqDistance,
} from './protocol.js';
import { encodeTime } from './commands.js';

const MAX_PAYLOAD = 1400; // keep datagrams comfortably under the ATEM ~1416 cap
const RETRANSMIT_TIMEOUT = 60; // ms before resending an unacked packet
const RETRANSMIT_INTERVAL = 20; // ms timer granularity
const MAX_RETRIES = 10;
const KEEPALIVE_INTERVAL = 1000; // ms

const State = { HELLO_SENT: 'hello_sent', ESTABLISHED: 'established', CLOSED: 'closed' };

export class Session extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} opts.sessionId        id assigned to this client
   * @param {{address:string,port:number}} opts.remote
   * @param {(buf:Buffer)=>void} opts.send  sends a datagram to this client
   * @param {()=>Buffer[]} opts.buildStateDump  returns the ordered state-dump commands (InCm last)
   */
  constructor({ sessionId, remote, send, buildStateDump }) {
    super();
    this.sessionId = sessionId;
    this.remote = remote;
    this._send = send;
    this._buildStateDump = buildStateDump;

    this.state = State.HELLO_SENT;
    this._nextPacketId = 1; // hello-response uses id 0, so the dump starts at 1
    this._lastClientPacketId = -1;
    this._inFlight = new Map(); // packetId -> { buffer, sentAt, retries }
    this._timers = [];

    this._sendHelloResponse();
  }

  get key() {
    return `${this.remote.address}:${this.remote.port}`;
  }

  // --- handshake -----------------------------------------------------------

  _sendHelloResponse() {
    // 20-byte NewSessionId response carrying the assigned session id. packetId 0
    // becomes the client's last-received id, so our state dump begins at id 1.
    const payload = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]);
    this._send(
      buildPacket({ flags: FLAG.NewSessionId, sessionId: this.sessionId, packetId: 0 }, payload),
    );
  }

  _establish() {
    if (this.state !== State.HELLO_SENT) return;
    this.state = State.ESTABLISHED;
    this._startTimers();
    this.emit('established');
    this.sendCommands(this._buildStateDump());
  }

  // --- inbound -------------------------------------------------------------

  handlePacket(header, payload) {
    if (this.state === State.CLOSED) return;

    // A repeated hello means our response was lost — resend it (don't re-dump).
    if (header.flags & FLAG.NewSessionId) {
      this._sendHelloResponse();
      return;
    }

    // The client's ack of our hello-response is the signal that it reached
    // Established and is ready for the state dump.
    if (this.state === State.HELLO_SENT) this._establish();

    if (header.flags & FLAG.AckReply) this._clearInFlight(header.ackId);
    if (header.flags & FLAG.RetransmitRequest) this._retransmitFrom(header.retransmitId);

    if (header.flags & FLAG.AckRequest) {
      // Reliable client packet (e.g. CPgI/CPvI or a keepalive ping): ack it,
      // and dispatch its commands once (dedupe retransmissions by packet id).
      this._sendAck(header.packetId);
      if (header.packetId !== this._lastClientPacketId) {
        this._lastClientPacketId = header.packetId;
        for (const cmd of parseCommands(payload)) this.emit('command', cmd.name, cmd.payload);
      }
    }
  }

  // --- outbound ------------------------------------------------------------

  _sendAck(ackId) {
    this._send(buildPacket({ flags: FLAG.AckReply, sessionId: this.sessionId, ackId }));
  }

  /** Pack command buffers into one or more reliable packets and send them. */
  sendCommands(commands) {
    if (this.state === State.CLOSED) return;
    let batch = [];
    let size = 0;
    const flush = () => {
      if (!batch.length) return;
      this._sendReliable(Buffer.concat(batch));
      batch = [];
      size = 0;
    };
    for (const cmd of commands) {
      if (size + cmd.length > MAX_PAYLOAD) flush();
      batch.push(cmd);
      size += cmd.length;
    }
    flush();
  }

  _sendReliable(payload) {
    const packetId = this._nextPacketId;
    this._nextPacketId = (this._nextPacketId + 1) % MAX_PACKET_ID;
    const buffer = buildPacket(
      { flags: FLAG.AckRequest, sessionId: this.sessionId, packetId },
      payload,
    );
    this._inFlight.set(packetId, { buffer, sentAt: Date.now(), retries: 0 });
    this._send(buffer);
  }

  _clearInFlight(ackId) {
    for (const id of this._inFlight.keys()) {
      if (isAtOrBehind(id, ackId)) this._inFlight.delete(id);
    }
  }

  _retransmitFrom(fromId) {
    const from = fromId % MAX_PACKET_ID;
    for (const [id, entry] of this._inFlight) {
      if (seqDistance(from, id) < MAX_PACKET_ID / 2) {
        this._resend(id, entry);
      }
    }
  }

  _resend(id, entry) {
    // Flip the IsRetransmit flag on the stored buffer in place.
    const buf = entry.buffer;
    const word = buf.readUInt16BE(0);
    buf.writeUInt16BE(word | (FLAG.IsRetransmit << 11), 0);
    entry.sentAt = Date.now();
    entry.retries += 1;
    this._send(buf);
  }

  // --- timers --------------------------------------------------------------

  _startTimers() {
    this._timers.push(setInterval(() => this._checkRetransmits(), RETRANSMIT_INTERVAL));
    this._timers.push(setInterval(() => this._keepalive(), KEEPALIVE_INTERVAL));
  }

  _checkRetransmits() {
    const now = Date.now();
    for (const [id, entry] of this._inFlight) {
      if (now - entry.sentAt < RETRANSMIT_TIMEOUT) continue;
      if (entry.retries >= MAX_RETRIES) {
        this.close();
        return;
      }
      this._resend(id, entry);
    }
  }

  _keepalive() {
    if (this.state !== State.ESTABLISHED) return;
    const d = new Date();
    this.sendCommands([encodeTime(d.getHours(), d.getMinutes(), d.getSeconds(), 0)]);
  }

  close() {
    if (this.state === State.CLOSED) return;
    this.state = State.CLOSED;
    for (const t of this._timers) clearInterval(t);
    this._timers = [];
    this._inFlight.clear();
    this.emit('close');
  }
}
