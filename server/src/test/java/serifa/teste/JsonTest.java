/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.teste;

import static serifa.teste.TestRunner.igual;
import static serifa.teste.TestRunner.lanca;
import static serifa.teste.TestRunner.verdade;

import java.util.List;
import java.util.Map;
import serifa.json.Json;
import serifa.json.JsonException;
import serifa.teste.TestRunner.Teste;

/** Testes do leitor/gerador de JSON. */
public class JsonTest {

    @Teste
    public void leValoresBasicos() {
        Map<String, Object> m = Json.parseObject("{\"a\":1,\"b\":-2.5,\"c\":true,\"d\":null,\"e\":\"x\\ny\",\"f\":[1,2]}");
        igual(1L, m.get("a"));
        igual(-2.5, m.get("b"));
        igual(Boolean.TRUE, m.get("c"));
        verdade(m.containsKey("d") && m.get("d") == null, "null deveria existir");
        igual("x\ny", m.get("e"));
        igual(List.of(1L, 2L), m.get("f"));
    }

    @Teste
    public void escapesUnicodeESurrogates() {
        igual("ã😀", Json.parse("\"\\u00e3\\ud83d\\ude00\""));
        igual("\"\\u0001\"", Json.stringify("\u0001"));
    }

    @Teste
    public void idaEVolta() {
        String s = "{\"título\":\"Olá, “mundo”\",\"n\":[1,2.5,{\"x\":[]}],\"v\":false}";
        igual(s, Json.stringify(Json.parse(s)));
        igual(Json.parse(s), Json.parse(Json.pretty(Json.parse(s), 2)));
    }

    @Teste
    public void rejeitaJsonInvalido() {
        for (String ruim : new String[] {"", "{", "[1,]", "{\"a\" 1}", "01", "1.", "\"abc", "tru", "{} x", "\"\t\"", "-"}) {
            lanca(JsonException.class, () -> Json.parse(ruim));
        }
    }

    @Teste
    public void limitaProfundidade() {
        String fundo = "[".repeat(500) + "]".repeat(500);
        JsonException e = lanca(JsonException.class, () -> Json.parse(fundo));
        verdade(e.getMessage().contains("aninhado"), "mensagem deveria falar de aninhamento");
        igual(3, ((List<?>) Json.parse("[[[]]]", 3)).size() + 2);
    }

    @Teste
    public void informaLinhaEColuna() {
        JsonException e = lanca(JsonException.class, () -> Json.parse("{\n  \"a\": x\n}"));
        igual(2, e.linha());
    }

    @Teste
    public void numerosGrandesEDecimais() {
        igual(9007199254740993L, Json.parse("9007199254740993"));
        igual(1.0e30, Json.parse("1e30"));
        igual("3", Json.stringify(3.0));
        igual("0.1", Json.stringify(0.1));
    }

    @Teste
    public void copiaProfunda() {
        Map<String, Object> m = Json.parseObject("{\"a\":{\"b\":[1]}}");
        @SuppressWarnings("unchecked")
        Map<String, Object> c = (Map<String, Object>) Json.deepCopy(m);
        Json.obj(c, "a").put("b", "x");
        igual(List.of(1L), Json.obj(m, "a").get("b"));
    }
}
