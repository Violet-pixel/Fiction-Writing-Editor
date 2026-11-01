/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.export;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import serifa.html.Block;
import serifa.html.HtmlReader;
import serifa.html.Inline;
import serifa.model.Project;

/**
 * Exportação do projeto inteiro (ou de um capítulo) para Markdown, HTML completo, DOCX e EPUB 3.
 * DOCX e EPUB são montados à mão com {@link ZipOutputStream}.
 */
public final class BookExporter {

    /** Resultado de uma exportação: bytes, tipo MIME e nome de arquivo sugerido. */
    public record Output(byte[] bytes, String contentType, String fileName) {
        public String text() {
            return new String(bytes, StandardCharsets.UTF_8);
        }
    }

    private BookExporter() {
    }

    /** Exporta no formato pedido: wattpad, ao3, txt, md, html, docx ou epub. */
    public static Output export(Project p, String formato, String capituloId) {
        List<Project.Chapter> caps = capitulos(p, capituloId);
        String base = slug(capituloId != null && caps.size() == 1 ? caps.get(0).title() : p.title());
        String f = formato == null ? "" : formato.toLowerCase(Locale.ROOT);
        switch (f) {
            case "wattpad", "ao3", "txt" -> {
                PlatformExporter.Format pf = PlatformExporter.Format.parse(f);
                PlatformExporter.Options o = PlatformExporter.Options.defaults(pf).withSceneBreak(p.sceneBreak());
                List<String> partes = new ArrayList<>();
                for (Project.Chapter c : caps) {
                    String corpo = PlatformExporter.export(c.html(), pf, o);
                    if (pf == PlatformExporter.Format.TXT && caps.size() > 1) {
                        corpo = c.title() + "\n\n" + corpo;
                    }
                    partes.add(corpo);
                }
                String sep = pf == PlatformExporter.Format.TXT ? "\n\n\n" : "\n";
                String tipo = pf == PlatformExporter.Format.TXT ? "text/plain; charset=utf-8" : "text/html; charset=utf-8";
                String ext = pf == PlatformExporter.Format.TXT ? ".txt" : "-" + f + ".html";
                return new Output(String.join(sep, partes).getBytes(StandardCharsets.UTF_8), tipo, base + ext);
            }
            case "md" -> {
                return new Output(markdown(p, caps).getBytes(StandardCharsets.UTF_8), "text/markdown; charset=utf-8",
                        base + ".md");
            }
            case "html" -> {
                return new Output(html(p, caps).getBytes(StandardCharsets.UTF_8), "text/html; charset=utf-8",
                        base + ".html");
            }
            case "docx" -> {
                return new Output(DocxWriter.write(p, caps),
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document", base + ".docx");
            }
            case "epub" -> {
                return new Output(epub(p, caps), "application/epub+zip", base + ".epub");
            }
            default -> throw new IllegalArgumentException("Formato de exportação desconhecido: " + formato
                    + ". Use wattpad, ao3, txt, md, html, docx ou epub.");
        }
    }

    static List<Project.Chapter> capitulos(Project p, String id) {
        if (id == null || id.isBlank()) {
            return p.chapters();
        }
        Project.Chapter c = p.chapter(id);
        if (c == null) {
            throw new IllegalArgumentException("Capítulo não encontrado: " + id);
        }
        return List.of(c);
    }

    /** Nome de arquivo seguro a partir de um título. */
    public static String slug(String titulo) {
        String s = java.text.Normalizer.normalize(titulo == null ? "" : titulo, java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-")
                .replaceAll("(^-+|-+$)", "");
        if (s.length() > 60) {
            s = s.substring(0, 60).replaceAll("-+$", "");
        }
        return s.isEmpty() ? "serifa" : s;
    }

    // ------------------------------------------------------------------ Markdown

    /** Markdown: título do projeto, títulos de capítulo e blocos. */
    public static String markdown(Project p, List<Project.Chapter> caps) {
        StringBuilder sb = new StringBuilder();
        sb.append("# ").append(p.title()).append("\n\n");
        if (!p.author().isBlank()) {
            sb.append("*").append(p.author()).append("*\n\n");
        }
        for (Project.Chapter c : caps) {
            sb.append("## ").append(c.title()).append("\n\n");
            int numero = 0;
            for (Block b : Block.fromHtml(c.html())) {
                String linha = switch (b.type()) {
                    case Block.H -> "#".repeat(Math.min(6, b.level() + 2)) + " " + b.text();
                    case Block.QUOTE -> "> " + Inline.render(b.content(), Inline.Mode.MARKDOWN).replace("\n", "\n> ");
                    case Block.LI -> (b.ordered() ? (++numero) + ". " : "- ") + Inline.render(b.content(), Inline.Mode.MARKDOWN);
                    case Block.CENA -> "<p align=\"center\">" + HtmlReader.escape(p.sceneBreak()) + "</p>";
                    case Block.QUEBRA -> "";
                    default -> Inline.render(b.content(), Inline.Mode.MARKDOWN);
                };
                if (!Block.LI.equals(b.type())) {
                    numero = 0;
                }
                if (!linha.isEmpty()) {
                    sb.append(linha).append("\n\n");
                }
            }
        }
        return sb.toString().stripTrailing() + "\n";
    }

    // ------------------------------------------------------------------ HTML

    /** Corpo XHTML de um capítulo (usado no HTML completo e no EPUB). */
    static String corpoXhtml(Project p, Project.Chapter c) {
        StringBuilder sb = new StringBuilder();
        List<Block> blocos = Block.fromHtml(c.html());
        boolean emLista = false;
        boolean listaOrdenada = false;
        for (Block b : blocos) {
            boolean li = Block.LI.equals(b.type());
            if (emLista && (!li || b.ordered() != listaOrdenada)) {
                sb.append(listaOrdenada ? "</ol>\n" : "</ul>\n");
                emLista = false;
            }
            if (li && !emLista) {
                listaOrdenada = b.ordered();
                sb.append(listaOrdenada ? "<ol>\n" : "<ul>\n");
                emLista = true;
            }
            String classe = b.align() == null ? "" : " class=\"" + b.align() + "\"";
            String inline = Inline.render(b.content(), Inline.Mode.XHTML);
            switch (b.type()) {
                case Block.H -> sb.append("<h").append(b.level() + 1).append(classe).append('>').append(inline)
                        .append("</h").append(b.level() + 1).append(">\n");
                case Block.QUOTE -> sb.append("<blockquote><p>").append(inline).append("</p></blockquote>\n");
                case Block.LI -> sb.append("<li>").append(inline).append("</li>\n");
                case Block.CENA -> sb.append("<p class=\"cena\">").append(HtmlReader.escape(p.sceneBreak())).append("</p>\n");
                case Block.QUEBRA -> sb.append("<div class=\"quebra-pagina\"></div>\n");
                default -> sb.append("<p").append(b.isDialogue() ? " class=\"fala" + (b.align() == null ? "" : " " + b.align()) + "\"" : classe)
                        .append('>').append(inline).append("</p>\n");
            }
        }
        if (emLista) {
            sb.append(listaOrdenada ? "</ol>\n" : "</ul>\n");
        }
        return sb.toString();
    }

    static String css(Project p) {
        String fonte = p.setting("fontFamily", "Georgia").replaceAll("[^A-Za-z0-9 \\-]", "");
        double tamanho = p.settingNumber("fontSize", 12);
        double linha = p.settingNumber("lineHeight", 1.5);
        boolean recuo = p.settingBool("firstLineIndent", true);
        return "body{font-family:\"" + fonte + "\",Georgia,serif;font-size:" + fmt(tamanho) + "pt;line-height:" + fmt(linha)
                + ";margin:0 auto;max-width:42em;padding:1em;color:#2b1d17;background:#faf6ef}\n"
                + "p{margin:0 0 .4em;text-align:justify" + (recuo ? ";text-indent:1.5em" : "") + "}\n"
                + "p.fala{text-indent:0}\n.center{text-align:center;text-indent:0}\n.right{text-align:right}\n"
                + "p.cena{text-align:center;text-indent:0;margin:1.2em 0}\nh1,h2,h3,h4{text-align:center;color:#5d1c16}\n"
                + "blockquote{margin:1em 2em;font-style:italic}\n.quebra-pagina{page-break-after:always;break-after:page}\n"
                + "section.capitulo{page-break-before:always;break-before:page}\nimg{max-width:100%}\n";
    }

    private static String fmt(double d) {
        return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
    }

    /** Documento HTML completo e autocontido. */
    public static String html(Project p, List<Project.Chapter> caps) {
        StringBuilder sb = new StringBuilder();
        sb.append("<!DOCTYPE html>\n<html lang=\"").append(HtmlReader.escapeAttr(p.language())).append("\">\n<head>\n")
                .append("<meta charset=\"utf-8\" />\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n")
                .append("<meta name=\"generator\" content=\"Serifa\" />\n")
                .append("<title>").append(HtmlReader.escape(p.title())).append("</title>\n<style>\n").append(css(p))
                .append("</style>\n</head>\n<body>\n<header>\n<h1>").append(HtmlReader.escape(p.title())).append("</h1>\n");
        if (!p.author().isBlank()) {
            sb.append("<p class=\"center\">").append(HtmlReader.escape(p.author())).append("</p>\n");
        }
        sb.append("</header>\n");
        for (Project.Chapter c : caps) {
            sb.append("<section class=\"capitulo\" id=\"cap-").append(HtmlReader.escapeAttr(c.id())).append("\">\n<h2>")
                    .append(HtmlReader.escape(c.title())).append("</h2>\n").append(corpoXhtml(p, c)).append("</section>\n");
        }
        sb.append("</body>\n</html>\n");
        return sb.toString();
    }

    // ------------------------------------------------------------------ EPUB 3

    /** Grava uma entrada de texto no ZIP. */
    static void entrada(ZipOutputStream zip, String nome, String conteudo) throws IOException {
        zip.putNextEntry(new ZipEntry(nome));
        zip.write(conteudo.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    /** EPUB 3 com um XHTML por capítulo, nav.xhtml, content.opf e mimetype sem compressão. */
    public static byte[] epub(Project p, List<Project.Chapter> caps) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes, StandardCharsets.UTF_8)) {
            byte[] mime = "application/epub+zip".getBytes(StandardCharsets.US_ASCII);
            ZipEntry m = new ZipEntry("mimetype");
            m.setMethod(ZipEntry.STORED);
            m.setSize(mime.length);
            m.setCompressedSize(mime.length);
            CRC32 crc = new CRC32();
            crc.update(mime);
            m.setCrc(crc.getValue());
            zip.putNextEntry(m);
            zip.write(mime);
            zip.closeEntry();
            zip.setMethod(ZipOutputStream.DEFLATED);
            entrada(zip, "META-INF/container.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                    + "<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n"
                    + "  <rootfiles>\n    <rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>\n"
                    + "  </rootfiles>\n</container>\n");
            entrada(zip, "OEBPS/estilo.css", css(p));
            String lang = HtmlReader.escapeAttr(p.language());
            StringBuilder manifesto = new StringBuilder();
            StringBuilder espinha = new StringBuilder();
            StringBuilder nav = new StringBuilder();
            int i = 0;
            for (Project.Chapter c : caps) {
                i++;
                String arquivo = String.format("capitulo-%03d.xhtml", i);
                String titulo = HtmlReader.escape(c.title());
                entrada(zip, "OEBPS/" + arquivo, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n"
                        + "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\""
                        + lang + "\" lang=\"" + lang + "\">\n<head>\n<meta charset=\"utf-8\" />\n<title>" + titulo
                        + "</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"estilo.css\" />\n</head>\n<body>\n"
                        + "<section epub:type=\"chapter\">\n<h2>" + titulo + "</h2>\n" + corpoXhtml(p, c)
                        + "</section>\n</body>\n</html>\n");
                manifesto.append("    <item id=\"cap").append(i).append("\" href=\"").append(arquivo)
                        .append("\" media-type=\"application/xhtml+xml\"/>\n");
                espinha.append("    <itemref idref=\"cap").append(i).append("\"/>\n");
                nav.append("      <li><a href=\"").append(arquivo).append("\">").append(titulo).append("</a></li>\n");
            }
            entrada(zip, "OEBPS/nav.xhtml", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n"
                    + "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\""
                    + lang + "\" lang=\"" + lang + "\">\n<head>\n<meta charset=\"utf-8\" />\n<title>Sumário</title>\n</head>\n"
                    + "<body>\n  <nav epub:type=\"toc\" id=\"toc\">\n    <h1>Sumário</h1>\n    <ol>\n" + nav
                    + "    </ol>\n  </nav>\n</body>\n</html>\n");
            String ident = Project.isValidId(p.id()) && p.id().length() == 36 ? p.id() : UUID.nameUUIDFromBytes(
                    (p.id() + p.title()).getBytes(StandardCharsets.UTF_8)).toString();
            String modificado = p.updatedAt().isBlank() ? Project.now() : p.updatedAt();
            modificado = modificado.replaceFirst("\\.\\d+Z$", "Z");
            String autor = p.author().isBlank() ? "" : "    <dc:creator>" + HtmlReader.escape(p.author()) + "</dc:creator>\n";
            entrada(zip, "OEBPS/content.opf", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
                    + "<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"bookid\" xml:lang=\"" + lang + "\">\n"
                    + "  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n"
                    + "    <dc:identifier id=\"bookid\">urn:uuid:" + ident + "</dc:identifier>\n"
                    + "    <dc:title>" + HtmlReader.escape(p.title()) + "</dc:title>\n"
                    + "    <dc:language>" + HtmlReader.escape(p.language()) + "</dc:language>\n" + autor
                    + "    <meta property=\"dcterms:modified\">" + HtmlReader.escape(modificado) + "</meta>\n"
                    + "  </metadata>\n  <manifest>\n"
                    + "    <item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n"
                    + "    <item id=\"css\" href=\"estilo.css\" media-type=\"text/css\"/>\n" + manifesto
                    + "  </manifest>\n  <spine>\n" + espinha + "  </spine>\n</package>\n");
        } catch (IOException e) {
            throw new IllegalStateException("Falha ao montar o EPUB: " + e.getMessage(), e);
        }
        return bytes.toByteArray();
    }
}
