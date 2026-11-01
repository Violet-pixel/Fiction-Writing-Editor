/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.teste;

import java.nio.file.Files;
import java.nio.file.Path;
import serifa.Engine;

/** Recursos compartilhados pelos testes (o dicionário é carregado uma vez só). */
final class Recursos {

    static final Engine ENGINE = Engine.fromEnvironment();

    private Recursos() {
    }

    /** Pasta tests/fixtures do repositório. */
    static Path fixtures() {
        for (Path p : new Path[] {Path.of("../tests/fixtures"), Path.of("tests/fixtures")}) {
            if (Files.isDirectory(p)) {
                return p;
            }
        }
        return ENGINE.web().resolve("../tests/fixtures").normalize();
    }
}
