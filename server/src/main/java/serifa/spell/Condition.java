/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.spell;

import java.util.ArrayList;
import java.util.List;

/**
 * Condição de afixo do Hunspell: sequência de elementos, cada um sendo {@code .} (qualquer
 * letra), uma classe {@code [abc]}, uma classe negada {@code [^abc]} ou um literal.
 * Trabalha com code points para não quebrar letras fora do plano básico.
 */
public final class Condition {

    private static final Condition QUALQUER = new Condition(new int[0][], new boolean[0], "." );

    /** Conjunto de code points de cada posição; {@code null} = qualquer caractere. */
    private final int[][] sets;
    private final boolean[] negated;
    private final String origem;

    private Condition(int[][] sets, boolean[] negated, String origem) {
        this.sets = sets;
        this.negated = negated;
        this.origem = origem;
    }

    /** Interpreta o texto da condição; "." sozinho vira a condição vazia (sempre verdadeira). */
    public static Condition parse(String texto) {
        if (texto == null || texto.isEmpty() || texto.equals(".")) {
            return QUALQUER;
        }
        List<int[]> conjuntos = new ArrayList<>();
        List<Boolean> negacoes = new ArrayList<>();
        int i = 0;
        while (i < texto.length()) {
            int cp = texto.codePointAt(i);
            if (cp == '[') {
                int fim = texto.indexOf(']', i + 1);
                if (fim < 0) {
                    // Classe sem fechamento: trata o resto como literais.
                    fim = texto.length();
                }
                int j = i + 1;
                boolean neg = false;
                if (j < fim && texto.charAt(j) == '^') {
                    neg = true;
                    j++;
                }
                conjuntos.add(texto.substring(j, fim).codePoints().toArray());
                negacoes.add(neg);
                i = Math.min(fim + 1, texto.length());
            } else if (cp == '.') {
                conjuntos.add(null);
                negacoes.add(false);
                i++;
            } else {
                conjuntos.add(new int[] {cp});
                negacoes.add(false);
                i += Character.charCount(cp);
            }
        }
        boolean[] neg = new boolean[negacoes.size()];
        for (int k = 0; k < neg.length; k++) {
            neg[k] = negacoes.get(k);
        }
        return new Condition(conjuntos.toArray(new int[0][]), neg, texto);
    }

    /** Número de posições que a condição examina. */
    public int length() {
        return sets.length;
    }

    private boolean matchesAt(int indice, int cp) {
        int[] set = sets[indice];
        if (set == null) {
            return true;
        }
        boolean achou = false;
        for (int c : set) {
            if (c == cp) {
                achou = true;
                break;
            }
        }
        return negated[indice] != achou;
    }

    /** A condição bate com o FIM do radical (sufixos). */
    public boolean matchesEnd(String radical) {
        if (sets.length == 0) {
            return true;
        }
        int[] cps = radical.codePoints().toArray();
        if (cps.length < sets.length) {
            return false;
        }
        int base = cps.length - sets.length;
        for (int k = 0; k < sets.length; k++) {
            if (!matchesAt(k, cps[base + k])) {
                return false;
            }
        }
        return true;
    }

    /** A condição bate com o COMEÇO do radical (prefixos). */
    public boolean matchesStart(String radical) {
        if (sets.length == 0) {
            return true;
        }
        int[] cps = radical.codePoints().limit(sets.length).toArray();
        if (cps.length < sets.length) {
            return false;
        }
        for (int k = 0; k < sets.length; k++) {
            if (!matchesAt(k, cps[k])) {
                return false;
            }
        }
        return true;
    }

    @Override
    public String toString() {
        return origem;
    }
}
