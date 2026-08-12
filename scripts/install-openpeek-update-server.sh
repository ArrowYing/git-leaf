#!/usr/bin/env bash
set -euo pipefail

: "${UPDATE_REMOTE_HOST:?Set UPDATE_REMOTE_HOST for the target SSH host}"
: "${UPDATE_REMOTE_ROOT:?Set UPDATE_REMOTE_ROOT for update artifacts}"
: "${TELEMETRY_REMOTE_ROOT:?Set TELEMETRY_REMOTE_ROOT for telemetry data}"
: "${UPDATE_BIND:?Set UPDATE_BIND for the service listener}"
: "${UPDATE_REMOTE_USER:?Set UPDATE_REMOTE_USER for the systemd service account}"
: "${UPDATE_REMOTE_WORK_DIR:?Set UPDATE_REMOTE_WORK_DIR for the service working directory}"
: "${UPDATE_REMOTE_BIN_DIR:?Set UPDATE_REMOTE_BIN_DIR for the installed server script}"

REMOTE_HOST="$UPDATE_REMOTE_HOST"
REMOTE_ROOT="$UPDATE_REMOTE_ROOT"
TELEMETRY_ROOT="$TELEMETRY_REMOTE_ROOT"
REMOTE_BIND="$UPDATE_BIND"
REMOTE_USER="$UPDATE_REMOTE_USER"
REMOTE_WORK_DIR="$UPDATE_REMOTE_WORK_DIR"
REMOTE_BIN_DIR="$UPDATE_REMOTE_BIN_DIR"
REMOTE_PORT="${UPDATE_PORT:-8320}"
SERVICE_NAME="${UPDATE_SERVICE_NAME:-gitleaf-updates.service}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ssh "$REMOTE_HOST" "install -d -m 0755 '$REMOTE_ROOT' '$REMOTE_BIN_DIR' && \
  install -d -m 0750 '$TELEMETRY_ROOT' '$TELEMETRY_ROOT/events' '$TELEMETRY_ROOT/downloads' '$TELEMETRY_ROOT/reports' && \
  find '$TELEMETRY_ROOT' -type d -exec chmod 0750 {} + && \
  find '$TELEMETRY_ROOT/events' '$TELEMETRY_ROOT/downloads' '$TELEMETRY_ROOT/reports' -type f -exec chmod 0640 {} +"
scp "$SCRIPT_DIR/openpeek-update-server.py" "$REMOTE_HOST:/tmp/openpeek-update-server.py"
ssh "$REMOTE_HOST" "install -m 0750 /tmp/openpeek-update-server.py '$REMOTE_BIN_DIR/openpeek-update-server.py' && rm -f /tmp/openpeek-update-server.py"

ssh "$REMOTE_HOST" "cat > /tmp/$SERVICE_NAME" <<UNIT
[Unit]
Description=OpenPeek update, Deep Link, and telemetry server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$REMOTE_USER
WorkingDirectory=$REMOTE_WORK_DIR
ExecStart=/usr/bin/python3 $REMOTE_BIN_DIR/openpeek-update-server.py --root $REMOTE_ROOT --telemetry-root $TELEMETRY_ROOT --bind $REMOTE_BIND --port $REMOTE_PORT
Restart=on-failure
RestartSec=3
UMask=0027
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$REMOTE_ROOT $TELEMETRY_ROOT

[Install]
WantedBy=multi-user.target
UNIT

ssh "$REMOTE_HOST" "sudo mv '/tmp/$SERVICE_NAME' '/etc/systemd/system/$SERVICE_NAME' && sudo systemctl daemon-reload && sudo systemctl enable \"$SERVICE_NAME\" && sudo systemctl restart \"$SERVICE_NAME\" && systemctl is-active \"$SERVICE_NAME\""
