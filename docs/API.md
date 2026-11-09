# API

[← Zurück zur README](../README.md)

Basis-URL: `http://<host>:3000`. Schreibende Requests (PUT/POST/DELETE) unterliegen dem CSRF-Hook (siehe [Konfiguration](KONFIGURATION.md)). Es gibt keine Authentifizierung.

## Endpunkte

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/ws` | WebSocket, sendet Snapshots (push-only) |
| GET | `/walk-test` | Startet Walk-Test; `202 {status}` oder `409 {error}` wenn bereits aktiv |
| GET | `/vmix/roster` | `{ inputs: [{ key, number }] }`, leer wenn vMix offline |
| PUT | `/overrides/:cameraId` | Body `{ state: 'program' \| 'preview' }` setzt Override (Details in `src/routes/overrides.ts`) |
| GET/PUT | `/config/settings` | Verbindungseinstellungen lesen/ändern; löst Reconnect aus (Methoden aus Frontend und Server-Code abgeleitet) |
| POST | `/test/:cameraId` | Body `{ action: 'program' \| 'preview' \| 'clear' }` für Kamera-Test |
| – | `src/routes/config.ts` | Weitere Config-/Mapping-Routen vorhanden; Inhalt nicht vollständig ausgewertet |

Statische Dateien (Web-UI) werden aus `dist/` unter `/` ausgeliefert.

## WebSocket-Snapshot

```json
{
  "type": "state",
  "cameras": [{ "cameraId": "cam-1", "name": "Kamera 1", "tally": "program" }],
  "connections": { "vmix": "connected", "atem": "connecting" },
  "latencyMs": null,
  "overrides": { "cam-1": "program" }
}
```

- `tally`: `program`, `preview` oder `off`
- Verbindungsstatus: `connecting`, `connected`, `disconnected`
- Der Snapshot wird beim Verbindungsaufbau sowie bei Tally-Änderungen, Verbindungswechseln und Override-Änderungen gesendet. Eingehende Nachrichten werden ignoriert.

## Fehlerantworten (CSRF)

`403 { "error": "CSRF: cross-origin request rejected" }` bzw. `"CSRF: invalid origin"`.