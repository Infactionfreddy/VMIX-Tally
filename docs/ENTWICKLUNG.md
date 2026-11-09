# Entwicklung

[← Zurück zur README](../README.md)

## Lokale Umgebung

```bash
npm ci
npm run dev        # startet vMix-Simulator, ATEM-Simulator und Server
```

`scripts/dev.mjs` startet drei Prozesse mit farbigen Präfixen: `scripts/vmix-simulator.mjs` (TCP 8099, HTTP 8088, Tally-Zyklus alle 3 s), einen ATEM-Simulator (UDP 9910) und `tsx src/server.ts` (Port 3000).

> **Achtung:** `dev.mjs` ruft `tools/atem-simulator/index.js` auf, das im Repo nicht vorhanden ist. Stattdessen existiert `scripts/atem-simulator.mjs` (`node scripts/atem-simulator.mjs`). Bitte Skript oder Pfad anpassen bzw. Simulatoren einzeln starten.

Frontend mit Hot Reload: `npx vite` (Port 5173, Proxy auf `localhost:3000` für `/overrides`, `/config`, `/test`, `/vmix`, `/ws`).

Im Verzeichnis `pyAtemSim-main/` liegt ein alternativer Python-ATEM-Simulator (`python atem_server.py`).

## Code-Struktur

- `src/core/` – reine Logik (Resolver, Tally-Zustand, Events)
- `src/vmix/` – vMix-Anbindung; `src/atem/` – ATEM-Anbindung. Nur `server.ts` importiert beide.
- `src/config/` – Schema und Persistenz
- `src/routes/` – Fastify-Plugins
- `src/frontend/` – Svelte 5 (Runes, `state.svelte.ts` als globaler Zustand), eigene `tsconfig.json`

## Skripte

| Befehl | Zweck |
|---|---|
| `npm run dev` | Dev-Umgebung mit Simulatoren |
| `npm run build` | Frontend-Build nach `dist/` |
| `npm start` | Server starten |
| `npm run typecheck` | `tsc --noEmit` (Backend, ohne `src/frontend`) |
| `npm test` / `npm run test:watch` | Vitest |

## Tests

Vitest (`src/**/*.test.ts`, Node-Umgebung). Vorhanden für Resolver, Tally-State, Events, Schema, Parser, Connectors, Routen (Overrides, Settings) und Server (`buildApp` mit Mocks, via `app.inject`). `buildApp` wird beim Import nicht gestartet (Main-Guard). Es gibt keine Frontend-Tests.

## Coding-Standards

- TypeScript `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, ESM mit `.js`-Endungen in Imports
- Reine Funktionen (Parser, Resolver) ohne I/O; Parser sind total und werfen nicht
- Fastify 5: bestehende pino-Instanz über `loggerInstance` übergeben
- Kein Linter/Formatter im Repo konfiguriert

## Release-Ablauf

Kein automatisierter Ablauf vorhanden (Paket `private`, Version 0.1.0). Vorschlag: Tests und Typecheck laufen lassen, Version anheben, taggen, mit `install-lxc.sh` ausrollen.

Planungsdokumente der Entwicklungsphasen liegen unter `.planning/`.