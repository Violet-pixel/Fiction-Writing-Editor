/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.json;

/** Objeto que sabe se converter em uma estrutura JSON simples (mapa, lista, texto, número). */
public interface JsonWritable {
    /** Retorna a representação em tipos simples, pronta para {@link Json#stringify(Object)}. */
    Object toJson();
}
