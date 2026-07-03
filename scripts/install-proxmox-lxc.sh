#!/bin/bash
# =============================================================================
# vMix → ATEM Tally-Bridge — Proxmox LXC Installer
# =============================================================================
#
# Läuft auf dem PROXMOX HOST und erstellt einen Debian 12 LXC Container.
#
# USAGE:
#   # Vom Mac deployen (empfohlen) — rsync + Install in einem Schritt:
#   bash scripts/install-proxmox-lxc.sh --remote root@10.30.0.3
#   bash scripts/install-proxmox-lxc.sh --remote root@10.30.0.3 --port 2222
#
#   # Mit Git statt lokalem rsync:
#   bash scripts/install-proxmox-lxc.sh --remote root@10.30.0.3 --git https://...
#
#   # Container-ID und IP manuell setzen (Umgebungsvariablen):
#   TALLY_CT_ID=150 TALLY_CT_IP="10.40.0.50/24" TALLY_CT_GW="10.40.0.1" \
#     bash scripts/install-proxmox-lxc.sh --remote root@10.30.0.3
#
#   # Direkt auf dem Proxmox-Host ausführen (Dateien schon vorhanden):
#   bash /opt/vmix-tally/scripts/install-proxmox-lxc.sh --from /opt/vmix-tally
#
# =============================================================================

set -eo pipefail

# ---- Farben & Hilfsfunktionen (vor Argparsing — remote-Modus braucht sie) ---
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

LOG_FILE="/tmp/tally-proxmox-install-$(date +%Y%m%d-%H%M%S).log"

log()     { echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
success() { echo -e "${GREEN}✓ $*${NC}" | tee -a "$LOG_FILE"; }
error()   { echo -e "${RED}✗ $*${NC}" | tee -a "$LOG_FILE"; exit 1; }
info()    { echo -e "${BLUE}ℹ $*${NC}" | tee -a "$LOG_FILE"; }
warning() { echo -e "${YELLOW}⚠ $*${NC}" | tee -a "$LOG_FILE"; }
step()    { echo -e "\n${CYAN}━━━ $* ━━━${NC}" | tee -a "$LOG_FILE"; }
ok()      { echo -e "${GREEN}[ OK ]${NC}  $*"; }

# ---- Argumente parsen -------------------------------------------------------
REMOTE_TARGET=""
SSH_PORT="22"
GIT_URL=""
HOST_SOURCE_DIR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --remote)   REMOTE_TARGET="${2:-}"; shift 2 ;;
        --port)     SSH_PORT="${2:-22}";    shift 2 ;;
        --git)      GIT_URL="${2:-}";       shift 2 ;;
        --from)     HOST_SOURCE_DIR="${2:-}"; shift 2 ;;
        -h|--help)
            sed -n '/^# USAGE/,/^# ====/p' "$0" | grep -v '^# ====' | sed 's/^# \?//'
            exit 0 ;;
        *) echo "Unbekanntes Argument: $1" >&2; exit 1 ;;
    esac
done

# =============================================================================
# REMOTE-MODUS: läuft auf dem Mac / Dev-Rechner
# =============================================================================
if [[ -n "$REMOTE_TARGET" ]]; then

    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

    [[ -f "${PROJECT_DIR}/src/server.ts" ]] || \
        error "Projektverzeichnis nicht gefunden. Script von 'scripts/' aus aufrufen."

    command -v rsync &>/dev/null || error "rsync nicht gefunden. Bitte installieren."
    command -v ssh   &>/dev/null || error "ssh nicht gefunden."

    REMOTE_APP_DIR="/opt/vmix-tally"
    SSH_SOCKET="/tmp/tally-proxmox-ssh-$$"
    SSH_BASE="-p ${SSH_PORT} -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15"
    SSH_OPTS="${SSH_BASE} -o ControlMaster=auto -o ControlPath=${SSH_SOCKET} -o ControlPersist=120"
    RSYNC_SSH="ssh ${SSH_OPTS}"

    cleanup() {
        ssh -O exit -o "ControlPath=${SSH_SOCKET}" "${REMOTE_TARGET}" 2>/dev/null || true
        rm -f "${SSH_SOCKET}"
    }
    trap cleanup EXIT

    echo ""
    echo -e "${BLUE}============================================================${NC}"
    echo -e "${BLUE}  vMix → ATEM Tally-Bridge  —  Proxmox LXC Deploy         ${NC}"
    echo -e "${BLUE}============================================================${NC}"
    echo -e "  Proxmox-Host: ${CYAN}${REMOTE_TARGET}${NC}  (Port ${SSH_PORT})"
    echo -e "  Quelle:       ${PROJECT_DIR}"
    echo ""

    step "Verbindung herstellen (einmalige Passwort-Eingabe)..."
    ssh ${SSH_OPTS} -o ControlMaster=yes "${REMOTE_TARGET}" "echo ok" >/dev/null \
        || error "SSH-Verbindung zu '${REMOTE_TARGET}' fehlgeschlagen.\n  Prüfe: IP, Port, Root-Login in sshd_config."
    ok "Verbunden. Kein weiteres Passwort nötig."

    if [[ -z "$GIT_URL" ]]; then
        # Dateien per rsync übertragen
        ssh ${SSH_OPTS} "${REMOTE_TARGET}" "mkdir -p '${REMOTE_APP_DIR}'"

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

        REMOTE_INSTALL_ARGS="--from '${REMOTE_APP_DIR}'"
    else
        REMOTE_INSTALL_ARGS="--git '${GIT_URL}'"
    fi

    # Umgebungsvariablen für den Remote-Aufruf weitergeben
    REMOTE_ENV=""
    [[ -n "${TALLY_CT_ID:-}"       ]] && REMOTE_ENV+="TALLY_CT_ID='${TALLY_CT_ID}' "
    [[ -n "${TALLY_CT_IP:-}"       ]] && REMOTE_ENV+="TALLY_CT_IP='${TALLY_CT_IP}' "
    [[ -n "${TALLY_CT_GW:-}"       ]] && REMOTE_ENV+="TALLY_CT_GW='${TALLY_CT_GW}' "
    [[ -n "${TALLY_CT_HOSTNAME:-}" ]] && REMOTE_ENV+="TALLY_CT_HOSTNAME='${TALLY_CT_HOSTNAME}' "
    [[ -n "${TALLY_PORT:-}"        ]] && REMOTE_ENV+="TALLY_PORT='${TALLY_PORT}' "
    [[ -n "${TALLY_CT_MEMORY:-}"   ]] && REMOTE_ENV+="TALLY_CT_MEMORY='${TALLY_CT_MEMORY}' "
    [[ -n "${TALLY_CT_STORAGE:-}"  ]] && REMOTE_ENV+="TALLY_CT_STORAGE='${TALLY_CT_STORAGE}' "

    step "Proxmox LXC Install-Script auf dem Host ausführen..."
    echo ""
    ssh ${SSH_OPTS} -o ServerAliveInterval=30 -o ServerAliveCountMax=10 -t \
        "${REMOTE_TARGET}" \
        "${REMOTE_ENV}bash '${REMOTE_APP_DIR}/scripts/install-proxmox-lxc.sh' ${REMOTE_INSTALL_ARGS}"

    echo ""
    ok "Deploy abgeschlossen."
    exit 0
fi

# ---- Konfiguration (via Umgebungsvariablen überschreibbar) ------------------
CT_ID="${TALLY_CT_ID:-}"
CT_HOSTNAME="${TALLY_CT_HOSTNAME:-vmix-tally}"
CT_STORAGE="${TALLY_CT_STORAGE:-}"
CT_TEMPLATE_STORAGE="${TALLY_CT_TEMPLATE_STORAGE:-}"
CT_MEMORY="${TALLY_CT_MEMORY:-512}"
CT_SWAP="${TALLY_CT_SWAP:-0}"
CT_DISK_SIZE="${TALLY_CT_DISK_SIZE:-4}"
CT_CORES="${TALLY_CT_CORES:-1}"
CT_BRIDGE="${TALLY_CT_BRIDGE:-vmbr0}"
CT_IP="${TALLY_CT_IP:-dhcp}"
CT_GW="${TALLY_CT_GW:-}"
CT_UNPRIVILEGED="${TALLY_CT_UNPRIVILEGED:-1}"
CT_ROOT_PASSWORD="${TALLY_CT_ROOT_PASSWORD:-}"

APP_DIR="/opt/vmix-tally"
SERVICE_USER="vmix-tally"
SERVICE_NAME="vmix-tally"
PORT="${TALLY_PORT:-3000}"
NODE_MAJOR=22

print_banner() {
    echo -e "${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                                                           ║"
    echo "║   vMix → ATEM Tally-Bridge — Proxmox LXC Installer      ║"
    echo "║   Debian 12 Container Setup                              ║"
    echo "║                                                           ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# =============================================================================
# Proxmox Host prüfen + freie CT-ID ermitteln
# =============================================================================

check_proxmox_host() {
    step "Proxmox Host prüfen"

    if ! command -v pct &>/dev/null; then
        error "pct nicht gefunden – Script muss auf dem Proxmox HOST ausgeführt werden!\nPer SSH mit Proxmox-Host verbinden, dann Script dort ausführen."
    fi
    success "Proxmox Host erkannt (pct verfügbar)"

    if [ -z "$CT_ID" ]; then
        info "Ermittle nächste freie Container-ID via /cluster/nextid..."
        CT_ID=$(pvesh get /cluster/nextid 2>/dev/null | tr -d '[:space:]"')
        if [[ ! "$CT_ID" =~ ^[0-9]+$ ]]; then
            error "Konnte keine freie ID ermitteln (pvesh /cluster/nextid fehlgeschlagen)"
        fi
        success "Nächste freie Container-ID: $CT_ID"
    else
        NEXT_FREE=$(pvesh get /cluster/nextid 2>/dev/null | tr -d '[:space:]"')
        if pct status "$CT_ID" &>/dev/null || qm status "$CT_ID" &>/dev/null; then
            error "Container ID $CT_ID existiert bereits!\n  Nächste freie ID: $NEXT_FREE\n  Setzen mit: TALLY_CT_ID=$NEXT_FREE bash $0 ..."
        fi
        success "Container ID $CT_ID ist verfügbar"
    fi
}

# =============================================================================
# Storage automatisch erkennen oder interaktiv auswählen
# =============================================================================

select_storage() {
    step "Storage auswählen"

    # --- Container-Disk Storage ---
    if [ -n "$CT_STORAGE" ]; then
        if pvesm status --content rootdir 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$CT_STORAGE"; then
            success "Container-Storage (Env): $CT_STORAGE"
        else
            warning "Storage '$CT_STORAGE' nicht verfügbar – auto-detect..."
            CT_STORAGE=""
        fi
    fi

    if [ -z "$CT_STORAGE" ]; then
        mapfile -t DISK_STORAGES < <(
            pvesm status --content rootdir 2>/dev/null \
            | awk 'NR>1 && $3=="active" {print $1}' \
            | sort
        )

        if [ "${#DISK_STORAGES[@]}" -eq 0 ]; then
            error "Kein aktiver Storage mit rootdir-Unterstützung gefunden!\nVerfügbare Storages prüfen: pvesm status"
        elif [ "${#DISK_STORAGES[@]}" -eq 1 ]; then
            CT_STORAGE="${DISK_STORAGES[0]}"
            success "Container-Storage (auto): $CT_STORAGE"
        else
            echo ""
            echo -e "${CYAN}Verfügbare Storages für Container-Disk:${NC}"
            for i in "${!DISK_STORAGES[@]}"; do
                echo -e "  ${YELLOW}$((i+1))${NC}) ${DISK_STORAGES[$i]}"
            done
            echo ""
            while true; do
                read -r -p "Storage auswählen [1-${#DISK_STORAGES[@]}]: " CHOICE
                if [[ "$CHOICE" =~ ^[0-9]+$ ]] && \
                   [ "$CHOICE" -ge 1 ] && [ "$CHOICE" -le "${#DISK_STORAGES[@]}" ]; then
                    CT_STORAGE="${DISK_STORAGES[$((CHOICE-1))]}"
                    break
                fi
                warning "Ungültige Auswahl – bitte Zahl zwischen 1 und ${#DISK_STORAGES[@]} eingeben"
            done
            success "Container-Storage gewählt: $CT_STORAGE"
        fi
    fi

    # --- Template Storage ---
    if [ -n "$CT_TEMPLATE_STORAGE" ]; then
        if pvesm status --content vztmpl 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$CT_TEMPLATE_STORAGE"; then
            success "Template-Storage (Env): $CT_TEMPLATE_STORAGE"
        else
            warning "Template-Storage '$CT_TEMPLATE_STORAGE' nicht verfügbar – auto-detect..."
            CT_TEMPLATE_STORAGE=""
        fi
    fi

    if [ -z "$CT_TEMPLATE_STORAGE" ]; then
        mapfile -t TMPL_STORAGES < <(
            pvesm status --content vztmpl 2>/dev/null \
            | awk 'NR>1 && $3=="active" {print $1}' \
            | sort
        )

        if [ "${#TMPL_STORAGES[@]}" -eq 0 ]; then
            CT_TEMPLATE_STORAGE=$(pvesm status 2>/dev/null | awk 'NR>1 && $3=="active" {print $1; exit}')
            warning "Kein Template-Storage gefunden – Fallback: $CT_TEMPLATE_STORAGE"
        elif [ "${#TMPL_STORAGES[@]}" -eq 1 ]; then
            CT_TEMPLATE_STORAGE="${TMPL_STORAGES[0]}"
            success "Template-Storage (auto): $CT_TEMPLATE_STORAGE"
        else
            echo ""
            echo -e "${CYAN}Verfügbare Storages für Templates:${NC}"
            for i in "${!TMPL_STORAGES[@]}"; do
                echo -e "  ${YELLOW}$((i+1))${NC}) ${TMPL_STORAGES[$i]}"
            done
            echo ""
            while true; do
                read -r -p "Template-Storage auswählen [1-${#TMPL_STORAGES[@]}]: " CHOICE
                if [[ "$CHOICE" =~ ^[0-9]+$ ]] && \
                   [ "$CHOICE" -ge 1 ] && [ "$CHOICE" -le "${#TMPL_STORAGES[@]}" ]; then
                    CT_TEMPLATE_STORAGE="${TMPL_STORAGES[$((CHOICE-1))]}"
                    break
                fi
                warning "Ungültige Auswahl"
            done
            success "Template-Storage gewählt: $CT_TEMPLATE_STORAGE"
        fi
    fi

    log "CT_STORAGE=$CT_STORAGE | CT_TEMPLATE_STORAGE=$CT_TEMPLATE_STORAGE"
}

# =============================================================================
# Debian 12 Template herunterladen / auffinden
# =============================================================================

get_debian_template() {
    step "Debian 12 Template"

    TEMPLATE=$(pvesm list "$CT_TEMPLATE_STORAGE" --content vztmpl 2>/dev/null \
        | grep -i "debian-12" | tail -1 | awk '{print $1}' || true)

    if [ -z "$TEMPLATE" ]; then
        info "Kein Debian 12 Template lokal – wird heruntergeladen..."
        pveam update 2>/dev/null || warning "pveam update fehlgeschlagen"

        TMPL_NAME=$(pveam available --section system 2>/dev/null \
            | grep -i "debian-12" | sort -V | tail -1 | awk '{print $2}' || true)

        if [ -z "$TMPL_NAME" ]; then
            error "Kein Debian 12 Template gefunden!\nManuell: pveam download $CT_TEMPLATE_STORAGE debian-12-standard_12.x_amd64.tar.zst"
        fi

        info "Lade Template herunter: $TMPL_NAME"
        pveam download "$CT_TEMPLATE_STORAGE" "$TMPL_NAME"
        success "Template heruntergeladen: $TMPL_NAME"
        TEMPLATE="${CT_TEMPLATE_STORAGE}:vztmpl/${TMPL_NAME}"
    else
        success "Template gefunden: $TEMPLATE"
    fi

    export DEBIAN_TEMPLATE="$TEMPLATE"
}

# =============================================================================
# LXC Container erstellen und starten
# =============================================================================

create_container() {
    step "LXC Container erstellen (ID: $CT_ID)"

    if [ -z "$CT_ROOT_PASSWORD" ]; then
        CT_ROOT_PASSWORD=$(openssl rand -base64 16 | tr -dc 'A-Za-z0-9' | head -c 16)
        echo ""
        echo -e "${YELLOW}  Root-Passwort automatisch generiert: ${RED}${CT_ROOT_PASSWORD}${NC}"
        echo -e "${YELLOW}  Notiere dieses Passwort – nur einmalig angezeigt!${NC}"
        echo ""
    fi

    if [ "$CT_IP" = "dhcp" ]; then
        NET_CONFIG="name=eth0,bridge=${CT_BRIDGE},ip=dhcp"
    else
        [ -z "$CT_GW" ] && error "Bei statischer IP TALLY_CT_GW (Gateway) setzen!\nBeispiel: TALLY_CT_GW=\"10.40.0.1\""
        NET_CONFIG="name=eth0,bridge=${CT_BRIDGE},ip=${CT_IP},gw=${CT_GW}"
    fi

    pct create "$CT_ID" "$DEBIAN_TEMPLATE" \
        --hostname     "$CT_HOSTNAME" \
        --memory       "$CT_MEMORY" \
        --swap         "$CT_SWAP" \
        --cores        "$CT_CORES" \
        --rootfs       "${CT_STORAGE}:${CT_DISK_SIZE}" \
        --net0         "$NET_CONFIG" \
        --unprivileged "$CT_UNPRIVILEGED" \
        --features     nesting=0 \
        --password     "$CT_ROOT_PASSWORD" \
        --ostype       debian \
        --start        0

    success "Container $CT_ID erstellt"

    info "Starte Container..."
    pct start "$CT_ID"

    info "Warte auf Container-Boot..."
    local retries=0
    while ! pct exec "$CT_ID" -- test -f /etc/debian_version 2>/dev/null; do
        sleep 2
        retries=$((retries + 1))
        if [ "$retries" -ge 30 ]; then
            error "Container startet nicht (Timeout 60s)\nStatus prüfen: pct status $CT_ID"
        fi
    done
    success "Container $CT_ID läuft"
}

# =============================================================================
# Basis-System konfigurieren
# =============================================================================

configure_base_system() {
    step "Basis-System konfigurieren"

    pct exec "$CT_ID" -- bash -c "
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq 2>&1 | grep -v '^W:' | head -5 || true
        apt-get install -y -qq curl ca-certificates git rsync openssl sudo
    " 2>&1 | tee -a "$LOG_FILE"

    success "Basispakete installiert"
}

# =============================================================================
# Node.js installieren
# =============================================================================

install_nodejs() {
    step "Node.js ${NODE_MAJOR} LTS installieren"

    pct exec "$CT_ID" -- bash -c "
        export DEBIAN_FRONTEND=noninteractive
        tmpsetup=\$(mktemp)
        curl -fsSL 'https://deb.nodesource.com/setup_${NODE_MAJOR}.x' -o \"\$tmpsetup\" \
            || { echo 'Nodesource-Download fehlgeschlagen'; exit 1; }
        bash \"\$tmpsetup\" >/dev/null 2>&1 || true
        rm -f \"\$tmpsetup\"
        apt-get install -y -qq nodejs
    " 2>&1 | tee -a "$LOG_FILE"

    local node_ver
    node_ver=$(pct exec "$CT_ID" -- node --version 2>/dev/null || echo "?")
    success "Node.js installiert: ${node_ver}"
}

# =============================================================================
# Service-User anlegen
# =============================================================================

create_service_user() {
    step "Service-User '${SERVICE_USER}' anlegen"

    pct exec "$CT_ID" -- bash -c "
        id '${SERVICE_USER}' &>/dev/null && echo 'Benutzer existiert bereits' || \
            useradd --system --shell /bin/false \
                    --home-dir '${APP_DIR}' \
                    --no-create-home \
                    '${SERVICE_USER}'
    "
    success "Service-User '${SERVICE_USER}' bereit"
}

# =============================================================================
# App installieren
# =============================================================================

install_app() {
    step "vMix Tally-Bridge installieren"

    if [ -n "$GIT_URL" ]; then
        # --- Git clone im Container ---
        pct exec "$CT_ID" -- bash -c "
            set -e
            export GIT_TERMINAL_PROMPT=0
            if [ -d '${APP_DIR}/.git' ]; then
                echo 'Repository vorhanden – aktualisiere...'
                git -C '${APP_DIR}' pull --quiet
            else
                echo 'Klone Repository...'
                git clone --quiet '${GIT_URL}' '${APP_DIR}'
            fi
        " 2>&1 | tee -a "$LOG_FILE"

    elif [ -n "$HOST_SOURCE_DIR" ]; then
        # --- Dateien vom Proxmox-Host per tar + pct push übertragen ---
        [ -f "${HOST_SOURCE_DIR}/src/server.ts" ] || \
            error "Quelldateien nicht gefunden in: ${HOST_SOURCE_DIR}\nErwartet: ${HOST_SOURCE_DIR}/src/server.ts"

        info "Paketiere Dateien von ${HOST_SOURCE_DIR}..."
        tar -czf /tmp/tally-app.tar.gz \
            --exclude='node_modules' \
            --exclude='dist' \
            --exclude='.git' \
            --exclude='config.json' \
            --exclude='*.log' \
            -C "$HOST_SOURCE_DIR" .
        info "Übertrage Archiv in Container..."
        pct exec "$CT_ID" -- mkdir -p "$APP_DIR"
        pct push "$CT_ID" /tmp/tally-app.tar.gz /tmp/tally-app.tar.gz
        pct exec "$CT_ID" -- bash -c "
            tar -xzf /tmp/tally-app.tar.gz -C '${APP_DIR}'
            rm -f /tmp/tally-app.tar.gz
            echo 'Dateien extrahiert.'
        "
        rm -f /tmp/tally-app.tar.gz
    fi

    # config.json anlegen falls nicht vorhanden
    pct exec "$CT_ID" -- bash -c "
        if [ ! -f '${APP_DIR}/config.json' ]; then
            cat > '${APP_DIR}/config.json' << 'CFGEOF'
{
  \"version\": 1,
  \"settings\": { \"vmix\": null, \"atem\": null },
  \"mapping\": [],
  \"overrides\": {}
}
CFGEOF
            echo 'config.json angelegt.'
        fi
    "

    pct exec "$CT_ID" -- chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR"
    success "Dateien in ${APP_DIR} bereit"

    # npm ci
    info "NPM-Abhängigkeiten installieren (kann 1-2 Min. dauern)..."
    pct exec "$CT_ID" -- bash -c "
        cd '${APP_DIR}'
        sudo -u '${SERVICE_USER}' npm ci --prefer-offline --quiet
    " 2>&1 | tee -a "$LOG_FILE"

    # Frontend bauen
    info "Frontend bauen (vite build)..."
    pct exec "$CT_ID" -- bash -c "
        cd '${APP_DIR}'
        sudo -u '${SERVICE_USER}' npm run build --silent
    " 2>&1 | tee -a "$LOG_FILE"

    success "App installiert"
}

# =============================================================================
# systemd Service einrichten
# =============================================================================

setup_systemd() {
    step "systemd Service einrichten"

    # TSX-Pfad im Container ermitteln
    local tsx_bin
    tsx_bin=$(pct exec "$CT_ID" -- bash -c \
        "ls '${APP_DIR}/node_modules/.bin/tsx' 2>/dev/null || echo '${APP_DIR}/node_modules/.bin/tsx'" \
        2>/dev/null | tr -d '[:space:]')
    info "TSX-Pfad: ${tsx_bin}"

    # Unit-File auf dem HOST erstellen, dann per pct push einspielen
    local tmp_unit
    tmp_unit=$(mktemp)
    cat > "$tmp_unit" << UNITEOF
[Unit]
Description=vMix ATEM Tally Bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${tsx_bin} ${APP_DIR}/src/server.ts
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

    pct push "$CT_ID" "$tmp_unit" "/etc/systemd/system/${SERVICE_NAME}.service"
    rm -f "$tmp_unit"

    pct exec "$CT_ID" -- bash -c "
        systemctl daemon-reload
        systemctl enable '${SERVICE_NAME}' --quiet
        echo 'systemd Service aktiviert'
    " 2>&1 | tee -a "$LOG_FILE"

    success "systemd Service '${SERVICE_NAME}' eingerichtet und aktiviert"
}

# =============================================================================
# logrotate konfigurieren
# =============================================================================

setup_logrotate() {
    step "Log-Rotation konfigurieren"

    pct exec "$CT_ID" -- bash -c "
        cat > /etc/logrotate.d/vmix-tally << 'LREOF'
/var/log/vmix-tally*.log {
    weekly
    missingok
    rotate 8
    compress
    delaycompress
    notifempty
}
LREOF
    "
    success "Log-Rotation eingerichtet (wöchentlich, 8 Wochen)"
}

# =============================================================================
# Installation validieren
# =============================================================================

validate_installation() {
    step "Installation validieren"

    local failed=0
    local files=(
        "${APP_DIR}/src/server.ts"
        "${APP_DIR}/package.json"
        "${APP_DIR}/config.json"
        "${APP_DIR}/node_modules"
        "${APP_DIR}/dist/index.html"
    )

    for f in "${files[@]}"; do
        if pct exec "$CT_ID" -- test -e "$f" 2>/dev/null; then
            info "  OK: $f"
        else
            warning "  FEHLT: $f"
            failed=$((failed + 1))
        fi
    done

    if [ "$failed" -gt 0 ]; then
        warning "$failed Datei(en) fehlen – Installation möglicherweise unvollständig"
    else
        success "Alle benötigten Dateien vorhanden"
    fi
}

# =============================================================================
# Service starten
# =============================================================================

start_server() {
    step "Service starten"

    pct exec "$CT_ID" -- systemctl start "$SERVICE_NAME" 2>&1 | tee -a "$LOG_FILE" || \
        warning "systemctl start fehlgeschlagen – Logs prüfen"

    sleep 3

    if pct exec "$CT_ID" -- systemctl is-active --quiet "$SERVICE_NAME"; then
        success "Service '${SERVICE_NAME}' läuft"
    else
        warning "Service scheint nicht zu laufen. Logs:"
        pct exec "$CT_ID" -- journalctl -u "$SERVICE_NAME" -n 20 --no-pager 2>/dev/null \
            | tee -a "$LOG_FILE" || true
    fi
}

# =============================================================================
# Container-IP ermitteln
# =============================================================================

get_container_ip() {
    local ip
    ip=$(pct exec "$CT_ID" -- bash -c \
        "ip -4 addr show eth0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1" \
        2>/dev/null || true)
    echo "${ip:-<unbekannt — 'pct exec $CT_ID -- ip a' ausführen>}"
}

# =============================================================================
# Zusammenfassung
# =============================================================================

print_summary() {
    local ip
    ip=$(get_container_ip)

    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                           ║${NC}"
    echo -e "${GREEN}║   vMix Tally-Bridge — LXC Installation abgeschlossen! ✓ ║${NC}"
    echo -e "${GREEN}║                                                           ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}Container-Info:${NC}"
    echo -e "  ID:            ${CYAN}${CT_ID}${NC}"
    echo -e "  Hostname:      ${CYAN}${CT_HOSTNAME}${NC}"
    echo -e "  IP-Adresse:    ${CYAN}${ip}${NC}"
    echo -e "  Root-Passwort: ${YELLOW}${CT_ROOT_PASSWORD}${NC}"
    echo ""
    echo -e "${BLUE}Tally-Bridge Web UI:${NC}"
    echo -e "  ${YELLOW}http://${ip}:${PORT}${NC}"
    echo ""
    echo -e "${BLUE}Container verwalten (Proxmox HOST):${NC}"
    echo -e "  Shell:     ${YELLOW}pct exec $CT_ID -- bash${NC}"
    echo -e "  Stoppen:   ${YELLOW}pct stop $CT_ID${NC}"
    echo -e "  Starten:   ${YELLOW}pct start $CT_ID${NC}"
    echo -e "  Konsole:   ${YELLOW}pct console $CT_ID${NC}"
    echo ""
    echo -e "${BLUE}Service-Verwaltung:${NC}"
    echo -e "  Status:    ${YELLOW}pct exec $CT_ID -- systemctl status ${SERVICE_NAME}${NC}"
    echo -e "  Neustart:  ${YELLOW}pct exec $CT_ID -- systemctl restart ${SERVICE_NAME}${NC}"
    echo -e "  Logs:      ${YELLOW}pct exec $CT_ID -- journalctl -u ${SERVICE_NAME} -f${NC}"
    echo ""
    echo -e "${BLUE}Update (vom Mac / Dev-Rechner):${NC}"
    echo -e "  ${YELLOW}bash scripts/install-lxc.sh --remote root@${ip}${NC}"
    echo ""
    echo -e "${BLUE}Log dieser Installation:${NC}  ${CYAN}${LOG_FILE}${NC}"
    echo ""
    echo -e "${BLUE}Nächste Schritte:${NC}"
    echo "  1. Web UI öffnen → vMix-IP und ATEM-IP eintragen"
    echo "  2. Kamera-Mapping konfigurieren"
    echo "  3. Fertig — Service startet automatisch beim Boot"
    echo ""
}

# =============================================================================
# Hauptprogramm
# =============================================================================

main() {
    # Quellenprüfung vorab
    if [ -z "$GIT_URL" ] && [ -z "$HOST_SOURCE_DIR" ]; then
        echo -e "${YELLOW}Keine Quelle angegeben.${NC}"
        echo ""
        echo "Optionen:"
        echo "  --git URL      Git-Repository im Container klonen"
        echo "  --from PFAD    Dateien vom Proxmox-Host übertragen"
        echo ""
        echo -e "Beispiel: ${CYAN}bash $0 --git https://github.com/USER/vmix-tally.git${NC}"
        echo -e "Oder:     ${CYAN}bash $0 --from /opt/vmix-tally${NC}"
        echo ""
        exit 1
    fi

    print_banner

    log "===== vMix Tally-Bridge Proxmox LXC Installation gestartet ====="
    log "CT_HOSTNAME=$CT_HOSTNAME | CT_IP=$CT_IP | PORT=$PORT"

    check_proxmox_host
    select_storage
    get_debian_template
    create_container
    configure_base_system
    install_nodejs
    create_service_user
    install_app
    setup_systemd
    setup_logrotate
    validate_installation
    start_server

    log "===== vMix Tally-Bridge LXC Installation abgeschlossen ====="
    print_summary
}

main
