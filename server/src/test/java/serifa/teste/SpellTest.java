/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.teste;

import static serifa.teste.TestRunner.falso;
import static serifa.teste.TestRunner.igual;
import static serifa.teste.TestRunner.verdade;

import java.util.List;
import java.util.Set;
import serifa.spell.Condition;
import serifa.spell.HunspellDictionary;
import serifa.spell.SpellChecker;
import serifa.spell.WeightedDistance;
import serifa.teste.TestRunner.Teste;

/** Testes do hunspell-lite com um dicionário pequeno e com o dicionário real. */
public class SpellTest {

    private static final String AFF = """
            SET UTF-8
            FLAG UTF-8
            TRY aeiourstnlcmdpç
            NOSUGGEST !
            FORBIDDENWORD *
            MAP 2
            MAP aáã
            MAP oóô
            REP 1
            REP ss ç
            SFX A Y 2
            SFX A   o     os      o
            SFX A   0     s       [ae]
            SFX B Y 1
            SFX B   r     ndo     [aei]r
            PFX C Y 1
            PFX C   0     re      .
            PFX D N 1
            PFX D   0     des     [^s]
            """;
    private static final String DIC = """
            7
            gato/AC
            casa/A
            andar/BCD
            palavrão/!
            cão
            errado/*
            ação
            """;

    private static SpellChecker mini() {
        return new SpellChecker(HunspellDictionary.fromStrings(AFF, DIC));
    }

    @Teste
    public void condicoes() {
        Condition c = Condition.parse("[^ã][ae]");
        verdade(c.matchesEnd("casa"), "casa termina com [^ã][ae]");
        falso(c.matchesEnd("ãa"), "ã é negado");
        verdade(Condition.parse(".").matchesEnd(""), "ponto aceita tudo");
        verdade(Condition.parse("r").matchesStart("rato"), "literal no começo");
        falso(Condition.parse("[aei]r").matchesEnd("ur"), "ur não bate");
    }

    @Teste
    public void afixos() {
        SpellChecker sc = mini();
        verdade(sc.check("gato"), "radical");
        verdade(sc.check("gatos"), "sufixo A (o → os)");
        verdade(sc.check("casas"), "sufixo A (0 → s)");
        verdade(sc.check("andando"), "sufixo B com strip");
        verdade(sc.check("regato"), "prefixo C");
        verdade(sc.check("desandar"), "prefixo D");
        verdade(sc.check("regatos"), "cross product C + A");
        falso(sc.check("desandando"), "D não tem cross product");
        falso(sc.check("errado"), "palavra proibida");
        falso(sc.check("casos"), "casa não gera casos");
    }

    @Teste
    public void maiusculasEHifen() {
        SpellChecker sc = mini();
        verdade(sc.check("Gato"), "capitalizada");
        verdade(sc.check("GATOS"), "toda maiúscula");
        falso(sc.check("gATO"), "caixa misturada");
        verdade(sc.check("gato-casa"), "partes com hífen");
        falso(sc.check("gato-xyz"), "parte errada");
        verdade(sc.check("Zuzu", Set.of("zuzu")), "dicionário pessoal");
    }

    @Teste
    public void sugestoesDoMini() {
        SpellChecker sc = mini();
        igual("cão", sc.suggest("cao").get(0));
        igual("Gato", sc.suggest("Gaot").get(0));
        igual("ação", sc.suggest("assão").get(0));
        falso(sc.suggest("palavrao").contains("palavrão"), "NOSUGGEST nunca é sugerida");
        verdade(sc.suggest("xyzxyzxyz").isEmpty(), "sem candidatos");
    }

    @Teste
    public void tokenizacao() {
        List<SpellChecker.Token> t = SpellChecker.tokenize("O guarda-chuva d'água, ONU, abc123, http://x.com/aa e a@b.com ok");
        igual("[guarda-chuva, d'água, ok]", t.stream().map(SpellChecker.Token::word).toList().toString());
        igual(2, t.get(0).start());
        List<SpellChecker.Token> u = SpellChecker.tokenize("😀 olá");
        igual(3, u.get(0).start());
    }

    @Teste
    public void distanciaPonderada() {
        igual(0.0, WeightedDistance.distance("casa", "casa", null));
        igual(1.0, WeightedDistance.distance("casa", "cas", null));
        igual(0.7, WeightedDistance.distance("casa", "cada", null));
        igual(1.0, WeightedDistance.distance("casa", "csaa", null));
        verdade(WeightedDistance.keyboardNeighbors('a', 'q'), "a-q");
        verdade(WeightedDistance.keyboardNeighbors('l', 'ç'), "l-ç");
        falso(WeightedDistance.keyboardNeighbors('a', 'p'), "a-p");
        igual(0.3, WeightedDistance.distance("cao", "cão", mini()));
    }

    @Teste
    public void dicionarioReal() {
        SpellChecker sc = Recursos.ENGINE.speller();
        verdade(sc.dictionary().wordCount() > 300_000, "dicionário carregado");
        for (String w : List.of("casa", "casas", "caminhava", "Brasil", "guarda-chuva", "andávamos", "pássaros", "rapidamente")) {
            verdade(sc.check(w), w + " deveria passar");
        }
        for (String w : List.of("voce", "nao", "felis", "ninguem")) {
            falso(sc.check(w), w + " deveria falhar");
        }
        igual("você", sc.suggest("voce").get(0));
        igual("Não", sc.suggest("Nao").get(0));
        igual("NÃO", sc.suggest("NAO").get(0));
    }
}
