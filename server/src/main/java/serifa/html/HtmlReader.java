/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.html;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Leitor tolerante do subconjunto de HTML usado nos capítulos (seção 6). Não executa nada,
 * ignora comentários, {@code script} e {@code style}, fecha tags esquecidas e decodifica as
 * entidades mais comuns. Não é um parser HTML5 completo — nem precisa ser, porque o editor já
 * entrega o HTML sanitizado.
 */
public final class HtmlReader {

    private static final Set<String> VAZIOS = Set.of("br", "hr", "img", "meta", "link", "input", "wbr", "col");
    private static final Set<String> BLOCOS = Set.of("p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul",
            "ol", "li", "div", "table", "tr", "td", "th", "figure", "figcaption", "hr", "thead", "tbody");
    private static final Set<String> IGNORAR_CONTEUDO = Set.of("script", "style", "template", "iframe", "object");
    private static final Map<String, String> ENTIDADES = Map.ofEntries(
            Map.entry("amp", "&"), Map.entry("lt", "<"), Map.entry("gt", ">"), Map.entry("quot", "\""),
            Map.entry("apos", "'"), Map.entry("nbsp", " "), Map.entry("mdash", "—"),
            Map.entry("ndash", "–"), Map.entry("hellip", "…"), Map.entry("laquo", "«"),
            Map.entry("raquo", "»"), Map.entry("ldquo", "“"), Map.entry("rdquo", "”"),
            Map.entry("lsquo", "‘"), Map.entry("rsquo", "’"), Map.entry("copy", "©"),
            Map.entry("ordm", "º"), Map.entry("ordf", "ª"), Map.entry("deg", "°"),
            Map.entry("middot", "·"), Map.entry("bull", "•"), Map.entry("shy", "­"));

    private HtmlReader() {
    }

    /** Lê um fragmento e devolve um nó raiz artificial ({@code #root}) com os nós de topo. */
    public static HtmlNode parse(String html) {
        HtmlNode raiz = HtmlNode.element("#root", null);
        if (html == null || html.isEmpty()) {
            return raiz;
        }
        Deque<HtmlNode> pilha = new ArrayDeque<>();
        pilha.push(raiz);
        int i = 0;
        int n = html.length();
        StringBuilder texto = new StringBuilder();
        while (i < n) {
            char c = html.charAt(i);
            if (c != '<') {
                texto.append(c);
                i++;
                continue;
            }
            if (html.startsWith("<!--", i)) {
                int fim = html.indexOf("-->", i + 4);
                i = fim < 0 ? n : fim + 3;
                continue;
            }
            if (html.startsWith("<!", i) || html.startsWith("<?", i)) {
                int fim = html.indexOf('>', i);
                i = fim < 0 ? n : fim + 1;
                continue;
            }
            boolean fechamento = i + 1 < n && html.charAt(i + 1) == '/';
            int inicioNome = i + (fechamento ? 2 : 1);
            int j = inicioNome;
            while (j < n && (Character.isLetterOrDigit(html.charAt(j)) || html.charAt(j) == '-')) {
                j++;
            }
            if (j == inicioNome) {
                // "<" solto no texto
                texto.append(c);
                i++;
                continue;
            }
            descarregarTexto(texto, pilha.peek());
            String nome = html.substring(inicioNome, j).toLowerCase(Locale.ROOT);
            int fimTag = acharFimDaTag(html, j);
            String miolo = html.substring(j, Math.max(j, fimTag));
            i = fimTag < n ? fimTag + 1 : n;
            if (fechamento) {
                fechar(pilha, nome);
                continue;
            }
            if (IGNORAR_CONTEUDO.contains(nome)) {
                int fim = html.toLowerCase(Locale.ROOT).indexOf("</" + nome, i);
                if (fim < 0) {
                    i = n;
                } else {
                    int gt = html.indexOf('>', fim);
                    i = gt < 0 ? n : gt + 1;
                }
                continue;
            }
            Map<String, String> atributos = lerAtributos(miolo);
            HtmlNode el = HtmlNode.element(nome, atributos);
            if (BLOCOS.contains(nome)) {
                // Um bloco novo fecha parágrafos abertos (comportamento do HTML).
                while (pilha.size() > 1 && pilha.peek().is("p") && !nome.equals("li")) {
                    pilha.pop();
                }
                if (nome.equals("li")) {
                    while (pilha.size() > 1 && (pilha.peek().is("li") || pilha.peek().is("p"))) {
                        if (pilha.peek().is("li")) {
                            pilha.pop();
                            break;
                        }
                        pilha.pop();
                    }
                }
            }
            pilha.peek().add(el);
            boolean autoFechado = miolo.endsWith("/");
            if (!VAZIOS.contains(nome) && !autoFechado) {
                pilha.push(el);
            }
        }
        descarregarTexto(texto, pilha.peek());
        return raiz;
    }

    private static int acharFimDaTag(String html, int de) {
        char aspas = 0;
        for (int k = de; k < html.length(); k++) {
            char c = html.charAt(k);
            if (aspas != 0) {
                if (c == aspas) {
                    aspas = 0;
                }
            } else if (c == '"' || c == '\'') {
                aspas = c;
            } else if (c == '>') {
                return k;
            }
        }
        return html.length();
    }

    private static void fechar(Deque<HtmlNode> pilha, String nome) {
        boolean existe = false;
        for (HtmlNode n : pilha) {
            if (n.is(nome)) {
                existe = true;
                break;
            }
        }
        if (!existe) {
            return;
        }
        while (pilha.size() > 1) {
            HtmlNode topo = pilha.pop();
            if (topo.is(nome)) {
                return;
            }
        }
    }

    private static void descarregarTexto(StringBuilder texto, HtmlNode pai) {
        if (texto.length() == 0) {
            return;
        }
        pai.add(HtmlNode.text(decode(texto.toString())));
        texto.setLength(0);
    }

    static Map<String, String> lerAtributos(String miolo) {
        Map<String, String> r = new LinkedHashMap<>();
        int i = 0;
        int n = miolo.length();
        while (i < n) {
            while (i < n && (Character.isWhitespace(miolo.charAt(i)) || miolo.charAt(i) == '/')) {
                i++;
            }
            int ini = i;
            while (i < n && !Character.isWhitespace(miolo.charAt(i)) && miolo.charAt(i) != '=' && miolo.charAt(i) != '/') {
                i++;
            }
            if (i == ini) {
                i++;
                continue;
            }
            String nome = miolo.substring(ini, i).toLowerCase(Locale.ROOT);
            while (i < n && Character.isWhitespace(miolo.charAt(i))) {
                i++;
            }
            String valor = "";
            if (i < n && miolo.charAt(i) == '=') {
                i++;
                while (i < n && Character.isWhitespace(miolo.charAt(i))) {
                    i++;
                }
                if (i < n && (miolo.charAt(i) == '"' || miolo.charAt(i) == '\'')) {
                    char q = miolo.charAt(i++);
                    int fim = miolo.indexOf(q, i);
                    if (fim < 0) {
                        fim = n;
                    }
                    valor = miolo.substring(i, fim);
                    i = Math.min(n, fim + 1);
                } else {
                    int v = i;
                    while (i < n && !Character.isWhitespace(miolo.charAt(i))) {
                        i++;
                    }
                    valor = miolo.substring(v, i);
                }
            }
            if (!nome.startsWith("on")) {
                r.putIfAbsent(nome, decode(valor));
            }
        }
        return r;
    }

    /** Decodifica entidades nomeadas comuns e numéricas. */
    public static String decode(String s) {
        if (s.indexOf('&') < 0) {
            return s;
        }
        StringBuilder sb = new StringBuilder(s.length());
        int i = 0;
        while (i < s.length()) {
            char c = s.charAt(i);
            if (c == '&') {
                int fim = s.indexOf(';', i);
                if (fim > i + 1 && fim - i <= 12) {
                    String nome = s.substring(i + 1, fim);
                    String valor = null;
                    if (nome.startsWith("#x") || nome.startsWith("#X")) {
                        valor = codepoint(nome.substring(2), 16);
                    } else if (nome.startsWith("#")) {
                        valor = codepoint(nome.substring(1), 10);
                    } else {
                        valor = ENTIDADES.get(nome);
                    }
                    if (valor != null) {
                        sb.append(valor);
                        i = fim + 1;
                        continue;
                    }
                }
            }
            sb.append(c);
            i++;
        }
        return sb.toString();
    }

    private static String codepoint(String num, int base) {
        try {
            int cp = Integer.parseInt(num, base);
            if (cp <= 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) {
                return "�";
            }
            return new String(Character.toChars(cp));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Escapa texto para HTML/XML ({@code & < >}). */
    public static String escape(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '&' -> sb.append("&amp;");
                case '<' -> sb.append("&lt;");
                case '>' -> sb.append("&gt;");
                default -> sb.append(c);
            }
        }
        return sb.toString();
    }

    /** Escapa texto para valor de atributo entre aspas duplas. */
    public static String escapeAttr(String s) {
        return escape(s).replace("\"", "&quot;");
    }
}
