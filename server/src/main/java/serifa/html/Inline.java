/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.html;

import java.util.Locale;
import serifa.text.CharClass;

/**
 * Renderização do conteúdo inline de um bloco em cada formato de saída, com a normalização de
 * espaços da seção 7: sequências de espaço viram um só, sem espaço no começo nem no fim.
 */
public final class Inline {

    /** Formato de saída inline. */
    public enum Mode {
        /** Texto puro, sem marcação ({@code br} vira quebra de linha). */
        TEXT,
        /** Wattpad: b, i, u e br. */
        WATTPAD,
        /** AO3: strong, em, u, s, sub, sup, a[href] e br. */
        AO3,
        /** Markdown: **negrito**, *itálico*, ~~tachado~~ e links. */
        MARKDOWN,
        /** HTML limpo para exportação HTML/EPUB (XHTML). */
        XHTML
    }

    private Inline() {
    }

    private static final class Estado {
        final StringBuilder sb = new StringBuilder();
        final Mode modo;
        boolean espacoPendente;
        boolean temTexto;
        boolean espacoEmitido;
        int caracteres;

        Estado(Mode modo) {
            this.modo = modo;
        }

        void texto(String s) {
            for (int i = 0; i < s.length(); ) {
                int cp = s.codePointAt(i);
                i += Character.charCount(cp);
                if (CharClass.isSpace(cp)) {
                    if (temTexto && !espacoEmitido) {
                        espacoPendente = true;
                    }
                    continue;
                }
                if (espacoPendente) {
                    sb.append(' ');
                    espacoPendente = false;
                }
                espacoEmitido = false;
                temTexto = true;
                caracteres++;
                if (modo == Mode.TEXT) {
                    sb.appendCodePoint(cp);
                } else if (modo == Mode.MARKDOWN) {
                    if ("*_`[]\\<>#".indexOf(cp) >= 0 && cp < 128) {
                        sb.append('\\');
                    }
                    sb.appendCodePoint(cp);
                } else {
                    switch (cp) {
                        case '&' -> sb.append("&amp;");
                        case '<' -> sb.append("&lt;");
                        case '>' -> sb.append("&gt;");
                        default -> sb.appendCodePoint(cp);
                    }
                }
            }
        }

        void marca(String m) {
            sb.append(m);
        }

        void quebraDeLinha() {
            espacoPendente = false;
            switch (modo) {
                case TEXT -> sb.append('\n');
                case WATTPAD -> sb.append("<br>");
                case AO3, XHTML -> sb.append("<br />");
                case MARKDOWN -> sb.append("  \n");
                default -> {
                }
            }
            temTexto = false;
        }
    }

    /** Renderiza os filhos de um nó no formato pedido. */
    public static String render(HtmlNode n, Mode modo) {
        if (n == null) {
            return "";
        }
        Estado e = new Estado(modo);
        for (HtmlNode f : n.children()) {
            renderizar(f, e);
        }
        String r = e.sb.toString();
        // Quebras de linha no fim do bloco não fazem sentido.
        String[] finais = {"<br>", "<br />", "\n", "  \n"};
        boolean mudou = true;
        while (mudou) {
            mudou = false;
            for (String f : finais) {
                if (r.endsWith(f)) {
                    r = r.substring(0, r.length() - f.length());
                    mudou = true;
                }
            }
        }
        return r;
    }

    private static boolean linkSeguro(String href) {
        if (href == null) {
            return false;
        }
        String h = href.trim().toLowerCase(Locale.ROOT);
        return h.startsWith("http://") || h.startsWith("https://");
    }

    private static void envolver(HtmlNode n, Estado e, String abre, String fecha) {
        int antes = e.sb.length();
        int caracteresAntes = e.caracteres;
        boolean pendente = e.espacoPendente;
        if (pendente && e.temTexto) {
            // O espaço pendente fica fora da marcação: "a <b>b</b>".
            e.sb.append(' ');
            e.espacoPendente = false;
            e.espacoEmitido = true;
        }
        int depoisEspaco = e.sb.length();
        e.marca(abre);
        for (HtmlNode f : n.children()) {
            renderizar(f, e);
        }
        if (e.caracteres == caracteresAntes) {
            // Marcação vazia: desfaz.
            e.sb.setLength(antes);
            e.espacoPendente = pendente || e.espacoPendente;
            e.espacoEmitido = false;
            return;
        }
        e.marca(fecha);
        if (depoisEspaco < antes) {
            return;
        }
    }

    private static void renderizar(HtmlNode n, Estado e) {
        if (n.isText()) {
            e.texto(n.textValue());
            return;
        }
        String tag = n.tag();
        if (tag.equals("br")) {
            e.quebraDeLinha();
            return;
        }
        if (tag.equals("img")) {
            String src = n.attr("src");
            String alt = n.attr("alt") == null ? "" : n.attr("alt");
            if (e.modo == Mode.XHTML && src != null && !src.toLowerCase(Locale.ROOT).startsWith("javascript:")) {
                e.marca("<img src=\"" + HtmlReader.escapeAttr(src) + "\" alt=\"" + HtmlReader.escapeAttr(alt) + "\" />");
            } else if (e.modo == Mode.MARKDOWN && src != null && !src.startsWith("data:")) {
                e.marca("![" + alt.replace("]", "") + "](" + src.replace(")", "%29") + ")");
            }
            return;
        }
        Mode m = e.modo;
        switch (tag) {
            case "strong", "b" -> {
                switch (m) {
                    case WATTPAD -> envolver(n, e, "<b>", "</b>");
                    case AO3, XHTML -> envolver(n, e, "<strong>", "</strong>");
                    case MARKDOWN -> envolver(n, e, "**", "**");
                    default -> filhos(n, e);
                }
            }
            case "em", "i" -> {
                switch (m) {
                    case WATTPAD -> envolver(n, e, "<i>", "</i>");
                    case AO3, XHTML -> envolver(n, e, "<em>", "</em>");
                    case MARKDOWN -> envolver(n, e, "*", "*");
                    default -> filhos(n, e);
                }
            }
            case "u" -> {
                if (m == Mode.WATTPAD || m == Mode.AO3 || m == Mode.XHTML) {
                    envolver(n, e, "<u>", "</u>");
                } else {
                    filhos(n, e);
                }
            }
            case "s", "strike", "del" -> {
                if (m == Mode.AO3 || m == Mode.XHTML) {
                    envolver(n, e, "<s>", "</s>");
                } else if (m == Mode.MARKDOWN) {
                    envolver(n, e, "~~", "~~");
                } else {
                    filhos(n, e);
                }
            }
            case "sub", "sup" -> {
                if (m == Mode.AO3 || m == Mode.XHTML) {
                    envolver(n, e, "<" + tag + ">", "</" + tag + ">");
                } else {
                    filhos(n, e);
                }
            }
            case "a" -> {
                String href = n.attr("href");
                if ((m == Mode.AO3 || m == Mode.XHTML) && linkSeguro(href)) {
                    envolver(n, e, "<a href=\"" + HtmlReader.escapeAttr(href.trim()) + "\">", "</a>");
                } else if (m == Mode.MARKDOWN && linkSeguro(href)) {
                    envolver(n, e, "[", "](" + href.trim().replace(")", "%29") + ")");
                } else {
                    filhos(n, e);
                }
            }
            default -> filhos(n, e);
        }
    }

    private static void filhos(HtmlNode n, Estado e) {
        for (HtmlNode f : n.children()) {
            renderizar(f, e);
        }
    }
}
