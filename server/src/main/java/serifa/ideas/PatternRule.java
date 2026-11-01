/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.ideas;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;
import serifa.json.Json;

/**
 * Regra por padrão vinda de {@code web/dados/regras.json}. O miolo do padrão é envolvido por
 * {@code (?<!\p{L})(?:PADRAO)(?!\p{L})} e compilado sem diferenciar maiúsculas, exatamente como
 * o front-end faz com as flags {@code giu}.
 */
public record PatternRule(String id, String category, String pattern, String message, String suggestion,
                          Pattern compiled) {

    /** Categorias aceitas pela especificação. */
    public static final List<String> CATEGORIAS =
            List.of("pleonasmo", "concordancia", "crase", "ortografia", "sentido", "estilo", "tempo-verbal");

    private static final int FLAGS =
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE | Pattern.UNICODE_CHARACTER_CLASS;

    /** Compila o padrão do jeito que o motor usa. */
    public static Pattern compile(String miolo) {
        return Pattern.compile("(?<!\\p{L})(?:" + miolo + ")(?!\\p{L})", FLAGS);
    }

    /** Lê uma regra do JSON, validando campos obrigatórios. */
    public static PatternRule fromJson(Map<String, Object> m) {
        String id = Json.str(m, "id", null);
        String padrao = Json.str(m, "padrao", null);
        if (id == null || id.isBlank() || padrao == null || padrao.isEmpty()) {
            throw new IllegalArgumentException("Regra sem 'id' ou sem 'padrao'.");
        }
        String categoria = Json.str(m, "categoria", "estilo");
        if (!CATEGORIAS.contains(categoria)) {
            throw new IllegalArgumentException("Categoria desconhecida na regra " + id + ": " + categoria);
        }
        try {
            return new PatternRule(id, categoria, padrao, Json.str(m, "mensagem", ""),
                    Json.str(m, "sugestao", ""), compile(padrao));
        } catch (PatternSyntaxException e) {
            throw new IllegalArgumentException("Padrão inválido na regra " + id + ": " + e.getDescription(), e);
        }
    }

    /** Lê todas as regras do documento {@code regras.json}. */
    @SuppressWarnings("unchecked")
    public static List<PatternRule> listFromJson(Map<String, Object> doc) {
        List<PatternRule> r = new ArrayList<>();
        for (Object o : Json.list(doc, "regras")) {
            if (o instanceof Map) {
                r.add(fromJson((Map<String, Object>) o));
            }
        }
        return r;
    }

    /** Aplica a regra ao texto e devolve as ocorrências. */
    public List<Idea> apply(String texto) {
        List<Idea> r = new ArrayList<>();
        Matcher m = compiled.matcher(texto);
        while (m.find()) {
            if (m.end() == m.start()) {
                continue;
            }
            r.add(new Idea(id, category, m.start(), m.end(), message, suggestion));
        }
        return r;
    }
}
