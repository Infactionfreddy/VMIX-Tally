#!/bin/bash
# =============================================================================
# vMix → ATEM Tally-Bridge — LXC Install / Deploy Script
# =============================================================================
#
# USAGE
# -----
#
# A) Deploy via SSH from your Mac / dev machine (empfohlen):
#    bash scripts/install-lxc.sh --remote root@192.168.1.50
#    bash scripts/install-lxc.sh --remote root@192.168.1.50 --port 2222
#
#    → rsync kopiert Projektdateien per SSH in den Container
#    → Install-Script wird automatisch remote ausgeführt
#
# B) Lokal im Container ausführen (Dateien schon vorhanden):
#    bash /opt/vmix-tally/scripts/install-lxc.sh
#
# C) Lokal im Container via Git:
#    bash install-lxc.sh --git https://github.com/USER/REPO.git
#
# UPDATE bestehende Installation (lokal im Container):
#    bash /opt/vmix-tally/scripts/install-lxc.sh
#
# =============================================================================
#
# PROXMOX LXC ERSTELLEN (auf dem Proxmox-Host):
# ----------------------------------------------
#   CTID=$(pvesh get /cluster/nextid)
#   TMPL=$(pveam list local | awk '/debian-12-standard/ {print $1}' | tail -1)
#
#   # Template herunterladen falls nicht vorhanden:
#   # pveam download local debian-12-standard_12.7-1_amd64.tar.zst
#
#   pct create $CTID $TMPL \
#     --hostname vmix-tally \
#     --memory 256 \
#     --swap 0 \
#     --rootfs local-lvm:4 \
#     --net0 name=eth0,bridge=vmbr0,ip=dhcp \
#     --unprivileged 1 \
#     --features nesting=1
#   pct start $CTID
#
#   # SSH aktivieren + Root-Login erlauben:
#   pct exec $CTID -- bash -c "
#     apt-get update -qq && apt-get install -y -qq openssh-server &&
#     sed -i 's/#PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config &&
#     systemctl enable ssh && systemctl start ssh &&
#     echo 'root:DEIN_PASSWORT' | chpasswd
#   "
#   LXC_IP=$(pct exec $CTID -- hostname -I | awk '{print $1}')
#   echo "Container ID: $CTID  —  IP: $LXC_IP"
#
#   # Dann vom Mac deployen:
#   bash scripts/install-lxc.sh --remote root@$LXC_IP
#
# =============================================================================

set -eo pipefail

# ---- Farben -----------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ OK ]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERR ]${NC}  $*"; exit 1; }
step()  { echo -e "\n${CYAN}▶ $*${NC}"; }

# ---- Argumente parsen -------------------------------------------------------
REMOTE_TARGET=""   # user@host
SSH_PORT="22"
GIT_URL=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --remote)   REMOTE_TARGET="${2:-}"; shift 2 ;;
        --port)     SSH_PORT="${2:-22}";    shift 2 ;;
        --git)      GIT_URL="${2:-}";       shift 2 ;;
        -h|--help)
            sed -n '/^# USAGE/,/^# ====/p' "$0" | grep -v '^# ====' | sed 's/^# \?//'
            exit 0 ;;
        *) error "Unbekanntes Argument: $1\nHilfe: bash install-lxc.sh --help" ;;
    esac
done

# =============================================================================
# REMOTE-MODUS: läuft auf dem Mac / Dev-Rechner
# =============================================================================
if [[ -n "$REMOTE_TARGET" ]]; then

    # Projektverzeichnis ermitteln (wo install-lxc.sh liegt)
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

    [[ -f "${PROJECT_DIR}/src/server.ts" ]] || \
        error "Projektverzeichnis nicht gefunden. Script von 'scripts/' aus aufrufen."

    command -v rsync &>/dev/null || error "rsync nicht gefunden. Installiere es zuerst."
    command -v ssh   &>/dev/null || error "ssh nicht gefunden."

    REMOTE_APP_DIR="/opt/vmix-tally"
    SSH_SOCKET="/tmp/vmix-tally-ssh-$$"

    # Basis-Optionen ohne ControlMaster (für den ersten Connect)
    SSH_BASE="-p ${SSH_PORT} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"
    # Alle weiteren Verbindungen laufen über den gemeinsamen Socket
    SSH_OPTS="${SSH_BASE} -o ControlMaster=auto -o ControlPath=${SSH_SOCKET} -o ControlPersist=120"
    RSYNC_SSH="ssh ${SSH_OPTS}"

    # Socket beim Beenden aufräumen
    cleanup() {
        ssh -O exit -o "ControlPath=${SSH_SOCKET}" "${REMOTE_TARGET}" 2>/dev/null || true
        rm -f "${SSH_SOCKET}"
    }
    trap cleanup EXIT

    echo ""
    echo -e "${BLUE}============================================================${NC}"
    echo -e "${BLUE}  vMix → ATEM Tally-Bridge  —  SSH Deploy                  ${NC}"
    echo -e "${BLUE}============================================================${NC}"
    echo -e "  Ziel:     ${CYAN}${REMOTE_TARGET}${NC}  (Port ${SSH_PORT})"
    echo -e "  Quelle:   ${PROJECT_DIR}"
    echo -e "  Remote:   ${REMOTE_APP_DIR}"
    echo ""

    # Einmalig authentifizieren — alle folgenden Befehle nutzen denselben Socket
    step "Verbindung herstellen (einmalige Passwort-Eingabe)..."
    ssh ${SSH_OPTS} -o ControlMaster=yes "${REMOTE_TARGET}" "echo ok" >/dev/null \
        || error "SSH-Verbindung zu '${REMOTE_TARGET}' fehlgeschlagen.\n  Prüfe: IP, Port, Passwort/Key, Root-Login in sshd_config."
    ok "Verbunden. Kein weiteres Passwort nötig."

    # Zielverzeichnis anlegen
    ssh ${SSH_OPTS} "${REMOTE_TARGET}" "mkdir -p '${REMOTE_APP_DIR}'"

    # Dateien synchronisieren
    step "Dateien übertragen (rsync)..."
    rsync -az --delete \
        --exclude=node_modules \
        --exclude=dist \
        --exclude=config.json \
        --exclude='.git' \
        --exclude='*.log' \
        -e "${RSYNC_SSH}" \
        "${PROJECT_DIR}/" \
        "${REMOTE_TARGET}:${REMOTE_APP_DIR}/"
    ok "Dateien übertragen."

    # Install-Script remote ausführen (ServerAliveInterval verhindert Timeout bei npm install)
    step "Install-Script remote ausführen..."
    echo ""
    ssh ${SSH_OPTS} -o ServerAliveInterval=30 -o ServerAliveCountMax=10 -t \
        "${REMOTE_TARGET}" \
        "bash '${REMOTE_APP_DIR}/scripts/install-lxc.sh'"

    echo ""
    ok "Deploy abgeschlossen."
    exit 0
fi

# =============================================================================
# LOKAL-MODUS: läuft im Container
# =============================================================================

# ---- Konfiguration ----------------------------------------------------------
APP_DIR="/opt/vmix-tally"
SERVICE_USER="vmix-tally"
SERVICE_NAME="vmix-tally"
PORT="${PORT:-3000}"
NODE_MAJOR=22

echo ""
echo -e "${BLUE}=================================================${NC}"
echo -e "${BLUE}  vMix → ATEM Tally-Bridge  —  LXC Installer   ${NC}"
echo -e "${BLUE}=================================================${NC}"
echo ""

# ---- Root-Prüfung -----------------------------------------------------------
[[ $EUID -ne 0 ]] && error "Als root ausführen: sudo bash install-lxc.sh"

# ---- Proxmox-Repos reparieren (falls vorhanden) -----------------------------
fix_proxmox_repos() {
    local changed=0

    # Enterprise-Repo deaktivieren (401 ohne Subscription-Key)
    local ent="/etc/apt/sources.list.d/pve-enterprise.list"
    if [[ -f "$ent" ]] && grep -q "^deb " "$ent" 2>/dev/null; then
        sed -i 's|^deb |#deb |g' "$ent"
        warn "Proxmox Enterprise-Repo deaktiviert (kein Subscription-Key)."
        changed=1
    fi

    # Ceph Enterprise-Repo deaktivieren
    local ceph="/etc/apt/sources.list.d/ceph.list"
    if [[ -f "$ceph" ]] && grep -q "^deb.*enterprise" "$ceph" 2>/dev/null; then
        sed -i '/enterprise/s|^deb |#deb |g' "$ceph"
        changed=1
    fi

    # proxmox.sources: Enterprise-Stanzas deaktivieren — DEB822-Format ist fragil,
    # daher die Datei komplett sichern statt einzelne Zeilen zu entfernen.
    local psrc="/etc/apt/sources.list.d/proxmox.sources"
    if [[ -f "$psrc" ]] && grep -q "enterprise.proxmox.com" "$psrc" 2>/dev/null; then
        mv "$psrc" "${psrc}.bak"
        warn "proxmox.sources Enterprise-Einträge deaktiviert (→ ${psrc}.bak)."
        changed=1
    fi

    # No-Subscription-Repo hinzufügen falls komplett leer/deaktiviert
    local nosub="/etc/apt/sources.list.d/pve-no-subscription.list"
    if [[ ! -f "$nosub" ]] && grep -rq "enterprise.proxmox.com" /etc/apt/ 2>/dev/null; then
        # Proxmox-Version und Debian-Codename ermitteln
        local codename
        codename=$(. /etc/os-release 2>/dev/null && echo "$VERSION_CODENAME" || echo "bookworm")
        echo "deb http://download.proxmox.com/debian/pve ${codename} pve-no-subscription" > "$nosub"
        info "Proxmox No-Subscription-Repo hinzugefügt."
        changed=1
    fi

    if [[ $changed -eq 1 ]]; then info "Proxmox-Repos korrigiert."; fi
    return 0
}

# ---- 1. Systempakete --------------------------------------------------------
step "[1/5] System aktualisieren..."
export DEBIAN_FRONTEND=noninteractive

# Proxmox-Repos fixen bevor apt-get update fehlschlägt
fix_proxmox_repos

# Update — Fehler von ungültigen Repos werden toleriert
apt-get update 2>&1 | grep -v "^W:" | grep -v "^N:" | grep -v "^$" | head -20 || true

# Pakete installieren — falls schon vorhanden, geschieht nichts
apt-get install -y curl ca-certificates git rsync 2>&1 | tail -5 || {
    warn "apt-get install fehlgeschlagen — prüfe ob Basispakete manuell installiert werden müssen."
    command -v curl  &>/dev/null || error "curl fehlt — bitte manuell: apt-get install curl"
    command -v git   &>/dev/null || error "git fehlt — bitte manuell: apt-get install git"
    command -v rsync &>/dev/null || error "rsync fehlt — bitte manuell: apt-get install rsync"
}
ok "Systempakete bereit."

# ---- 2. Node.js -------------------------------------------------------------
NODE_INSTALLED_MAJOR=0
if command -v node &>/dev/null; then
    NODE_INSTALLED_MAJOR=$(node --version | cut -d. -f1 | tr -d v)
fi

if [[ "$NODE_INSTALLED_MAJOR" -lt "$NODE_MAJOR" ]]; then
    step "[2/5] Node.js ${NODE_MAJOR} LTS installieren..."
    # Download erst in Datei, dann ausführen — kein Pipe+pipefail-Problem
    tmpsetup=$(mktemp)
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" -o "$tmpsetup" \
        || error "Nodesource-Download fehlgeschlagen. Prüfe Internet-Verbindung."
    bash "$tmpsetup" >/dev/null 2>&1 || true   # setup fügt Repo hinzu; Update-Fehler toleriert
    rm -f "$tmpsetup"
    apt-get install -y nodejs 2>&1 | grep -v "^Get:" | grep -v "^$" | tail -8 \
        || error "Node.js-Installation fehlgeschlagen."
    ok "Node.js $(node --version) installiert."
else
    ok "[2/5] Node.js $(node --version) bereits vorhanden."
fi

# ---- 3. Service-User --------------------------------------------------------
step "[3/5] Service-User '${SERVICE_USER}' anlegen..."
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --shell /bin/false \
            --home-dir "$APP_DIR" --no-create-home \
            "$SERVICE_USER"
    ok "User '${SERVICE_USER}' erstellt."
else
    ok "User '${SERVICE_USER}' bereits vorhanden."
fi

# ---- 4. App installieren / aktualisieren ------------------------------------
step "[4/5] App nach ${APP_DIR} installieren..."

systemctl stop "$SERVICE_NAME" 2>/dev/null || true

if [[ -n "$GIT_URL" ]]; then
    # Git clone / pull
    if [[ -d "${APP_DIR}/.git" ]]; then
        info "Git-Update..."
        git -C "$APP_DIR" fetch --quiet
        git -C "$APP_DIR" reset --hard origin/HEAD --quiet
    else
        info "Klone ${GIT_URL}..."
        git clone --quiet "$GIT_URL" "$APP_DIR"
    fi
elif [[ -f "${APP_DIR}/src/server.ts" ]]; then
    # Dateien bereits vorhanden (via SSH-Deploy oder pct push)
    ok "Dateien bereits in ${APP_DIR} vorhanden."
elif [[ -d "${APP_DIR}/.git" ]]; then
    # Erneuter Aufruf — Git-Update
    info "Git-Update..."
    git -C "$APP_DIR" pull --quiet
else
    error "Keine Quelldateien gefunden.\nEntweder: --remote user@host vom Dev-Rechner nutzen\nOder:     --git https://github.com/USER/REPO.git angeben"
fi

# config.json anlegen falls nicht vorhanden (wird bei Updates beibehalten)
if [[ ! -f "${APP_DIR}/config.json" ]]; then
    info "Standard config.json anlegen..."
    cat > "${APP_DIR}/config.json" << 'CONFIGEOF'
{
  "version": 1,
  "settings": {
    "vmix": null,
    "atem": null
  },
  "mapping": [],
  "overrides": {}
}
CONFIGEOF
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR"
ok "Dateien bereit."

# npm install + Frontend bauen
info "npm-Abhängigkeiten installieren..."
cd "$APP_DIR"
sudo -u "$SERVICE_USER" npm ci --prefer-offline --silent
ok "Abhängigkeiten installiert."

info "Frontend bauen..."
sudo -u "$SERVICE_USER" npm run build --silent
ok "Frontend gebaut."

# ---- 5. systemd-Service -----------------------------------------------------
step "[5/5] systemd-Service einrichten..."

cat > "/etc/systemd/system/${SERVICE_NAME}.service" << UNITEOF
[Unit]
Description=vMix ATEM Tally Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/node_modules/.bin/tsx ${APP_DIR}/src/server.ts
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=60s
StartLimitBurst=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE_NAME}
Environment=NODE_ENV=production
Environment=PORT=${PORT}
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNITEOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" --quiet
systemctl start "$SERVICE_NAME"

sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
    ok "Service läuft."
else
    warn "Service gestartet, prüfe Logs: journalctl -u ${SERVICE_NAME} -n 30"
fi

# ---- Fertig -----------------------------------------------------------------
LXC_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "LXC-IP")

echo ""
echo -e "${GREEN}=================================================${NC}"
echo -e "${GREEN}  Installation abgeschlossen!                   ${NC}"
echo -e "${GREEN}=================================================${NC}"
echo ""
echo -e "  Web UI:     ${CYAN}http://${LXC_IP}:${PORT}${NC}"
echo ""
echo -e "  Logs:       ${YELLOW}journalctl -u ${SERVICE_NAME} -f${NC}"
echo -e "  Status:     ${YELLOW}systemctl status ${SERVICE_NAME}${NC}"
echo -e "  Update:     ${YELLOW}bash scripts/install-lxc.sh --remote root@${LXC_IP}${NC}  (vom Mac)"
echo ""
echo "  Nächste Schritte:"
echo "  1. Web UI öffnen → vMix-IP und ATEM-IP eintragen"
echo "  2. Kamera-Mapping konfigurieren"
echo "  3. Fertig — Service startet automatisch beim Boot"
echo ""
