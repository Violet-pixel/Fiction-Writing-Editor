/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.text;

import java.util.ArrayList;
import java.util.List;

/** Regra de fala (seção 2) e utilidades para separar trechos falados dentro da narração. */
public final class Dialogue {

    private Dialogue() {
    }

    /**
     * Um parágrafo é fala se, depois de tirar os espaços do começo, começa com travessão,
     * meia-risca, barra horizontal, hífen seguido de espaço ou aspas de abertura.
     */
    public static boolean isDialogue(String paragrafo) {
        if (paragrafo == null) {
            return false;
        }
        int i = 0;
        while (i < paragrafo.length()) {
            int cp = paragrafo.codePointAt(i);
            if (!CharClass.isSpace(cp)) {
                break;
            }
            i += Character.charCount(cp);
        }
        if (i >= paragrafo.length()) {
            return false;
        }
        int cp = paragrafo.codePointAt(i);
        if (cp == 0x2014 || cp == 0x2013 || cp == 0x2015 || cp == 0x201C || cp == '"' || cp == 0xAB) {
            return true;
        }
        if (cp == '-') {
            int prox = i + 1;
            return prox < paragrafo.length() && CharClass.isSpace(paragrafo.codePointAt(prox));
        }
        return false;
    }

    /** Intervalo [início, fim) em unidades UTF-16. */
    public record Span(int start, int end) {
        public boolean contains(int pos) {
            return pos >= start && pos < end;
        }
    }

    /**
     * Encontra os trechos entre aspas curvas “...” (e retas "..." pareadas) dentro de um texto,
     * para que as regras de narração não se apliquem a falas citadas no meio do parágrafo.
     */
    public static List<Span> quotedSpans(String texto) {
        List<Span> r = new ArrayList<>();
        int abertura = -1;
        boolean reta = false;
        for (int i = 0; i < texto.length(); i++) {
            char c = texto.charAt(i);
            if (abertura < 0) {
                if (c == '“' || c == '«') {
                    abertura = i;
                    reta = false;
                } else if (c == '"') {
                    abertura = i;
                    reta = true;
                }
            } else {
                if ((!reta && (c == '”' || c == '»')) || (reta && c == '"')) {
                    r.add(new Span(abertura, i + 1));
                    abertura = -1;
                } else if (c == '\n') {
                    r.add(new Span(abertura, i));
                    abertura = -1;
                }
            }
        }
        if (abertura >= 0) {
            r.add(new Span(abertura, texto.length()));
        }
        return r;
    }
}
