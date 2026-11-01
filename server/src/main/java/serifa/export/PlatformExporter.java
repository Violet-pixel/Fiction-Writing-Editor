/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.export;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import serifa.html.Block;
import serifa.html.HtmlReader;
import serifa.html.Inline;
import serifa.json.Json;

/**
 * Exportação de um capítulo para Wattpad, AO3 e texto puro (seção 7). A saída precisa ser
 * idêntica à do front-end em JavaScript; as fixtures de {@code tests/fixtures/exportacao.json}
 * garantem isso.
 */
public final class PlatformExporter {

    /** Linha vazia usada por Wattpad e AO3. */
    public static final String LINHA_VAZIA = "<p>&nbsp;</p>";

    /** Formatos suportados. */
    public enum Format {
        WATTPAD, AO3, TXT;

        public static Format parse(String s) {
            return switch (s == null ? "" : s.trim().toLowerCase(java.util.Locale.ROOT)) {
                case "wattpad" -> WATTPAD;
                case "ao3" -> AO3;
                case "txt", "texto" -> TXT;
                default -> throw new IllegalArgumentException("Formato desconhecido: " + s);
            };
        }
    }

    /** Opções de espaçamento e símbolo de cena. */
    public record Options(boolean blankBetweenParagraphs, boolean blankBeforeDialogue, boolean blankAfterDialogue,
                          String sceneBreak) {

        public static Options defaults(Format f) {
            return switch (f) {
                case WATTPAD -> new Options(false, true, true, "* * *");
                case AO3 -> new Options(false, true, false, "* * *");
                case TXT -> new Options(false, false, false, "* * *");
            };
        }

        /** Lê as opções de um objeto JSON, partindo dos padrões do formato. */
        public static Options fromJson(Format f, Map<String, Object> m) {
            Options d = defaults(f);
            if (m == null) {
                return d;
            }
            return new Options(Json.bool(m, "blankBetweenParagraphs", d.blankBetweenParagraphs),
                    Json.bool(m, "blankBeforeDialogue", d.blankBeforeDialogue),
                    Json.bool(m, "blankAfterDialogue", d.blankAfterDialogue),
                    Json.str(m, "sceneBreak", d.sceneBreak));
        }

        public Options withSceneBreak(String s) {
            return new Options(blankBetweenParagraphs, blankBeforeDialogue, blankAfterDialogue,
                    s == null || s.isBlank() ? sceneBreak : s);
        }
    }

    private PlatformExporter() {
    }

    /** Exporta o HTML de um capítulo. */
    public static String export(String html, Format formato, Options opcoes) {
        return export(Block.fromHtml(html), formato, opcoes);
    }

    /** Exporta uma lista de blocos já lida. */
    public static String export(List<Block> blocos, Format formato, Options opcoes) {
        if (opcoes == null) {
            opcoes = Options.defaults(formato);
        }
        if (formato == Format.TXT) {
            List<String> partes = new ArrayList<>();
            for (Block b : blocos) {
                String s = texto(b, opcoes);
                if (s != null && !s.isEmpty()) {
                    partes.add(s);
                }
            }
            return String.join("\n\n", partes);
        }
        List<String> linhas = new ArrayList<>();
        Block anterior = null;
        for (Block b : blocos) {
            String linha = formato == Format.WATTPAD ? wattpad(b, opcoes) : ao3(b, opcoes);
            if (linha == null) {
                continue;
            }
            if (anterior != null) {
                boolean fala = b.isDialogue();
                boolean falaAntes = anterior.isDialogue();
                boolean vazia = opcoes.blankBetweenParagraphs()
                        || (opcoes.blankBeforeDialogue() && fala && !falaAntes)
                        || (opcoes.blankAfterDialogue() && !fala && falaAntes);
                if (vazia) {
                    linhas.add(LINHA_VAZIA);
                }
            }
            linhas.add(linha);
            anterior = b;
        }
        return String.join("\n", linhas);
    }

    private static String texto(Block b, Options o) {
        return switch (b.type()) {
            case Block.CENA -> o.sceneBreak();
            case Block.QUEBRA -> null;
            default -> Inline.render(b.content(), Inline.Mode.TEXT);
        };
    }

    private static String wattpad(Block b, Options o) {
        switch (b.type()) {
            case Block.QUEBRA:
                return null;
            case Block.CENA:
                return "<p style=\"text-align:center\">" + HtmlReader.escape(o.sceneBreak()) + "</p>";
            case Block.H:
                return "<p style=\"text-align:center\"><b>" + HtmlReader.escape(b.text()) + "</b></p>";
            case Block.QUOTE: {
                String inline = Inline.render(b.content(), Inline.Mode.WATTPAD);
                return inline.isEmpty() ? null : "<p><i>" + inline + "</i></p>";
            }
            default: {
                String inline = Inline.render(b.content(), Inline.Mode.WATTPAD);
                if (inline.isEmpty()) {
                    return null;
                }
                String abre = b.align() == null ? "<p>" : "<p style=\"text-align:" + b.align() + "\">";
                return abre + inline + "</p>";
            }
        }
    }

    private static String ao3(Block b, Options o) {
        switch (b.type()) {
            case Block.QUEBRA:
                return null;
            case Block.CENA:
                return "<hr />";
            case Block.H:
                return "<h3>" + HtmlReader.escape(b.text()) + "</h3>";
            case Block.QUOTE: {
                String inline = Inline.render(b.content(), Inline.Mode.AO3);
                return inline.isEmpty() ? null : "<blockquote><p>" + inline + "</p></blockquote>";
            }
            default: {
                String inline = Inline.render(b.content(), Inline.Mode.AO3);
                if (inline.isEmpty()) {
                    return null;
                }
                String abre = b.align() == null ? "<p>" : "<p align=\"" + b.align() + "\">";
                return abre + inline + "</p>";
            }
        }
    }
}
