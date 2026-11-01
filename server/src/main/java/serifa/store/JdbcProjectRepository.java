/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.store;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import serifa.json.Json;
import serifa.model.Project;

/**
 * Repositório JDBC opcional (PostgreSQL, esquema em {@code db/schema.sql}). O driver não é
 * dependência de compilação: basta estar no classpath e {@code SERIFA_DB_URL} estar definido.
 * O documento completo fica em {@code projeto.documento} (jsonb) e os capítulos são espelhados
 * na tabela {@code capitulo} para consultas.
 */
public final class JdbcProjectRepository implements ProjectRepository {

    private final String url;
    private final String usuario;
    private final String senha;

    public JdbcProjectRepository(String url, String usuario, String senha) {
        this.url = url;
        this.usuario = usuario;
        this.senha = senha;
    }

    /** Cria o repositório se a URL estiver definida e o driver puder ser carregado. */
    public static Optional<ProjectRepository> fromEnvironment() {
        String url = System.getenv("SERIFA_DB_URL");
        if (url == null || url.isBlank()) {
            return Optional.empty();
        }
        try {
            DriverManager.getDriver(url);
        } catch (SQLException e) {
            System.err.println("Aviso: SERIFA_DB_URL definido, mas nenhum driver JDBC aceitou a URL; usando arquivos.");
            return Optional.empty();
        }
        return Optional.of(new JdbcProjectRepository(url, System.getenv("SERIFA_DB_USER"), System.getenv("SERIFA_DB_PASSWORD")));
    }

    private Connection conectar() throws SQLException {
        return usuario == null ? DriverManager.getConnection(url) : DriverManager.getConnection(url, usuario, senha);
    }

    private static RuntimeException falha(SQLException e) {
        return new IllegalStateException("Erro no banco de dados: " + e.getMessage(), e);
    }

    @Override
    public List<Summary> list() {
        List<Summary> r = new ArrayList<>();
        String sql = "SELECT p.id, p.titulo, p.atualizado_em, (SELECT count(*) FROM capitulo c WHERE c.projeto_id = p.id) "
                + "FROM projeto p ORDER BY p.atualizado_em DESC";
        try (Connection c = conectar(); PreparedStatement st = c.prepareStatement(sql); ResultSet rs = st.executeQuery()) {
            while (rs.next()) {
                r.add(new Summary(rs.getString(1), rs.getString(2), String.valueOf(rs.getTimestamp(3).toInstant()), rs.getInt(4)));
            }
        } catch (SQLException e) {
            throw falha(e);
        }
        return r;
    }

    @Override
    public Optional<Map<String, Object>> get(String id) {
        try (Connection c = conectar();
             PreparedStatement st = c.prepareStatement("SELECT documento::text FROM projeto WHERE id = ?::uuid")) {
            st.setString(1, id);
            try (ResultSet rs = st.executeQuery()) {
                return rs.next() ? Optional.of(Json.parseObject(rs.getString(1))) : Optional.empty();
            }
        } catch (SQLException e) {
            throw falha(e);
        }
    }

    @Override
    public void save(Map<String, Object> doc) {
        Project p = Project.wrap(doc);
        String json = Json.stringify(doc);
        try (Connection c = conectar()) {
            c.setAutoCommit(false);
            try {
                try (PreparedStatement st = c.prepareStatement(
                        "INSERT INTO projeto (id, titulo, autor, idioma, documento, criado_em, atualizado_em) "
                                + "VALUES (?::uuid, ?, ?, ?, ?::jsonb, now(), now()) ON CONFLICT (id) DO UPDATE SET "
                                + "titulo = EXCLUDED.titulo, autor = EXCLUDED.autor, idioma = EXCLUDED.idioma, "
                                + "documento = EXCLUDED.documento, versao = projeto.versao + 1, atualizado_em = now()")) {
                    st.setString(1, p.id());
                    st.setString(2, p.title());
                    st.setString(3, p.author());
                    st.setString(4, p.language());
                    st.setString(5, json);
                    st.executeUpdate();
                }
                // apaga só os capítulos que saíram; os outros são atualizados no lugar (mantém os vínculos)
                List<String> ids = new ArrayList<>();
                for (Project.Chapter cap : p.chapters()) {
                    ids.add(cap.id());
                }
                try (PreparedStatement del = c.prepareStatement(
                        "DELETE FROM capitulo WHERE projeto_id = ?::uuid AND NOT (id::text = ANY (?))")) {
                    del.setString(1, p.id());
                    del.setArray(2, c.createArrayOf("text", ids.toArray()));
                    del.executeUpdate();
                }
                try (PreparedStatement ins = c.prepareStatement(
                        "INSERT INTO capitulo (id, projeto_id, titulo, posicao, html, notas, status, atualizado_em) "
                                + "VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, ?, now()) ON CONFLICT (id) DO UPDATE SET "
                                + "titulo = EXCLUDED.titulo, posicao = EXCLUDED.posicao, html = EXCLUDED.html, "
                                + "notas = EXCLUDED.notas, status = EXCLUDED.status, atualizado_em = now()")) {
                    for (Project.Chapter cap : p.chapters()) {
                        ins.setString(1, cap.id());
                        ins.setString(2, p.id());
                        ins.setString(3, cap.title());
                        ins.setInt(4, cap.position());
                        ins.setString(5, cap.html());
                        ins.setString(6, cap.notes());
                        ins.setString(7, cap.status());
                        ins.addBatch();
                    }
                    ins.executeBatch();
                }
                try (PreparedStatement rev = c.prepareStatement(
                        "INSERT INTO revisao (projeto_id, numero, documento, tamanho) VALUES (?::uuid, "
                                + "COALESCE((SELECT max(numero) FROM revisao WHERE projeto_id = ?::uuid), 0) + 1, ?::jsonb, ?)")) {
                    rev.setString(1, p.id());
                    rev.setString(2, p.id());
                    rev.setString(3, json);
                    rev.setInt(4, json.length());
                    rev.executeUpdate();
                }
                try (PreparedStatement poda = c.prepareStatement(
                        "DELETE FROM revisao WHERE projeto_id = ?::uuid AND numero <= "
                                + "(SELECT max(numero) FROM revisao WHERE projeto_id = ?::uuid) - ?")) {
                    poda.setString(1, p.id());
                    poda.setString(2, p.id());
                    poda.setInt(3, MAX_REVISOES);
                    poda.executeUpdate();
                }
                c.commit();
            } catch (SQLException e) {
                c.rollback();
                throw e;
            }
        } catch (SQLException e) {
            throw falha(e);
        }
    }

    @Override
    public boolean delete(String id) {
        try (Connection c = conectar(); PreparedStatement st = c.prepareStatement("DELETE FROM projeto WHERE id = ?::uuid")) {
            st.setString(1, id);
            return st.executeUpdate() > 0;
        } catch (SQLException e) {
            throw falha(e);
        }
    }

    @Override
    public List<Revision> revisions(String id) {
        List<Revision> r = new ArrayList<>();
        try (Connection c = conectar(); PreparedStatement st = c.prepareStatement(
                "SELECT numero, criado_em, tamanho, documento->>'title' FROM revisao WHERE projeto_id = ?::uuid ORDER BY numero DESC")) {
            st.setString(1, id);
            try (ResultSet rs = st.executeQuery()) {
                while (rs.next()) {
                    r.add(new Revision(rs.getInt(1), String.valueOf(rs.getTimestamp(2).toInstant()), rs.getInt(3), rs.getString(4)));
                }
            }
        } catch (SQLException e) {
            throw falha(e);
        }
        return r;
    }
}
