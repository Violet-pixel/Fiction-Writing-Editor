/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.teste;

import static serifa.teste.TestRunner.igual;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import serifa.export.PlatformExporter;
import serifa.ideas.Idea;
import serifa.json.Json;
import serifa.spell.SpellChecker;
import serifa.teste.TestRunner.Teste;
import serifa.text.TextStats;

/** Executa todas as fixtures de paridade de {@code tests/fixtures/}. */
public class FixturesTest {

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> casos(String arquivo) throws IOException {
        Path p = Recursos.fixtures().resolve(arquivo);
        Object v = Json.parse(Files.readString(p, StandardCharsets.UTF_8));
        List<Map<String, Object>> r = new ArrayList<>();
        if (v instanceof Map<?, ?> m && m.get("casos") instanceof List<?> l) {
            v = l;
        }
        for (Object o : (List<Object>) v) {
            r.add((Map<String, Object>) o);
        }
        return r;
    }

    @Teste
    public void contagem() throws IOException {
        for (Map<String, Object> c : casos("contagem.json")) {
            String t = Json.str(c, "text", "");
            Map<String, Object> esperado = Json.obj(c, "expected");
            @SuppressWarnings("unchecked")
            Map<String, Object> obtido = (Map<String, Object>) TextStats.of(t).toJson();
            for (String k : esperado.keySet()) {
                igual(esperado.get(k), obtido.get(k), "contagem de " + Json.stringify(t) + " campo " + k);
            }
        }
    }

    @Teste
    public void ortografia() throws IOException {
        SpellChecker sc = Recursos.ENGINE.speller();
        for (Map<String, Object> c : casos("ortografia.json")) {
            String t = Json.str(c, "text", "");
            List<SpellChecker.Misspelling> erros = sc.review(t, Json.strings(c, "personal"), false);
            List<Object> obtido = new ArrayList<>();
            for (SpellChecker.Misspelling m : erros) {
                obtido.add(Json.mapOf("word", m.word(), "start", (long) m.start(), "end", (long) m.end()));
            }
            igual(Json.stringify(c.get("expected")), Json.stringify(obtido), "ortografia de " + t);
            Map<String, Object> primeiras = Json.obj(c, "firstSuggestions");
            if (primeiras != null) {
                for (Map.Entry<String, Object> e : primeiras.entrySet()) {
                    List<String> s = sc.suggest(e.getKey());
                    igual(e.getValue(), s.isEmpty() ? null : s.get(0), "1ª sugestão para " + e.getKey());
                }
            }
        }
    }

    @Teste
    public void ideias() throws IOException {
        for (Map<String, Object> c : casos("ideias.json")) {
            String t = Json.str(c, "text", "");
            List<Object> obtido = new ArrayList<>();
            for (Idea i : Recursos.ENGINE.ideas().analyze(t)) {
                obtido.add(Json.mapOf("rule", i.rule(), "start", (long) i.start(), "end", (long) i.end()));
            }
            List<Object> esperado = new ArrayList<>();
            for (Object o : (List<?>) c.get("expected")) {
                @SuppressWarnings("unchecked")
                Map<String, Object> e = (Map<String, Object>) o;
                esperado.add(Json.mapOf("rule", e.get("rule"), "start", e.get("start"), "end", e.get("end")));
            }
            igual(Json.stringify(esperado), Json.stringify(obtido), "ideias de " + t);
        }
    }

    @Teste
    public void exportacao() throws IOException {
        for (Map<String, Object> c : casos("exportacao.json")) {
            PlatformExporter.Format f = PlatformExporter.Format.parse(Json.str(c, "format", ""));
            String obtido = PlatformExporter.export(Json.str(c, "html", ""), f,
                    PlatformExporter.Options.fromJson(f, Json.obj(c, "options")));
            igual(Json.str(c, "expected", null), obtido, "exportação " + f + " de " + Json.str(c, "html", ""));
        }
    }

    @Teste
    public void paridadeCompartilhadaSeExistir() throws IOException {
        Path p = Recursos.fixtures().resolve("paridade.json");
        if (!Files.exists(p)) {
            return;
        }
        Object doc = Json.parse(Files.readString(p, StandardCharsets.UTF_8));
        if (doc instanceof Map<?, ?> m && m.get("contagem") instanceof List<?> lista) {
            for (Object o : lista) {
                if (o instanceof Map<?, ?> caso && caso.get("text") instanceof String t && caso.get("expected") instanceof Map<?, ?> esp) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> obtido = (Map<String, Object>) TextStats.of(t).toJson();
                    for (Object k : esp.keySet()) {
                        igual(esp.get(k), obtido.get(String.valueOf(k)), "paridade " + Json.stringify(t) + " " + k);
                    }
                }
            }
        }
    }
}
