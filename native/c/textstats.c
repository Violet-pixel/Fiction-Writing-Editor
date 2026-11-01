/*
 * textstats.c — núcleo da contagem de texto do Serifa (seção 1 da especificação).
 *
 * Copyright (©) 2026 Clara Portes
 *
 * Sem libc: só aritmética sobre os bytes. O mesmo arquivo gera
 *   - web/wasm/textstats.wasm (clang --target=wasm32, exportações abaixo);
 *   - o núcleo dos CLIs nativos `contar` (C) e `revisor` (C++).
 *
 * ABI do textstats.wasm (o front-end JS depende dela):
 *   memory                      memória linear exportada
 *   ts_buffer() -> i32          ponteiro do buffer de entrada (>= 16 MiB livres)
 *   ts_capacity() -> i32        quantos bytes cabem hoje a partir de ts_buffer()
 *   ts_reserve(len) -> i32      garante len bytes (faz memory.grow se precisar);
 *                               devolve ts_buffer() ou 0 se não conseguiu crescer.
 *                               Depois de crescer, o ArrayBuffer antigo do JS fica
 *                               "detached": recrie as views de memory.buffer.
 *   ts_count(len) -> i32        conta os len bytes UTF-8 do buffer e devolve um
 *                               ponteiro para 6 uint32 (little-endian):
 *                               [words, characters, charactersNoSpaces,
 *                                paragraphs, sentences, dialogues]
 *                               O resultado é sobrescrito na próxima chamada.
 */
#include "textstats.h"

int ts_is_word_char(ts_u32 cp)
{
    if (cp < 0x80) {
        return (cp >= '0' && cp <= '9') || (cp >= 'A' && cp <= 'Z') || (cp >= 'a' && cp <= 'z');
    }
    if (cp >= 0xC0 && cp <= 0x24F) return cp != 0xD7 && cp != 0xF7;
    if (cp >= 0x370 && cp <= 0x1FFF) return 1;
    if (cp >= 0x3040 && cp <= 0x9FFF) return 1;
    if (cp >= 0xAC00 && cp <= 0xD7AF) return 1;
    return 0;
}

int ts_is_space(ts_u32 cp)
{
    if (cp == ' ' || (cp >= 0x09 && cp <= 0x0D)) return 1;
    if (cp < 0x85) return 0;
    if (cp == 0x85 || cp == 0xA0 || cp == 0x1680) return 1;
    if (cp >= 0x2000 && cp <= 0x200A) return 1;
    return cp == 0x2028 || cp == 0x2029 || cp == 0x202F || cp == 0x205F || cp == 0x3000;
}

/* Travessões que também separam palavras: — – ― */
static int is_dash(ts_u32 cp)
{
    return cp == 0x2014 || cp == 0x2013 || cp == 0x2015;
}

/* Pontuação terminal: . ! ? … */
static int is_terminal(ts_u32 cp)
{
    return cp == '.' || cp == '!' || cp == '?' || cp == 0x2026;
}

/* O que pode vir logo depois de uma corrida terminal (além de espaço/fim): ” " ’ » ) — */
static int is_closer(ts_u32 cp)
{
    return cp == 0x201D || cp == '"' || cp == 0x2019 || cp == 0xBB || cp == ')' || cp == 0x2014;
}

/* Começos de fala (seção 2), exceto "- " que é tratado à parte: — – ― “ " « */
static int is_dialogue_start(ts_u32 cp)
{
    return is_dash(cp) || cp == 0x201C || cp == '"' || cp == 0xAB;
}

ts_u32 ts_utf8_next(const unsigned char *s, unsigned long n, unsigned long *pos)
{
    unsigned long i = *pos;
    ts_u32 b = s[i++];
    ts_u32 cp, lower = 0x80, upper = 0xBF;
    int need;

    if (b < 0x80) { *pos = i; return b; }
    if (b >= 0xC2 && b <= 0xDF) { need = 1; cp = b & 0x1F; }
    else if (b >= 0xE0 && b <= 0xEF) {
        need = 2; cp = b & 0x0F;
        if (b == 0xE0) lower = 0xA0;
        if (b == 0xED) upper = 0x9F;
    } else if (b >= 0xF0 && b <= 0xF4) {
        need = 3; cp = b & 0x07;
        if (b == 0xF0) lower = 0x90;
        if (b == 0xF4) upper = 0x8F;
    } else { *pos = i; return 0xFFFD; }

    /* Algoritmo do WHATWG (igual ao TextDecoder): o byte inválido não é consumido. */
    while (need > 0) {
        ts_u32 c;
        if (i >= n) { *pos = i; return 0xFFFD; }
        c = s[i];
        if (c < lower || c > upper) { *pos = i; return 0xFFFD; }
        lower = 0x80; upper = 0xBF;
        cp = (cp << 6) | (c & 0x3F);
        i++;
        need--;
    }
    *pos = i;
    return cp;
}

ts_u32 ts_reading_minutes(ts_u32 words)
{
    return words == 0 ? 0 : (words + 199u) / 200u;
}

void ts_count_utf8(const unsigned char *s, unsigned long n, ts_u32 out[TS_FIELDS])
{
    ts_u32 words = 0, chars = 0, nospace = 0, paragraphs = 0, sentences = 0, dialogues = 0;
    int token_counted = 0;     /* o token atual já foi contado como palavra */
    int saw_word = 0;          /* houve isWordChar desde a última corrida terminal */
    int in_run = 0;            /* dentro de uma corrida . ! ? … */
    int line_content = 0;      /* a linha tem algo que não é espaço */
    int line_state = 0;        /* 0 = só espaços até agora, 1 = viu "-" no começo, 2 = decidido */
    int line_dialogue = 0;
    unsigned long pos = 0;

    while (pos < n) {
        ts_u32 cp = ts_utf8_next(s, n, &pos);
        int space = ts_is_space(cp);

        /* Fim de uma corrida terminal: decide se conta como frase. */
        if (in_run && !is_terminal(cp)) {
            in_run = 0;
            if (space || is_closer(cp)) {
                if (saw_word) sentences++;
                saw_word = 0;
            }
        }

        if (cp != '\n' && cp != '\r') chars++;
        if (!space) nospace++;

        /* Palavras: tokens separados por espaço ou travessão com pelo menos um isWordChar. */
        if (space || is_dash(cp)) {
            token_counted = 0;
        } else if (ts_is_word_char(cp)) {
            if (!token_counted) { words++; token_counted = 1; }
            saw_word = 1;
        } else if (is_terminal(cp)) {
            in_run = 1;
        }

        /* Parágrafos e falas, linha a linha. */
        if (cp == '\n') {
            if (line_content) {
                paragraphs++;
                if (line_dialogue) dialogues++;
            }
            line_content = 0; line_state = 0; line_dialogue = 0;
            continue;
        }
        if (line_state == 1) {
            /* "-" seguido de espaço no começo da linha é fala. */
            line_dialogue = space;
            line_state = 2;
        }
        if (!space) {
            line_content = 1;
            if (line_state == 0) {
                if (cp == '-') line_state = 1;
                else { line_dialogue = is_dialogue_start(cp); line_state = 2; }
            }
        }
    }

    if (in_run) {               /* corrida terminal no fim do texto */
        if (saw_word) sentences++;
        saw_word = 0;
    }
    if (saw_word) sentences++;  /* frase final sem pontuação */
    if (line_content) {
        paragraphs++;
        if (line_dialogue) dialogues++;
    }
    if (words == 0) sentences = 0;

    out[TS_WORDS] = words;
    out[TS_CHARACTERS] = chars;
    out[TS_CHARACTERS_NO_SPACES] = nospace;
    out[TS_PARAGRAPHS] = paragraphs;
    out[TS_SENTENCES] = sentences;
    out[TS_DIALOGUES] = dialogues;
}

/* ------------------------------------------------------------------------- */
/* Exportações do WebAssembly                                                */
/* ------------------------------------------------------------------------- */
#if defined(__wasm__)

#define TS_EXPORT(name) __attribute__((export_name(name), visibility("default")))
#define TS_PAGE 65536ul

/* O buffer de entrada começa no fim dos dados estáticos (__heap_base, definido
 * pelo wasm-ld) e vai até o fim da memória. A memória inicial é configurada no
 * link (--initial-memory) para deixar pelo menos 16 MiB livres. */
extern unsigned char __heap_base;

static ts_u32 ts_result[TS_FIELDS];

TS_EXPORT("ts_buffer") unsigned char *ts_buffer(void)
{
    return &__heap_base;
}

TS_EXPORT("ts_capacity") unsigned long ts_capacity(void)
{
    unsigned long total = (unsigned long)__builtin_wasm_memory_size(0) * TS_PAGE;
    return total - (unsigned long)&__heap_base;
}

TS_EXPORT("ts_reserve") unsigned char *ts_reserve(unsigned long len)
{
    unsigned long cap = ts_capacity();
    if (len > cap) {
        unsigned long missing = len - cap;
        unsigned long pages = (missing + TS_PAGE - 1) / TS_PAGE;
        if (__builtin_wasm_memory_grow(0, pages) == (unsigned long)-1) return 0;
    }
    return &__heap_base;
}

TS_EXPORT("ts_count") ts_u32 *ts_count(unsigned long len)
{
    unsigned long cap = ts_capacity();
    if (len > cap) len = cap;
    ts_count_utf8(&__heap_base, len, ts_result);
    return ts_result;
}

#endif /* __wasm__ */
