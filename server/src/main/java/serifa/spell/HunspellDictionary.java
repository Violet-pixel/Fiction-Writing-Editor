/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.spell;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.Reader;
import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Dicionário no formato Hunspell, versão simplificada ("hunspell-lite" da especificação).
 *
 * <p>Lê do .aff apenas {@code SFX}, {@code PFX}, {@code REP}, {@code MAP}, {@code TRY},
 * {@code FORBIDDENWORD} e {@code NOSUGGEST}; do .dic, a lista de palavras com suas flags
 * (cada flag é um code point, como em {@code FLAG UTF-8}). Os afixos ficam indexados pelo texto
 * acrescentado para que cada consulta só examine os afixos possíveis.</p>
 */
public final class HunspellDictionary {

    /** Par de substituição REP. */
    public record Replacement(String from, String to) {
    }

    private final Map<String, String> palavras = new HashMap<>(400_000);
    private final Set<String> proibidas = new HashSet<>();
    private final Map<String, List<AffixEntry>> sufixos = new HashMap<>();
    private final Map<String, List<AffixEntry>> prefixos = new HashMap<>();
    private final List<Replacement> reps = new ArrayList<>();
    private final List<String> mapas = new ArrayList<>();
    private String tryChars = "";
    private int forbiddenFlag = -1;
    private int noSuggestFlag = -1;
    private int maxSufixo = 0;
    private int maxPrefixo = 0;
    private int totalAfixos = 0;

    private HunspellDictionary() {
    }

    /** Carrega o par .aff/.dic do disco. */
    public static HunspellDictionary load(Path aff, Path dic) throws IOException {
        try (Reader a = Files.newBufferedReader(aff, StandardCharsets.UTF_8);
             Reader d = Files.newBufferedReader(dic, StandardCharsets.UTF_8)) {
            return load(a, d);
        }
    }

    /** Carrega a partir de textos (útil nos testes). */
    public static HunspellDictionary fromStrings(String aff, String dic) {
        try {
            return load(new StringReader(aff), new StringReader(dic));
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Carrega a partir de leitores quaisquer. */
    public static HunspellDictionary load(Reader aff, Reader dic) throws IOException {
        HunspellDictionary h = new HunspellDictionary();
        h.lerAff(new BufferedReader(aff));
        h.lerDic(new BufferedReader(dic));
        return h;
    }

    private static String[] campos(String linha) {
        return linha.trim().split("[ \\t]+");
    }

    private static String zero(String s) {
        return "0".equals(s) ? "" : s;
    }

    private void lerAff(BufferedReader r) throws IOException {
        String linha;
        Map<String, Boolean> cross = new HashMap<>();
        while ((linha = r.readLine()) != null) {
            if (linha.isEmpty() || linha.charAt(0) == '#') {
                continue;
            }
            if (linha.charAt(0) == '﻿') {
                linha = linha.substring(1);
            }
            String[] f = campos(linha);
            if (f.length == 0) {
                continue;
            }
            switch (f[0]) {
                case "TRY" -> {
                    if (f.length > 1) {
                        tryChars = f[1];
                    }
                }
                case "FORBIDDENWORD" -> {
                    if (f.length > 1) {
                        forbiddenFlag = f[1].codePointAt(0);
                    }
                }
                case "NOSUGGEST" -> {
                    if (f.length > 1) {
                        noSuggestFlag = f[1].codePointAt(0);
                    }
                }
                case "REP" -> {
                    if (f.length >= 3) {
                        reps.add(new Replacement(f[1], f[2]));
                    }
                }
                case "MAP" -> {
                    if (f.length >= 2 && !f[1].chars().allMatch(Character::isDigit)) {
                        mapas.add(f[1]);
                    }
                }
                case "SFX", "PFX" -> {
                    boolean sfx = f[0].equals("SFX");
                    if (f.length == 4 && (f[2].equals("Y") || f[2].equals("N"))
                            && f[3].chars().allMatch(Character::isDigit)) {
                        cross.put(f[0] + f[1], f[2].equals("Y"));
                        continue;
                    }
                    if (f.length < 4) {
                        continue;
                    }
                    int flag = f[1].codePointAt(0);
                    String strip = zero(f[2]);
                    String add = f[3];
                    int barra = add.indexOf('/');
                    if (barra >= 0) {
                        add = add.substring(0, barra);
                    }
                    add = zero(add);
                    Condition cond = Condition.parse(f.length > 4 ? f[4] : ".");
                    boolean y = cross.getOrDefault(f[0] + f[1], false);
                    AffixEntry e = new AffixEntry(flag, sfx, y, strip, add, cond);
                    (sfx ? sufixos : prefixos).computeIfAbsent(add, k -> new ArrayList<>()).add(e);
                    if (sfx) {
                        maxSufixo = Math.max(maxSufixo, add.length());
                    } else {
                        maxPrefixo = Math.max(maxPrefixo, add.length());
                    }
                    totalAfixos++;
                }
                default -> {
                    // Diretivas que o hunspell-lite não usa (BREAK, KEY, COMPOUND...) são ignoradas.
                }
            }
        }
    }

    private void lerDic(BufferedReader r) throws IOException {
        String linha = r.readLine();
        if (linha == null) {
            return;
        }
        // A primeira linha é a contagem aproximada; se não for número, é uma palavra.
        if (!linha.trim().chars().allMatch(Character::isDigit) || linha.trim().isEmpty()) {
            adicionarLinha(linha);
        }
        while ((linha = r.readLine()) != null) {
            adicionarLinha(linha);
        }
    }

    private void adicionarLinha(String linha) {
        if (linha.isEmpty()) {
            return;
        }
        int tab = linha.indexOf('\t');
        if (tab >= 0) {
            linha = linha.substring(0, tab);
        }
        linha = linha.strip();
        if (linha.isEmpty()) {
            return;
        }
        String palavra = linha;
        String flags = "";
        int barra = linha.indexOf('/');
        while (barra == 0) {
            barra = linha.indexOf('/', 1);
        }
        if (barra > 0) {
            palavra = linha.substring(0, barra);
            flags = linha.substring(barra + 1);
            int espaco = flags.indexOf(' ');
            if (espaco >= 0) {
                flags = flags.substring(0, espaco);
            }
        }
        if (forbiddenFlag >= 0 && flags.indexOf(forbiddenFlag) >= 0) {
            proibidas.add(palavra);
            return;
        }
        String antigo = palavras.get(palavra);
        palavras.put(palavra, antigo == null ? flags : antigo + flags);
    }

    // ------------------------------------------------------------------ consultas

    /** Flags de uma palavra do .dic (entradas não proibidas), ou {@code null}. */
    public String flags(String palavra) {
        return palavras.get(palavra);
    }

    /** A palavra aparece no .dic marcada como proibida. */
    public boolean isForbidden(String palavra) {
        return proibidas.contains(palavra) && !palavras.containsKey(palavra);
    }

    private static boolean temFlag(String flags, int flag) {
        return flags != null && flags.indexOf(flag) >= 0;
    }

    /**
     * Procura a palavra exatamente como está (sem mexer em maiúsculas), seguindo os passos
     * (a)–(d) da especificação. Devolve as flags do radical que validou a palavra, ou
     * {@code null} quando a palavra não é reconhecida.
     */
    public String lookupFlags(String w) {
        if (w == null || w.isEmpty()) {
            return null;
        }
        String direto = palavras.get(w);
        if (direto != null) {
            return direto;
        }
        // (b) sufixos
        int limite = Math.min(maxSufixo, w.length());
        for (int len = 0; len <= limite; len++) {
            List<AffixEntry> lista = sufixos.get(w.substring(w.length() - len));
            if (lista == null) {
                continue;
            }
            for (AffixEntry e : lista) {
                String stem = e.undo(w);
                if (stem != null) {
                    String f = palavras.get(stem);
                    if (temFlag(f, e.flag())) {
                        return f;
                    }
                }
            }
        }
        // (c) prefixos e (d) prefixo + sufixo
        int limiteP = Math.min(maxPrefixo, w.length());
        for (int len = 0; len <= limiteP; len++) {
            List<AffixEntry> lista = prefixos.get(w.substring(0, len));
            if (lista == null) {
                continue;
            }
            for (AffixEntry p : lista) {
                String stem = p.undo(w);
                if (stem == null) {
                    continue;
                }
                String f = palavras.get(stem);
                if (temFlag(f, p.flag())) {
                    return f;
                }
                if (p.cross()) {
                    String cruzado = cruzar(stem, p);
                    if (cruzado != null) {
                        return cruzado;
                    }
                }
            }
        }
        return null;
    }

    private String cruzar(String stem1, AffixEntry prefixo) {
        int limite = Math.min(maxSufixo, stem1.length());
        for (int len = 0; len <= limite; len++) {
            List<AffixEntry> lista = sufixos.get(stem1.substring(stem1.length() - len));
            if (lista == null) {
                continue;
            }
            for (AffixEntry s : lista) {
                if (!s.cross()) {
                    continue;
                }
                String stem2 = s.undo(stem1);
                if (stem2 == null) {
                    continue;
                }
                String f = palavras.get(stem2);
                if (temFlag(f, prefixo.flag()) && temFlag(f, s.flag())) {
                    return f;
                }
            }
        }
        return null;
    }

    /** Verdadeiro se a palavra é reconhecida exatamente como escrita. */
    public boolean lookup(String w) {
        return lookupFlags(w) != null;
    }

    /** Verdadeiro se a palavra (ou o radical que a valida) tem a flag NOSUGGEST. */
    public boolean isNoSuggest(String w) {
        if (noSuggestFlag < 0) {
            return false;
        }
        String f = lookupFlags(w);
        return f != null && f.indexOf(noSuggestFlag) >= 0;
    }

    /** Gera as formas de um radical com seus afixos (sem cross product), para diagnóstico. */
    public List<String> expand(String radical) {
        String f = palavras.get(radical);
        List<String> r = new ArrayList<>();
        if (f == null) {
            return r;
        }
        r.add(radical);
        for (Map<String, List<AffixEntry>> mapa : List.of(sufixos, prefixos)) {
            for (List<AffixEntry> lista : mapa.values()) {
                for (AffixEntry e : lista) {
                    if (f.indexOf(e.flag()) >= 0) {
                        String forma = e.apply(radical);
                        if (forma != null && !r.contains(forma)) {
                            r.add(forma);
                        }
                    }
                }
            }
        }
        return r;
    }

    public List<Replacement> replacements() {
        return Collections.unmodifiableList(reps);
    }

    public List<String> maps() {
        return Collections.unmodifiableList(mapas);
    }

    public String tryChars() {
        return tryChars;
    }

    public int wordCount() {
        return palavras.size();
    }

    public int affixCount() {
        return totalAfixos;
    }
}
