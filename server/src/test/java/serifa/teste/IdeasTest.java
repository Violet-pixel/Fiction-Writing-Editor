/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.teste;

import static serifa.teste.TestRunner.falso;
import static serifa.teste.TestRunner.igual;
import static serifa.teste.TestRunner.verdade;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import serifa.ideas.Idea;
import serifa.ideas.IdeaEngine;
import serifa.ideas.PatternRule;
import serifa.ideas.VerbTable;
import serifa.teste.TestRunner.Teste;

/** Testes das regras de ideias e da tabela de verbos. */
public class IdeasTest {

    private static IdeaEngine motor() {
        return Recursos.ENGINE.ideas();
    }

    private static List<String> regras(String texto) {
        return motor().analyze(texto).stream().map(Idea::rule).toList();
    }

    @Teste
    public void regrasDoArquivo() {
        List<PatternRule> r = motor().rules();
        verdade(r.size() >= 60, "pelo menos 60 regras");
        Set<String> ids = new HashSet<>();
        for (PatternRule p : r) {
            verdade(ids.add(p.id()), "id repetido: " + p.id());
            verdade(PatternRule.CATEGORIAS.contains(p.category()), "categoria válida em " + p.id());
            falso(p.pattern().contains("\\b"), "sem \\b em " + p.id());
            falso(p.pattern().matches("(?s).*\\(\\?<[A-Za-z].*"), "sem grupos nomeados em " + p.id());
            falso(p.pattern().contains("++") || p.pattern().contains("*+"), "sem quantificadores possessivos em " + p.id());
        }
    }

    @Teste
    public void conjugacaoRegular() {
        VerbTable v = motor().verbs();
        igual("toquei", v.form("tocar", VerbTable.PERFEITO, 0));
        igual("cheguei", v.form("chegar", VerbTable.PERFEITO, 0));
        igual("comecei", v.form("começar", VerbTable.PERFEITO, 0));
        igual("conheço", v.form("conhecer", VerbTable.PRESENTE, 0));
        igual("protejo", v.form("proteger", VerbTable.PRESENTE, 0));
        igual("finjo", v.form("fingir", VerbTable.PRESENTE, 0));
        igual("andávamos", v.form("andar", VerbTable.IMPERFEITO, 2));
    }

    @Teste
    public void tempoEAmbiguidade() {
        VerbTable v = motor().verbs();
        igual(VerbTable.IMPERFEITO, v.tense("era"));
        igual(null, v.tense("andamos"));
        igual(null, v.tense("partimos"));
        igual(null, v.tense("como"));
        igual(null, v.tense("olho"));
        igual(null, v.tense("ando"));
        igual(VerbTable.PRESENTE, v.tense("sou"));
        igual(1, v.person("foi"));
        igual(-1, v.person("era"));
    }

    @Teste
    public void palavraRepetida() {
        verdade(regras("o o menino").contains(IdeaEngine.PALAVRA_REPETIDA), "o o");
        falso(regras("se se olhou").contains(IdeaEngine.PALAVRA_REPETIDA), "exceção se se");
        falso(regras("fim.\nfim.").contains(IdeaEngine.PALAVRA_REPETIDA), "parágrafos diferentes");
        falso(regras("sim, sim").contains(IdeaEngine.PALAVRA_REPETIDA), "pontuação no meio");
    }

    @Teste
    public void tempoVerbalFrase() {
        List<Idea> r = motor().analyze("Ele caminhava e vê a lua.");
        igual(1, r.size());
        igual("viu", r.get(0).suggestion());
        igual("Mistura de tempos verbais: “caminhava” está no passado e “vê” no presente.", r.get(0).message());
        verdade(motor().analyze("— Eu caminhava e vejo tudo.").isEmpty(), "falas não contam");
        verdade(motor().analyze("Ele caminhava e disse: “vejo tudo”.").isEmpty(), "trecho citado não conta");
    }

    @Teste
    public void concordanciaDePronome() {
        List<Idea> r = motor().analyze("Eles foi embora. Nós vai depois.");
        igual(2, r.size());
        igual("foram", r.get(0).suggestion());
        igual("vamos", r.get(1).suggestion());
        verdade(motor().analyze("Ela e eu fomos.").isEmpty(), "sujeito composto");
        verdade(motor().analyze("— Eu foi lá — disse.").stream().anyMatch(i -> i.rule().equals(IdeaEngine.CONCORDANCIA_PRONOME)),
                "vale dentro de fala");
    }

    @Teste
    public void fraseLonga() {
        String longa = "palavra ".repeat(56).trim() + ".";
        verdade(regras(longa).contains(IdeaEngine.FRASE_LONGA), "56 palavras");
        falso(regras("palavra ".repeat(55).trim() + ".").contains(IdeaEngine.FRASE_LONGA), "55 palavras");
        falso(regras("— " + longa).contains(IdeaEngine.FRASE_LONGA), "fala não conta");
    }

    @Teste
    public void ignoradas() {
        verdade(motor().analyze("Derrepente caiu.", List.of("ortografia-derrepente:derrepente")).isEmpty(), "ignorada");
        igual(1, motor().analyze("Derrepente caiu.", List.of("outra:coisa")).size());
    }

    @Teste
    public void offsetsUtf16() {
        List<Idea> r = motor().analyze("😀 Derrepente.");
        igual(3, r.get(0).start());
        igual(13, r.get(0).end());
    }
}
