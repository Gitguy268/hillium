#!/bin/sh
# Render logo.svg into the extension icons and a macOS .icns, using only built-in macOS tools.
set -eu
cd "$(dirname "$0")"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

qlmanage -t -s 1024 -o "$tmp" logo.svg >/dev/null 2>&1
src="$tmp/logo.svg.png"
[ -f "$src" ] || { echo "QuickLook could not render logo.svg" >&2; exit 1; }

for size in 16 32 48 128; do
  sips -z "$size" "$size" "$src" --out "../extension/icons/$size.png" >/dev/null
done
sips -z 512 512 "$src" --out logo-512.png >/dev/null

set_dir="$tmp/Hillium.iconset"
mkdir "$set_dir"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$src" --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$src" --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$set_dir" -o Hillium.icns
echo "Icons written."
