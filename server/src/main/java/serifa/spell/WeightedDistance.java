/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.spell;

/**
 * Distância de Damerau-Levenshtein (versão "optimal string alignment") com custos ponderados:
 * trocar por uma variante do mesmo grupo MAP custa 0,3; por uma letra vizinha no teclado
 * ABNT2 custa 0,7; qualquer outra operação custa 1.
 */
public final class WeightedDistance {

    /** Custo de trocar por variante do grupo MAP (acentos). */
    public static final double CUSTO_MAP = 0.3;
    /** Custo de trocar por letra vizinha no teclado. */
    public static final double CUSTO_TECLADO = 0.7;

    private static final String[] LINHAS = {"qwertyuiop", "asdfghjklç", "zxcvbnm"};

    private WeightedDistance() {
    }

    /** As duas letras são vizinhas no teclado ABNT2 (só letras minúsculas sem acento e ç). */
    public static boolean keyboardNeighbors(int a, int b) {
        a = Character.toLowerCase(a);
        b = Character.toLowerCase(b);
        int ra = -1;
        int ca = -1;
        int rb = -1;
        int cb = -1;
        for (int r = 0; r < LINHAS.length; r++) {
            int ia = LINHAS[r].indexOf(a);
            if (ia >= 0) {
                ra = r;
                ca = ia;
            }
            int ib = LINHAS[r].indexOf(b);
            if (ib >= 0) {
                rb = r;
                cb = ib;
            }
        }
        if (ra < 0 || rb < 0 || a == b) {
            return false;
        }
        if (ra == rb) {
            return Math.abs(ca - cb) == 1;
        }
        if (Math.abs(ra - rb) != 1) {
            return false;
        }
        // Linha de cima: coluna c encosta nas colunas c-1 e c da linha de baixo.
        int cimaC = ra < rb ? ca : cb;
        int baixoC = ra < rb ? cb : ca;
        return baixoC == cimaC || baixoC == cimaC - 1;
    }

    private static double custoTroca(int a, int b, SpellChecker sc) {
        if (a == b) {
            return 0;
        }
        if (sc != null) {
            int ga = sc.mapGroup(new String(Character.toChars(a)));
            if (ga >= 0 && ga == sc.mapGroup(new String(Character.toChars(b)))) {
                return CUSTO_MAP;
            }
        }
        if (keyboardNeighbors(a, b)) {
            return CUSTO_TECLADO;
        }
        return 1;
    }

    /** Distância ponderada entre duas palavras. */
    public static double distance(String x, String y, SpellChecker sc) {
        int[] a = x.codePoints().toArray();
        int[] b = y.codePoints().toArray();
        int n = a.length;
        int m = b.length;
        double[][] d = new double[n + 1][m + 1];
        for (int i = 0; i <= n; i++) {
            d[i][0] = i;
        }
        for (int j = 0; j <= m; j++) {
            d[0][j] = j;
        }
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= m; j++) {
                double troca = d[i - 1][j - 1] + custoTroca(a[i - 1], b[j - 1], sc);
                double v = Math.min(Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1), troca);
                if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) {
                    v = Math.min(v, d[i - 2][j - 2] + 1);
                }
                d[i][j] = v;
            }
        }
        // Arredonda para evitar diferenças de ponto flutuante entre linguagens.
        return Math.round(d[n][m] * 1000.0) / 1000.0;
    }
}
