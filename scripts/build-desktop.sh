#!/usr/bin/env bash
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
APP="$RAIZ/desktop/app"
rm -rf "$APP"
mkdir -p "$APP"
cp -r "$RAIZ/web/." "$APP/"
find "$APP" -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.mjs' -o -name '*.json' -o -name '*.svg' -o -name '*.aff' -o -name '*.dic' -o -name '*.txt' -o -name '*.wasm' \) -print0 |
  while IFS= read -r -d '' f; do gzip -9 -n "$f"; done
VERSAO="$(tr -d '\r\n' < "$RAIZ/VERSION")"
cd "$RAIZ/desktop"
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H windowsgui -X main.versao=$VERSAO" -o "$RAIZ/Serifa.exe" .
rm -rf "$APP"
ls -lh "$RAIZ/Serifa.exe"
