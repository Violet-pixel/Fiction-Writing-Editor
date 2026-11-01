/*
 * fuzzy.cpp — distância Damerau-Levenshtein ponderada do Serifa
 * (seção 3, item 4 da especificação).
 *
 * Copyright (©) 2026 Clara Portes
 *
 * C++ "freestanding": sem std, sem exceções, sem RTTI, sem alocação dinâmica.
 * Compila para web/wasm/fuzzy.wasm e também como cabeçalho-fonte para os CLIs
 * nativos (o revisor inclui este arquivo com FZ_NO_EXPORTS definido).
 *
 * Custos (inteiros, em milésimos):
 *   letras iguais (sem diferenciar maiúsculas)                0
 *   variantes do mesmo grupo do MAP pt-BR (aáãâ, eéê, ií,
 *     oóõô, uúü, cç), sem diferenciar maiúsculas             300
 *   letras vizinhas no teclado ABNT2                         700
 *   qualquer outra substituição                             1000
 *   inserção, remoção, troca de duas letras vizinhas        1000
 * Variante "optimal string alignment" (cada trecho é editado no máximo uma vez).
 *
 * ABI do fuzzy.wasm:
 *   memory                         memória linear exportada
 *   fz_buffer() -> i32             ponteiro para a área de trabalho (uint32 = code points)
 *   fz_capacity() -> i32           quantos uint32 cabem na área (FZ_BUFFER_WORDS)
 *   fz_distance(alen, blen) -> i32 a = buffer[0..alen), b = buffer[alen..alen+blen);
 *                                  devolve distância × 1000
 *   fz_rank(word_len, count) -> i32
 *                                  buffer = palavra (word_len code points), depois
 *                                  `count` candidatos, cada um como [tamanho, cps...];
 *                                  grava em buffer[0..count) os índices dos candidatos
 *                                  ordenados pela distância (empate: ordem original)
 *                                  e devolve count (limitado a FZ_MAX_CANDIDATES).
 * Palavras com mais de FZ_MAX_LEN code points são comparadas só até FZ_MAX_LEN.
 */

typedef unsigned int fz_u32;

#define FZ_MAX_LEN 1024
#define FZ_MAX_CANDIDATES 65536
#define FZ_BUFFER_WORDS (1u << 20) /* 1 Mi uint32 = 4 MiB */

#define FZ_COST_MAP 300
#define FZ_COST_NEAR 700
#define FZ_COST_FULL 1000

namespace fz {

/* Minúscula simples para latim básico, Latin-1 e Latin Extended-A. */
static inline fz_u32 fold(fz_u32 c)
{
    if (c >= 'A' && c <= 'Z') return c + 32;
    if (c >= 0xC0 && c <= 0xDE && c != 0xD7) return c + 32;
    if (c >= 0x100 && c <= 0x17F) {
        if ((c >= 0x139 && c <= 0x148) || (c >= 0x179 && c <= 0x17E)) return (c & 1) ? c + 1 : c;
        if (c != 0x130 && c != 0x131 && c != 0x138 && c != 0x149 && c != 0x178) return (c & 1) ? c : c + 1;
    }
    return c;
}

/* Grupo do MAP (1..6) de uma letra já em minúscula; 0 se não pertence a nenhum. */
static inline int map_group(fz_u32 c)
{
    switch (c) {
    case 'a': case 0xE1: case 0xE3: case 0xE2: return 1;           /* a á ã â */
    case 'e': case 0xE9: case 0xEA: return 2;                      /* e é ê */
    case 'i': case 0xED: return 3;                                 /* i í */
    case 'o': case 0xF3: case 0xF5: case 0xF4: return 4;           /* o ó õ ô */
    case 'u': case 0xFA: case 0xFC: return 5;                      /* u ú ü */
    case 'c': case 0xE7: return 6;                                 /* c ç */
    default: return 0;
    }
}

/* Posição (linha, coluna) no teclado ABNT2 (0 = números, 1 = qwerty...); -1 se não for tecla. */
static inline void key_pos(fz_u32 c, int *row, int *col)
{
    static const char r0[] = "1234567890";
    static const char r1[] = "qwertyuiop";
    static const char r2[] = "asdfghjkl";
    static const char r3[] = "zxcvbnm";
    *row = -1; *col = 0;
    if (c == 0xE7) { *row = 2; *col = 9; return; } /* ç fica à direita do l */
    if (c > 0x7F) return;
    for (int i = 0; r0[i]; i++) if ((fz_u32)r0[i] == c) { *row = 4; *col = i; return; }
    for (int i = 0; r1[i]; i++) if ((fz_u32)r1[i] == c) { *row = 1; *col = i; return; }
    for (int i = 0; r2[i]; i++) if ((fz_u32)r2[i] == c) { *row = 2; *col = i; return; }
    for (int i = 0; r3[i]; i++) if ((fz_u32)r3[i] == c) { *row = 3; *col = i; return; }
}

/* Vizinhas no teclado: mesma linha lado a lado, ou linhas adjacentes
 * considerando o deslocamento das fileiras (q-a, w-a, w-s, a-z, s-z, s-x...). */
static inline bool keyboard_near(fz_u32 a, fz_u32 b)
{
    int ra, ca, rb, cb;
    key_pos(a, &ra, &ca);
    key_pos(b, &rb, &cb);
    if (ra < 0 || rb < 0) return false;
    if (ra == 4) ra = 0; /* fileira dos números fica acima do q */
    if (rb == 4) rb = 0;
    if (ra == rb) return ca - cb == 1 || cb - ca == 1;
    if (ra > rb) { int t = ra; ra = rb; rb = t; t = ca; ca = cb; cb = t; }
    if (rb - ra != 1) return false;
    /* a está na linha de cima: as vizinhas de baixo são as colunas c-1 e c. */
    return cb == ca || cb == ca - 1;
}

static inline int sub_cost(fz_u32 x, fz_u32 y)
{
    if (x == y) return 0;
    x = fold(x);
    y = fold(y);
    if (x == y) return 0;
    int gx = map_group(x);
    if (gx != 0 && gx == map_group(y)) return FZ_COST_MAP;
    if (keyboard_near(x, y)) return FZ_COST_NEAR;
    return FZ_COST_FULL;
}

static inline int min2(int a, int b) { return a < b ? a : b; }

/* Três linhas da matriz (OSA precisa da linha i-2). */
static int row_prev2[FZ_MAX_LEN + 1];
static int row_prev[FZ_MAX_LEN + 1];
static int row_cur[FZ_MAX_LEN + 1];

/* Distância × 1000 entre a[0..alen) e b[0..blen). */
static int distance(const fz_u32 *a, fz_u32 alen, const fz_u32 *b, fz_u32 blen)
{
    if (alen > FZ_MAX_LEN) alen = FZ_MAX_LEN;
    if (blen > FZ_MAX_LEN) blen = FZ_MAX_LEN;
    int *p2 = row_prev2, *p1 = row_prev, *cur = row_cur;
    for (fz_u32 j = 0; j <= blen; j++) p1[j] = (int)j * FZ_COST_FULL;
    for (fz_u32 i = 1; i <= alen; i++) {
        cur[0] = (int)i * FZ_COST_FULL;
        for (fz_u32 j = 1; j <= blen; j++) {
            int best = p1[j - 1] + sub_cost(a[i - 1], b[j - 1]);
            best = min2(best, p1[j] + FZ_COST_FULL);  /* remoção */
            best = min2(best, cur[j - 1] + FZ_COST_FULL); /* inserção */
            if (i > 1 && j > 1 && fold(a[i - 1]) == fold(b[j - 2]) && fold(a[i - 2]) == fold(b[j - 1])
                && fold(a[i - 1]) != fold(a[i - 2])) {
                best = min2(best, p2[j - 2] + FZ_COST_FULL); /* troca de vizinhas */
            }
            cur[j] = best;
        }
        int *t = p2; p2 = p1; p1 = cur; cur = t;
    }
    return p1[blen];
}

static int dist_tmp[FZ_MAX_CANDIDATES];
static fz_u32 order[FZ_MAX_CANDIDATES];
static fz_u32 order_tmp[FZ_MAX_CANDIDATES];

/* Merge sort estável dos índices pela distância. */
static void sort_indices(fz_u32 n)
{
    for (fz_u32 width = 1; width < n; width *= 2) {
        for (fz_u32 lo = 0; lo < n; lo += 2 * width) {
            fz_u32 mid = lo + width < n ? lo + width : n;
            fz_u32 hi = lo + 2 * width < n ? lo + 2 * width : n;
            fz_u32 i = lo, j = mid, k = lo;
            while (i < mid && j < hi) {
                if (dist_tmp[order[j]] < dist_tmp[order[i]]) order_tmp[k++] = order[j++];
                else order_tmp[k++] = order[i++];
            }
            while (i < mid) order_tmp[k++] = order[i++];
            while (j < hi) order_tmp[k++] = order[j++];
        }
        for (fz_u32 k = 0; k < n; k++) order[k] = order_tmp[k];
    }
}

/* Ordena candidatos guardados em buf (formato do fz_rank). Devolve quantos índices gravou. */
[[maybe_unused]] static fz_u32 rank(fz_u32 *buf, fz_u32 buf_words, fz_u32 word_len, fz_u32 count)
{
    if (count > FZ_MAX_CANDIDATES) count = FZ_MAX_CANDIDATES;
    if (word_len > buf_words) return 0;
    const fz_u32 *word = buf;
    fz_u32 pos = word_len;
    fz_u32 n = 0;
    for (; n < count; n++) {
        if (pos >= buf_words) break;
        fz_u32 len = buf[pos++];
        if (len > buf_words - pos) break;
        dist_tmp[n] = distance(word, word_len, buf + pos, len);
        order[n] = n;
        pos += len;
    }
    sort_indices(n);
    for (fz_u32 k = 0; k < n; k++) buf[k] = order[k];
    return n;
}

} /* namespace fz */

#if defined(__wasm__) && !defined(FZ_NO_EXPORTS)

#define FZ_EXPORT(name) __attribute__((export_name(name), visibility("default")))

static fz_u32 fz_area[FZ_BUFFER_WORDS];

extern "C" {

FZ_EXPORT("fz_buffer") fz_u32 *fz_buffer(void)
{
    return fz_area;
}

FZ_EXPORT("fz_capacity") fz_u32 fz_capacity(void)
{
    return FZ_BUFFER_WORDS;
}

FZ_EXPORT("fz_distance") int fz_distance(fz_u32 alen, fz_u32 blen)
{
    if (alen > FZ_BUFFER_WORDS) alen = FZ_BUFFER_WORDS;
    if (blen > FZ_BUFFER_WORDS - alen) blen = FZ_BUFFER_WORDS - alen;
    return fz::distance(fz_area, alen, fz_area + alen, blen);
}

FZ_EXPORT("fz_rank") fz_u32 fz_rank(fz_u32 word_len, fz_u32 count)
{
    return fz::rank(fz_area, FZ_BUFFER_WORDS, word_len, count);
}

} /* extern "C" */

#endif
