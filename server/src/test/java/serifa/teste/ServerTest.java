/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.teste;

import static serifa.teste.TestRunner.contem;
import static serifa.teste.TestRunner.igual;
import static serifa.teste.TestRunner.verdade;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import serifa.http.ApiServer;
import serifa.json.Json;
import serifa.model.Project;
import serifa.store.FileProjectRepository;
import serifa.teste.TestRunner.Teste;

/** Testes da API HTTP de ponta a ponta (servidor real numa porta livre). */
public class ServerTest {

    private static HttpResponse<String> pedir(HttpClient c, int porta, String metodo, String caminho, String corpo)
            throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + porta + caminho));
        b.method(metodo, corpo == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(corpo, StandardCharsets.UTF_8));
        return c.send(b.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    }

    @Teste
    @SuppressWarnings("unchecked")
    public void apiCompleta() throws Exception {
        Path dados = Files.createTempDirectory("serifa-teste");
        ApiServer s = new ApiServer(Recursos.ENGINE, new FileProjectRepository(dados));
        s.start("127.0.0.1", 0);
        int porta = s.port();
        HttpClient c = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).build();
        try {
            HttpResponse<String> h = pedir(c, porta, "GET", "/api/v1/health", null);
            igual(200, h.statusCode());
            igual("{\"status\":\"ok\",\"app\":\"Serifa\",\"version\":\"1.0.0\"}", h.body());
            igual("DENY", h.headers().firstValue("X-Frame-Options").orElse(""));
            igual("nosniff", h.headers().firstValue("X-Content-Type-Options").orElse(""));
            verdade(h.headers().firstValue("Content-Security-Policy").isPresent(), "CSP presente");

            HttpResponse<String> cont = pedir(c, porta, "POST", "/api/v1/count", "{\"text\":\"Olá, mundo. — Fala\"}");
            igual(200, cont.statusCode());
            igual(3L, Json.parseObject(cont.body()).get("words"));
            igual(400, pedir(c, porta, "POST", "/api/v1/count", "{\"txt\":1}").statusCode());
            igual(400, pedir(c, porta, "POST", "/api/v1/count", "{ruim").statusCode());
            contem(pedir(c, porta, "POST", "/api/v1/count", "{ruim").body(), "JSON inválido");

            HttpResponse<String> chk = pedir(c, porta, "POST", "/api/v1/check",
                    "{\"text\":\"Voce subiu para cima. Zuzu\",\"personal\":[\"zuzu\"]}");
            Map<String, Object> r = Json.parseObject(chk.body());
            igual(1, Json.list(r, "spelling").size());
            igual(1, Json.list(r, "ideas").size());

            Project p = Project.create("Teste de API");
            HttpResponse<String> criado = pedir(c, porta, "POST", "/api/v1/projects", Json.stringify(p.json()));
            igual(201, criado.statusCode());
            igual(409, pedir(c, porta, "POST", "/api/v1/projects", Json.stringify(p.json())).statusCode());
            p.json().put("title", "Novo título");
            igual(200, pedir(c, porta, "PUT", "/api/v1/projects/" + p.id(), Json.stringify(p.json())).statusCode());
            igual(400, pedir(c, porta, "PUT", "/api/v1/projects/outro-id", Json.stringify(p.json())).statusCode());
            List<Object> lista = (List<Object>) Json.parse(pedir(c, porta, "GET", "/api/v1/projects", null).body());
            igual(1, lista.size());
            List<Object> revs = (List<Object>) Json.parse(pedir(c, porta, "GET", "/api/v1/projects/" + p.id() + "/revisions", null).body());
            igual(2, revs.size());
            contem(pedir(c, porta, "GET", "/api/v1/projects/" + p.id(), null).body(), "Novo título");

            HttpResponse<String> exp = pedir(c, porta, "POST", "/api/v1/export/txt", Json.stringify(p.json()));
            igual(200, exp.statusCode());
            contem(exp.headers().firstValue("Content-Disposition").orElse(""), "novo-titulo.txt");
            igual(400, pedir(c, porta, "POST", "/api/v1/export/txt?chapter=nada", Json.stringify(p.json())).statusCode());

            igual(204, pedir(c, porta, "DELETE", "/api/v1/projects/" + p.id(), null).statusCode());
            igual(404, pedir(c, porta, "GET", "/api/v1/projects/" + p.id(), null).statusCode());
            igual(405, pedir(c, porta, "DELETE", "/api/v1/health", null).statusCode());
            igual(404, pedir(c, porta, "GET", "/api/v2/health", null).statusCode());

            igual(200, pedir(c, porta, "GET", "/dados/regras.json", null).statusCode());
            int trav = pedir(c, porta, "GET", "/%2e%2e/server/build.sh", null).statusCode();
            verdade(trav == 403 || trav == 404, "path traversal bloqueado");
            igual(403, pedir(c, porta, "GET", "/dados/..%2f..%2fserver%2fbuild.sh", null).statusCode());

            // Corpo grande, mas abaixo do limite de 10 MB, é aceito.
            String grande = "{\"text\":\"" + "a ".repeat(ApiServer.MAX_CORPO / 4) + "\"}";
            HttpResponse<String> g = pedir(c, porta, "POST", "/api/v1/count", grande);
            igual(200, g.statusCode());
            igual((long) (ApiServer.MAX_CORPO / 4), Json.parseObject(g.body()).get("words"));
        } finally {
            s.stop();
        }
    }

    @Teste
    public void resolucaoDeCaminhos() {
        Path raiz = Path.of("/tmp/raiz");
        igual(null, ApiServer.StaticFiles.resolve(raiz, "/../etc/passwd"));
        igual(null, ApiServer.StaticFiles.resolve(raiz, "/a/%2e%2e/%2e%2e/x"));
        igual(null, ApiServer.StaticFiles.resolve(raiz, "/.git/config"));
        igual(raiz.resolve("index.html"), ApiServer.StaticFiles.resolve(raiz, "/"));
        igual(raiz.resolve("js/app.js"), ApiServer.StaticFiles.resolve(raiz, "/js/app.js"));
    }

    @Teste
    public void revisoesLimitadas() throws Exception {
        FileProjectRepository repo = new FileProjectRepository(Files.createTempDirectory("serifa-rev"));
        Project p = Project.create("Revisões");
        for (int i = 0; i < 55; i++) {
            p.json().put("title", "Versão " + i);
            repo.save(p.json());
        }
        igual(50, repo.revisions(p.id()).size());
        igual(55, repo.revisions(p.id()).get(0).number());
        igual("Versão 54", Json.str(repo.get(p.id()).orElseThrow(), "title", ""));
    }
}
