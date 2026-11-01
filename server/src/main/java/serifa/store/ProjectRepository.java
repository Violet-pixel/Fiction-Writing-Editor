/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.store;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/** Armazenamento de projetos {@code .serifa} com histórico de revisões. */
public interface ProjectRepository extends AutoCloseable {

    /** Quantidade de revisões guardadas por projeto. */
    int MAX_REVISOES = 50;

    /** Resumo usado na listagem. */
    record Summary(String id, String title, String updatedAt, int chapters) {
    }

    /** Revisão guardada a cada gravação. */
    record Revision(int number, String savedAt, int size, String title) {
    }

    List<Summary> list();

    Optional<Map<String, Object>> get(String id);

    /** Grava (cria ou substitui) e guarda uma revisão. */
    void save(Map<String, Object> projeto);

    boolean delete(String id);

    List<Revision> revisions(String id);

    @Override
    default void close() {
    }
}
