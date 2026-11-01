/*
 * contar.c — CLI nativo de contagem de texto do Serifa.
 *
 * Copyright (©) 2026 Clara Portes
 *
 * Uso: contar arquivo.txt [--json]
 *      contar - [--json]          (lê da entrada padrão)
 *
 * Usa o mesmo núcleo (textstats.c) do textstats.wasm do navegador.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "textstats.h"

static void uso(void)
{
    fprintf(stderr,
            "Uso: contar arquivo.txt [--json]\n"
            "  Conta palavras, caracteres, parágrafos, frases e falas de um texto UTF-8.\n"
            "  Use \"-\" no lugar do arquivo para ler da entrada padrão.\n");
}

/* Lê o arquivo inteiro para a memória. Devolve NULL em caso de erro. */
static unsigned char *ler_tudo(const char *caminho, unsigned long *tamanho)
{
    FILE *f = strcmp(caminho, "-") == 0 ? stdin : fopen(caminho, "rb");
    unsigned char *buf = NULL;
    size_t cap = 0, len = 0;

    if (!f) return NULL;
    for (;;) {
        size_t lidos;
        if (len == cap) {
            size_t novo = cap ? cap * 2 : 1 << 16;
            unsigned char *p = (unsigned char *)realloc(buf, novo);
            if (!p) { free(buf); if (f != stdin) fclose(f); return NULL; }
            buf = p; cap = novo;
        }
        lidos = fread(buf + len, 1, cap - len, f);
        len += lidos;
        if (lidos == 0) break;
    }
    if (ferror(f)) { free(buf); if (f != stdin) fclose(f); return NULL; }
    if (f != stdin) fclose(f);
    *tamanho = (unsigned long)len;
    return buf;
}

int main(int argc, char **argv)
{
    const char *arquivo = NULL;
    int json = 0, i;
    unsigned char *dados;
    unsigned long tamanho = 0, inicio_bom = 0;
    ts_u32 r[TS_FIELDS];
    clock_t t0, t1;
    double ms;

    for (i = 1; i < argc; i++) {
        if (strcmp(argv[i], "--json") == 0) json = 1;
        else if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "--ajuda") == 0) {
            uso();
            return 0;
        } else if (!arquivo) arquivo = argv[i];
        else { uso(); return 2; }
    }
    if (!arquivo) { uso(); return 2; }

    dados = ler_tudo(arquivo, &tamanho);
    if (!dados) {
        fprintf(stderr, "contar: não foi possível ler \"%s\".\n", arquivo);
        return 1;
    }
    /* Ignora o BOM UTF-8, se houver (o navegador também ignora). */
    if (tamanho >= 3 && dados[0] == 0xEF && dados[1] == 0xBB && dados[2] == 0xBF) inicio_bom = 3;

    t0 = clock();
    ts_count_utf8(dados + inicio_bom, tamanho - inicio_bom, r);
    t1 = clock();
    ms = (double)(t1 - t0) * 1000.0 / CLOCKS_PER_SEC;

    if (json) {
        printf("{\"words\":%u,\"characters\":%u,\"charactersNoSpaces\":%u,\"paragraphs\":%u,"
               "\"sentences\":%u,\"dialogues\":%u,\"readingMinutes\":%u}\n",
               r[TS_WORDS], r[TS_CHARACTERS], r[TS_CHARACTERS_NO_SPACES], r[TS_PARAGRAPHS],
               r[TS_SENTENCES], r[TS_DIALOGUES], ts_reading_minutes(r[TS_WORDS]));
    } else {
        printf("Palavras:              %u\n", r[TS_WORDS]);
        printf("Caracteres:            %u\n", r[TS_CHARACTERS]);
        printf("Caracteres sem espaço: %u\n", r[TS_CHARACTERS_NO_SPACES]);
        printf("Parágrafos:            %u\n", r[TS_PARAGRAPHS]);
        printf("Frases:                %u\n", r[TS_SENTENCES]);
        printf("Falas:                 %u\n", r[TS_DIALOGUES]);
        printf("Tempo de leitura:      %u min\n", ts_reading_minutes(r[TS_WORDS]));
        fprintf(stderr, "(contado em %.2f ms)\n", ms);
    }
    free(dados);
    return 0;
}
