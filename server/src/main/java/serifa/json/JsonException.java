/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.json;

/** Erro de leitura ou escrita de JSON, com a posição aproximada do problema. */
public class JsonException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    private final int linha;
    private final int coluna;

    public JsonException(String mensagem, int linha, int coluna) {
        super(linha > 0 ? mensagem + " (linha " + linha + ", coluna " + coluna + ")" : mensagem);
        this.linha = linha;
        this.coluna = coluna;
    }

    public int linha() {
        return linha;
    }

    public int coluna() {
        return coluna;
    }
}
