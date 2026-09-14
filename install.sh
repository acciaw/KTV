#!/usr/bin/env bash
# sets up ktv on this machine and keeps it running with systemd, run after git clone
#   bash install.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

command -v node >/dev/null || { echo "node not found, install node 22 or later first"; exit 1; }
command -v systemctl >/dev/null || { echo "systemd not found, start the server by hand: npm ci --omit=dev && npm start"; exit 1; }

npm ci --omit=dev

if [ ! -f .env ]; then
  cp .env.example .env
fi

mkdir -p data "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/ktv.service" <<EOF
[Unit]
Description=KTV
After=network.target

[Service]
WorkingDirectory=$(pwd)
ExecStart=$(command -v node) server/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now ktv
loginctl enable-linger "$USER" 2>/dev/null || echo "run 'loginctl enable-linger $USER' as root so KTV keeps running after you log out"

port=$(grep '^PORT=' .env | cut -d= -f2)
port=${port:-8787}
key=$(grep '^ACCESS_KEY=' .env | cut -d= -f2-)
keyParam=${key:+?key=$key}
ip=$(hostname -I 2>/dev/null | awk '{print $1}')
lan_host=${ip:+${ip//./-}.sslip.io}

echo
echo "KTV is running as a background service. Two different ways to reach it, for two different things:"
echo
echo "1. First time only, to finish setup (connect Spotify and the others) in /admin. Spotify and Google only allow"
echo "   logins back to 127.0.0.1, so from your own computer, not this server, open a tunnel and leave it running:"
echo "     ssh -L $port:127.0.0.1:$port $(whoami)@${ip:-this-machine}"
echo "   then, while that's open, visit this in a browser on that same computer:"
echo "     http://127.0.0.1:$port/admin$keyParam"
echo
echo "2. Every time after, to watch /tv from any device on your network (phone, TV, laptop), no SSH, just a browser:"
echo "     http://${lan_host:-<this-machine-lan-ip-with-dots-as-dashes>.sslip.io}:$port/tv$keyParam"
echo
if [ -z "$key" ]; then
  echo "No ACCESS_KEY is set, so that URL works for anyone on your network. To require one, set ACCESS_KEY in .env"
  echo "and run: systemctl --user restart ktv"
  echo
fi
echo "Update later with: git pull && npm ci --omit=dev && systemctl --user restart ktv"
