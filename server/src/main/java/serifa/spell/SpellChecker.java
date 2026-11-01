/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.spell;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import serifa.json.JsonWritable;
import serifa.text.CharClass;

/**
 * Revisão ortográfica "hunspell-lite" (seção 3): tokenização, verificação com regras de
 * maiúsculas e hífen, e sugestões ordenadas por distância ponderada.
 */
public final class SpellChecker {

    /** Número máximo de sugestões devolvidas. */
    public static final int MAX_SUGESTOES = 6;

    private static final Locale PT_BR = Locale.forLanguageTag("pt-BR");

    /** Palavra encontrada no texto. */
    public record Token(String word, int start, int end) {
    }

    /** Palavra que não passou na verificação, com sugestões. */
    public record Misspelling(String word, int start, int end, List<String> suggestions) implements JsonWritable {
        @Override
        public Object toJson() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("word", word);
            m.put("start", start);
            m.put("end", end);
            m.put("suggestions", suggestions);
            return m;
        }
    }

    private final HunspellDictionary dic;
    private final List<String[]> grupos = new ArrayList<>();
    private final int[] tryCps;

    public SpellChecker(HunspellDictionary dic) {
        this.dic = dic;
        for (String mapa : dic.maps()) {
            grupos.add(mapa.codePoints().mapToObj(Character::toString).toArray(String[]::new));
        }
        this.tryCps = dic.tryChars().codePoints().toArray();
    }

    public HunspellDictionary dictionary() {
        return dic;
    }

    // ------------------------------------------------------------------ maiúsculas

    /** Todas as letras são maiúsculas (e há pelo menos uma). */
    public static boolean isAllUpper(String w) {
        boolean temLetra = false;
        for (int i = 0; i < w.length(); ) {
            int cp = w.codePointAt(i);
            i += Character.charCount(cp);
            if (Character.isLetter(cp)) {
                temLetra = true;
                if (!Character.isUpperCase(cp)) {
                    return false;
                }
            }
        }
        return temLetra;
    }

    /** Primeira letra maiúscula e as demais minúsculas. */
    public static boolean isCapitalized(String w) {
        if (w.isEmpty()) {
            return false;
        }
        int primeiro = w.codePointAt(0);
        if (!Character.isUpperCase(primeiro)) {
            return false;
        }
        for (int i = Character.charCount(primeiro); i < w.length(); ) {
            int cp = w.codePointAt(i);
            i += Character.charCount(cp);
            if (Character.isUpperCase(cp)) {
                return false;
            }
        }
        return true;
    }

    /** Coloca a primeira letra em maiúscula e o resto em minúscula. */
    public static String capitalize(String w) {
        if (w.isEmpty()) {
            return w;
        }
        int primeiro = w.codePointAt(0);
        int n = Character.charCount(primeiro);
        return new String(Character.toChars(Character.toUpperCase(primeiro))) + w.substring(n).toLowerCase(PT_BR);
    }

    public static String lower(String w) {
        return w.toLowerCase(PT_BR);
    }

    // ------------------------------------------------------------------ verificação

    /** Verifica uma palavra sem dicionário pessoal. */
    public boolean check(String word) {
        return check(word, Set.of());
    }

    /**
     * Verifica uma palavra. {@code pessoal} deve conter as palavras do dicionário pessoal já em
     * minúsculas (ver {@link #personalSet(Collection)}).
     */
    public boolean check(String word, Set<String> pessoal) {
        if (word == null || word.isEmpty()) {
            return true;
        }
        if (!pessoal.isEmpty() && pessoal.contains(lower(word))) {
            return true;
        }
        if (checkCase(word)) {
            return true;
        }
        if (word.indexOf('-') >= 0) {
            boolean algum = false;
            for (String parte : word.split("-")) {
                if (parte.isEmpty()) {
                    continue;
                }
                algum = true;
                if (!(pessoal.contains(lower(parte)) || checkCase(parte))) {
                    return false;
                }
            }
            return algum;
        }
        return false;
    }

    private boolean checkCase(String word) {
        if (dic.lookup(word)) {
            return true;
        }
        if (isAllUpper(word)) {
            String low = lower(word);
            return dic.lookup(low) || dic.lookup(capitalize(low));
        }
        if (isCapitalized(word)) {
            return dic.lookup(lower(word));
        }
        return false;
    }

    /** Normaliza o dicionário pessoal para comparação sem diferenciar maiúsculas. */
    public static Set<String> personalSet(Collection<String> palavras) {
        Set<String> r = new HashSet<>();
        if (palavras != null) {
            for (String p : palavras) {
                if (p != null && !p.isBlank()) {
                    r.add(lower(p.strip()));
                }
            }
        }
        return r;
    }

    // ------------------------------------------------------------------ tokenização

    private static boolean isJoiner(int cp) {
        return cp == '-' || cp == '\'' || cp == 0x2019;
    }

    /**
     * Separa o texto nas palavras que a revisão deve examinar. Ignora tokens com dígito colado,
     * de uma letra só, siglas em maiúsculas de até 4 letras e palavras dentro de URLs e e-mails.
     */
    public static List<Token> tokenize(String texto) {
        List<Token> r = new ArrayList<>();
        int n = texto.length();
        int i = 0;
        while (i < n) {
            int cp = texto.codePointAt(i);
            if (!CharClass.isWordChar(cp)) {
                i += Character.charCount(cp);
                continue;
            }
            int inicio = i;
            boolean temDigito = false;
            int j = i;
            while (j < n) {
                int c = texto.codePointAt(j);
                if (CharClass.isWordChar(c)) {
                    if (c >= '0' && c <= '9') {
                        temDigito = true;
                    }
                    j += Character.charCount(c);
                    continue;
                }
                if (isJoiner(c) && j > inicio) {
                    int anterior = texto.codePointBefore(j);
                    int k = j + Character.charCount(c);
                    if (k < n && CharClass.isLetter(anterior) && CharClass.isLetter(texto.codePointAt(k))) {
                        j = k;
                        continue;
                    }
                }
                break;
            }
            String palavra = texto.substring(inicio, j);
            i = j;
            if (temDigito) {
                continue;
            }
            int letras = palavra.codePointCount(0, palavra.length());
            if (letras <= 1) {
                continue;
            }
            if (letras <= 4 && isAllUpper(palavra)) {
                continue;
            }
            if (dentroDeEndereco(texto, inicio, j)) {
                continue;
            }
            r.add(new Token(palavra, inicio, j));
        }
        return r;
    }

    private static boolean dentroDeEndereco(String texto, int inicio, int fim) {
        int a = inicio;
        while (a > 0) {
            int cp = texto.codePointBefore(a);
            if (CharClass.isSpace(cp)) {
                break;
            }
            a -= Character.charCount(cp);
        }
        int b = fim;
        while (b < texto.length()) {
            int cp = texto.codePointAt(b);
            if (CharClass.isSpace(cp)) {
                break;
            }
            b += Character.charCount(cp);
        }
        String bloco = texto.substring(a, b);
        return bloco.contains("://") || bloco.toLowerCase(Locale.ROOT).contains("www.") || bloco.indexOf('@') >= 0;
    }

    /** Revisa um texto inteiro e devolve as palavras erradas, com sugestões. */
    public List<Misspelling> review(String texto, Collection<String> pessoal, boolean comSugestoes) {
        Set<String> p = personalSet(pessoal);
        List<Misspelling> r = new ArrayList<>();
        Map<String, List<String>> cache = new LinkedHashMap<>();
        for (Token t : tokenize(texto)) {
            if (check(t.word(), p)) {
                continue;
            }
            List<String> sugestoes = List.of();
            if (comSugestoes) {
                sugestoes = cache.computeIfAbsent(t.word(), w -> suggest(w, p));
            }
            r.add(new Misspelling(t.word(), t.start(), t.end(), sugestoes));
        }
        return r;
    }

    // ------------------------------------------------------------------ sugestões

    /** Sugere até {@link #MAX_SUGESTOES} grafias para uma palavra errada. */
    public List<String> suggest(String palavra) {
        return suggest(palavra, Set.of());
    }

    /** Sugestões levando em conta o dicionário pessoal. */
    public List<String> suggest(String palavra, Set<String> pessoal) {
        if (palavra == null || palavra.isEmpty()) {
            return List.of();
        }
        boolean caps = isAllUpper(palavra) && palavra.codePointCount(0, palavra.length()) > 1;
        boolean cap = !caps && isCapitalized(palavra);
        String base = (caps || cap) ? lower(palavra) : palavra;

        LinkedHashSet<String> candidatos = new LinkedHashSet<>();
        gerarRep(base, candidatos);
        gerarMap(base, candidatos);
        gerarEdicoes(base, candidatos);

        List<String> validos = new ArrayList<>();
        Set<String> vistos = new HashSet<>();
        for (String c : candidatos) {
            if (c.isEmpty() || c.equals(base) || !vistos.add(c)) {
                continue;
            }
            // com hífen, só vale se a palavra inteira estiver no dicionário ("e-mail" sim, "cacho-o" não)
            if (c.indexOf('-') >= 0 && !dic.lookup(c)) {
                continue;
            }
            if (candidatoValido(c, pessoal)) {
                validos.add(c);
            }
        }
        // Ordenação estável por distância (desempate = ordem de geração).
        List<double[]> pesos = new ArrayList<>();
        for (int i = 0; i < validos.size(); i++) {
            String c = validos.get(i);
            boolean separa = (c.indexOf(' ') >= 0 || c.indexOf('-') >= 0) && base.indexOf(' ') < 0 && base.indexOf('-') < 0;
            pesos.add(new double[] {WeightedDistance.distance(base, c, this) + (separa ? 0.6 : 0), i});
        }
        pesos.sort((x, y) -> x[0] != y[0] ? Double.compare(x[0], y[0]) : Double.compare(x[1], y[1]));
        List<String> r = new ArrayList<>();
        for (double[] p : pesos) {
            String s = validos.get((int) p[1]);
            if (caps) {
                s = s.toUpperCase(PT_BR);
            } else if (cap) {
                s = capitalize(s);
            }
            if (!r.contains(s)) {
                r.add(s);
            }
            if (r.size() >= MAX_SUGESTOES) {
                break;
            }
        }
        return r;
    }

    private boolean candidatoValido(String c, Set<String> pessoal) {
        if (c.indexOf(' ') >= 0) {
            for (String parte : c.split(" ")) {
                if (parte.codePointCount(0, parte.length()) < 2 || !check(parte, pessoal) || dic.isNoSuggest(parte)) {
                    return false;
                }
            }
            return true;
        }
        if (!check(c, pessoal)) {
            return false;
        }
        return !dic.isNoSuggest(c);
    }

    private void gerarRep(String w, Set<String> out) {
        for (HunspellDictionary.Replacement rep : dic.replacements()) {
            String de = rep.from();
            boolean inicio = de.startsWith("^");
            boolean fim = de.endsWith("$") && de.length() > 1;
            if (inicio) {
                de = de.substring(1);
            }
            if (fim) {
                de = de.substring(0, de.length() - 1);
            }
            de = de.replace('_', ' ');
            String para = rep.to().replace('_', ' ');
            if (de.isEmpty()) {
                continue;
            }
            if (inicio && fim) {
                if (w.equals(de)) {
                    out.add(para);
                }
                continue;
            }
            if (inicio) {
                if (w.startsWith(de)) {
                    out.add(para + w.substring(de.length()));
                }
                continue;
            }
            if (fim) {
                if (w.endsWith(de)) {
                    out.add(w.substring(0, w.length() - de.length()) + para);
                }
                continue;
            }
            int pos = w.indexOf(de);
            while (pos >= 0) {
                out.add(w.substring(0, pos) + para + w.substring(pos + de.length()));
                pos = w.indexOf(de, pos + 1);
            }
        }
    }

    /** Grupo MAP do caractere (ou -1). */
    int mapGroup(String ch) {
        for (int g = 0; g < grupos.size(); g++) {
            for (String s : grupos.get(g)) {
                if (s.equals(ch)) {
                    return g;
                }
            }
        }
        return -1;
    }

    private List<String> variantes(String ch) {
        List<String> r = new ArrayList<>();
        int g = mapGroup(ch);
        if (g < 0) {
            return r;
        }
        boolean maiuscula = Character.isUpperCase(ch.codePointAt(0));
        for (String s : grupos.get(g)) {
            if (!s.equals(ch) && Character.isUpperCase(s.codePointAt(0)) == maiuscula) {
                r.add(s);
            }
        }
        return r;
    }

    private void gerarMap(String w, Set<String> out) {
        String[] letras = w.codePoints().mapToObj(Character::toString).toArray(String[]::new);
        List<List<String>> vars = new ArrayList<>();
        for (String l : letras) {
            vars.add(variantes(l));
        }
        for (int i = 0; i < letras.length; i++) {
            for (String v : vars.get(i)) {
                String[] copia = letras.clone();
                copia[i] = v;
                out.add(String.join("", copia));
            }
        }
        for (int i = 0; i < letras.length; i++) {
            for (int j = i + 1; j < letras.length; j++) {
                for (String v1 : vars.get(i)) {
                    for (String v2 : vars.get(j)) {
                        String[] copia = letras.clone();
                        copia[i] = v1;
                        copia[j] = v2;
                        out.add(String.join("", copia));
                    }
                }
            }
        }
    }

    private void gerarEdicoes(String w, Set<String> out) {
        int[] cps = w.codePoints().toArray();
        int n = cps.length;
        // remover
        for (int i = 0; i < n; i++) {
            out.add(junta(cps, 0, i) + junta(cps, i + 1, n));
        }
        // trocar vizinhas
        for (int i = 0; i + 1 < n; i++) {
            if (cps[i] == cps[i + 1]) {
                continue;
            }
            int[] c = cps.clone();
            c[i] = cps[i + 1];
            c[i + 1] = cps[i];
            out.add(new String(c, 0, n));
        }
        // substituir
        for (int i = 0; i < n; i++) {
            for (int t : tryCps) {
                if (t == cps[i]) {
                    continue;
                }
                int[] c = cps.clone();
                c[i] = t;
                out.add(new String(c, 0, n));
            }
        }
        // inserir
        for (int i = 0; i <= n; i++) {
            String a = junta(cps, 0, i);
            String b = junta(cps, i, n);
            for (int t : tryCps) {
                out.add(a + new String(Character.toChars(t)) + b);
            }
        }
    }

    private static String junta(int[] cps, int de, int ate) {
        return ate <= de ? "" : new String(cps, de, ate - de);
    }
}
