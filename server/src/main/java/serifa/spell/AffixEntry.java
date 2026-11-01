/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.spell;

/**
 * Uma linha {@code SFX}/{@code PFX} do arquivo .aff já interpretada.
 *
 * @param flag      flag (um code point) que o radical precisa ter no .dic
 * @param suffix    verdadeiro para sufixo, falso para prefixo
 * @param cross     se pode combinar com afixo do outro tipo (cross product = Y)
 * @param strip     texto que foi retirado do radical para aplicar o afixo ("" quando 0)
 * @param add       texto acrescentado à palavra ("" quando 0), sem flags de continuação
 * @param condition condição sobre o radical
 */
public record AffixEntry(int flag, boolean suffix, boolean cross, String strip, String add, Condition condition) {

    /**
     * Desfaz o afixo numa palavra, devolvendo o radical candidato (ou {@code null} se a palavra
     * não termina/começa com {@code add} ou se a condição não bate).
     */
    public String undo(String palavra) {
        if (suffix) {
            if (!palavra.endsWith(add)) {
                return null;
            }
            String stem = palavra.substring(0, palavra.length() - add.length()) + strip;
            return condition.matchesEnd(stem) ? stem : null;
        }
        if (!palavra.startsWith(add)) {
            return null;
        }
        String stem = strip + palavra.substring(add.length());
        return condition.matchesStart(stem) ? stem : null;
    }

    /** Aplica o afixo a um radical (usado para gerar formas nos testes e na CLI). */
    public String apply(String radical) {
        if (suffix) {
            if (!radical.endsWith(strip) || !condition.matchesEnd(radical)) {
                return null;
            }
            return radical.substring(0, radical.length() - strip.length()) + add;
        }
        if (!radical.startsWith(strip) || !condition.matchesStart(radical)) {
            return null;
        }
        return add + radical.substring(strip.length());
    }
}
