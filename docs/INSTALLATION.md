# Installation

[← Zurück zur README](../README.md)

## Voraussetzungen

- Node.js ≥ 22, npm
- Netzwerkzugriff auf vMix (TCP-API-Port, Standard 8099; HTTP-API 8088) und ATEM (UDP 9910)
- Für den systemd-Betrieb: Debian-basiertes System (z. B. Proxmox-LXC) mit root-Rechten

## Variante A: Manuell

```bash
git clone https://github.com/Infactionfreddy/VMIX-Tally.git
cd VMIX-Tally
npm ci
npm run build   # baut das Frontend nach dist/
npm start       # startet den Server auf Port 3000
```

Port ändern: `PORT=8080 npm start`.

## Variante B: LXC / Debian mit systemd (`scripts/install-lxc.sh`)

Das Skript installiert Node.js 22 (NodeSource), legt den Systembenutzer `vmix-tally` an, installiert nach `/opt/vmix-tally`, baut das Frontend und richtet den systemd-Dienst `vmix-tally` ein.

1. Container erstellen (Beispiel im Kopf des Skripts, Debian 12).
2. Deploy vom Entwicklungsrechner per SSH/rsync:
   ```bash
   bash scripts/install-lxc.sh --remote root@<LXC-IP>
   bash scripts/install-lxc.sh --remote root@<LXC-IP> --port 2222
   ```
3. Alternativ im Container: `bash /opt/vmix-tally/scripts/install-lxc.sh` oder `bash install-lxc.sh --git <Repo-URL>`.
4. Web-UI öffnen (`http://<IP>:3000`), vMix-/ATEM-Adresse eintragen und Mapping konfigurieren.

Nützliche Befehle:

```bash
journalctl -u vmix-tally -f
systemctl status vmix-tally
```

Das Skript `scripts/install-proxmox-lxc.sh` liegt ebenfalls im Repo; sein Inhalt wurde für diese Doku nicht ausgewertet (Annahme: Erstellung des Containers auf dem Proxmox-Host).

## Update

- Manuell: `git pull && npm ci && npm run build`, dann Dienst neu starten.
- LXC: Deploy-Befehl erneut ausführen. `config.json` wird beim rsync ausgeschlossen und bleibt erhalten.

## Deinstallation

```bash
systemctl disable --now vmix-tally
rm /etc/systemd/system/vmix-tally.service
systemctl daemon-reload
rm -rf /opt/vmix-tally
userdel vmix-tally
```

Node.js wird dabei nicht entfernt.