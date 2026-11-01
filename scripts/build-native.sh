#!/usr/bin/env bash
# build-native.sh — compila os CLIs nativos do Serifa (contar e revisor) em native/build/.
# Copyright (©) 2026 Clara Portes
# Variáveis opcionais: CC (padrão: gcc), CXX (padrão: g++).
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CC="${CC:-gcc}"
CXX="${CXX:-g++}"
SAIDA="$RAIZ/native/build"
mkdir -p "$SAIDA"

"$CC" -std=c11 -O2 -Wall -Wextra -o "$SAIDA/contar" \
  "$RAIZ/native/c/contar.c" "$RAIZ/native/c/textstats.c"

"$CC" -std=c11 -O2 -Wall -Wextra -c -o "$SAIDA/textstats.o" "$RAIZ/native/c/textstats.c"
"$CXX" -std=c++17 -O2 -Wall -Wextra -o "$SAIDA/revisor" \
  "$RAIZ/native/cpp/revisor/main.cpp" "$RAIZ/native/cpp/revisor/hunspell_lite.cpp" "$SAIDA/textstats.o"
rm -f "$SAIDA/textstats.o"

echo "Gerados: native/build/contar e native/build/revisor"
