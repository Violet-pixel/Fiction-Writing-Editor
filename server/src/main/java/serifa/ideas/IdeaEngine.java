/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.ideas;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import serifa.text.CharClass;
import serifa.text.Dialogue;
import serifa.text.TextStats;

/**
 * Motor do "balão de ideia" (seção 5): aplica as regras por padrão e as regras por código
 * (palavra repetida, frase longa, mistura de tempos verbais e concordância de pronome).
 */
public final class IdeaEngine {

    public static final String PALAVRA_REPETIDA = "palavra-repetida";
    public static final String FRASE_LONGA = "frase-longa";
    public static final String TEMPO_FRASE = "tempo-verbal-frase";
    public static final String TEMPO_CAPITULO = "tempo-verbal-capitulo";
    public static final String CONCORDANCIA_PRONOME = "concordancia-pronome";

    /** Limite de palavras de uma frase de narração antes de virar ideia. */
    public static final int MAX_PALAVRAS_FRASE = 55;
    /** Mínimo de formas verbais no capítulo para julgar o tempo da narração. */
    public static final int MIN_FORMAS_CAPITULO = 8;
    /** Proporção mínima para considerar o capítulo narrado num tempo. */
    public static final double PROPORCAO_CAPITULO = 0.7;

    private static final Set<String> REPETICOES_PERMITIDAS = Set.of("se se", "nos nos", "lo lo", "la la");
    private static final Set<String> ANTES_DE_PRONOME_IGNORAR = Set.of(
            "e", "ou", "nem", "a", "para", "pra", "de", "com", "por", "sem", "contra", "entre", "sobre", "até");
    private static final Locale PT_BR = Locale.forLanguageTag("pt-BR");

    private final List<PatternRule> regras;
    private final VerbTable verbos;

    public IdeaEngine(List<PatternRule> regras, VerbTable verbos) {
        this.regras = List.copyOf(regras);
        this.verbos = verbos;
    }

    public List<PatternRule> rules() {
        return regras;
    }

    public VerbTable verbs() {
        return verbos;
    }

    /** Palavra de letras com posição, usada pelas regras por código. */
    record Word(String text, String lower, int start, int end) {
    }

    /** Parágrafo com seu deslocamento no texto completo. */
    record Paragraph(String text, int offset, boolean dialogue) {
    }

    // ------------------------------------------------------------------ API

    /** Analisa o texto e devolve as ideias ordenadas por posição. */
    public List<Idea> analyze(String texto) {
        return analyze(texto, List.of());
    }

    /**
     * Analisa o texto, descartando ideias ignoradas. Cada item de {@code ignoradas} tem a forma
     * {@code "regra:trecho"} (trecho comparado sem diferenciar maiúsculas).
     */
    public List<Idea> analyze(String texto, Collection<String> ignoradas) {
        if (texto == null) {
            texto = "";
        }
        List<Idea> r = new ArrayList<>();
        for (PatternRule regra : regras) {
            r.addAll(regra.apply(texto));
        }
        List<Paragraph> paragrafos = paragraphs(texto);
        List<Word> todas = words(texto, 0);
        repeated(texto, todas, r);
        pronouns(texto, todas, r);
        narration(paragrafos, r);
        Set<String> ign = new HashSet<>();
        if (ignoradas != null) {
            for (String s : ignoradas) {
                if (s != null) {
                    ign.add(s.toLowerCase(PT_BR));
                }
            }
        }
        final String t = texto;
        List<Idea> filtradas = new ArrayList<>();
        for (Idea i : r) {
            String chave = (i.rule() + ":" + t.substring(i.start(), i.end())).toLowerCase(PT_BR);
            if (!ign.contains(chave)) {
                filtradas.add(i);
            }
        }
        filtradas.sort(Comparator.comparingInt(Idea::start).thenComparingInt(Idea::end));
        return filtradas;
    }

    // ------------------------------------------------------------------ apoio

    static List<Paragraph> paragraphs(String texto) {
        List<Paragraph> r = new ArrayList<>();
        int inicio = 0;
        while (inicio <= texto.length()) {
            int fim = texto.indexOf('\n', inicio);
            if (fim < 0) {
                fim = texto.length();
            }
            String linha = texto.substring(inicio, fim);
            if (TextStats.hasNonSpace(linha)) {
                r.add(new Paragraph(linha, inicio, Dialogue.isDialogue(linha)));
            }
            inicio = fim + 1;
        }
        return r;
    }

    /** Palavras de letras (com hífen/apóstrofo internos), incluindo as de uma letra. */
    static List<Word> words(String texto, int deslocamento) {
        List<Word> r = new ArrayList<>();
        int n = texto.length();
        int i = 0;
        while (i < n) {
            int cp = texto.codePointAt(i);
            if (!CharClass.isLetter(cp)) {
                i += Character.charCount(cp);
                continue;
            }
            int j = i;
            while (j < n) {
                int c = texto.codePointAt(j);
                if (CharClass.isLetter(c)) {
                    j += Character.charCount(c);
                    continue;
                }
                if ((c == '-' || c == '\'' || c == 0x2019) && j + 1 < n && CharClass.isLetter(texto.codePointAt(j + 1))) {
                    j++;
                    continue;
                }
                break;
            }
            String w = texto.substring(i, j);
            r.add(new Word(w, w.toLowerCase(PT_BR), i + deslocamento, j + deslocamento));
            i = j;
        }
        return r;
    }

    private static boolean soEspacosNaLinha(String texto, int de, int ate) {
        if (de >= ate) {
            return false;
        }
        for (int k = de; k < ate; k++) {
            char c = texto.charAt(k);
            if (c == '\n' || !CharClass.isSpace(c)) {
                return false;
            }
        }
        return true;
    }

    private void repeated(String texto, List<Word> ws, List<Idea> out) {
        for (int k = 1; k < ws.size(); k++) {
            Word a = ws.get(k - 1);
            Word b = ws.get(k);
            if (!a.lower().equals(b.lower()) || !soEspacosNaLinha(texto, a.end(), b.start())) {
                continue;
            }
            if (REPETICOES_PERMITIDAS.contains(a.lower() + " " + b.lower())) {
                continue;
            }
            out.add(new Idea(PALAVRA_REPETIDA, "estilo", a.start(), b.end(),
                    "Palavra repetida: “" + a.text() + " " + b.text() + "”.", a.text()));
        }
    }

    private static int pessoaDoPronome(String p) {
        return switch (p) {
            case "eu" -> 0;
            case "ele", "ela", "você" -> 1;
            case "nós" -> 2;
            case "eles", "elas", "vocês" -> 3;
            default -> -1;
        };
    }

    private void pronouns(String texto, List<Word> ws, List<Idea> out) {
        for (int k = 0; k + 1 < ws.size(); k++) {
            Word pron = ws.get(k);
            int esperada = pessoaDoPronome(pron.lower());
            if (esperada < 0) {
                continue;
            }
            Word verbo = ws.get(k + 1);
            if (!soEspacosNaLinha(texto, pron.end(), verbo.start())) {
                continue;
            }
            if (k > 0) {
                Word antes = ws.get(k - 1);
                if (ANTES_DE_PRONOME_IGNORAR.contains(antes.lower()) && soEspacosNaLinha(texto, antes.end(), pron.start())) {
                    continue;
                }
            }
            int pessoa = verbos.person(verbo.lower());
            if (pessoa < 0 || pessoa == esperada) {
                continue;
            }
            VerbTable.Use uso = verbos.uses(verbo.lower()).get(0);
            String certa = verbos.form(uso.verb(), uso.tense(), esperada);
            if (certa == null || certa.equalsIgnoreCase(verbo.text())) {
                continue;
            }
            out.add(new Idea(CONCORDANCIA_PRONOME, "concordancia", verbo.start(), verbo.end(),
                    "Concordância: com “" + pron.text() + "”, use “" + certa + "” em vez de “" + verbo.text() + "”.",
                    preservarCaixa(verbo.text(), certa)));
        }
    }

    private static String preservarCaixa(String original, String nova) {
        if (!original.isEmpty() && Character.isUpperCase(original.codePointAt(0))) {
            return nova.substring(0, 1).toUpperCase(PT_BR) + nova.substring(1);
        }
        return nova;
    }

    /** Forma verbal com o tempo já decidido. */
    record VerbForm(Word word, String tense) {
    }

    private List<VerbForm> formasNarradas(String texto, int deslocamento) {
        List<Dialogue.Span> citacoes = Dialogue.quotedSpans(texto);
        List<VerbForm> r = new ArrayList<>();
        for (Word w : words(texto, deslocamento)) {
            int local = w.start() - deslocamento;
            boolean citada = false;
            for (Dialogue.Span s : citacoes) {
                if (s.contains(local)) {
                    citada = true;
                    break;
                }
            }
            if (citada) {
                continue;
            }
            String tempo = verbos.tense(w.lower());
            if (tempo != null) {
                r.add(new VerbForm(w, tempo));
            }
        }
        return r;
    }

    /** Intervalos de frases [início, fim) dentro de um parágrafo. */
    static List<int[]> sentences(String p) {
        List<int[]> r = new ArrayList<>();
        int n = p.length();
        int inicio = -1;
        int i = 0;
        while (i < n) {
            int cp = p.codePointAt(i);
            if (inicio < 0) {
                if (!CharClass.isSpace(cp)) {
                    inicio = i;
                } else {
                    i += Character.charCount(cp);
                    continue;
                }
            }
            if (CharClass.isTerminal(cp)) {
                int j = i;
                while (j < n && CharClass.isTerminal(p.codePointAt(j))) {
                    j += Character.charCount(p.codePointAt(j));
                }
                boolean fim = j >= n || CharClass.isSpace(p.codePointAt(j)) || CharClass.isAfterTerminal(p.codePointAt(j));
                if (fim) {
                    while (j < n && CharClass.isAfterTerminal(p.codePointAt(j)) && p.codePointAt(j) != 0x2014) {
                        j += Character.charCount(p.codePointAt(j));
                    }
                    r.add(new int[] {inicio, j});
                    inicio = -1;
                }
                i = j;
                continue;
            }
            i += Character.charCount(cp);
        }
        if (inicio >= 0) {
            int fim = n;
            while (fim > inicio && CharClass.isSpace(p.charAt(fim - 1))) {
                fim--;
            }
            r.add(new int[] {inicio, fim});
        }
        return r;
    }

    private void narration(List<Paragraph> paragrafos, List<Idea> out) {
        int passado = 0;
        int presente = 0;
        List<List<VerbForm>> porParagrafo = new ArrayList<>();
        List<Paragraph> narrados = new ArrayList<>();
        for (Paragraph p : paragrafos) {
            if (p.dialogue()) {
                continue;
            }
            narrados.add(p);
            List<VerbForm> formasParagrafo = new ArrayList<>();
            for (int[] f : sentences(p.text())) {
                String frase = p.text().substring(f[0], f[1]);
                int base = p.offset() + f[0];
                if (TextStats.countWords(frase) > MAX_PALAVRAS_FRASE) {
                    out.add(new Idea(FRASE_LONGA, "estilo", base, base + frase.length(),
                            "Frase longa (" + TextStats.countWords(frase) + " palavras): considere dividi-la.", ""));
                }
                List<VerbForm> formas = formasNarradas(frase, base);
                formasParagrafo.addAll(formas);
                VerbForm primeiraPassada = null;
                for (VerbForm v : formas) {
                    if (VerbTable.isPast(v.tense())) {
                        primeiraPassada = v;
                        break;
                    }
                }
                if (primeiraPassada == null) {
                    continue;
                }
                for (VerbForm v : formas) {
                    if (!VerbTable.PRESENTE.equals(v.tense())) {
                        continue;
                    }
                    out.add(new Idea(TEMPO_FRASE, "tempo-verbal", v.word().start(), v.word().end(),
                            "Mistura de tempos verbais: “" + primeiraPassada.word().text() + "” está no passado e “"
                                    + v.word().text() + "” no presente.",
                            sugestaoPassado(v.word())));
                }
            }
            for (VerbForm v : formasParagrafo) {
                if (VerbTable.isPast(v.tense())) {
                    passado++;
                } else {
                    presente++;
                }
            }
            porParagrafo.add(formasParagrafo);
        }
        int total = passado + presente;
        if (total < MIN_FORMAS_CAPITULO) {
            return;
        }
        boolean narradoNoPassado = passado >= PROPORCAO_CAPITULO * total;
        boolean narradoNoPresente = presente >= PROPORCAO_CAPITULO * total;
        if (!narradoNoPassado && !narradoNoPresente) {
            return;
        }
        for (List<VerbForm> formas : porParagrafo) {
            int pres = 0;
            int pass = 0;
            VerbForm primeiraPres = null;
            VerbForm primeiraPass = null;
            for (VerbForm v : formas) {
                if (VerbTable.isPast(v.tense())) {
                    pass++;
                    if (primeiraPass == null) {
                        primeiraPass = v;
                    }
                } else {
                    pres++;
                    if (primeiraPres == null) {
                        primeiraPres = v;
                    }
                }
            }
            if (narradoNoPassado && pres >= 2 && pass == 0) {
                out.add(new Idea(TEMPO_CAPITULO, "tempo-verbal", primeiraPres.word().start(), primeiraPres.word().end(),
                        "O capítulo é narrado no passado, mas este parágrafo está no presente.", ""));
            } else if (narradoNoPresente && pass >= 2 && pres == 0) {
                out.add(new Idea(TEMPO_CAPITULO, "tempo-verbal", primeiraPass.word().start(), primeiraPass.word().end(),
                        "O capítulo é narrado no presente, mas este parágrafo está no passado.", ""));
            }
        }
    }

    private String sugestaoPassado(Word w) {
        for (VerbTable.Use u : verbos.uses(w.lower())) {
            String s = verbos.form(u.verb(), VerbTable.PERFEITO, u.person());
            if (s == null) {
                s = verbos.form(u.verb(), VerbTable.IMPERFEITO, u.person());
            }
            if (s != null) {
                return preservarCaixa(w.text(), s);
            }
        }
        return "";
    }

    /** Carrega o motor a partir dos JSON já lidos. */
    public static IdeaEngine fromJson(Map<String, Object> regras, Map<String, Object> verbos) {
        return new IdeaEngine(PatternRule.listFromJson(regras), VerbTable.fromJson(verbos));
    }
}
