#!/bin/sh
# Double-click to run Hillium Browser. The first run installs it (about 350 MB).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Hillium needs Node.js 20 or later: https://nodejs.org (or: brew install node)"
  read -r _
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing Hillium Browser (first run only)…"
  npm ci --no-audit --no-fund || { echo "Install failed."; read -r _; exit 1; }
fi
# npm can skip Electron's download step (install scripts off); fetch it if missing.
if [ ! -d node_modules/electron/dist ]; then
  node node_modules/electron/install.js || { echo "Could not download Electron."; read -r _; exit 1; }
fi
exec npx --no-install electron .
