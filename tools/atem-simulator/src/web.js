// Zero-dependency web tally view: an HTTP server that serves a single page and
// pushes state snapshots over Server-Sent Events (no WebSocket library needed).

import http from 'node:http';

export function startWeb(simulator, { port = 8080 } = {}) {
  const clients = new Set();

  const push = (snapshot) => {
    const data = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const res of clients) res.write(data);
  };
  simulator.on('state', push);
  simulator.state.on('change', () => push(simulator.state.snapshot()));

  const server = http.createServer((req, res) => {
    if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(simulator.state.snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve({ server, port }));
  });
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ATEM Simulator — Tally</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: system-ui, sans-serif; background: #111; color: #eee; }
  header { padding: 16px 24px; border-bottom: 1px solid #333; display: flex; gap: 24px; align-items: baseline; }
  h1 { font-size: 16px; margin: 0; font-weight: 600; }
  .meta { color: #888; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; padding: 24px; }
  .cam { border: 2px solid #333; border-radius: 10px; padding: 18px 14px; background: #1b1b1b; transition: all .08s; }
  .cam .id { font-size: 12px; color: #888; }
  .cam .name { font-size: 17px; font-weight: 600; margin-top: 4px; }
  .cam .tag { display: inline-block; margin-top: 12px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #777; }
  .cam.program { border-color: #ff2d2d; background: #2a0e0e; box-shadow: 0 0 0 2px #ff2d2d33; }
  .cam.program .tag { color: #ff6b6b; }
  .cam.preview { border-color: #25c225; background: #0e220e; }
  .cam.preview .tag { color: #5bd75b; }
</style>
</head>
<body>
<header>
  <h1>ATEM Simulator</h1>
  <span class="meta">PGM <b id="pgm">–</b> · PVW <b id="pvw">–</b></span>
  <span class="meta" id="conn">connecting…</span>
</header>
<div class="grid" id="grid"></div>
<script>
  const grid = document.getElementById('grid');
  const es = new EventSource('/events');
  es.onopen = () => (document.getElementById('conn').textContent = 'live');
  es.onerror = () => (document.getElementById('conn').textContent = 'reconnecting…');
  es.onmessage = (e) => render(JSON.parse(e.data));
  function render(s) {
    document.getElementById('pgm').textContent = s.programInput;
    document.getElementById('pvw').textContent = s.previewInput;
    grid.innerHTML = '';
    for (const cam of s.inputs) {
      const el = document.createElement('div');
      el.className = 'cam' + (cam.program ? ' program' : cam.preview ? ' preview' : '');
      const tag = cam.program ? 'On Air' : cam.preview ? 'Preview' : 'Idle';
      el.innerHTML =
        '<div class="id">Input ' + cam.id + '</div>' +
        '<div class="name">' + cam.longName + '</div>' +
        '<div class="tag">' + tag + '</div>';
      grid.appendChild(el);
    }
  }
</script>
</body>
</html>`;
