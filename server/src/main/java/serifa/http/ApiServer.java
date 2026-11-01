/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.http;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import serifa.Engine;
import serifa.export.BookExporter;
import serifa.ideas.Idea;
import serifa.json.Json;
import serifa.json.JsonException;
import serifa.model.Project;
import serifa.spell.SpellChecker;
import serifa.store.ProjectRepository;
import serifa.text.TextStats;

/**
 * Servidor HTTP da API (seção 8) usando {@code com.sun.net.httpserver}. Escuta em 127.0.0.1 por
 * padrão, limita o corpo a 10 MB, envia cabeçalhos de segurança e serve a pasta {@code web/}
 * sem permitir path traversal.
 */
public final class ApiServer {

    /** Tamanho máximo do corpo de uma requisição. */
    public static final int MAX_CORPO = 10 * 1024 * 1024;
    public static final String VERSAO = "1.0.0";

    /** Erro HTTP com status e mensagem em português. */
    public static final class HttpError extends RuntimeException {
        private static final long serialVersionUID = 1L;
        final int status;

        public HttpError(int status, String mensagem) {
            super(mensagem);
            this.status = status;
        }
    }

    /** Resposta pronta para enviar. */
    public record Response(int status, String contentType, byte[] body, Map<String, String> headers) {
        static Response json(int status, Object valor) {
            return new Response(status, "application/json; charset=utf-8",
                    Json.stringify(valor).getBytes(StandardCharsets.UTF_8), Map.of());
        }
    }

    private final Engine engine;
    private final ProjectRepository repo;
    private HttpServer server;
    private java.util.concurrent.ExecutorService executor;

    public ApiServer(Engine engine, ProjectRepository repo) {
        this.engine = engine;
        this.repo = repo;
    }

    /** Sobe o servidor. */
    public void start(String host, int porta) throws IOException {
        server = HttpServer.create(new InetSocketAddress(host, porta), 0);
        server.createContext("/", this::tratar);
        executor = Executors.newFixedThreadPool(Math.max(4, Runtime.getRuntime().availableProcessors()));
        server.setExecutor(executor);
        server.start();
    }

    public int port() {
        return server.getAddress().getPort();
    }

    public void stop() {
        if (server != null) {
            server.stop(0);
        }
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    private void tratar(HttpExchange ex) throws IOException {
        Response r;
        try {
            r = route(ex.getRequestMethod().toUpperCase(Locale.ROOT), ex.getRequestURI().getRawPath(),
                    ex.getRequestURI().getRawQuery(), () -> lerCorpo(ex), ex.getRequestHeaders().getFirst("Content-Type"));
        } catch (HttpError e) {
            r = Response.json(e.status, Json.mapOf("error", e.getMessage()));
        } catch (JsonException e) {
            r = Response.json(400, Json.mapOf("error", "JSON inválido: " + e.getMessage()));
        } catch (IllegalArgumentException e) {
            r = Response.json(400, Json.mapOf("error", e.getMessage()));
        } catch (RuntimeException e) {
            r = Response.json(500, Json.mapOf("error", "Erro interno no servidor."));
        }
        var h = ex.getResponseHeaders();
        h.set("X-Content-Type-Options", "nosniff");
        h.set("X-Frame-Options", "DENY");
        h.set("Referrer-Policy", "no-referrer");
        h.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; "
                + "script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
        h.set("Cross-Origin-Opener-Policy", "same-origin");
        h.set("Content-Type", r.contentType());
        h.set("Cache-Control", "no-store");
        r.headers().forEach(h::set);
        boolean head = ex.getRequestMethod().equalsIgnoreCase("HEAD");
        ex.sendResponseHeaders(r.status(), head || r.body().length == 0 ? -1 : r.body().length);
        if (!head && r.body().length > 0) {
            try (OutputStream os = ex.getResponseBody()) {
                os.write(r.body());
            }
        }
        ex.close();
    }

    private static byte[] lerCorpo(HttpExchange ex) {
        String tamanho = ex.getRequestHeaders().getFirst("Content-Length");
        if (tamanho != null) {
            try {
                if (Long.parseLong(tamanho.trim()) > MAX_CORPO) {
                    throw new HttpError(413, "Corpo da requisição maior que 10 MB.");
                }
            } catch (NumberFormatException e) {
                throw new HttpError(400, "Content-Length inválido.");
            }
        }
        try (InputStream in = ex.getRequestBody()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > MAX_CORPO) {
                    throw new HttpError(413, "Corpo da requisição maior que 10 MB.");
                }
            }
            return out.toByteArray();
        } catch (IOException e) {
            throw new HttpError(400, "Não foi possível ler o corpo da requisição.");
        }
    }

    /** Fornecedor do corpo (lido só quando a rota precisa). */
    public interface Body {
        byte[] get();
    }

    private static Map<String, Object> corpoJson(Body body) {
        byte[] b = body.get();
        if (b.length == 0) {
            throw new HttpError(400, "Corpo JSON vazio.");
        }
        return Json.parseObject(new String(b, StandardCharsets.UTF_8));
    }

    private static Map<String, String> query(String raw) {
        Map<String, String> q = new LinkedHashMap<>();
        if (raw == null || raw.isEmpty()) {
            return q;
        }
        for (String par : raw.split("&")) {
            int igual = par.indexOf('=');
            String k = igual < 0 ? par : par.substring(0, igual);
            String v = igual < 0 ? "" : par.substring(igual + 1);
            q.put(URLDecoder.decode(k, StandardCharsets.UTF_8), URLDecoder.decode(v, StandardCharsets.UTF_8));
        }
        return q;
    }

    /** Roteador: separado do HttpExchange para poder ser testado diretamente. */
    public Response route(String metodo, String caminho, String rawQuery, Body body, String contentType) {
        if (caminho == null || caminho.isEmpty()) {
            caminho = "/";
        }
        if (!caminho.startsWith("/api/")) {
            if (!metodo.equals("GET") && !metodo.equals("HEAD")) {
                throw new HttpError(405, "Método não permitido.");
            }
            return StaticFiles.serve(engine.web(), caminho);
        }
        String[] p = caminho.substring(1).split("/");
        if (p.length < 3 || !p[1].equals("v1")) {
            throw new HttpError(404, "Rota da API não encontrada.");
        }
        String recurso = p[2];
        switch (recurso) {
            case "health" -> {
                exigir(metodo, "GET");
                return Response.json(200, Json.mapOf("status", "ok", "app", "Serifa", "version", VERSAO));
            }
            case "count" -> {
                exigir(metodo, "POST");
                Map<String, Object> b = corpoJson(body);
                return Response.json(200, TextStats.of(texto(b)).toJson());
            }
            case "check" -> {
                exigir(metodo, "POST");
                return Response.json(200, check(corpoJson(body)));
            }
            case "export" -> {
                exigir(metodo, "POST");
                if (p.length != 4) {
                    throw new HttpError(404, "Informe o formato: /api/v1/export/{wattpad|ao3|txt|md|html|docx|epub}.");
                }
                Project pr = Project.wrap(corpoJson(body));
                List<String> erros = pr.validate();
                if (!erros.isEmpty()) {
                    throw new HttpError(422, "Projeto inválido: " + String.join(" ", erros));
                }
                BookExporter.Output o = BookExporter.export(pr, p[3], query(rawQuery).get("chapter"));
                return new Response(200, o.contentType(), o.bytes(),
                        Map.of("Content-Disposition", "attachment; filename=\"" + o.fileName() + "\""));
            }
            case "projects" -> {
                return projetos(metodo, p, body);
            }
            default -> throw new HttpError(404, "Rota da API não encontrada.");
        }
    }

    private static void exigir(String metodo, String esperado) {
        if (!metodo.equals(esperado)) {
            throw new HttpError(405, "Método não permitido (use " + esperado + ").");
        }
    }

    private static String texto(Map<String, Object> b) {
        Object t = b.get("text");
        if (!(t instanceof String s)) {
            throw new HttpError(400, "O campo 'text' é obrigatório e precisa ser texto.");
        }
        return s;
    }

    private Map<String, Object> check(Map<String, Object> b) {
        String t = texto(b);
        Map<String, Object> r = new LinkedHashMap<>();
        List<Object> ortografia = new ArrayList<>();
        if (Json.bool(b, "spelling", true)) {
            SpellChecker sc = engine.speller();
            for (SpellChecker.Misspelling m : sc.review(t, Json.strings(b, "personal"), true)) {
                ortografia.add(m.toJson());
            }
        }
        List<Object> ideias = new ArrayList<>();
        if (Json.bool(b, "ideas", true)) {
            for (Idea i : engine.ideas().analyze(t, Json.strings(b, "ignored"))) {
                ideias.add(i.toJson());
            }
        }
        r.put("spelling", ortografia);
        r.put("ideas", ideias);
        return r;
    }

    private Response projetos(String metodo, String[] p, Body body) {
        if (p.length == 3) {
            if (metodo.equals("GET")) {
                List<Object> lista = new ArrayList<>();
                for (ProjectRepository.Summary s : repo.list()) {
                    lista.add(Json.mapOf("id", s.id(), "title", s.title(), "updatedAt", s.updatedAt(), "chapters", s.chapters()));
                }
                return Response.json(200, lista);
            }
            if (metodo.equals("POST")) {
                byte[] b = body.get();
                Map<String, Object> doc;
                if (b.length == 0) {
                    doc = Project.create("Sem título").json();
                } else {
                    doc = Json.parseObject(new String(b, StandardCharsets.UTF_8));
                    if (!doc.containsKey("format") && doc.size() <= 2) {
                        doc = Project.create(Json.str(doc, "title", "Sem título")).json();
                    }
                    if (!Project.isValidId(Json.str(doc, "id", null))) {
                        doc.put("id", UUID.randomUUID().toString());
                    }
                }
                validar(doc);
                if (repo.get(Json.str(doc, "id", "")).isPresent()) {
                    throw new HttpError(409, "Já existe um projeto com esse id.");
                }
                doc.put("updatedAt", Project.now());
                repo.save(doc);
                return Response.json(201, doc);
            }
            throw new HttpError(405, "Método não permitido.");
        }
        String id = p[3];
        if (!Project.isValidId(id)) {
            throw new HttpError(400, "Identificador de projeto inválido.");
        }
        if (p.length == 5 && p[4].equals("revisions")) {
            exigir(metodo, "GET");
            if (repo.get(id).isEmpty()) {
                throw new HttpError(404, "Projeto não encontrado.");
            }
            List<Object> lista = new ArrayList<>();
            for (ProjectRepository.Revision r : repo.revisions(id)) {
                lista.add(Json.mapOf("number", r.number(), "savedAt", r.savedAt(), "size", r.size(), "title", r.title()));
            }
            return Response.json(200, lista);
        }
        if (p.length != 4) {
            throw new HttpError(404, "Rota da API não encontrada.");
        }
        switch (metodo) {
            case "GET" -> {
                return Response.json(200, repo.get(id).orElseThrow(() -> new HttpError(404, "Projeto não encontrado.")));
            }
            case "PUT" -> {
                Map<String, Object> doc = corpoJson(body);
                if (!id.equals(Json.str(doc, "id", null))) {
                    throw new HttpError(400, "O 'id' do corpo é diferente do 'id' da URL.");
                }
                validar(doc);
                doc.put("updatedAt", Project.now());
                repo.save(doc);
                return Response.json(200, doc);
            }
            case "DELETE" -> {
                if (!repo.delete(id)) {
                    throw new HttpError(404, "Projeto não encontrado.");
                }
                return new Response(204, "application/json; charset=utf-8", new byte[0], Map.of());
            }
            default -> throw new HttpError(405, "Método não permitido.");
        }
    }

    private static void validar(Map<String, Object> doc) {
        List<String> erros = Project.wrap(doc).validate();
        if (!erros.isEmpty()) {
            throw new HttpError(422, "Projeto inválido: " + String.join(" ", erros));
        }
    }

    /** Arquivos estáticos de {@code web/}. */
    public static final class StaticFiles {
        private static final Map<String, String> TIPOS = Map.ofEntries(
                Map.entry("html", "text/html; charset=utf-8"), Map.entry("js", "text/javascript; charset=utf-8"),
                Map.entry("mjs", "text/javascript; charset=utf-8"), Map.entry("css", "text/css; charset=utf-8"),
                Map.entry("json", "application/json; charset=utf-8"), Map.entry("wasm", "application/wasm"),
                Map.entry("svg", "image/svg+xml"), Map.entry("png", "image/png"), Map.entry("jpg", "image/jpeg"),
                Map.entry("jpeg", "image/jpeg"), Map.entry("webp", "image/webp"), Map.entry("ico", "image/x-icon"),
                Map.entry("txt", "text/plain; charset=utf-8"), Map.entry("aff", "text/plain; charset=utf-8"),
                Map.entry("dic", "text/plain; charset=utf-8"), Map.entry("woff2", "font/woff2"),
                Map.entry("webmanifest", "application/manifest+json"));

        private StaticFiles() {
        }

        /** Resolve o caminho pedido dentro da raiz, recusando qualquer saída dela. */
        public static Path resolve(Path raiz, String caminhoBruto) {
            String c = URLDecoder.decode(caminhoBruto.replace("+", "%2B"), StandardCharsets.UTF_8);
            if (c.indexOf('\0') >= 0 || c.contains("\\")) {
                return null;
            }
            if (c.endsWith("/")) {
                c = c + "index.html";
            }
            for (String parte : c.split("/")) {
                if (parte.equals("..") || (parte.startsWith(".") && !parte.isEmpty())) {
                    return null;
                }
            }
            Path base = raiz.toAbsolutePath().normalize();
            Path alvo = base.resolve(c.substring(1)).normalize();
            return alvo.startsWith(base) ? alvo : null;
        }

        static Response serve(Path raiz, String caminho) {
            Path alvo = resolve(raiz, caminho);
            if (alvo == null) {
                throw new HttpError(403, "Caminho não permitido.");
            }
            if (Files.isDirectory(alvo)) {
                alvo = alvo.resolve("index.html");
            }
            if (!Files.isRegularFile(alvo, LinkOption.NOFOLLOW_LINKS)) {
                throw new HttpError(404, "Arquivo não encontrado.");
            }
            String nome = alvo.getFileName().toString();
            int ponto = nome.lastIndexOf('.');
            String ext = ponto < 0 ? "" : nome.substring(ponto + 1).toLowerCase(Locale.ROOT);
            try {
                return new Response(200, TIPOS.getOrDefault(ext, "application/octet-stream"), Files.readAllBytes(alvo), Map.of());
            } catch (IOException e) {
                throw new HttpError(500, "Falha ao ler o arquivo.");
            }
        }
    }
}
