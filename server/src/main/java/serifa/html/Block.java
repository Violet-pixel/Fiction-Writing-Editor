/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.html;

import java.util.ArrayList;
import java.util.List;
import serifa.text.Dialogue;

/**
 * Bloco do modelo de exportação (seção 7): tipo, nível (para títulos), alinhamento, nó com o
 * conteúdo inline e o texto normalizado.
 *
 * @param type    {@code p}, {@code h}, {@code quote}, {@code li}, {@code cena}, {@code quebra}
 * @param level   1–3 para títulos, 0 nos demais
 * @param align   {@code center}, {@code right} ou {@code null}
 * @param content nó cujos filhos são o conteúdo inline (pode ser {@code null} em cena/quebra)
 * @param text    texto com espaços normalizados
 * @param ordered para itens de lista: se a lista é numerada
 */
public record Block(String type, int level, String align, HtmlNode content, String text, boolean ordered) {

    public static final String P = "p";
    public static final String H = "h";
    public static final String QUOTE = "quote";
    public static final String LI = "li";
    public static final String CENA = "cena";
    public static final String QUEBRA = "quebra";

    /** Fala segundo a regra da seção 2 (cena e quebra nunca são falas). */
    public boolean isDialogue() {
        return !CENA.equals(type) && !QUEBRA.equals(type) && Dialogue.isDialogue(text);
    }

    public boolean hasImage() {
        return content != null && content.hasImage();
    }

    /** Converte o HTML de um capítulo na lista de blocos. */
    public static List<Block> fromHtml(String html) {
        List<Block> r = new ArrayList<>();
        HtmlNode raiz = HtmlReader.parse(html);
        coletar(raiz, r, null);
        return r;
    }

    private static String alinhamento(HtmlNode n) {
        String a = n.style("text-align");
        if (a == null) {
            a = n.attr("align");
        }
        if (a == null) {
            return null;
        }
        a = a.trim().toLowerCase(java.util.Locale.ROOT);
        return a.equals("center") || a.equals("right") ? a : null;
    }

    private static void coletar(HtmlNode pai, List<Block> r, String alinhamentoHerdado) {
        HtmlNode soltos = null;
        for (HtmlNode n : pai.children()) {
            boolean inline = n.isText() || !isBlockTag(n.tag());
            if (inline) {
                if (soltos == null) {
                    soltos = HtmlNode.element("p", null);
                }
                soltos.add(copiar(n));
                continue;
            }
            if (soltos != null) {
                adicionar(r, P, 0, alinhamentoHerdado, soltos, false);
                soltos = null;
            }
            String tag = n.tag();
            String al = alinhamento(n) != null ? alinhamento(n) : alinhamentoHerdado;
            switch (tag) {
                case "p" -> adicionar(r, P, 0, al, n, false);
                case "h1", "h2", "h3", "h4", "h5", "h6" -> adicionar(r, H, Math.min(3, tag.charAt(1) - '0'), al, n, false);
                case "blockquote" -> {
                    boolean temBlocos = n.children().stream().anyMatch(f -> !f.isText() && isBlockTag(f.tag()));
                    if (temBlocos) {
                        List<Block> internos = new ArrayList<>();
                        coletar(n, internos, al);
                        for (Block b : internos) {
                            r.add(b.type().equals(P) ? new Block(QUOTE, 0, b.align(), b.content(), b.text(), false) : b);
                        }
                    } else {
                        adicionar(r, QUOTE, 0, al, n, false);
                    }
                }
                case "ul", "ol" -> {
                    for (HtmlNode li : n.children()) {
                        if (li.is("li")) {
                            adicionar(r, LI, 0, alinhamento(li) != null ? alinhamento(li) : al, li, tag.equals("ol"));
                        }
                    }
                }
                case "li" -> adicionar(r, LI, 0, al, n, false);
                case "hr" -> r.add(new Block(CENA, 0, null, null, "", false));
                case "div" -> {
                    if (n.hasClass("quebra-pagina")) {
                        r.add(new Block(QUEBRA, 0, null, null, "", false));
                    } else if (n.hasClass("cena")) {
                        r.add(new Block(CENA, 0, null, null, "", false));
                    } else {
                        coletar(n, r, al);
                    }
                }
                case "table", "thead", "tbody" -> {
                    for (HtmlNode tr : linhas(n)) {
                        HtmlNode p = HtmlNode.element("p", null);
                        boolean primeiro = true;
                        for (HtmlNode td : tr.children()) {
                            if (td.is("td") || td.is("th")) {
                                if (!primeiro) {
                                    p.add(HtmlNode.text(" | "));
                                }
                                primeiro = false;
                                for (HtmlNode f : td.children()) {
                                    p.add(copiar(f));
                                }
                            }
                        }
                        adicionar(r, P, 0, al, p, false);
                    }
                }
                case "tr" -> {
                    HtmlNode t = HtmlNode.element("table", null);
                    t.add(copiar(n));
                    List<Block> x = new ArrayList<>();
                    coletar(wrap(t), x, al);
                    r.addAll(x);
                }
                case "figure" -> {
                    HtmlNode p = HtmlNode.element("p", null);
                    for (HtmlNode f : n.children()) {
                        if (f.is("figcaption")) {
                            p.add(HtmlNode.element("br", null));
                            for (HtmlNode g : f.children()) {
                                p.add(copiar(g));
                            }
                        } else {
                            p.add(copiar(f));
                        }
                    }
                    adicionar(r, P, 0, al != null ? al : "center", p, false);
                }
                default -> coletar(n, r, al);
            }
        }
        if (soltos != null) {
            adicionar(r, P, 0, alinhamentoHerdado, soltos, false);
        }
    }

    private static HtmlNode wrap(HtmlNode n) {
        HtmlNode raiz = HtmlNode.element("#root", null);
        raiz.add(n);
        return raiz;
    }

    private static List<HtmlNode> linhas(HtmlNode tabela) {
        List<HtmlNode> r = new ArrayList<>();
        for (HtmlNode f : tabela.children()) {
            if (f.is("tr")) {
                r.add(f);
            } else if (f.is("thead") || f.is("tbody") || f.is("tfoot")) {
                r.addAll(linhas(f));
            }
        }
        return r;
    }

    private static HtmlNode copiar(HtmlNode n) {
        if (n.isText()) {
            return HtmlNode.text(n.textValue());
        }
        HtmlNode c = HtmlNode.element(n.tag(), new java.util.LinkedHashMap<>(n.attrs()));
        for (HtmlNode f : n.children()) {
            c.add(copiar(f));
        }
        return c;
    }

    static boolean isBlockTag(String tag) {
        return switch (tag) {
            case "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "hr", "div", "table",
                 "thead", "tbody", "tr", "figure" -> true;
            default -> false;
        };
    }

    private static void adicionar(List<Block> r, String tipo, int nivel, String al, HtmlNode n, boolean ordenada) {
        String texto = Inline.render(n, Inline.Mode.TEXT);
        if (texto.isEmpty() && !n.hasImage()) {
            return;
        }
        r.add(new Block(tipo, nivel, al, n, texto, ordenada));
    }
}
