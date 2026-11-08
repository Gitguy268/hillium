#!/bin/sh
# Install SearXNG natively (no Docker) and keep it running on 127.0.0.1:8888.
set -eu

SEARXNG_COMMIT="a9d99003344ac3879ec45c56c661283482a92a39" # 2026-09-30
PORT="${HILLIUM_SEARXNG_PORT:-8888}"
HOME_DIR="$HOME/Library/Application Support/Hillium/searxng"
LABEL="org.hillium.searxng"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/Hillium/searxng.log"

command -v uv >/dev/null 2>&1 || { echo "uv is required: brew install uv" >&2; exit 1; }

mkdir -p "$HOME_DIR" "$(dirname "$LOG")" "$(dirname "$PLIST")"
cd "$HOME_DIR"

if [ ! -d src/.git ]; then
  git clone --quiet https://github.com/searxng/searxng.git src
fi
git -C src fetch --quiet origin "$SEARXNG_COMMIT"
git -C src checkout --quiet "$SEARXNG_COMMIT"

uv venv --quiet --python 3.12 --allow-existing venv
# SearXNG's setup.py imports its own deps, so install them first, then the package without isolation.
uv pip install --quiet --python venv/bin/python -r src/requirements.txt setuptools wheel
uv pip install --quiet --python venv/bin/python --no-build-isolation -e src

if [ ! -f settings.yml ]; then
  SECRET="$(openssl rand -hex 32)"
  cat > settings.yml <<EOF
use_default_settings: true
general:
  instance_name: "Hillium Search"
search:
  formats: [html, json]
server:
  bind_address: "127.0.0.1"
  port: $PORT
  secret_key: "$SECRET"
  limiter: false
  image_proxy: true
  method: "GET"
EOF
  chmod 600 settings.yml
fi

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$HOME_DIR/venv/bin/python</string>
    <string>-m</string>
    <string>searx.webapp</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SEARXNG_SETTINGS_PATH</key><string>$HOME_DIR/settings.yml</string>
  </dict>
  <key>WorkingDirectory</key><string>$HOME_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

printf "Waiting for SearXNG"
i=0
until curl -fs -o /dev/null "http://127.0.0.1:$PORT/healthz"; do
  i=$((i + 1))
  if [ "$i" -ge 60 ]; then echo; echo "SearXNG did not start; see $LOG" >&2; exit 1; fi
  printf "."; sleep 1
done
echo
echo "SearXNG is running at http://127.0.0.1:$PORT"
echo "Search URL for the browser: http://127.0.0.1:$PORT/search?q=%s"
