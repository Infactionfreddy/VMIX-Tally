// Round-trip the simulator's hand-encoded state commands through atem-connection's
// own decoders. If these pass, the encoders are wire-correct by construction.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCommands } from '../src/protocol.js';
import {
  encodeProgramInput,
  encodePreviewInput,
  encodeTallyBySource,
  encodeTopology,
  encodeVersion,
  PROTOCOL_VERSION,
  TALLY_PROGRAM,
  TALLY_PREVIEW,
} from '../src/commands.js';

import { Commands } from 'atem-connection';

const payloadOf = (cmdBuffer) => parseCommands(cmdBuffer)[0].payload;

test('PrgI decodes to the program input we encoded', () => {
  const payload = payloadOf(encodeProgramInput(0, 5));
  const cmd = Commands.ProgramInputUpdateCommand.deserialize(payload, PROTOCOL_VERSION);
  assert.equal(cmd.mixEffect, 0);
  assert.equal(cmd.properties.source, 5);
});

test('PrvI decodes to the preview input we encoded', () => {
  const payload = payloadOf(encodePreviewInput(0, 3));
  const cmd = Commands.PreviewInputUpdateCommand.deserialize(payload, PROTOCOL_VERSION);
  assert.equal(cmd.mixEffect, 0);
  assert.equal(cmd.properties.source, 3);
});

test('TlSr decodes to the tally bitfields we encoded', () => {
  const entries = [
    { source: 1, value: TALLY_PROGRAM },
    { source: 2, value: TALLY_PREVIEW },
    { source: 3, value: 0 },
  ];
  const payload = payloadOf(encodeTallyBySource(entries));
  const cmd = Commands.TallyBySourceCommand.deserialize(payload, PROTOCOL_VERSION);
  // The decoded shape is a map keyed by source id → { program, preview }.
  const bySource = cmd.properties;
  assert.deepEqual(bySource[1], { program: true, preview: false });
  assert.deepEqual(bySource[2], { program: false, preview: true });
  assert.deepEqual(bySource[3], { program: false, preview: false });
});

test('_top decodes with the mix-effect and source counts we set', () => {
  const payload = payloadOf(encodeTopology({ mixEffects: 1, sources: 20 }));
  const cmd = Commands.TopologyCommand.deserialize(payload, PROTOCOL_VERSION);
  assert.equal(cmd.properties.mixEffects, 1);
  assert.equal(cmd.properties.sources, 20);
});

test('_ver decodes to the advertised protocol version', () => {
  const payload = payloadOf(encodeVersion());
  const cmd = Commands.VersionCommand.deserialize(payload, PROTOCOL_VERSION);
  assert.equal(cmd.properties.version, PROTOCOL_VERSION);
});
