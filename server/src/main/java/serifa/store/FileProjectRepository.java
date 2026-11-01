/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.store;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;
import serifa.json.Json;
import serifa.model.Project;

/**
 * Repositório em arquivos JSON: {@code <dados>/projetos/<id>.serifa} e
 * {@code <dados>/revisoes/<id>/<numero>.serifa}. Toda gravação é atômica (arquivo temporário +
 * {@code ATOMIC_MOVE}) para não corromper o projeto se o processo cair no meio.
 */
public final class FileProjectRepository implements ProjectRepository {

    private final Path projetos;
    private final Path revisoes;

    public FileProjectRepository(Path raiz) {
        this.projetos = raiz.resolve("projetos");
        this.revisoes = raiz.resolve("revisoes");
        try {
            Files.createDirectories(projetos);
            Files.createDirectories(revisoes);
        } catch (IOException e) {
            throw new UncheckedIOException("Não foi possível criar a pasta de dados " + raiz, e);
        }
    }

    private Path arquivo(String id) {
        if (!Project.isValidId(id)) {
            throw new IllegalArgumentException("Identificador de projeto inválido.");
        }
        return projetos.resolve(id + ".serifa");
    }

    /** Grava bytes de forma atômica. */
    public static void writeAtomic(Path destino, String conteudo) throws IOException {
        Path tmp = destino.resolveSibling(destino.getFileName() + ".tmp-" + ProcessHandle.current().pid() + "-"
                + Thread.currentThread().threadId());
        Files.writeString(tmp, conteudo, StandardCharsets.UTF_8);
        try {
            Files.move(tmp, destino, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, destino, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /** Grava bytes de forma atômica (arquivos binários da exportação). */
    public static void writeAtomicBytes(Path destino, byte[] conteudo) throws IOException {
        Path abs = destino.toAbsolutePath();
        Path tmp = abs.resolveSibling(abs.getFileName() + ".tmp-" + ProcessHandle.current().pid());
        Files.write(tmp, conteudo);
        try {
            Files.move(tmp, abs, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(tmp, abs, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    @Override
    public synchronized List<Summary> list() {
        List<Summary> r = new ArrayList<>();
        try (DirectoryStream<Path> ds = Files.newDirectoryStream(projetos, "*.serifa")) {
            for (Path p : ds) {
                try {
                    Map<String, Object> doc = Json.parseObject(Files.readString(p, StandardCharsets.UTF_8));
                    Project pr = Project.wrap(doc);
                    r.add(new Summary(pr.id(), pr.title(), pr.updatedAt(), pr.chapters().size()));
                } catch (RuntimeException ruim) {
                    // Arquivo corrompido não derruba a listagem.
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        r.sort(Comparator.comparing(Summary::updatedAt).reversed());
        return r;
    }

    @Override
    public synchronized Optional<Map<String, Object>> get(String id) {
        Path p = arquivo(id);
        if (!Files.exists(p)) {
            return Optional.empty();
        }
        try {
            return Optional.of(Json.parseObject(Files.readString(p, StandardCharsets.UTF_8)));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public synchronized void save(Map<String, Object> doc) {
        String id = Json.str(doc, "id", null);
        Path p = arquivo(id);
        String json = Json.pretty(doc, 1);
        try {
            writeAtomic(p, json);
            Path dir = revisoes.resolve(id);
            Files.createDirectories(dir);
            int proximo = numeros(dir).stream().mapToInt(Integer::intValue).max().orElse(0) + 1;
            writeAtomic(dir.resolve(String.format("%06d.serifa", proximo)), json);
            List<Integer> todos = numeros(dir);
            todos.sort(null);
            while (todos.size() > MAX_REVISOES) {
                Files.deleteIfExists(dir.resolve(String.format("%06d.serifa", todos.remove(0))));
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Falha ao gravar o projeto: " + e.getMessage(), e);
        }
    }

    private static List<Integer> numeros(Path dir) throws IOException {
        List<Integer> r = new ArrayList<>();
        try (Stream<Path> s = Files.list(dir)) {
            s.forEach(p -> {
                String n = p.getFileName().toString();
                if (n.matches("\\d{6}\\.serifa")) {
                    r.add(Integer.parseInt(n.substring(0, 6)));
                }
            });
        }
        return r;
    }

    @Override
    public synchronized boolean delete(String id) {
        Path p = arquivo(id);
        try {
            boolean apagou = Files.deleteIfExists(p);
            Path dir = revisoes.resolve(id);
            if (Files.isDirectory(dir)) {
                try (Stream<Path> s = Files.list(dir)) {
                    for (Path f : s.toList()) {
                        Files.deleteIfExists(f);
                    }
                }
                Files.deleteIfExists(dir);
            }
            return apagou;
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @Override
    public synchronized List<Revision> revisions(String id) {
        arquivo(id);
        Path dir = revisoes.resolve(id);
        List<Revision> r = new ArrayList<>();
        if (!Files.isDirectory(dir)) {
            return r;
        }
        try {
            List<Integer> nums = numeros(dir);
            nums.sort(Comparator.reverseOrder());
            for (int n : nums) {
                Path f = dir.resolve(String.format("%06d.serifa", n));
                String conteudo = Files.readString(f, StandardCharsets.UTF_8);
                String titulo;
                String quando;
                try {
                    Project pr = Project.wrap(Json.parseObject(conteudo));
                    titulo = pr.title();
                    quando = pr.updatedAt();
                } catch (RuntimeException ruim) {
                    titulo = "";
                    quando = "";
                }
                r.add(new Revision(n, quando, conteudo.length(), titulo));
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return r;
    }
}
