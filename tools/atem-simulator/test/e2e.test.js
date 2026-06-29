// End-to-end: point a real atem-connection client at the simulator and verify it
// connects like real hardware, then drives program/preview and sees the echo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { Atem } from 'atem-connection';
import { AtemSimulator } from '../src/server.js';
import { SwitcherState } from '../src/state.js';

const PORT = 19910; // avoid clashing with a real ATEM on 9910

function makeSim() {
  const inputs = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, longName: `Camera ${i + 1}` }));
  const state = new SwitcherState({ inputs, program: 1, preview: 2 });
  return new AtemSimulator({ port: PORT, state });
}

function waitFor(emitter, event, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = (...args) => {
      if (!predicate || predicate(...args)) {
        clearTimeout(timer);
        emitter.off(event, handler);
        resolve(args);
      }
    };
    emitter.on(event, handler);
  });
}

test('atem-connection client connects to the simulator and reads initial state', async () => {
  const sim = makeSim();
  await sim.listen();
  const atem = new Atem();
  try {
    atem.on('error', () => {});
    const connected = once(atem, 'connected');
    atem.connect('127.0.0.1', PORT);
    await Promise.race([
      connected,
      new Promise((_, r) => setTimeout(() => r(new Error('client never connected')), 5000)),
    ]);

    assert.equal(atem.state.video.mixEffects[0].programInput, 1);
    assert.equal(atem.state.video.mixEffects[0].previewInput, 2);
  } finally {
    await atem.disconnect().catch(() => {});
    await sim.close();
  }
});

test('client changeProgramInput reaches the simulator and the echoed state lands back', async () => {
  const sim = makeSim();
  await sim.listen();
  const atem = new Atem();
  try {
    atem.on('error', () => {});
    const connected = once(atem, 'connected');
    atem.connect('127.0.0.1', PORT);
    await connected;

    // The simulator must receive the control command...
    const gotControl = waitFor(sim, 'controlProgram', (s) => s === 4);
    await atem.changeProgramInput(4);
    const [received] = await gotControl;
    assert.equal(received, 4);
    assert.equal(sim.state.programInput, 4);

    // ...and the echoed PrgI must update the client's own state.
    await waitFor(atem, 'stateChanged', () => atem.state.video.mixEffects[0].programInput === 4);
    assert.equal(atem.state.video.mixEffects[0].programInput, 4);

    // Preview path too.
    const gotPreview = waitFor(sim, 'controlPreview', (s) => s === 6);
    await atem.changePreviewInput(6);
    await gotPreview;
    assert.equal(sim.state.previewInput, 6);
    await waitFor(atem, 'stateChanged', () => atem.state.video.mixEffects[0].previewInput === 6);
    assert.equal(atem.state.video.mixEffects[0].previewInput, 6);
  } finally {
    await atem.disconnect().catch(() => {});
    await sim.close();
  }
});
