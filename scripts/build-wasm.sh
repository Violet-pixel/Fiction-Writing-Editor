#!/usr/bin/env bash
# build-wasm.sh — gera web/wasm/textstats.wasm (C) e web/wasm/fuzzy.wasm (C++).
# Copyright (©) 2026 Clara Portes
#
# WebAssembly "freestanding": só clang + wasm-ld, sem wasi-libc nem emscripten.
# Variáveis opcionais: CLANG (padrão: clang), CLANGXX (padrão: clang++).
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAIDA="$RAIZ/web/wasm"
CLANG="${CLANG:-clang}"
CLANGXX="${CLANGXX:-clang++}"
mkdir -p "$SAIDA"

if ! command -v "$CLANG" >/dev/null 2>&1; then
  echo "build-wasm: clang não encontrado (defina CLANG=...)." >&2
  exit 1
fi
if ! command -v wasm-ld >/dev/null 2>&1 && ! command -v wasm-ld-18 >/dev/null 2>&1; then
  echo "build-wasm: wasm-ld não encontrado (pacote lld)." >&2
  exit 1
fi

COMUM=(--target=wasm32 -O2 -nostdlib -ffreestanding -fno-builtin -Wall -Wextra
       -Wl,--no-entry -Wl,--export-dynamic -Wl,--strip-all)

# textstats.wasm: memória inicial de 18 MiB para garantir >= 16 MiB de buffer
# depois dos dados estáticos e da pilha; pode crescer com ts_reserve().
"$CLANG" "${COMUM[@]}" -std=c11 \
  -Wl,--initial-memory=18874368 \
  -Wl,--export=ts_buffer -Wl,--export=ts_capacity -Wl,--export=ts_reserve -Wl,--export=ts_count \
  -o "$SAIDA/textstats.wasm" "$RAIZ/native/c/textstats.c"

# fuzzy.wasm: a área de trabalho (4 MiB) é estática.
"$CLANGXX" "${COMUM[@]}" -std=c++17 -fno-exceptions -fno-rtti \
  -Wl,--export=fz_buffer -Wl,--export=fz_capacity -Wl,--export=fz_distance -Wl,--export=fz_rank \
  -o "$SAIDA/fuzzy.wasm" "$RAIZ/native/cpp/fuzzy.cpp"

for f in textstats fuzzy; do
  echo "web/wasm/$f.wasm: $(wc -c < "$SAIDA/$f.wasm") bytes"
done
