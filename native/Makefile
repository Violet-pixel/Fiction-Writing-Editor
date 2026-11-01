# Makefile — partes em C e C++ do Serifa.
# Copyright (©) 2026 Clara Portes
#
#   make            CLIs nativos (build/contar, build/revisor) e os dois .wasm
#   make native     só os CLIs nativos
#   make wasm       só web/wasm/textstats.wasm e web/wasm/fuzzy.wasm
#   make test       testes (Node + revisor)
#   make clean      apaga build/ (os .wasm ficam)

CC      ?= gcc
CXX     ?= g++
CLANG   ?= clang
CLANGXX ?= clang++
CFLAGS   = -std=c11 -O2 -Wall -Wextra
CXXFLAGS = -std=c++17 -O2 -Wall -Wextra

BUILD = build
WASM  = ../web/wasm
REVISOR_SRC = cpp/revisor/main.cpp cpp/revisor/hunspell_lite.cpp
REVISOR_HDR = cpp/revisor/hunspell_lite.hpp cpp/fuzzy.cpp c/textstats.h

WASM_COMUM = --target=wasm32 -O2 -nostdlib -ffreestanding -fno-builtin -Wall -Wextra \
             -Wl,--no-entry -Wl,--export-dynamic -Wl,--strip-all

.PHONY: all native wasm test clean

all: native wasm

native: $(BUILD)/contar $(BUILD)/revisor

wasm: $(WASM)/textstats.wasm $(WASM)/fuzzy.wasm

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/contar: c/contar.c c/textstats.c c/textstats.h | $(BUILD)
	$(CC) $(CFLAGS) -o $@ c/contar.c c/textstats.c

$(BUILD)/textstats.o: c/textstats.c c/textstats.h | $(BUILD)
	$(CC) $(CFLAGS) -c -o $@ c/textstats.c

$(BUILD)/revisor: $(REVISOR_SRC) $(REVISOR_HDR) $(BUILD)/textstats.o
	$(CXX) $(CXXFLAGS) -o $@ $(REVISOR_SRC) $(BUILD)/textstats.o

$(WASM)/textstats.wasm: c/textstats.c c/textstats.h
	mkdir -p $(WASM)
	$(CLANG) $(WASM_COMUM) -std=c11 -Wl,--initial-memory=18874368 \
	  -Wl,--export=ts_buffer -Wl,--export=ts_capacity -Wl,--export=ts_reserve -Wl,--export=ts_count \
	  -o $@ c/textstats.c

$(WASM)/fuzzy.wasm: cpp/fuzzy.cpp
	mkdir -p $(WASM)
	$(CLANGXX) $(WASM_COMUM) -std=c++17 -fno-exceptions -fno-rtti \
	  -Wl,--export=fz_buffer -Wl,--export=fz_capacity -Wl,--export=fz_distance -Wl,--export=fz_rank \
	  -o $@ cpp/fuzzy.cpp

test: all
	cd .. && node --test native/tests/
	cd .. && bash native/tests/revisor-test.sh

clean:
	rm -rf $(BUILD)
