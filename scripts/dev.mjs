#!/usr/bin/env node
/**
 * Dev launcher: starts all three processes together with colored prefixes.
 *
 *   node scripts/dev.mjs
 *
 * Processes:
 *   [vmix]   node scripts/vmix-simulator.mjs   — TCP 8099 + HTTP 8088
 *   [atem]   node scripts/atem-simulator.mjs   — UDP 9910
 *   [server] npx tsx src/server.ts             — HTTP/WS 3000
 *
 * Press Ctrl+C to stop all three.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// ANSI color codes
const COLORS = {
  vmix:   '\x1b[36m',  // cyan
  atem:   '\x1b[33m',  // yellow
  server: '\x1b[32m',  // green
  reset:  '\x1b[0m',
};

function prefix(name, line) {
  return `${COLORS[name]}[${name}]${COLORS.reset} ${line}`;
}

function spawnProcess(name, cmd, args, opts = {}) {
  const proc = spawn(cmd, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) console.log(prefix(name, line));
    }
  });

  proc.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) console.error(prefix(name, line));
    }
  });

  proc.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && signal !== 'SIGINT') {
      console.log(prefix(name, `exited (code=${code ?? signal})`));
    }
  });

  return proc;
}

console.log('\n=== vMix → ATEM Tally-Bridge — Dev Mode ===');
console.log('Starting: vMix simulator, ATEM simulator, tally server\n');

// Give simulators 300 ms head-start before the server tries to connect
const vmix   = spawnProcess('vmix',   'node', ['scripts/vmix-simulator.mjs']);
const atem   = spawnProcess('atem',   'node', ['scripts/atem-simulator.mjs']);

setTimeout(() => {
  const server = spawnProcess('server', 'npx', ['tsx', 'src/server.ts']);

  // On Ctrl+C: kill all three
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    server.kill('SIGTERM');
    vmix.kill('SIGTERM');
    atem.kill('SIGTERM');
    process.exit(0);
  });
}, 300);

process.on('SIGINT', () => {
  // handled inside the setTimeout; this catches the case before server starts
  vmix.kill('SIGTERM');
  atem.kill('SIGTERM');
  process.exit(0);
});

console.log('Open http://localhost:3000 in your browser once "Server listening" appears.\n');
