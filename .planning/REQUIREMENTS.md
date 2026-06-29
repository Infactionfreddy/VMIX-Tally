# Requirements: vMix → ATEM Tally-Bridge

**Defined:** 2026-06-29
**Core Value:** Wenn vMix einen Input live schaltet, leuchtet an genau der richtigen Blackmagic-Kamera das rote Tally — zuverlässig und mit unter 100 ms Verzögerung.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### vMix Integration

- [ ] **VMIX-01**: Server verbindet sich mit vMix über die TCP-API (Port 8099) mit konfigurierbarem Host/Port
- [ ] **VMIX-02**: Server abonniert vMix-Tally und empfängt Live-/Preview-Zustandsänderungen in Echtzeit (Push)
- [ ] **VMIX-03**: Server löst jede Tally-Position auf eine stabile vMix-Input-Identität (Number/Key) auf, nicht auf den rohen String-Offset
- [ ] **VMIX-04**: Server verbindet sich bei Verbindungsabbruch automatisch mit vMix neu (Backoff)

### ATEM Integration

- [ ] **ATEM-01**: Server verbindet sich mit einem ATEM-Mischer über dessen Ethernet-Protokoll mit konfigurierbarer IP
- [ ] **ATEM-02**: Server setzt den ATEM-Program-Bus per hartem Schnitt (instant cut), um rotes SDI-Tally zu erzeugen — niemals per Auto-/Mix-Transition
- [ ] **ATEM-03**: Server setzt den ATEM-Preview-Bus, um grünes SDI-Tally zu erzeugen
- [ ] **ATEM-04**: Server verbindet sich bei Verbindungsabbruch automatisch mit dem ATEM neu und stellt den Soll-Zustand wieder her (Resync)

### Tally Core

- [ ] **CORE-01**: Server hält ein kanonisches Soll-Tally-Zustandsmodell pro Kamera (off / program / preview)
- [ ] **CORE-02**: Server löst den finalen Tally-Zustand mit Vorrang live → mapping → manueller Override auf
- [ ] **CORE-03**: Server sendet einen ATEM-Befehl nur, wenn der Soll- vom Ist-Zustand abweicht (Single-Writer-Reconciler)
- [ ] **CORE-04**: Nur der Haupt-PGM/PVW-Eingang treibt Tally — Overlay-/PiP-Zustände werden ignoriert

### Mapping & Config

- [ ] **MAP-01**: Nutzer kann jeden vMix-Input einem ATEM-Eingang/einer Kamera zuordnen (bis zu 8)
- [ ] **CFG-01**: vMix-/ATEM-Verbindungseinstellungen (IP/Port) bleiben über Server-Neustarts erhalten
- [ ] **CFG-02**: Die Input-Zuordnung bleibt über Server-Neustarts erhalten

### Verification

- [ ] **VERIFY-01**: Nutzer kann einen Walk-Test pro Eingang ausführen, der das Tally nacheinander an jede zugeordnete Kamera schaltet, um die Kette vMix→ATEM→Kamera-ID zu verifizieren

### Web UI

- [ ] **UI-01**: Nutzer kann vMix- und ATEM-Verbindungseinstellungen (IP/Port) in der Weboberfläche konfigurieren
- [ ] **UI-02**: Nutzer sieht den Echtzeit-Verbindungsstatus/-Health für vMix und ATEM
- [ ] **UI-03**: Nutzer sieht ein Echtzeit-Dashboard, welche Kamera gerade rot/grün ist
- [ ] **UI-04**: Nutzer kann das Tally für eine einzelne Kamera manuell forcieren (sticky, visuell abgesetzt, wieder lösbar)
- [ ] **UI-05**: Nutzer sieht einen Latenz-/Aktualitäts-Indikator für die Tally-Pipeline

### Reliability

- [ ] **REL-01**: Die Tally-Reaktion von vMix-Schaltung bis ATEM-Befehl bleibt unter 100 ms

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Erweiterte Tally-Logik

- **OVL-01**: Overlay-/PiP-/Multiview-Tally (mehrere gleichzeitig live geschaltete Quellen abbilden)
- **MULTI-01**: Mehrere ATEM-/vMix-Endpunkte gleichzeitig verwalten

### Betrieb

- **OPS-01**: Aktivitäts-/Ereignis-Log der Tally-Wechsel
- **OPS-02**: Mapping-Konfiguration importieren/exportieren
- **PKG-01**: Als Windows-Dienst paketieren (NSSM) für Auto-Start/Auto-Restart

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Eigene ESP32/W5500-Hardware-Tally-Lampen | Tally läuft nativ über ATEM-SDI; keine Zusatz-Hardware an den Kameras nötig |
| vMix per Server fernsteuern/switchen | vMix wird nur gelesen; Switching macht der Operator in vMix |
| ATEM-Videoausgang als Sendesignal nutzen | ATEM dient nur als Tally-Verteiler; echtes Programm liefert vMix |
| Many-Source-Tally-Arbitrierung (à la Tally Arbiter) | Bewusst single-source (vMix) / single-transport (ATEM) gehalten |
| Authentifizierung / Benutzerkonten | Co-lokales LAN-Tool im vertrauten Produktionsnetz |
| Auto-/Mix-Transitions auf dem ATEM | Würden zwei Kameras gleichzeitig rot zeigen; nur harte Schnitte |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | TBD | Pending |
| CORE-02 | TBD | Pending |
| CORE-03 | TBD | Pending |
| CORE-04 | TBD | Pending |
| CFG-01 | TBD | Pending |
| CFG-02 | TBD | Pending |
| MAP-01 | TBD | Pending |
| VMIX-01 | TBD | Pending |
| VMIX-02 | TBD | Pending |
| VMIX-03 | TBD | Pending |
| VMIX-04 | TBD | Pending |
| ATEM-01 | TBD | Pending |
| ATEM-02 | TBD | Pending |
| ATEM-03 | TBD | Pending |
| ATEM-04 | TBD | Pending |
| VERIFY-01 | TBD | Pending |
| UI-01 | TBD | Pending |
| UI-02 | TBD | Pending |
| UI-03 | TBD | Pending |
| UI-04 | TBD | Pending |
| UI-05 | TBD | Pending |
| REL-01 | TBD | Pending |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 0 (filled by roadmap)
- Unmapped: 22 ⚠️

---
*Requirements defined: 2026-06-29*
*Last updated: 2026-06-29 after initial definition*
