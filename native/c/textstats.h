/*
 * textstats.h — núcleo da contagem de texto do Serifa (seção 1 da especificação).
 *
 * Copyright (©) 2026 Clara Portes
 *
 * Código "freestanding": não depende da libc, para poder ser compilado tanto
 * para WebAssembly (clang --target=wasm32 -nostdlib) quanto para os CLIs
 * nativos (gcc/g++/MinGW).
 */
#ifndef SERIFA_TEXTSTATS_H
#define SERIFA_TEXTSTATS_H

#ifdef __cplusplus
extern "C" {
#endif

typedef unsigned int ts_u32;

/* Ordem dos campos no vetor de resultado (a mesma da ABI do textstats.wasm). */
enum {
    TS_WORDS = 0,
    TS_CHARACTERS = 1,
    TS_CHARACTERS_NO_SPACES = 2,
    TS_PARAGRAPHS = 3,
    TS_SENTENCES = 4,
    TS_DIALOGUES = 5,
    TS_FIELDS = 6
};

/* Classificação de code points (seção 1). Retornam 1 ou 0. */
int ts_is_word_char(ts_u32 cp);
int ts_is_space(ts_u32 cp);

/*
 * Decodifica um code point UTF-8 a partir de s[*pos] (n = tamanho total) e
 * avança *pos. Sequências inválidas viram U+FFFD consumindo 1 byte
 * (mesmo comportamento do TextDecoder do navegador para bytes soltos).
 */
ts_u32 ts_utf8_next(const unsigned char *s, unsigned long n, unsigned long *pos);

/*
 * Conta os n bytes UTF-8 de s e grava os 6 contadores em out, na ordem
 * [words, characters, charactersNoSpaces, paragraphs, sentences, dialogues].
 */
void ts_count_utf8(const unsigned char *s, unsigned long n, ts_u32 out[TS_FIELDS]);

/* Tempo de leitura: ceil(words / 200) minutos (0 se não há palavras). */
ts_u32 ts_reading_minutes(ts_u32 words);

#ifdef __cplusplus
}
#endif

#endif /* SERIFA_TEXTSTATS_H */
