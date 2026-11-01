/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.teste;

import static serifa.teste.TestRunner.falso;
import static serifa.teste.TestRunner.igual;
import static serifa.teste.TestRunner.verdade;

import serifa.teste.TestRunner.Teste;
import serifa.text.CharClass;
import serifa.text.Dialogue;
import serifa.text.TextStats;

/** Testes da contagem (seção 1) e da regra de fala (seção 2). */
public class TextStatsTest {

    @Teste
    public void palavrasDaEspecificacao() {
        igual(1, TextStats.countWords("guarda-chuva"));
        igual(1, TextStats.countWords("d'água"));
        igual(1, TextStats.countWords("3,5"));
        igual(1, TextStats.countWords("—Olá"));
        igual(0, TextStats.countWords("..."));
        igual(2, TextStats.countWords("sim—não"));
        igual(3, TextStats.countWords("  um dois três  "));
    }

    @Teste
    public void caracteres() {
        TextStats s = TextStats.of("a b\nc\r\n😀");
        igual(5, s.characters());
        igual(4, s.charactersNoSpaces());
    }

    @Teste
    public void paragrafosEFalas() {
        TextStats s = TextStats.of("Narração.\n\n— Fala.\n“Outra.”\n- Hífen.\n-sem espaço\n   \n«Aspas»");
        igual(6, s.paragraphs());
        igual(4, s.dialogues());
    }

    @Teste
    public void frases() {
        igual(0, TextStats.countSentences(""));
        igual(0, TextStats.countSentences("?!..."));
        igual(1, TextStats.countSentences("Sem ponto final"));
        igual(2, TextStats.countSentences("Uma. Duas"));
        igual(1, TextStats.countSentences("Valor 3.5 aqui."));
        igual(2, TextStats.countSentences("“Vem?” Veio."));
        igual(2, TextStats.countSentences("Ele (calado.) Saiu."));
        igual(1, TextStats.countSentences("Fim...!?"));
    }

    @Teste
    public void minutosDeLeitura() {
        igual(0, TextStats.of("").readingMinutes());
        igual(1, TextStats.of("uma").readingMinutes());
        igual(2, TextStats.of("a ".repeat(201)).readingMinutes());
    }

    @Teste
    public void classesDeCaracteres() {
        verdade(CharClass.isWordChar('ç'), "ç é letra");
        falso(CharClass.isWordChar(0xD7), "× não é letra");
        falso(CharClass.isWordChar(0xF7), "÷ não é letra");
        verdade(CharClass.isWordChar('語'), "ideograma é letra");
        verdade(CharClass.isWordChar('한'), "hangul é letra");
        verdade(CharClass.isSpace(0x3000), "espaço ideográfico");
        verdade(CharClass.isSpace(0x85), "NEL");
        falso(CharClass.isSpace(0x200B), "espaço de largura zero não conta");
    }

    @Teste
    public void regraDeFala() {
        verdade(Dialogue.isDialogue("  — Oi"), "travessão");
        verdade(Dialogue.isDialogue("– Oi"), "meia-risca");
        verdade(Dialogue.isDialogue("― Oi"), "barra horizontal");
        verdade(Dialogue.isDialogue("- Oi"), "hífen com espaço");
        falso(Dialogue.isDialogue("-Oi"), "hífen colado não é fala");
        falso(Dialogue.isDialogue("-"), "hífen sozinho");
        verdade(Dialogue.isDialogue("\"Oi\""), "aspas retas");
        falso(Dialogue.isDialogue("Ele disse “oi”"), "aspas no meio");
        igual(1, Dialogue.quotedSpans("a “b” c").size());
        igual(2, Dialogue.quotedSpans("\"x\" e \"y\"").size());
    }
}
