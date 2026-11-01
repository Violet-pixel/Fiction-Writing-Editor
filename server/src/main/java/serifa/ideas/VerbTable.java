/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.ideas;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import serifa.json.Json;

/**
 * Tabela de formas verbais montada a partir de {@code web/dados/verbos.json}: conjuga os verbos
 * regulares (com os ajustes ortográficos de -car, -gar, -çar, -cer, -ger e -gir), junta os
 * irregulares e descarta os homógrafos. Cada forma sabe em que tempo(s) e pessoa(s) aparece.
 */
public final class VerbTable {

    /** Tempos verbais conhecidos. */
    public static final String PRESENTE = "presente";
    public static final String PERFEITO = "perfeito";
    public static final String IMPERFEITO = "imperfeito";
    private static final List<String> TEMPOS = List.of(PRESENTE, PERFEITO, IMPERFEITO);

    /** Ocorrência de uma forma: verbo (infinitivo), tempo e índice da pessoa (0=1s, 1=3s, 2=1p, 3=3p). */
    public record Use(String verb, String tense, int person) {
    }

    private final List<String> pessoas;
    private final Map<String, List<Use>> formas = new HashMap<>();
    private final Map<String, Map<String, List<String>>> conjugacoes = new LinkedHashMap<>();
    private final Set<String> homografos = new HashSet<>();

    private VerbTable(List<String> pessoas) {
        this.pessoas = pessoas;
    }

    /** Monta a tabela a partir do JSON de verbos. */
    @SuppressWarnings("unchecked")
    public static VerbTable fromJson(Map<String, Object> json) {
        List<String> pessoas = Json.strings(json, "pessoas");
        if (pessoas.isEmpty()) {
            pessoas = List.of("1s", "3s", "1p", "3p");
        }
        VerbTable t = new VerbTable(pessoas);
        Map<String, Object> term = Json.obj(json, "terminacoes");
        for (String verbo : Json.strings(json, "regulares")) {
            if (verbo.length() < 3) {
                continue;
            }
            String tipo = verbo.substring(verbo.length() - 2);
            Map<String, Object> fins = Json.obj(term, tipo);
            if (fins == null) {
                continue;
            }
            String radical = verbo.substring(0, verbo.length() - 2);
            Map<String, List<String>> conj = new LinkedHashMap<>();
            for (String tempo : TEMPOS) {
                List<String> lista = new ArrayList<>();
                List<String> terminacoes = Json.strings(fins, tempo);
                for (int p = 0; p < terminacoes.size(); p++) {
                    lista.add(ajustar(verbo, radical, tempo, p, terminacoes.get(p)));
                }
                conj.put(tempo, lista);
            }
            t.adicionar(verbo, conj, true);
        }
        Map<String, Object> irregulares = Json.obj(json, "irregulares");
        if (irregulares != null) {
            for (Map.Entry<String, Object> e : irregulares.entrySet()) {
                if (!(e.getValue() instanceof Map)) {
                    continue;
                }
                Map<String, Object> tempos = (Map<String, Object>) e.getValue();
                Map<String, List<String>> conj = new LinkedHashMap<>();
                for (String tempo : TEMPOS) {
                    conj.put(tempo, Json.strings(tempos, tempo));
                }
                t.adicionar(e.getKey(), conj, false);
            }
        }
        for (String h : Json.strings(json, "homografos")) {
            t.homografos.add(h.toLowerCase(Locale.ROOT));
        }
        return t;
    }

    /** Aplica as regras ortográficas da conjugação regular. */
    static String ajustar(String verbo, String radical, String tempo, int pessoa, String terminacao) {
        if (pessoa == 0 && PERFEITO.equals(tempo)) {
            if (verbo.endsWith("car")) {
                return verbo.substring(0, verbo.length() - 3) + "quei";
            }
            if (verbo.endsWith("gar")) {
                return verbo.substring(0, verbo.length() - 3) + "guei";
            }
            if (verbo.endsWith("çar")) {
                return verbo.substring(0, verbo.length() - 3) + "cei";
            }
        }
        if (pessoa == 0 && PRESENTE.equals(tempo)) {
            if (verbo.endsWith("cer")) {
                return verbo.substring(0, verbo.length() - 3) + "ço";
            }
            if (verbo.endsWith("ger") || verbo.endsWith("gir")) {
                return verbo.substring(0, verbo.length() - 3) + "jo";
            }
        }
        return radical + terminacao;
    }

    /**
     * Registra as formas no índice. Dos verbos regulares, o presente da 1ª pessoa do singular NÃO
     * entra no índice ("cheiro", "olho", "canto" colidem com substantivos), mas continua disponível
     * em {@link #form(String, String, int)} para sugestões.
     */
    private void adicionar(String verbo, Map<String, List<String>> conj, boolean regular) {
        conjugacoes.put(verbo, conj);
        for (Map.Entry<String, List<String>> e : conj.entrySet()) {
            List<String> lista = e.getValue();
            for (int p = 0; p < lista.size(); p++) {
                if (regular && p == 0 && PRESENTE.equals(e.getKey())) {
                    continue;
                }
                String forma = lista.get(p).toLowerCase(Locale.ROOT);
                Use uso = new Use(verbo, e.getKey(), p);
                List<Use> usos = formas.computeIfAbsent(forma, k -> new ArrayList<>());
                if (!usos.contains(uso)) {
                    usos.add(uso);
                }
            }
        }
    }

    /** Usos de uma forma (vazio para homógrafos ou formas desconhecidas). */
    public List<Use> uses(String forma) {
        String f = forma.toLowerCase(Locale.ROOT);
        if (homografos.contains(f)) {
            return List.of();
        }
        return formas.getOrDefault(f, List.of());
    }

    /** O tempo da forma se for único; {@code null} se desconhecida, homógrafa ou ambígua. */
    public String tense(String forma) {
        String tempo = null;
        for (Use u : uses(forma)) {
            if (tempo == null) {
                tempo = u.tense();
            } else if (!tempo.equals(u.tense())) {
                return null;
            }
        }
        return tempo;
    }

    /** Verdadeiro para perfeito ou imperfeito. */
    public static boolean isPast(String tempo) {
        return PERFEITO.equals(tempo) || IMPERFEITO.equals(tempo);
    }

    /** A pessoa da forma se for única (e o tempo também); senão -1. */
    public int person(String forma) {
        int pessoa = -1;
        if (tense(forma) == null) {
            return -1;
        }
        for (Use u : uses(forma)) {
            if (pessoa < 0) {
                pessoa = u.person();
            } else if (pessoa != u.person()) {
                return -1;
            }
        }
        return pessoa;
    }

    /** Forma de um verbo num tempo e pessoa, ou {@code null}. */
    public String form(String verbo, String tempo, int pessoa) {
        Map<String, List<String>> conj = conjugacoes.get(verbo);
        if (conj == null) {
            return null;
        }
        List<String> lista = conj.get(tempo);
        if (lista == null || pessoa < 0 || pessoa >= lista.size()) {
            return null;
        }
        return lista.get(pessoa);
    }

    /** Todas as conjugações conhecidas (verbo → tempo → formas). */
    public Map<String, Map<String, List<String>>> conjugations() {
        return conjugacoes;
    }

    public boolean isHomograph(String forma) {
        return homografos.contains(forma.toLowerCase(Locale.ROOT));
    }

    public List<String> persons() {
        return pessoas;
    }

    public int verbCount() {
        return conjugacoes.size();
    }
}
