# ATEM Simulator

A reactive **Blackmagic ATEM switcher simulator**. It speaks the real ATEM UDP
control protocol (port 9910) well enough that the [`atem-connection`](https://www.npmjs.com/package/atem-connection)
library — the same library the vMix→ATEM tally bridge uses — connects to it as if
it were real hardware, accepts program/preview-input changes, and gets tally state
back.

This lets you develop and test the tally bridge (Phase 4: ATEM output, red/green
tally, walk-test, <100 ms latency) **without a physical ATEM and without cameras**.

## What it does

- Implements the ATEM connection handshake + reliable-delivery layer (acks,
  retransmits, keepalive) as the server-side peer of `atem-connection`.
- Serves a minimal device state dump (`_ver`, `_pin`, `_top`, `InPr`, `PrgI`,
  `PrvI`, `TlSr`, `InCm`) so the client reports `connected` and reads initial state.
- Reacts to the client's `CPgI` / `CPvI` (change program / preview input) by
  updating internal state and echoing `PrgI` / `PrvI` / `TlSr` back — closing the
  tally loop: *bridge sets program → simulator updates tally → bridge sees it.*
- Visualizes tally two ways:
  - **Console** — connection lifecycle + a 🔴/🟢 line on every change.
  - **Web** — a live red/green camera grid at `http://localhost:8080` (Server-Sent
    Events, no extra dependencies).

## Run

```bash
cd tools/atem-simulator
npm install          # only needed for the test suite (atem-connection)
npm start            # listens on 9910, web view on :8080, 8 inputs

# options
node index.js --inputs 8 --port 9910 --web 8080 --program 1 --preview 2
node index.js --web=false        # console only
```

Then point your bridge (or any `atem-connection` client) at `127.0.0.1`:

```js
import { Atem } from 'atem-connection'
const atem = new Atem()
atem.on('connected', () => atem.changeProgramInput(3)) // camera 3 → red
atem.connect('127.0.0.1')
```

Open `http://localhost:8080` to watch the tally grid react in real time.

## Test

```bash
npm test
```

- `test/codec.test.js` — round-trips every hand-encoded command (`PrgI`, `PrvI`,
  `TlSr`, `_top`, `_ver`) through `atem-connection`'s own decoders, proving the
  encoders are wire-correct.
- `test/e2e.test.js` — boots the simulator, connects a real `atem-connection`
  client, and asserts it reaches `connected`, reads initial state, and that
  `changeProgramInput` / `changePreviewInput` reach the simulator and the echoed
  state lands back on the client.

## Layout

| File | Responsibility |
|------|----------------|
| `src/protocol.js` | 12-byte transport header, packet flags, 8-byte command framing |
| `src/commands.js` | Encoders for state commands; decoder for `CPgI`/`CPvI` |
| `src/state.js`    | Switcher state model + tally derivation |
| `src/session.js`  | Per-client handshake + reliable send/ack/retransmit/keepalive |
| `src/server.js`   | UDP server, state dump, command dispatch, echo |
| `src/web.js`      | Zero-dependency HTTP + SSE tally page |
| `index.js`        | CLI entry: config, server, web, console logging |

## Notes / limitations

- Single mix-effect (ME1), cut-style program/preview only — matching the bridge's
  cut-only tally model. No transitions, keyers, or aux routing.
- Protocol fidelity is targeted at `atem-connection`. Stricter clients (e.g.
  LibAtem, which validates the hello-response body) are not a goal.
- Implementation spec and protocol details: `.planning/research/ATEM-SIMULATOR.md`.
