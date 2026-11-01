/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.text;

import java.util.LinkedHashMap;
import java.util.Map;
import serifa.json.JsonWritable;

/**
 * Estatísticas de um texto puro (seção 1 da especificação): palavras, caracteres, parágrafos,
 * frases, falas e minutos de leitura.
 */
public record TextStats(int words, int characters, int charactersNoSpaces, int paragraphs, int sentences,
                        int dialogues, int readingMinutes) implements JsonWritable {

    /** Palavras por minuto usadas para estimar o tempo de leitura. */
    public static final int PALAVRAS_POR_MINUTO = 200;

    /** Calcula todas as estatísticas de uma vez. */
    public static TextStats of(String texto) {
        if (texto == null) {
            texto = "";
        }
        int words = countWords(texto);
        int chars = 0;
        int noSpace = 0;
        for (int i = 0; i < texto.length(); ) {
            int cp = texto.codePointAt(i);
            i += Character.charCount(cp);
            if (cp != '\n' && cp != '\r') {
                chars++;
            }
            if (!CharClass.isSpace(cp)) {
                noSpace++;
            }
        }
        int paragrafos = 0;
        int falas = 0;
        for (String linha : texto.split("\n", -1)) {
            if (hasNonSpace(linha)) {
                paragrafos++;
                if (Dialogue.isDialogue(linha)) {
                    falas++;
                }
            }
        }
        int frases = countSentences(texto);
        int minutos = words == 0 ? 0 : (words + PALAVRAS_POR_MINUTO - 1) / PALAVRAS_POR_MINUTO;
        return new TextStats(words, chars, noSpace, paragrafos, frases, falas, minutos);
    }

    /** Verdadeiro se a linha tem algum caractere que não é espaço. */
    public static boolean hasNonSpace(String linha) {
        for (int i = 0; i < linha.length(); ) {
            int cp = linha.codePointAt(i);
            if (!CharClass.isSpace(cp)) {
                return true;
            }
            i += Character.charCount(cp);
        }
        return false;
    }

    /** Conta palavras: tokens separados por espaço ou travessão com pelo menos um caractere de palavra. */
    public static int countWords(String texto) {
        int total = 0;
        boolean temLetra = false;
        boolean emToken = false;
        for (int i = 0; i < texto.length(); ) {
            int cp = texto.codePointAt(i);
            i += Character.charCount(cp);
            if (CharClass.isSpace(cp) || CharClass.isDash(cp)) {
                if (emToken && temLetra) {
                    total++;
                }
                emToken = false;
                temLetra = false;
            } else {
                emToken = true;
                if (CharClass.isWordChar(cp)) {
                    temLetra = true;
                }
            }
        }
        if (emToken && temLetra) {
            total++;
        }
        return total;
    }

    /** Conta frases pelas corridas terminais (ver especificação). */
    public static int countSentences(String texto) {
        int[] cps = texto.codePoints().toArray();
        int n = cps.length;
        int frases = 0;
        boolean letraDesdeUltima = false;
        int i = 0;
        while (i < n) {
            int cp = cps[i];
            if (CharClass.isTerminal(cp)) {
                int j = i;
                while (j < n && CharClass.isTerminal(cps[j])) {
                    j++;
                }
                boolean fim = j >= n || CharClass.isSpace(cps[j]) || CharClass.isAfterTerminal(cps[j]);
                if (fim && letraDesdeUltima) {
                    frases++;
                    letraDesdeUltima = false;
                }
                i = j;
                continue;
            }
            if (CharClass.isWordChar(cp)) {
                letraDesdeUltima = true;
            }
            i++;
        }
        if (letraDesdeUltima) {
            frases++;
        }
        return frases;
    }

    @Override
    public Object toJson() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("words", words);
        m.put("characters", characters);
        m.put("charactersNoSpaces", charactersNoSpaces);
        m.put("paragraphs", paragraphs);
        m.put("sentences", sentences);
        m.put("dialogues", dialogues);
        m.put("readingMinutes", readingMinutes);
        return m;
    }
}
