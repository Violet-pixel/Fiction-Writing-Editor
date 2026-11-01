/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.model;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import serifa.json.Json;

/**
 * Documento de projeto {@code .serifa} (seção 6). Guarda o mapa JSON original (para não perder
 * campos desconhecidos) e oferece acesso tipado e validação com mensagens em português.
 */
public final class Project {

    public static final Set<String> FORMAT_MODES = Set.of("livro", "wattpad", "ao3");
    public static final Set<String> PAGE_SIZES = Set.of("a4", "a5", "carta", "oficio", "livro-6x9", "bolso-5x8", "b5");
    public static final Set<String> ORIENTATIONS = Set.of("retrato", "paisagem");
    public static final Set<String> MARGINS = Set.of("normal", "estreita", "moderada", "larga", "espelhada");
    public static final Set<String> PAPERS = Set.of("branca", "marfim", "pautada", "quadriculada", "antiga", "noturna");
    public static final Set<String> STATUS = Set.of("rascunho", "revisao", "pronto");
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    /** Capítulo já lido do JSON. */
    public record Chapter(String id, String title, int position, String html, String notes, String status) {
    }

    private final Map<String, Object> doc;

    private Project(Map<String, Object> doc) {
        this.doc = doc;
    }

    /** Envolve um mapa JSON (sem validar). */
    public static Project wrap(Map<String, Object> doc) {
        return new Project(doc);
    }

    /** Cria um projeto novo e vazio com um capítulo. */
    public static Project create(String titulo) {
        String agora = now();
        Map<String, Object> cap = Json.mapOf("id", UUID.randomUUID().toString(), "title", "Capítulo 1", "position", 0,
                "html", "<p></p>", "notes", "", "status", "rascunho", "words", 0, "updatedAt", agora);
        Map<String, Object> settings = Json.mapOf("formatMode", "livro", "pageSize", "a5", "orientation", "retrato",
                "margins", "normal", "paper", "branca", "fontFamily", "Georgia", "fontSize", 12, "lineHeight", 1.5,
                "firstLineIndent", true, "dailyGoal", 1000, "sceneBreak", "* * *");
        List<Object> caps = new ArrayList<>();
        caps.add(cap);
        return new Project(Json.mapOf("format", "serifa", "version", 1, "id", UUID.randomUUID().toString(),
                "title", titulo == null || titulo.isBlank() ? "Sem título" : titulo, "author", "", "language", "pt-BR",
                "createdAt", agora, "updatedAt", agora, "settings", settings, "chapters", caps,
                "dictionary", new ArrayList<>(), "ignored", new ArrayList<>()));
    }

    /** Data/hora atual em ISO 8601 com milissegundos (igual ao {@code toISOString()} do JS). */
    public static String now() {
        return Instant.now().truncatedTo(ChronoUnit.MILLIS).toString().replaceFirst("(\\d{2}:\\d{2}:\\d{2})Z$", "$1.000Z");
    }

    /** Verdadeiro se o identificador é seguro para nomes de arquivo e URLs. */
    public static boolean isValidId(String id) {
        return id != null && ID.matcher(id).matches();
    }

    /** Valida o documento; devolve a lista de problemas (vazia = válido). */
    public List<String> validate() {
        List<String> erros = new ArrayList<>();
        if (!"serifa".equals(doc.get("format"))) {
            erros.add("O campo 'format' precisa ser \"serifa\".");
        }
        if (Json.num(doc, "version", -1) != 1) {
            erros.add("Versão de projeto não suportada (esperava 1).");
        }
        if (!isValidId(Json.str(doc, "id", null))) {
            erros.add("O campo 'id' está ausente ou tem caracteres inválidos.");
        }
        String titulo = Json.str(doc, "title", null);
        if (titulo == null || titulo.isBlank()) {
            erros.add("O projeto precisa de um título.");
        } else if (titulo.length() > 300) {
            erros.add("O título do projeto passa de 300 caracteres.");
        }
        Map<String, Object> s = Json.obj(doc, "settings");
        if (s != null) {
            checar(erros, s, "formatMode", FORMAT_MODES);
            checar(erros, s, "pageSize", PAGE_SIZES);
            checar(erros, s, "orientation", ORIENTATIONS);
            checar(erros, s, "margins", MARGINS);
            checar(erros, s, "paper", PAPERS);
            double fonte = Json.dbl(s, "fontSize", 12);
            if (fonte < 6 || fonte > 72) {
                erros.add("Tamanho de fonte fora do intervalo 6–72.");
            }
            double linha = Json.dbl(s, "lineHeight", 1.5);
            if (linha < 0.8 || linha > 4) {
                erros.add("Entrelinha fora do intervalo 0,8–4.");
            }
        }
        Object caps = doc.get("chapters");
        if (!(caps instanceof List)) {
            erros.add("O campo 'chapters' precisa ser uma lista.");
        } else {
            int i = 0;
            for (Object o : (List<?>) caps) {
                i++;
                if (!(o instanceof Map)) {
                    erros.add("O capítulo " + i + " não é um objeto.");
                    continue;
                }
                @SuppressWarnings("unchecked")
                Map<String, Object> c = (Map<String, Object>) o;
                if (!isValidId(Json.str(c, "id", null))) {
                    erros.add("O capítulo " + i + " tem 'id' ausente ou inválido.");
                }
                if (!(c.get("html") instanceof String)) {
                    erros.add("O capítulo " + i + " não tem o campo 'html'.");
                }
                String st = Json.str(c, "status", "rascunho");
                if (!STATUS.contains(st)) {
                    erros.add("O capítulo " + i + " tem status desconhecido: " + st + ".");
                }
            }
        }
        return erros;
    }

    private static void checar(List<String> erros, Map<String, Object> s, String campo, Set<String> validos) {
        Object v = s.get(campo);
        if (v != null && !(v instanceof String str && validos.contains(str))) {
            erros.add("Valor inválido em settings." + campo + ": " + v + ".");
        }
    }

    public Map<String, Object> json() {
        return doc;
    }

    public String id() {
        return Json.str(doc, "id", "");
    }

    public String title() {
        return Json.str(doc, "title", "Sem título");
    }

    public String author() {
        return Json.str(doc, "author", "");
    }

    public String language() {
        return Json.str(doc, "language", "pt-BR");
    }

    public String updatedAt() {
        return Json.str(doc, "updatedAt", "");
    }

    /** Configuração (texto) com padrão. */
    public String setting(String campo, String padrao) {
        return Json.str(Json.obj(doc, "settings"), campo, padrao);
    }

    public double settingNumber(String campo, double padrao) {
        return Json.dbl(Json.obj(doc, "settings"), campo, padrao);
    }

    public boolean settingBool(String campo, boolean padrao) {
        return Json.bool(Json.obj(doc, "settings"), campo, padrao);
    }

    public String sceneBreak() {
        String s = setting("sceneBreak", "* * *");
        return s.isBlank() ? "* * *" : s;
    }

    public List<String> dictionary() {
        return Json.strings(doc, "dictionary");
    }

    public List<String> ignored() {
        return Json.strings(doc, "ignored");
    }

    /** Capítulos em ordem de {@code position}. */
    @SuppressWarnings("unchecked")
    public List<Chapter> chapters() {
        List<Chapter> r = new ArrayList<>();
        int i = 0;
        for (Object o : Json.list(doc, "chapters")) {
            if (o instanceof Map) {
                Map<String, Object> c = (Map<String, Object>) o;
                r.add(new Chapter(Json.str(c, "id", "cap-" + i), Json.str(c, "title", "Capítulo " + (i + 1)),
                        (int) Json.num(c, "position", i), Json.str(c, "html", ""), Json.str(c, "notes", ""),
                        Json.str(c, "status", "rascunho")));
            }
            i++;
        }
        r.sort(Comparator.comparingInt(Chapter::position));
        return r;
    }

    /** Capítulo pelo id, ou {@code null}. */
    public Chapter chapter(String id) {
        for (Chapter c : chapters()) {
            if (c.id().equals(id)) {
                return c;
            }
        }
        return null;
    }
}
