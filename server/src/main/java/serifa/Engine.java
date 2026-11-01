/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import serifa.ideas.IdeaEngine;
import serifa.json.Json;
import serifa.spell.HunspellDictionary;
import serifa.spell.SpellChecker;

/**
 * Ponto central do motor: localiza a pasta {@code web/} (variável {@code SERIFA_WEB}, ou
 * {@code ../web} / {@code ./web}) e carrega sob demanda o dicionário e as regras.
 */
public final class Engine {

    private final Path web;
    private volatile SpellChecker speller;
    private volatile IdeaEngine ideas;

    public Engine(Path web) {
        this.web = web.toAbsolutePath().normalize();
    }

    /** Descobre a pasta web a partir do ambiente. */
    public static Path findWeb() {
        String env = System.getenv("SERIFA_WEB");
        if (env == null || env.isBlank()) {
            env = System.getProperty("serifa.web");
        }
        if (env != null && !env.isBlank()) {
            return Path.of(env);
        }
        for (String c : List.of("../web", "./web", "web")) {
            Path p = Path.of(c);
            if (Files.isDirectory(p.resolve("dados"))) {
                return p;
            }
        }
        return Path.of("web");
    }

    public static Engine fromEnvironment() {
        return new Engine(findWeb());
    }

    public Path web() {
        return web;
    }

    /** Corretor ortográfico (carregado na primeira chamada; leva cerca de um segundo). */
    public SpellChecker speller() {
        SpellChecker s = speller;
        if (s == null) {
            synchronized (this) {
                if (speller == null) {
                    try {
                        speller = new SpellChecker(HunspellDictionary.load(web.resolve("dicionario/pt-BR.aff"),
                                web.resolve("dicionario/pt-BR.dic")));
                    } catch (IOException e) {
                        throw new UncheckedIOException("Não foi possível ler o dicionário em " + web.resolve("dicionario"), e);
                    }
                }
                s = speller;
            }
        }
        return s;
    }

    /** Motor de ideias (regras.json + verbos.json). */
    public IdeaEngine ideas() {
        IdeaEngine i = ideas;
        if (i == null) {
            synchronized (this) {
                if (ideas == null) {
                    ideas = IdeaEngine.fromJson(readJson("dados/regras.json"), readJson("dados/verbos.json"));
                }
                i = ideas;
            }
        }
        return i;
    }

    private Map<String, Object> readJson(String rel) {
        try {
            return Json.parseObject(Files.readString(web.resolve(rel), StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException("Não foi possível ler " + web.resolve(rel), e);
        }
    }
}
