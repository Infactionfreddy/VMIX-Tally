# vMix → ATEM Tally-Bridge

## What This Is

Ein Node.js-Server mit Weboberfläche, der das Tally-System von vMix mit Blackmagic-Kameras kompatibel macht. vMix bleibt der eigentliche Bildmischer; der Server liest dessen Live-/Preview-Zustand über die vMix-API aus und schaltet einen ATEM-Mischer so mit, dass dieser über den SDI-Rückkanal korrektes rot/grün Tally an die Blackmagic-Kameras verteilt. Für Video-Produktionen, die in vMix mischen wollen, aber Blackmagic-Kameras mit nativem SDI-Tally einsetzen.

## Core Value

Wenn vMix einen Input live schaltet, leuchtet an genau der richtigen Blackmagic-Kamera das rote Tally — zuverlässig und mit unter 100 ms Verzögerung. Das ist die eine Funktion, die im Live-Betrieb stimmen muss.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Server verbindet sich mit vMix über die TCP-API und empfängt Tally-Zustandsänderungen (Live/Preview) in Echtzeit
- [ ] Server verbindet sich mit dem ATEM über dessen Netzwerk-Protokoll und kann Program-/Preview-Bus setzen
- [ ] Konfigurierbares Mapping vMix-Input → ATEM-Eingang/Kamera (Kern-„Misch"-Funktion)
- [ ] Bei vMix-Live spiegelt der Server den Zustand auf den ATEM-Program-Bus → rotes SDI-Tally an der Kamera
- [ ] Bei vMix-Preview spiegelt der Server den Zustand auf den ATEM-Preview-Bus → grünes SDI-Tally an der Kamera
- [ ] Weboberfläche: Mapping-Konfiguration (vMix-Input ↔ ATEM-Eingang)
- [ ] Weboberfläche: Echtzeit-Live-Status (welche Kamera ist gerade rot/grün)
- [ ] Weboberfläche: Verbindungs-Setup für vMix- und ATEM-IP/Port inkl. Verbindungsstatus
- [ ] Weboberfläche: manueller Tally-Override für einzelne Kameras (z. B. zum Testen)
- [ ] Unterstützung für bis zu 8 Kameras / vMix-Inputs
- [ ] Auto-Reconnect bei Verbindungsabbruch zu vMix oder ATEM
- [ ] Reaktionszeit von vMix-Schaltung bis ATEM-Tally unter 100 ms

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Overlay-/PiP-/Multiview-Tally-Logik (mehrere gleichzeitig live geschaltete Quellen) — bewusst vereinfacht: nur der Haupt-PGM-Eingang bekommt Tally; Overlay-Logik wäre eine spätere Erweiterung
- Eigene ESP32/W5500-Hardware-Tally-Lampen — verworfen zugunsten des nativen SDI-Tally-Wegs über den ATEM; keine Zusatz-Hardware an den Kameras nötig
- vMix als per Server gesteuerter Mischer — vMix wird nur gelesen, nicht ferngesteuert; Switching macht weiter der Operator in vMix
- Nutzung des ATEM-Videoausgangs als Sendesignal — der ATEM wird ausschließlich als Tally-Verteiler genutzt; das echte Programm liefert vMix

## Context

- **Setup-Kette:** vMix (Switching) → PGM-Signal → ATEM (nur Tally-Verteiler) → SDI-Rückkanal → Blackmagic-Kameras. Blackmagic-Kameras lesen Tally nativ aus dem SDI-Rückkanal.
- **Technische Realität ATEM-Tally:** Ein ATEM erzeugt Tally aus seinem Program-/Preview-Bus. Damit eine Kamera über SDI rotes Tally bekommt, muss der Server den passenden ATEM-Eingang auf Program (rot) bzw. Preview (grün) schalten. Der ATEM-Videoausgang spielt dabei keine Rolle — er dient nur der Tally-Einspeisung.
- **vMix-API:** vMix bietet eine TCP-API (Port 8099, Push von Tally-Änderungen, latenzarm) und eine HTTP/XML-API (Port 8088, Polling). Für <100 ms ist die TCP-API mit Tally-Subscription der bevorzugte Weg.
- **ATEM-Steuerung:** Blackmagic ATEM-Mischer werden über ein eigenes Ethernet-Protokoll gesteuert; im Node.js-Ökosystem existiert die etablierte Library `atem-connection`.
- **Umgebungs-Notiz:** In der Entwicklungsumgebung liegt das ESP-IDF-Framework mit W5500-Ethernet-Treiber. Eigene ESP32-Tally-Hardware ist aktuell aber explizit Out of Scope (siehe oben) — der Tally-Weg läuft über den ATEM.

## Constraints

- **Tech stack**: Node.js-Server mit Weboberfläche — plattformübergreifend, etablierte Libraries für ATEM (`atem-connection`) und Echtzeit-UI (WebSocket)
- **Performance**: Ende-zu-Ende-Reaktion (vMix-Schaltung → ATEM-Tally) unter 100 ms — Live-Produktionsanforderung
- **Reliability**: Auto-Reconnect bei Verbindungsabbruch zu vMix oder ATEM; der Server wird live in Produktion eingesetzt
- **Compatibility**: vMix TCP/HTTP-API; Blackmagic ATEM Ethernet-Protokoll; Blackmagic-Kameras mit SDI-Tally aus dem Rückkanal
- **Scale**: bis zu 8 Kameras / vMix-Inputs

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tally-Weg über ATEM-SDI statt eigener ESP32-Hardware | Blackmagic-Kameras lesen Tally nativ aus dem SDI-Rückkanal; keine Zusatz-Hardware an Kameras nötig | — Pending |
| Server steuert ATEM-Program/Preview-Bus aktiv mit | Einzige Möglichkeit, per-Kamera-Tally über SDI zu erzeugen; ATEM leitet Tally aus seinen Bussen ab | — Pending |
| vMix-Zustand über TCP-API (Push) statt HTTP-Polling | Latenzarm, erfüllt <100 ms-Anforderung | — Pending |
| Node.js als Server-Plattform | Reife Libraries (`atem-connection`), WebSocket-UI, plattformübergreifend | — Pending |
| Nur Haupt-PGM-Tally, kein Overlay/PiP | Hält v1 einfach; Overlay-Logik als spätere Erweiterung | — Pending |
| Rot + Grün (Live + Preview) Tally | Vollständige Tally-Abbildung wie vom Operator erwartet | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-29 after initialization*
