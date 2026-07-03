#!/usr/bin/env node
/**
 * vMix TCP + HTTP Simulator for local development / UI testing.
 *
 * Simulates two vMix API endpoints:
 *   - TCP  port 8099  → SUBSCRIBE TALLY push protocol
 *   - HTTP port 8088  → GET /api returns roster XML
 *
 * Tally cycle: realistic 7-step program/preview sequence, changes every 3 s.
 * Three inputs with stable GUIDs matching scripts/dev-config.json.
 *
 * Usage:
 *   node scripts/vmix-simulator.mjs
 */

import { createServer as createTcpServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';

// ---------------------------------------------------------------------------
// Roster — GUIDs must match dev-config.json mapping entries
// ---------------------------------------------------------------------------

const INPUTS = [
  { number: 1, key: 'vmix-key-cam1', title: 'Kamera 1' },
  { number: 2, key: 'vmix-key-cam2', title: 'Kamera 2' },
  { number: 3, key: 'vmix-key-cam3', title: 'Kamera 3' },
  { number: 4, key: 'vmix-key-cam4', title: 'Kamera 4' },
  { number: 5, key: 'vmix-key-cam5', title: 'Kamera 5' },
  { number: 6, key: 'vmix-key-cam6', title: 'Kamera 6' }
];

const ROSTER_XML = `<vmix>
  <inputs>
${INPUTS.map(i => `    <input number="${i.number}" key="${i.key}" shortTitle="${i.title}" title="${i.title}" />`).join('\n')}
  </inputs>
</vmix>`;

// ---------------------------------------------------------------------------
// Tally cycle  (0=off, 1=program, 2=preview)
//              cam1 cam2 cam3
// ---------------------------------------------------------------------------

const TALLY_CYCLE = [
  '100',  // cam1 LIVE
  '120',  // cam1 LIVE, cam2 PREV
  '020',  // cam2 LIVE          ← cut
  '021',  // cam2 LIVE, cam3 PREV
  '001',  // cam3 LIVE          ← cut
  '101',  // cam3 LIVE, cam1 PREV
  '100',  // cam1 LIVE          ← cut
];

let cycleIdx = 0;
let currentTally = TALLY_CYCLE[0];

// ---------------------------------------------------------------------------
// TCP server (port 8099) — SUBSCRIBE TALLY push
// ---------------------------------------------------------------------------

const subscribers = new Set();

const tcpServer = createTcpServer((socket) => {
  const addr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[TCP] Client connected: ${addr}`);

  let buf = '';

  // Send current tally immediately on connect
  socket.write(`TALLY OK ${currentTally}\r\n`);

  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\r\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (line === 'SUBSCRIBE TALLY') {
        console.log(`[TCP] ${addr} subscribed to TALLY`);
        subscribers.add(socket);
      } else if (line === 'UNSUBSCRIBE TALLY') {
        subscribers.delete(socket);
      }
    }
  });

  socket.on('close', () => {
    subscribers.delete(socket);
    console.log(`[TCP] Client disconnected: ${addr}`);
  });

  socket.on('error', () => {
    subscribers.delete(socket);
  });
});

tcpServer.listen(8099, '0.0.0.0', () => {
  console.log('[TCP] vMix tally server listening on port 8099');
});

// ---------------------------------------------------------------------------
// HTTP server (port 8088) — GET /api returns roster XML
// ---------------------------------------------------------------------------

const httpServer = createHttpServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/api' || req.url?.startsWith('/api?'))) {
    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' });
    res.end(ROSTER_XML);
    console.log('[HTTP] Served roster XML');
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

httpServer.listen(8088, '0.0.0.0', () => {
  console.log('[HTTP] vMix roster server listening on port 8088');
});

// ---------------------------------------------------------------------------
// Tally cycle — advance every 3 seconds, push to all subscribers
// ---------------------------------------------------------------------------

setInterval(() => {
  cycleIdx = (cycleIdx + 1) % TALLY_CYCLE.length;
  currentTally = TALLY_CYCLE[cycleIdx];

  const labels = currentTally.split('').map((d, i) =>
    d === '1' ? `cam${i+1}=LIVE` : d === '2' ? `cam${i+1}=PREV` : null
  ).filter(Boolean).join(', ') || 'all off';

  console.log(`[TALLY] → "${currentTally}"  (${labels})`);

  const msg = `TALLY OK ${currentTally}\r\n`;
  for (const sock of subscribers) {
    try {
      sock.write(msg);
    } catch {
      subscribers.delete(sock);
    }
  }
}, 3000);

console.log('\nvMix Simulator running. Tally cycles every 3 s.\nPress Ctrl+C to stop.\n');
