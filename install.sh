#!/usr/bin/env bash
#
# Tetris-Server im Debian-Container einrichten.
# Im entpackten Projektordner ausführen:   sudo ./install.sh
#
set -euo pipefail

APP_USER="tetris"
APP_DIR="/opt/tetris"
PORT="${PORT:-5000}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ">> Pakete installieren ..."
apt-get update
apt-get install -y python3 python3-venv python3-pip rsync

echo ">> App-User & Zielverzeichnis ..."
id -u "$APP_USER" &>/dev/null || \
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
rsync -a \
  "$SRC_DIR/app.py" \
  "$SRC_DIR/requirements.txt" \
  "$SRC_DIR/templates" \
  "$SRC_DIR/static" \
  "$APP_DIR/"

echo ">> Virtualenv & Dependencies ..."
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip >/dev/null
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo ">> systemd-Service schreiben ..."
cat > /etc/systemd/system/tetris.service <<EOF
[Unit]
Description=Tetris Web Server (Flask + waitress)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/.venv/bin/waitress-serve --host=0.0.0.0 --port=${PORT} app:app
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now tetris.service

echo ""
echo ">> Status:"
systemctl --no-pager --full status tetris.service | head -n 6 || true

IP="$(hostname -I | awk '{print $1}')"
echo ""
echo ">> Fertig! Tetris läuft auf:  http://${IP}:${PORT}"
