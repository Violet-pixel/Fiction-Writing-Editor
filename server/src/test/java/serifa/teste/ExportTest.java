/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.teste;

import static serifa.teste.TestRunner.contem;
import static serifa.teste.TestRunner.falso;
import static serifa.teste.TestRunner.igual;
import static serifa.teste.TestRunner.verdade;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import serifa.export.BookExporter;
import serifa.export.PlatformExporter;
import serifa.html.Block;
import serifa.html.HtmlReader;
import serifa.json.Json;
import serifa.model.Project;
import serifa.teste.TestRunner.Teste;

/** Testes do leitor de HTML e dos exportadores. */
public class ExportTest {

    static Project projeto() {
        Project p = Project.create("Meu Livro");
        Map<String, Object> cap = Json.mapOf("id", "cap-2", "title", "Segundo & último", "position", 1,
                "html", "<h2>Parte</h2><p>Texto <strong>forte</strong> <em>leve</em> <u>sub</u> <s>x</s>.</p>"
                        + "<hr class=\"cena\"><div class=\"quebra-pagina\"></div><p style=\"text-align:center\">— Fala</p>"
                        + "<ol><li>um</li><li>dois</li></ol>",
                "notes", "", "status", "rascunho");
        Json.list(p.json(), "chapters").add(cap);
        p.json().put("author", "Autoria Fictícia");
        return p;
    }

    private static Map<String, String> zip(byte[] bytes) throws IOException {
        Map<String, String> r = new LinkedHashMap<>();
        try (ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry e;
            while ((e = z.getNextEntry()) != null) {
                r.put(e.getName() + (e.getMethod() == ZipEntry.STORED ? "#stored" : ""),
                        new String(z.readAllBytes(), StandardCharsets.UTF_8));
            }
        }
        return r;
    }

    @Teste
    public void leitorHtml() {
        igual("a & b < c", HtmlReader.parse("a &amp; b &lt; c").allText());
        igual(" é—", HtmlReader.decode("&nbsp;&#233;&#x2014;"));
        igual("&xyz;", HtmlReader.decode("&xyz;"));
        verdade(HtmlReader.parse("<p onclick=\"x()\">a</p>").children().get(0).attrs().isEmpty(), "on* removido");
        igual("ab", HtmlReader.parse("<p>a<script>alert(1)</script>b</p>").allText());
        igual(2, HtmlReader.parse("<p>um<p>dois").children().size());
    }

    @Teste
    public void blocos() {
        List<Block> b = Block.fromHtml("<h1>T</h1><p> </p><p style=\"text-align:justify\">J</p><blockquote>Q</blockquote>"
                + "<ul><li>a</li></ul><hr class=\"cena\"><div class=\"quebra-pagina\"></div><p><img src=\"x.png\"></p>solto");
        igual("[h, p, quote, li, cena, quebra, p, p]", b.stream().map(Block::type).toList().toString());
        igual(null, b.get(1).align());
        verdade(b.get(6).hasImage(), "imagem preservada");
    }

    @Teste
    public void wattpadEspacamento() {
        String html = "<p>A</p><p>— B</p><p>— C</p><p>D</p>";
        igual("<p>A</p>\n<p>&nbsp;</p>\n<p>— B</p>\n<p>— C</p>\n<p>&nbsp;</p>\n<p>D</p>",
                PlatformExporter.export(html, PlatformExporter.Format.WATTPAD, null));
        igual("<p>A</p>\n<p>&nbsp;</p>\n<p>— B</p>\n<p>— C</p>\n<p>D</p>",
                PlatformExporter.export(html, PlatformExporter.Format.AO3, null));
        igual("A\n\n— B\n\n— C\n\nD", PlatformExporter.export(html, PlatformExporter.Format.TXT, null));
    }

    @Teste
    public void espacosEntreMarcacoes() {
        igual("<p><b>a</b> b</p>", PlatformExporter.export("<p><b>a </b> b</p>", PlatformExporter.Format.WATTPAD, null));
        igual("<p>a <i>b</i></p>", PlatformExporter.export("<p>a <i> b </i></p>", PlatformExporter.Format.WATTPAD, null));
        igual("<p>a</p>", PlatformExporter.export("<p>a<b> </b></p>", PlatformExporter.Format.WATTPAD, null));
    }

    @Teste
    public void markdownEHtml() {
        Project p = projeto();
        String md = BookExporter.export(p, "md", null).text();
        contem(md, "# Meu Livro");
        contem(md, "**forte** *leve* sub ~~x~~.");
        contem(md, "1. um\n\n2. dois");
        String html = BookExporter.export(p, "html", null).text();
        contem(html, "<!DOCTYPE html>");
        contem(html, "<h2>Segundo &amp; último</h2>");
        contem(html, "<strong>forte</strong>");
        contem(html, "<ol>\n<li>um</li>");
        falso(html.contains("<script"), "sem script");
    }

    @Teste
    public void docx() throws IOException {
        Project p = projeto();
        p.json().put("settings", Json.mapOf("pageSize", "a4", "orientation", "paisagem", "margins", "espelhada",
                "fontFamily", "Garamond", "fontSize", 13, "lineHeight", 2));
        Map<String, String> z = zip(BookExporter.export(p, "docx", null).bytes());
        verdade(z.containsKey("[Content_Types].xml"), "content types");
        String doc = z.get("word/document.xml");
        contem(doc, "<w:b/>");
        contem(doc, "<w:i/>");
        contem(doc, "<w:u w:val=\"single\"/>");
        contem(doc, "<w:strike/>");
        contem(doc, "<w:br w:type=\"page\"/>");
        contem(doc, "<w:jc w:val=\"center\"/>");
        contem(doc, "w:w=\"16838\" w:h=\"11906\" w:orient=\"landscape\"");
        contem(doc, "Segundo &amp; último");
        contem(z.get("word/styles.xml"), "w:ascii=\"Garamond\"");
        contem(z.get("word/styles.xml"), "<w:sz w:val=\"26\"/>");
        contem(z.get("word/settings.xml"), "<w:mirrorMargins/>");
    }

    @Teste
    public void epub() throws IOException {
        byte[] bytes = BookExporter.export(projeto(), "epub", null).bytes();
        igual("mimetype", new String(bytes, 30, 8, StandardCharsets.US_ASCII));
        Map<String, String> z = zip(bytes);
        igual("application/epub+zip", z.get("mimetype#stored"));
        contem(z.get("META-INF/container.xml"), "OEBPS/content.opf");
        String opf = z.get("OEBPS/content.opf");
        contem(opf, "properties=\"nav\"");
        contem(opf, "<dc:creator>Autoria Fictícia</dc:creator>");
        contem(opf, "<itemref idref=\"cap2\"/>");
        contem(z.get("OEBPS/nav.xhtml"), "capitulo-002.xhtml");
        contem(z.get("OEBPS/capitulo-002.xhtml"), "<p class=\"cena\">* * *</p>");
    }

    @Teste
    public void capituloUnicoENomes() {
        Project p = projeto();
        BookExporter.Output o = BookExporter.export(p, "txt", "cap-2");
        igual("segundo-ultimo.txt", o.fileName());
        contem(o.text(), "Texto forte leve sub x.");
        igual("serifa", BookExporter.slug("***"));
        TestRunner.lanca(IllegalArgumentException.class, () -> BookExporter.export(p, "pdf", null));
        TestRunner.lanca(IllegalArgumentException.class, () -> BookExporter.export(p, "md", "nao-existe"));
    }

    @Teste
    public void validacaoDoProjeto() {
        verdade(Project.create("X").validate().isEmpty(), "projeto novo é válido");
        Project ruim = Project.wrap(Json.parseObject("{\"format\":\"outro\",\"version\":2,\"id\":\"../x\",\"title\":\"\","
                + "\"settings\":{\"pageSize\":\"a9\"},\"chapters\":[{\"id\":\"c\",\"status\":\"x\"}]}"));
        List<String> erros = ruim.validate();
        igual(7, erros.size());
        falso(Project.isValidId("a/b"), "barra não é id válido");
    }
}
