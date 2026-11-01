#!/usr/bin/env bash
# revisor-test.sh — compila (se preciso) e testa o CLI revisor contra casos próprios e
# tests/fixtures/ortografia.json. Rodar de qualquer pasta.
# Copyright (©) 2026 Clara Portes
set -euo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ ! -x "$RAIZ/native/build/revisor" ] || [ "$RAIZ/native/cpp/revisor/hunspell_lite.cpp" -nt "$RAIZ/native/build/revisor" ] \
   || [ "$RAIZ/native/cpp/revisor/main.cpp" -nt "$RAIZ/native/build/revisor" ]; then
  "$RAIZ/scripts/build-native.sh"
fi
cd "$RAIZ"
node --test native/tests/revisor.test.mjs
