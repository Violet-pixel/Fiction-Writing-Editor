/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.text;

/**
 * Classes de caracteres da especificação (seção 1). As mesmas regras existem em C e em
 * JavaScript; qualquer mudança aqui precisa ser replicada lá e coberta pelas fixtures.
 */
public final class CharClass {

    private CharClass() {
    }

    /** Letra ou dígito que forma palavra. */
    public static boolean isWordChar(int cp) {
        if ((cp >= '0' && cp <= '9') || (cp >= 'A' && cp <= 'Z') || (cp >= 'a' && cp <= 'z')) {
            return true;
        }
        if (cp >= 0xC0 && cp <= 0x24F) {
            return cp != 0xD7 && cp != 0xF7;
        }
        return (cp >= 0x370 && cp <= 0x1FFF) || (cp >= 0x3040 && cp <= 0x9FFF) || (cp >= 0xAC00 && cp <= 0xD7AF);
    }

    /** Letra (caractere de palavra que não é dígito ASCII). */
    public static boolean isLetter(int cp) {
        return isWordChar(cp) && !(cp >= '0' && cp <= '9');
    }

    /** Espaço em branco segundo a especificação. */
    public static boolean isSpace(int cp) {
        if (cp == ' ' || (cp >= 0x09 && cp <= 0x0D)) {
            return true;
        }
        return cp == 0x85 || cp == 0xA0 || cp == 0x1680 || (cp >= 0x2000 && cp <= 0x200A)
                || cp == 0x2028 || cp == 0x2029 || cp == 0x202F || cp == 0x205F || cp == 0x3000;
    }

    /** Travessões que também separam palavras (—, – e ―). */
    public static boolean isDash(int cp) {
        return cp == 0x2014 || cp == 0x2013 || cp == 0x2015;
    }

    /** Pontuação que termina frase: . ! ? e reticências. */
    public static boolean isTerminal(int cp) {
        return cp == '.' || cp == '!' || cp == '?' || cp == 0x2026;
    }

    /** Caracteres que podem vir logo depois de uma corrida terminal. */
    public static boolean isAfterTerminal(int cp) {
        return cp == 0x201D || cp == '"' || cp == 0x2019 || cp == 0xBB || cp == ')' || cp == 0x2014;
    }

    /** Letra maiúscula (qualquer escrita). */
    public static boolean isUpper(int cp) {
        return Character.isUpperCase(cp);
    }
}
