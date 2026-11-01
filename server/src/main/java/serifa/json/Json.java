/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.json;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Leitor e gerador de JSON escrito à mão (sem dependências externas).
 *
 * <p>Os valores lidos viram tipos simples do Java: {@code Map<String,Object>} (com ordem de
 * inserção preservada), {@code List<Object>}, {@code String}, {@code Long}, {@code Double},
 * {@code Boolean} e {@code null}. O leitor é estrito (RFC 8259), limita a profundidade de
 * aninhamento para evitar estouro de pilha com entradas maliciosas e informa linha e coluna
 * nos erros.</p>
 */
public final class Json {

    /** Profundidade máxima padrão de objetos/listas aninhados. */
    public static final int PROFUNDIDADE_PADRAO = 200;

    private Json() {
    }

    // ------------------------------------------------------------------ leitura

    /** Lê um documento JSON completo. */
    public static Object parse(String texto) {
        return parse(texto, PROFUNDIDADE_PADRAO);
    }

    /** Lê um documento JSON completo com limite de profundidade explícito. */
    public static Object parse(String texto, int profundidadeMaxima) {
        if (texto == null) {
            throw new JsonException("Documento JSON vazio.", 1, 1);
        }
        Leitor leitor = new Leitor(texto, profundidadeMaxima);
        leitor.pularEspacos();
        if (leitor.pos < texto.length() && texto.charAt(leitor.pos) == '﻿') {
            leitor.pos++;
            leitor.pularEspacos();
        }
        Object valor = leitor.lerValor(0);
        leitor.pularEspacos();
        if (leitor.pos != texto.length()) {
            throw leitor.erro("Conteúdo extra depois do fim do documento JSON.");
        }
        return valor;
    }

    /** Lê um documento cuja raiz precisa ser um objeto. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> parseObject(String texto) {
        Object valor = parse(texto);
        if (!(valor instanceof Map)) {
            throw new JsonException("Esperava um objeto JSON na raiz do documento.", 1, 1);
        }
        return (Map<String, Object>) valor;
    }

    private static final class Leitor {
        final String s;
        final int limite;
        int pos;

        Leitor(String s, int limite) {
            this.s = s;
            this.limite = limite;
        }

        JsonException erro(String mensagem) {
            int linha = 1;
            int coluna = 1;
            for (int i = 0; i < pos && i < s.length(); i++) {
                if (s.charAt(i) == '\n') {
                    linha++;
                    coluna = 1;
                } else {
                    coluna++;
                }
            }
            return new JsonException(mensagem, linha, coluna);
        }

        void pularEspacos() {
            while (pos < s.length()) {
                char c = s.charAt(pos);
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                    pos++;
                } else {
                    break;
                }
            }
        }

        Object lerValor(int profundidade) {
            if (pos >= s.length()) {
                throw erro("Fim inesperado do documento JSON.");
            }
            char c = s.charAt(pos);
            switch (c) {
                case '{':
                    return lerObjeto(profundidade + 1);
                case '[':
                    return lerLista(profundidade + 1);
                case '"':
                    return lerTexto();
                case 't':
                    esperarPalavra("true");
                    return Boolean.TRUE;
                case 'f':
                    esperarPalavra("false");
                    return Boolean.FALSE;
                case 'n':
                    esperarPalavra("null");
                    return null;
                default:
                    if (c == '-' || (c >= '0' && c <= '9')) {
                        return lerNumero();
                    }
                    throw erro("Caractere inesperado '" + c + "' no JSON.");
            }
        }

        void esperarPalavra(String palavra) {
            if (!s.startsWith(palavra, pos)) {
                throw erro("Valor inválido no JSON (esperava '" + palavra + "').");
            }
            pos += palavra.length();
        }

        Map<String, Object> lerObjeto(int profundidade) {
            if (profundidade > limite) {
                throw erro("JSON aninhado demais (limite de " + limite + " níveis).");
            }
            pos++; // '{'
            Map<String, Object> mapa = new LinkedHashMap<>();
            pularEspacos();
            if (pos < s.length() && s.charAt(pos) == '}') {
                pos++;
                return mapa;
            }
            while (true) {
                pularEspacos();
                if (pos >= s.length() || s.charAt(pos) != '"') {
                    throw erro("Esperava o nome de um campo entre aspas.");
                }
                String chave = lerTexto();
                pularEspacos();
                if (pos >= s.length() || s.charAt(pos) != ':') {
                    throw erro("Esperava ':' depois do nome do campo.");
                }
                pos++;
                pularEspacos();
                Object valor = lerValor(profundidade);
                mapa.put(chave, valor);
                pularEspacos();
                if (pos >= s.length()) {
                    throw erro("Objeto JSON não foi fechado.");
                }
                char c = s.charAt(pos++);
                if (c == '}') {
                    return mapa;
                }
                if (c != ',') {
                    pos--;
                    throw erro("Esperava ',' ou '}' no objeto JSON.");
                }
            }
        }

        List<Object> lerLista(int profundidade) {
            if (profundidade > limite) {
                throw erro("JSON aninhado demais (limite de " + limite + " níveis).");
            }
            pos++; // '['
            List<Object> lista = new ArrayList<>();
            pularEspacos();
            if (pos < s.length() && s.charAt(pos) == ']') {
                pos++;
                return lista;
            }
            while (true) {
                pularEspacos();
                lista.add(lerValor(profundidade));
                pularEspacos();
                if (pos >= s.length()) {
                    throw erro("Lista JSON não foi fechada.");
                }
                char c = s.charAt(pos++);
                if (c == ']') {
                    return lista;
                }
                if (c != ',') {
                    pos--;
                    throw erro("Esperava ',' ou ']' na lista JSON.");
                }
            }
        }

        String lerTexto() {
            pos++; // aspas iniciais
            StringBuilder sb = null;
            int inicio = pos;
            while (true) {
                if (pos >= s.length()) {
                    throw erro("Texto JSON não foi fechado.");
                }
                char c = s.charAt(pos);
                if (c == '"') {
                    String trecho = s.substring(inicio, pos);
                    pos++;
                    return sb == null ? trecho : sb.append(trecho).toString();
                }
                if (c < 0x20) {
                    throw erro("Caractere de controle não escapado dentro de texto JSON.");
                }
                if (c == '\\') {
                    if (sb == null) {
                        sb = new StringBuilder();
                    }
                    sb.append(s, inicio, pos);
                    pos++;
                    if (pos >= s.length()) {
                        throw erro("Escape incompleto no texto JSON.");
                    }
                    char e = s.charAt(pos++);
                    switch (e) {
                        case '"' -> sb.append('"');
                        case '\\' -> sb.append('\\');
                        case '/' -> sb.append('/');
                        case 'b' -> sb.append('\b');
                        case 'f' -> sb.append('\f');
                        case 'n' -> sb.append('\n');
                        case 'r' -> sb.append('\r');
                        case 't' -> sb.append('\t');
                        case 'u' -> {
                            if (pos + 4 > s.length()) {
                                throw erro("Escape \\u incompleto no texto JSON.");
                            }
                            int cp = 0;
                            for (int i = 0; i < 4; i++) {
                                int d = Character.digit(s.charAt(pos + i), 16);
                                if (d < 0) {
                                    throw erro("Escape \\u inválido no texto JSON.");
                                }
                                cp = cp * 16 + d;
                            }
                            pos += 4;
                            sb.append((char) cp);
                        }
                        default -> {
                            pos--;
                            throw erro("Escape desconhecido '\\" + e + "' no texto JSON.");
                        }
                    }
                    inicio = pos;
                } else {
                    pos++;
                }
            }
        }

        Object lerNumero() {
            int inicio = pos;
            if (s.charAt(pos) == '-') {
                pos++;
            }
            if (pos >= s.length()) {
                throw erro("Número JSON incompleto.");
            }
            if (s.charAt(pos) == '0') {
                pos++;
            } else if (s.charAt(pos) >= '1' && s.charAt(pos) <= '9') {
                while (pos < s.length() && Character.isDigit(s.charAt(pos)) && s.charAt(pos) < 128) {
                    pos++;
                }
            } else {
                throw erro("Número JSON inválido.");
            }
            boolean decimal = false;
            if (pos < s.length() && s.charAt(pos) == '.') {
                decimal = true;
                pos++;
                int digitos = 0;
                while (pos < s.length() && s.charAt(pos) >= '0' && s.charAt(pos) <= '9') {
                    pos++;
                    digitos++;
                }
                if (digitos == 0) {
                    throw erro("Número JSON inválido: faltam dígitos depois do ponto.");
                }
            }
            if (pos < s.length() && (s.charAt(pos) == 'e' || s.charAt(pos) == 'E')) {
                decimal = true;
                pos++;
                if (pos < s.length() && (s.charAt(pos) == '+' || s.charAt(pos) == '-')) {
                    pos++;
                }
                int digitos = 0;
                while (pos < s.length() && s.charAt(pos) >= '0' && s.charAt(pos) <= '9') {
                    pos++;
                    digitos++;
                }
                if (digitos == 0) {
                    throw erro("Número JSON inválido: expoente sem dígitos.");
                }
            }
            String numero = s.substring(inicio, pos);
            if (!decimal) {
                try {
                    return Long.parseLong(numero);
                } catch (NumberFormatException grande) {
                    return new BigDecimal(numero).doubleValue();
                }
            }
            return Double.parseDouble(numero);
        }
    }

    // ------------------------------------------------------------------ escrita

    /** Gera JSON compacto. */
    public static String stringify(Object valor) {
        StringBuilder sb = new StringBuilder();
        escrever(sb, valor, -1, 0, 0);
        return sb.toString();
    }

    /** Gera JSON indentado com o número de espaços pedido. */
    public static String pretty(Object valor, int indentacao) {
        StringBuilder sb = new StringBuilder();
        escrever(sb, valor, indentacao, 0, 0);
        return sb.toString();
    }

    private static void quebra(StringBuilder sb, int indent, int nivel) {
        if (indent < 0) {
            return;
        }
        sb.append('\n');
        for (int i = 0; i < indent * nivel; i++) {
            sb.append(' ');
        }
    }

    @SuppressWarnings("unchecked")
    private static void escrever(StringBuilder sb, Object v, int indent, int nivel, int prof) {
        if (prof > PROFUNDIDADE_PADRAO * 4) {
            throw new JsonException("Estrutura aninhada demais para gerar JSON.", 0, 0);
        }
        if (v == null) {
            sb.append("null");
        } else if (v instanceof String str) {
            escreverTexto(sb, str);
        } else if (v instanceof Boolean b) {
            sb.append(b ? "true" : "false");
        } else if (v instanceof Double || v instanceof Float) {
            double d = ((Number) v).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) {
                sb.append("null");
            } else if (d == Math.rint(d) && Math.abs(d) < 1e15) {
                sb.append((long) d);
            } else {
                sb.append(numeroCurto(d));
            }
        } else if (v instanceof Number n) {
            sb.append(n.toString());
        } else if (v instanceof Map<?, ?> mapa) {
            if (mapa.isEmpty()) {
                sb.append("{}");
                return;
            }
            sb.append('{');
            boolean primeiro = true;
            for (Map.Entry<?, ?> e : mapa.entrySet()) {
                if (!primeiro) {
                    sb.append(',');
                }
                primeiro = false;
                quebra(sb, indent, nivel + 1);
                escreverTexto(sb, String.valueOf(e.getKey()));
                sb.append(indent < 0 ? ":" : ": ");
                escrever(sb, e.getValue(), indent, nivel + 1, prof + 1);
            }
            quebra(sb, indent, nivel);
            sb.append('}');
        } else if (v instanceof Collection<?> lista) {
            if (lista.isEmpty()) {
                sb.append("[]");
                return;
            }
            sb.append('[');
            boolean primeiro = true;
            for (Object item : lista) {
                if (!primeiro) {
                    sb.append(',');
                }
                primeiro = false;
                quebra(sb, indent, nivel + 1);
                escrever(sb, item, indent, nivel + 1, prof + 1);
            }
            quebra(sb, indent, nivel);
            sb.append(']');
        } else if (v instanceof Object[] arr) {
            escrever(sb, java.util.Arrays.asList(arr), indent, nivel, prof);
        } else if (v instanceof JsonWritable w) {
            escrever(sb, w.toJson(), indent, nivel, prof);
        } else {
            escreverTexto(sb, v.toString());
        }
    }

    private static String numeroCurto(double d) {
        String r = Double.toString(d);
        if (r.contains("E")) {
            return new BigDecimal(d).stripTrailingZeros().toString();
        }
        return r;
    }

    /** Escreve um texto entre aspas com os escapes de JSON. */
    public static void escreverTexto(StringBuilder sb, String s) {
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                default -> {
                    if (c < 0x20 || c == 0x2028 || c == 0x2029) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
    }

    // ------------------------------------------------------------------ utilidades de acesso

    /** Lê um campo de texto de um objeto, ou o padrão se ausente ou de outro tipo. */
    public static String str(Map<String, Object> obj, String campo, String padrao) {
        Object v = obj == null ? null : obj.get(campo);
        return v instanceof String s ? s : padrao;
    }

    /** Lê um campo numérico inteiro. */
    public static long num(Map<String, Object> obj, String campo, long padrao) {
        Object v = obj == null ? null : obj.get(campo);
        return v instanceof Number n ? n.longValue() : padrao;
    }

    /** Lê um campo numérico decimal. */
    public static double dbl(Map<String, Object> obj, String campo, double padrao) {
        Object v = obj == null ? null : obj.get(campo);
        return v instanceof Number n ? n.doubleValue() : padrao;
    }

    /** Lê um campo booleano. */
    public static boolean bool(Map<String, Object> obj, String campo, boolean padrao) {
        Object v = obj == null ? null : obj.get(campo);
        return v instanceof Boolean b ? b : padrao;
    }

    /** Lê um campo objeto (ou null). */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> obj(Map<String, Object> obj, String campo) {
        Object v = obj == null ? null : obj.get(campo);
        return v instanceof Map ? (Map<String, Object>) v : null;
    }

    /** Lê um campo lista (ou lista vazia). */
    @SuppressWarnings("unchecked")
    public static List<Object> list(Map<String, Object> obj, String campo) {
        Object v = obj == null ? null : obj.get(campo);
        return v instanceof List ? (List<Object>) v : new ArrayList<>();
    }

    /** Lê uma lista de textos, ignorando itens que não são texto. */
    public static List<String> strings(Map<String, Object> obj, String campo) {
        List<String> r = new ArrayList<>();
        for (Object o : list(obj, campo)) {
            if (o instanceof String s) {
                r.add(s);
            }
        }
        return r;
    }

    /** Cria um mapa ordenado a partir de pares chave/valor. */
    public static Map<String, Object> mapOf(Object... pares) {
        if (pares.length % 2 != 0) {
            throw new IllegalArgumentException("mapOf precisa de pares chave/valor");
        }
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < pares.length; i += 2) {
            m.put(String.valueOf(pares[i]), pares[i + 1]);
        }
        return m;
    }

    /** Cópia profunda de uma estrutura JSON. */
    @SuppressWarnings("unchecked")
    public static Object deepCopy(Object v) {
        if (v instanceof Map<?, ?> m) {
            Map<String, Object> r = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : m.entrySet()) {
                r.put(String.valueOf(e.getKey()), deepCopy(e.getValue()));
            }
            return r;
        }
        if (v instanceof List<?> l) {
            List<Object> r = new ArrayList<>(l.size());
            for (Object o : l) {
                r.add(deepCopy(o));
            }
            return r;
        }
        return v;
    }
}
