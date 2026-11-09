# Konfiguration

[← Zurück zur README](../README.md)

## Umgebungsvariablen

| Variable | Standard | Beschreibung |
|---|---|---|
| `PORT` | `3000` | Port von HTTP und WebSocket (Bind auf `0.0.0.0`) |
| `NODE_ENV` | – | Vom systemd-Dienst auf `production` gesetzt |

## config.json

Wird vom `ConfigStore` (lowdb) im Arbeitsverzeichnis verwaltet und per zod validiert. Der LXC-Installer legt folgende Grundstruktur an:

```json
{ "version": 1, "settings": { "vmix": null, "atem": null }, "mapping": [], "overrides": {} }
```

| Feld | Beschreibung |
|---|---|
| `version` | Schemaversion (`1`) |
| `settings.vmix` | `host`, `port` (TCP), optional `vmixHttpPort` (Standard 8088) oder `null` |
| `settings.atem` | `host`, `port` (Standard-Fallback 9910) oder `null` |
| `mapping` | Liste mit u. a. `cameraId`, `atemSource`, `vmixNumber`, `vmixTitle`, vMix-Key (genaues Schema siehe `src/config/schema.ts`) |
| `overrides` | Objekt `cameraId → 'program' \| 'preview'` |

Ohne ATEM-Einstellungen startet der Server mit dem Fallback `192.168.1.1:9910` und lässt sich im UI konfigurieren (Fail-open). Ohne vMix-Einstellungen bleibt der Orchestrator inaktiv, bis konfiguriert wird. Ein Ändern der Einstellungen löst einen Reconnect aus.

## Ports

| Dienst | Port | Protokoll |
|---|---|---|
| Bridge Web-UI/API | 3000 | HTTP/WS |
| vMix TCP-API | 8099 (Standard laut Simulator) | TCP |
| vMix HTTP-API | 8088 | HTTP |
| ATEM | 9910 | UDP |
| Vite-Dev-Server | 5173 | HTTP (nur Entwicklung) |

## Hooks / Filter

| Hook | Wirkung |
|---|---|
| Fastify `onRequest` (CSRF) | Blockiert PUT/POST/DELETE bei `Sec-Fetch-Site` ≠ `same-origin`/`none` oder abweichendem `Origin`-Hostnamen (403) |

## Hinweise

- `config.json` kann Netzwerkadressen enthalten und sollte nicht veröffentlicht werden (Annahme: in `.gitignore`).
- Es gibt keine Authentifizierung; Zugriff auf das Netz beschränken.