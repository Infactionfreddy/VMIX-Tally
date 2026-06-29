#!/usr/bin/env node
// Entry point: starts the ATEM simulator + web tally view and logs activity to the
// console. Configure via flags or env:
//
//   node index.js --inputs 8 --port 9910 --web 8080 --program 1 --preview 2
//
// Defaults match a small studio: 8 SDI camera inputs, real ATEM port 9910.

import { AtemSimulator } from './src/server.js';
import { SwitcherState } from './src/state.js';
import { startWeb } from './src/web.js';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(argv[i]);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (val === undefined) {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        val = next;
        i++;
      } else {
        val = true;
      }
    }
    args[key] = val;
  }
  return args;
}

const args = parseArgs(process.argv);
const inputCount = Number(args.inputs ?? process.env.SIM_INPUTS ?? 8);
const port = Number(args.port ?? process.env.SIM_PORT ?? 9910);
const webPort = args.web === false ? null : Number(args.web ?? process.env.SIM_WEB ?? 8080);

const inputs = Array.from({ length: inputCount }, (_, i) => ({
  id: i + 1,
  longName: `Camera ${i + 1}`,
  shortName: `Cam${i + 1}`,
}));

const state = new SwitcherState({
  inputs,
  program: Number(args.program ?? 1),
  preview: Number(args.preview ?? Math.min(2, inputCount)),
});

const sim = new AtemSimulator({ port, state });

const ts = () => new Date().toLocaleTimeString();
sim.on('listening', (a) => console.log(`[${ts()}] ATEM simulator listening on ${a.address}:${a.port} (${inputCount} inputs)`));
sim.on('connected', (r) => console.log(`[${ts()}] client connected: ${r.address}:${r.port}`));
sim.on('disconnected', (r) => console.log(`[${ts()}] client disconnected: ${r.address}:${r.port}`));
sim.on('controlProgram', (s) => console.log(`[${ts()}] ← CPgI program → input ${s}`));
sim.on('controlPreview', (s) => console.log(`[${ts()}] ← CPvI preview → input ${s}`));
sim.on('error', (e) => console.error(`[${ts()}] error:`, e.message));

state.on('change', () => {
  const snap = state.snapshot();
  const pgm = snap.inputs.find((i) => i.program);
  const pvw = snap.inputs.find((i) => i.preview);
  console.log(`[${ts()}]   tally: 🔴 ${pgm ? pgm.longName : '—'}   🟢 ${pvw ? pvw.longName : '—'}`);
});

await sim.listen();
if (webPort) {
  await startWeb(sim, { port: webPort });
  console.log(`[${ts()}] web tally view: http://localhost:${webPort}`);
}

const shutdown = async () => {
  console.log(`\n[${ts()}] shutting down…`);
  await sim.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
