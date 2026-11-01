/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.cli;

import java.io.IOException;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import serifa.Engine;
import serifa.export.BookExporter;
import serifa.http.ApiServer;
import serifa.ideas.Idea;
import serifa.json.Json;
import serifa.model.Project;
import serifa.spell.SpellChecker;
import serifa.store.FileProjectRepository;
import serifa.store.JdbcProjectRepository;
import serifa.store.ProjectRepository;
import serifa.text.TextStats;

/** Linha de comando: {@code serve}, {@code check}, {@code count} e {@code export}. */
public final class Main {

    private static final String AJUDA = """
            Serifa — servidor e ferramentas de linha de comando

            Uso:
              java -jar server/target/serifa.jar serve [--porta 8080] [--host 127.0.0.1]
              java -jar server/target/serifa.jar count ARQUIVO.txt|-
              java -jar server/target/serifa.jar check ARQUIVO.txt|- [--sem-sugestoes] [--json]
              java -jar server/target/serifa.jar export PROJETO.serifa FORMATO [--capitulo ID] [--saida ARQUIVO]

            Formatos de exportação: wattpad, ao3, txt, md, html, docx, epub.
            Use "-" para ler o texto da entrada padrão.

            Variáveis de ambiente:
              SERIFA_PORT     porta do servidor (padrão 8080)
              SERIFA_HOST     endereço de escuta (padrão 127.0.0.1)
              SERIFA_WEB      pasta web/ com dicionário e dados (padrão ../web ou ./web)
              SERIFA_DATA     pasta dos projetos salvos (padrão ./dados-servidor)
              SERIFA_DB_URL   URL JDBC do PostgreSQL (opcional; o driver precisa estar no classpath)
            """;

    private Main() {
    }

    public static void main(String[] args) throws Exception {
        int codigo = run(args, System.out, System.err);
        if (codigo >= 0) {
            System.exit(codigo);
        }
        // Código negativo: o servidor continua rodando nas threads do HttpServer.
    }

    /** Executa um comando e devolve o código de saída. */
    public static int run(String[] args, PrintStream out, PrintStream err) throws Exception {
        if (args.length == 0 || args[0].equals("--help") || args[0].equals("-h") || args[0].equals("ajuda")) {
            out.print(AJUDA);
            return args.length == 0 ? 2 : 0;
        }
        List<String> resto = new ArrayList<>(List.of(args).subList(1, args.length));
        if (resto.contains("--help")) {
            out.print(AJUDA);
            return 0;
        }
        switch (args[0]) {
            case "serve" -> {
                return serve(resto, out);
            }
            case "count" -> {
                if (resto.isEmpty()) {
                    err.println("Informe o arquivo de texto (ou - para a entrada padrão).");
                    return 2;
                }
                out.println(Json.pretty(TextStats.of(ler(resto.get(0))).toJson(), 2));
                return 0;
            }
            case "check" -> {
                return check(resto, out, err);
            }
            case "export" -> {
                return export(resto, out, err);
            }
            default -> {
                err.println("Comando desconhecido: " + args[0] + ". Use --help para ver a ajuda.");
                return 2;
            }
        }
    }

    private static String ler(String arquivo) throws IOException {
        if (arquivo.equals("-")) {
            return new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
        }
        return Files.readString(Path.of(arquivo), StandardCharsets.UTF_8);
    }

    private static String opcao(List<String> a, String nome, String padrao) {
        int i = a.indexOf(nome);
        return i >= 0 && i + 1 < a.size() ? a.get(i + 1) : padrao;
    }

    private static int serve(List<String> a, PrintStream out) throws IOException {
        String porta = opcao(a, "--porta", System.getenv().getOrDefault("SERIFA_PORT", "8080"));
        String host = opcao(a, "--host", System.getenv().getOrDefault("SERIFA_HOST", "127.0.0.1"));
        Engine engine = Engine.fromEnvironment();
        ProjectRepository repo = JdbcProjectRepository.fromEnvironment().orElseGet(() ->
                new FileProjectRepository(Path.of(System.getenv().getOrDefault("SERIFA_DATA", "dados-servidor"))));
        ApiServer s = new ApiServer(engine, repo);
        s.start(host, Integer.parseInt(porta));
        out.println("Serifa rodando em http://" + host + ":" + s.port() + "/ (web: " + engine.web() + ")");
        out.println("Pressione Ctrl+C para encerrar.");
        Runtime.getRuntime().addShutdownHook(new Thread(s::stop));
        return -1;
    }

    private static int check(List<String> a, PrintStream out, PrintStream err) throws IOException {
        if (a.isEmpty()) {
            err.println("Informe o arquivo de texto (ou - para a entrada padrão).");
            return 2;
        }
        String texto = ler(a.get(0));
        Engine e = Engine.fromEnvironment();
        boolean sugestoes = !a.contains("--sem-sugestoes");
        List<SpellChecker.Misspelling> erros = e.speller().review(texto, List.of(), sugestoes);
        List<Idea> ideias = e.ideas().analyze(texto);
        if (a.contains("--json")) {
            List<Object> o = new ArrayList<>();
            erros.forEach(m -> o.add(m.toJson()));
            List<Object> i = new ArrayList<>();
            ideias.forEach(x -> i.add(x.toJson()));
            out.println(Json.pretty(Json.mapOf("spelling", o, "ideas", i), 2));
        } else {
            for (SpellChecker.Misspelling m : erros) {
                out.println("[ortografia] " + m.word() + " (" + m.start() + "–" + m.end() + ")"
                        + (m.suggestions().isEmpty() ? "" : " → " + String.join(", ", m.suggestions())));
            }
            for (Idea i : ideias) {
                out.println("[" + i.category() + "] " + texto.substring(i.start(), i.end()) + ": " + i.message()
                        + (i.suggestion().isEmpty() ? "" : " → " + i.suggestion()));
            }
            out.println(erros.size() + " palavra(s) desconhecida(s), " + ideias.size() + " ideia(s).");
        }
        return erros.isEmpty() && ideias.isEmpty() ? 0 : 1;
    }

    private static int export(List<String> a, PrintStream out, PrintStream err) throws IOException {
        if (a.size() < 2) {
            err.println("Uso: export PROJETO.serifa FORMATO [--capitulo ID] [--saida ARQUIVO]");
            return 2;
        }
        Project p = Project.wrap(Json.parseObject(ler(a.get(0))));
        List<String> erros = p.validate();
        if (!erros.isEmpty()) {
            err.println("Projeto inválido:");
            erros.forEach(x -> err.println("  - " + x));
            return 1;
        }
        BookExporter.Output o = BookExporter.export(p, a.get(1), opcao(a, "--capitulo", null));
        String saida = opcao(a, "--saida", null);
        if (saida == null && (a.get(1).equals("docx") || a.get(1).equals("epub"))) {
            saida = o.fileName();
        }
        if (saida == null) {
            out.print(o.text());
            return 0;
        }
        FileProjectRepository.writeAtomicBytes(Path.of(saida), o.bytes());
        out.println("Arquivo gerado: " + saida);
        return 0;
    }
}
