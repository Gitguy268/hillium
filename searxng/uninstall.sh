#!/bin/sh
# Stop SearXNG and remove everything install.sh created.
set -eu

LABEL="org.hillium.searxng"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Library/Application Support/Hillium/searxng"
rm -f "$HOME/Library/Logs/Hillium/searxng.log"
echo "SearXNG removed."
