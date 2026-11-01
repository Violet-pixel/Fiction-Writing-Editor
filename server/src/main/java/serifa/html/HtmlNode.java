/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.html;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Nó da árvore de HTML: elemento (com atributos e filhos) ou texto. */
public final class HtmlNode {

    private final String tag;
    private final String text;
    private final Map<String, String> attrs;
    private final List<HtmlNode> children = new ArrayList<>();
    private HtmlNode parent;

    private HtmlNode(String tag, String text, Map<String, String> attrs) {
        this.tag = tag;
        this.text = text;
        this.attrs = attrs;
    }

    /** Cria um elemento. */
    public static HtmlNode element(String tag, Map<String, String> attrs) {
        return new HtmlNode(tag.toLowerCase(Locale.ROOT), null, attrs == null ? new LinkedHashMap<>() : attrs);
    }

    /** Cria um nó de texto (já com entidades decodificadas). */
    public static HtmlNode text(String texto) {
        return new HtmlNode(null, texto, Map.of());
    }

    public boolean isText() {
        return tag == null;
    }

    public boolean is(String nome) {
        return tag != null && tag.equals(nome);
    }

    public String tag() {
        return tag;
    }

    public String textValue() {
        return text;
    }

    public Map<String, String> attrs() {
        return attrs;
    }

    public String attr(String nome) {
        return attrs.get(nome);
    }

    public List<HtmlNode> children() {
        return children;
    }

    public HtmlNode parent() {
        return parent;
    }

    public void add(HtmlNode filho) {
        filho.parent = this;
        children.add(filho);
    }

    /** Verdadeiro se o atributo class contém a classe pedida. */
    public boolean hasClass(String classe) {
        String c = attrs.get("class");
        if (c == null) {
            return false;
        }
        for (String parte : c.trim().split("\\s+")) {
            if (parte.equals(classe)) {
                return true;
            }
        }
        return false;
    }

    /** Valor de uma propriedade do atributo style (ex.: text-align), em minúsculas. */
    public String style(String propriedade) {
        String s = attrs.get("style");
        if (s == null) {
            return null;
        }
        for (String decl : s.split(";")) {
            int dois = decl.indexOf(':');
            if (dois < 0) {
                continue;
            }
            if (decl.substring(0, dois).trim().equalsIgnoreCase(propriedade)) {
                return decl.substring(dois + 1).trim().toLowerCase(Locale.ROOT);
            }
        }
        return null;
    }

    /** Texto de todos os descendentes (sem normalizar espaços); {@code br} vira quebra de linha. */
    public String allText() {
        StringBuilder sb = new StringBuilder();
        juntarTexto(this, sb);
        return sb.toString();
    }

    private static void juntarTexto(HtmlNode n, StringBuilder sb) {
        if (n.isText()) {
            sb.append(n.text);
            return;
        }
        if (n.is("br")) {
            sb.append('\n');
            return;
        }
        for (HtmlNode f : n.children) {
            juntarTexto(f, sb);
        }
    }

    /** Verdadeiro se algum descendente é uma imagem. */
    public boolean hasImage() {
        if (is("img")) {
            return true;
        }
        for (HtmlNode f : children) {
            if (f.hasImage()) {
                return true;
            }
        }
        return false;
    }

    @Override
    public String toString() {
        return isText() ? "#text(" + text + ")" : "<" + tag + attrs + ">" + children;
    }
}
