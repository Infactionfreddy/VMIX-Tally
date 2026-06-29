// The ATEM simulator: a UDP server on port 9910 that runs the handshake, serves a
// state dump, reacts to CPgI/CPvI by updating switcher state, and echoes the
// resulting PrgI/PrvI/TlSr back to the client.

import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';
import { ATEM_PORT, decodeHeader } from './protocol.js';
import { Session } from './session.js';
import {
  encodeVersion,
  encodeProductId,
  encodeTopology,
  encodeInputProperties,
  encodeProgramInput,
  encodePreviewInput,
  encodeTallyBySource,
  encodeInitComplete,
  encodeTime,
  decodeChangeInput,
} from './commands.js';
import { SwitcherState } from './state.js';

export class AtemSimulator extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} [opts.port]
   * @param {string} [opts.model]
   * @param {SwitcherState} opts.state
   */
  constructor({ port = ATEM_PORT, model = 'ATEM Simulator', state } = {}) {
    super();
    this.port = port;
    this.model = model;
    this.state = state;
    this.sessions = new Map(); // "addr:port" -> Session
    this._nextSessionId = 1;
    this.socket = dgram.createSocket('udp4');

    this.socket.on('message', (msg, rinfo) => this._onMessage(msg, rinfo));
    this.socket.on('error', (err) => this.emit('error', err));

    // Re-broadcast switcher changes to connected clients.
    this.state.on('change', () => this._broadcastState());
  }

  listen() {
    return new Promise((resolve) => {
      this.socket.bind(this.port, () => {
        this.address = this.socket.address();
        this.emit('listening', this.address);
        resolve(this.address);
      });
    });
  }

  close() {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
    return new Promise((resolve) => this.socket.close(resolve));
  }

  _onMessage(msg, rinfo) {
    if (msg.length < 12) return;
    const header = decodeHeader(msg);

    // The client drops mis-sized packets; we do the same on the way in.
    if (header.length !== msg.length) return;

    const payload = msg.subarray(12);
    const key = `${rinfo.address}:${rinfo.port}`;
    let session = this.sessions.get(key);

    // A 20-byte NewSessionId packet with no existing session is a connect request.
    if (!session) {
      const isHello = (header.flags & 0x02) !== 0;
      if (!isHello) return;
      session = this._createSession(rinfo);
    }

    session.handlePacket(header, payload);
  }

  _createSession(remote) {
    const sessionId = this._nextSessionId;
    this._nextSessionId = (this._nextSessionId + 1) & 0x7fff || 1;
    const key = `${remote.address}:${remote.port}`;

    const session = new Session({
      sessionId,
      remote,
      send: (buf) => this.socket.send(buf, remote.port, remote.address),
      buildStateDump: () => this._buildStateDump(),
    });

    session.on('established', () => this.emit('connected', remote));
    session.on('command', (name, p) => this._onCommand(session, name, p));
    session.on('close', () => {
      if (this.sessions.get(key) === session) this.sessions.delete(key);
      this.emit('disconnected', remote);
    });

    this.sessions.set(key, session);
    return session;
  }

  /** The ordered state dump sent during the handshake. InCm must be last. */
  _buildStateDump() {
    const cmds = [
      encodeVersion(),
      encodeProductId(this.model),
      encodeTopology({ mixEffects: 1, sources: 20 }),
    ];
    for (const input of this.state.inputs) {
      cmds.push(
        encodeInputProperties({
          id: input.id,
          longName: input.longName,
          shortName: input.shortName,
        }),
      );
    }
    cmds.push(encodeProgramInput(0, this.state.programInput));
    cmds.push(encodePreviewInput(0, this.state.previewInput));
    cmds.push(encodeTallyBySource(this.state.tally()));
    cmds.push(encodeInitComplete());
    // The client's parse loop runs `while (buffer.length > 8)`, so a trailing
    // command is required for the 8-byte InCm to be parsed (and thus for the
    // 'connected' event to fire). A timecode is a harmless trailer.
    const d = new Date();
    cmds.push(encodeTime(d.getHours(), d.getMinutes(), d.getSeconds(), 0));
    return cmds;
  }

  _onCommand(session, name, payload) {
    if (name === 'CPgI') {
      const { source } = decodeChangeInput(payload);
      this.emit('controlProgram', source);
      this.state.setProgram(source); // 'change' triggers _broadcastState
    } else if (name === 'CPvI') {
      const { source } = decodeChangeInput(payload);
      this.emit('controlPreview', source);
      this.state.setPreview(source);
    }
  }

  /** Push current program/preview/tally to every established session. */
  _broadcastState() {
    const cmds = [
      encodeProgramInput(0, this.state.programInput),
      encodePreviewInput(0, this.state.previewInput),
      encodeTallyBySource(this.state.tally()),
    ];
    for (const session of this.sessions.values()) {
      if (session.state === 'established') session.sendCommands(cmds);
    }
    this.emit('state', this.state.snapshot());
  }
}
