/*
 * Serifa — editor de textos para escritores.
 * Copyright (©) 2026 Clara Portes
 */
package serifa.export;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipOutputStream;
import serifa.html.Block;
import serifa.html.HtmlNode;
import serifa.html.HtmlReader;
import serifa.model.Project;
import serifa.text.CharClass;

/**
 * Gerador de DOCX (Office Open XML) escrito à mão: parágrafos, negrito, itálico, sublinhado,
 * tachado, alinhamento, títulos, quebra de cena e de página, tamanho de página e margens.
 */
public final class DocxWriter {

    private static final double TWIPS_POR_MM = 1440 / 25.4;

    private DocxWriter() {
    }

    /** Tamanho de página em milímetros (largura, altura) no modo retrato. */
    public static double[] pageSizeMm(String nome) {
        return switch (nome == null ? "a5" : nome) {
            case "a4" -> new double[] {210, 297};
            case "carta" -> new double[] {215.9, 279.4};
            case "oficio" -> new double[] {216, 330};
            case "livro-6x9" -> new double[] {152.4, 228.6};
            case "bolso-5x8" -> new double[] {127, 203.2};
            case "b5" -> new double[] {176, 250};
            default -> new double[] {148, 210};
        };
    }

    /** Margens em milímetros: topo, direita, baixo, esquerda. */
    public static double[] marginsMm(String nome) {
        return switch (nome == null ? "normal" : nome) {
            case "estreita" -> new double[] {12.7, 12.7, 12.7, 12.7};
            case "moderada" -> new double[] {25.4, 19.1, 25.4, 19.1};
            case "larga" -> new double[] {25.4, 50.8, 25.4, 50.8};
            case "espelhada" -> new double[] {25.4, 25.4, 25.4, 31.8};
            default -> new double[] {25, 25, 25, 30};
        };
    }

    static int twips(double mm) {
        return (int) Math.round(mm * TWIPS_POR_MM);
    }

    private static String xml(String s) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); ) {
            int cp = s.codePointAt(i);
            i += Character.charCount(cp);
            if (cp < 0x20 && cp != '\t' && cp != '\n' && cp != '\r') {
                continue;
            }
            switch (cp) {
                case '&' -> sb.append("&amp;");
                case '<' -> sb.append("&lt;");
                case '>' -> sb.append("&gt;");
                case '"' -> sb.append("&quot;");
                default -> sb.appendCodePoint(cp);
            }
        }
        return sb.toString();
    }

    /** Estado de formatação herdado durante a montagem dos runs. */
    private record Fmt(boolean b, boolean i, boolean u, boolean s, String vert) {
        Fmt with(String tag) {
            return switch (tag) {
                case "strong", "b" -> new Fmt(true, i, u, s, vert);
                case "em", "i" -> new Fmt(b, true, u, s, vert);
                case "u" -> new Fmt(b, i, true, s, vert);
                case "s", "strike", "del" -> new Fmt(b, i, u, true, vert);
                case "sub" -> new Fmt(b, i, u, s, "subscript");
                case "sup" -> new Fmt(b, i, u, s, "superscript");
                default -> this;
            };
        }

        String rPr() {
            StringBuilder sb = new StringBuilder();
            if (b) {
                sb.append("<w:b/>");
            }
            if (i) {
                sb.append("<w:i/>");
            }
            if (u) {
                sb.append("<w:u w:val=\"single\"/>");
            }
            if (s) {
                sb.append("<w:strike/>");
            }
            if (vert != null) {
                sb.append("<w:vertAlign w:val=\"").append(vert).append("\"/>");
            }
            return sb.length() == 0 ? "" : "<w:rPr>" + sb + "</w:rPr>";
        }
    }

    private static final class Runs {
        final StringBuilder sb = new StringBuilder();
        boolean espaco;
        boolean temTexto;

        void texto(String t, Fmt f) {
            StringBuilder trecho = new StringBuilder();
            for (int k = 0; k < t.length(); ) {
                int cp = t.codePointAt(k);
                k += Character.charCount(cp);
                if (CharClass.isSpace(cp)) {
                    if (temTexto) {
                        espaco = true;
                    }
                    continue;
                }
                if (espaco) {
                    trecho.append(' ');
                    espaco = false;
                }
                temTexto = true;
                trecho.appendCodePoint(cp);
            }
            if (trecho.length() > 0) {
                sb.append("<w:r>").append(f.rPr()).append("<w:t xml:space=\"preserve\">").append(xml(trecho.toString()))
                        .append("</w:t></w:r>");
            }
        }

        void quebra() {
            espaco = false;
            temTexto = false;
            sb.append("<w:r><w:br/></w:r>");
        }
    }

    private static void runs(HtmlNode n, Fmt f, Runs r) {
        for (HtmlNode c : n.children()) {
            if (c.isText()) {
                r.texto(c.textValue(), f);
            } else if (c.is("br")) {
                r.quebra();
            } else if (!c.is("img")) {
                runs(c, f.with(c.tag()), r);
            }
        }
    }

    private static String paragrafo(String estilo, String alinhamento, boolean recuo, String conteudo) {
        StringBuilder pPr = new StringBuilder();
        if (estilo != null) {
            pPr.append("<w:pStyle w:val=\"").append(estilo).append("\"/>");
        }
        if (alinhamento != null) {
            pPr.append("<w:jc w:val=\"").append(alinhamento).append("\"/>");
        }
        if (recuo) {
            pPr.append("<w:ind w:firstLine=\"709\"/>");
        }
        return "<w:p>" + (pPr.length() > 0 ? "<w:pPr>" + pPr + "</w:pPr>" : "") + conteudo + "</w:p>";
    }

    /** Monta o .docx completo. */
    public static byte[] write(Project p, List<Project.Chapter> caps) {
        boolean recuo = p.settingBool("firstLineIndent", true);
        StringBuilder corpo = new StringBuilder();
        corpo.append(paragrafo("Title", "center", false, "<w:r><w:t xml:space=\"preserve\">" + xml(p.title()) + "</w:t></w:r>"));
        if (!p.author().isBlank()) {
            corpo.append(paragrafo("Subtitle", "center", false, "<w:r><w:t xml:space=\"preserve\">" + xml(p.author()) + "</w:t></w:r>"));
        }
        for (Project.Chapter c : caps) {
            corpo.append("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");
            corpo.append(paragrafo("Heading1", "center", false,
                    "<w:r><w:t xml:space=\"preserve\">" + xml(c.title()) + "</w:t></w:r>"));
            for (Block b : Block.fromHtml(c.html())) {
                switch (b.type()) {
                    case Block.CENA -> corpo.append(paragrafo("Cena", "center", false,
                            "<w:r><w:t xml:space=\"preserve\">" + xml(p.sceneBreak()) + "</w:t></w:r>"));
                    case Block.QUEBRA -> corpo.append("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>");
                    default -> {
                        Runs r = new Runs();
                        Fmt base = new Fmt(false, Block.QUOTE.equals(b.type()), false, false, null);
                        runs(b.content(), base, r);
                        if (r.sb.length() == 0) {
                            continue;
                        }
                        String al = b.align() == null ? (Block.H.equals(b.type()) ? "center" : "both") : b.align();
                        String estilo = switch (b.type()) {
                            case Block.H -> "Heading" + Math.min(3, b.level() + 1);
                            case Block.QUOTE -> "Quote";
                            case Block.LI -> "ListParagraph";
                            default -> null;
                        };
                        String conteudo = Block.LI.equals(b.type()) ? "<w:r><w:t xml:space=\"preserve\">• </w:t></w:r>" + r.sb : r.sb.toString();
                        boolean comRecuo = recuo && b.type().equals(Block.P) && b.align() == null && !b.isDialogue();
                        corpo.append(paragrafo(estilo, al, comRecuo, conteudo));
                    }
                }
            }
        }
        double[] tam = pageSizeMm(p.setting("pageSize", "a5"));
        boolean paisagem = "paisagem".equals(p.setting("orientation", "retrato"));
        double w = paisagem ? tam[1] : tam[0];
        double h = paisagem ? tam[0] : tam[1];
        String margens = p.setting("margins", "normal");
        double[] m = marginsMm(margens);
        corpo.append("<w:sectPr><w:pgSz w:w=\"").append(twips(w)).append("\" w:h=\"").append(twips(h)).append('"')
                .append(paisagem ? " w:orient=\"landscape\"" : "").append("/><w:pgMar w:top=\"").append(twips(m[0]))
                .append("\" w:right=\"").append(twips(m[1])).append("\" w:bottom=\"").append(twips(m[2]))
                .append("\" w:left=\"").append(twips(m[3])).append("\" w:header=\"709\" w:footer=\"709\" w:gutter=\"0\"/>")
                .append("</w:sectPr>");
        String documento = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                + "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" "
                + "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><w:body>"
                + corpo + "</w:body></w:document>";
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes, StandardCharsets.UTF_8)) {
            BookExporter.entrada(zip, "[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                    + "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
                    + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
                    + "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
                    + "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>"
                    + "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>"
                    + "<Override PartName=\"/word/settings.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml\"/>"
                    + "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>"
                    + "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>"
                    + "</Types>");
            BookExporter.entrada(zip, "_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>"
                    + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>"
                    + "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>"
                    + "</Relationships>");
            BookExporter.entrada(zip, "word/_rels/document.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                    + "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
                    + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
                    + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings\" Target=\"settings.xml\"/>"
                    + "</Relationships>");
            BookExporter.entrada(zip, "word/document.xml", documento);
            BookExporter.entrada(zip, "word/styles.xml", estilos(p));
            BookExporter.entrada(zip, "word/settings.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                    + "<w:settings xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
                    + ("espelhada".equals(margens) ? "<w:mirrorMargins/>" : "")
                    + "<w:defaultTabStop w:val=\"709\"/><w:compat/></w:settings>");
            String agora = Project.now().replaceFirst("\\.\\d+Z$", "Z");
            BookExporter.entrada(zip, "docProps/core.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                    + "<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" "
                    + "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" "
                    + "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">"
                    + "<dc:title>" + xml(p.title()) + "</dc:title>"
                    + (p.author().isBlank() ? "" : "<dc:creator>" + xml(p.author()) + "</dc:creator>")
                    + "<dc:language>" + xml(p.language()) + "</dc:language>"
                    + "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">" + agora + "</dcterms:modified>"
                    + "</cp:coreProperties>");
            BookExporter.entrada(zip, "docProps/app.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                    + "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\">"
                    + "<Application>Serifa</Application></Properties>");
        } catch (IOException e) {
            throw new IllegalStateException("Falha ao montar o DOCX: " + e.getMessage(), e);
        }
        return bytes.toByteArray();
    }

    private static String estilos(Project p) {
        String fonte = xml(p.setting("fontFamily", "Georgia"));
        int meiosPontos = (int) Math.round(p.settingNumber("fontSize", 12) * 2);
        int linha = (int) Math.round(p.settingNumber("lineHeight", 1.5) * 240);
        String lang = xml(p.language());
        return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n"
                + "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
                + "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"" + fonte + "\" w:hAnsi=\"" + fonte
                + "\" w:cs=\"" + fonte + "\"/><w:sz w:val=\"" + meiosPontos + "\"/><w:szCs w:val=\"" + meiosPontos
                + "\"/><w:lang w:val=\"" + lang + "\"/></w:rPr></w:rPrDefault>"
                + "<w:pPrDefault><w:pPr><w:spacing w:after=\"0\" w:line=\"" + linha + "\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault>"
                + "</w:docDefaults>"
                + "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style>"
                + estilo("Title", "Title", 2 * meiosPontos, true, 480)
                + estilo("Subtitle", "Subtitle", meiosPontos + 4, false, 240)
                + estilo("Heading1", "heading 1", (int) (meiosPontos * 1.6), true, 360)
                + estilo("Heading2", "heading 2", (int) (meiosPontos * 1.35), true, 240)
                + estilo("Heading3", "heading 3", (int) (meiosPontos * 1.15), true, 200)
                + "<w:style w:type=\"paragraph\" w:styleId=\"Quote\"><w:name w:val=\"Quote\"/><w:basedOn w:val=\"Normal\"/>"
                + "<w:pPr><w:ind w:left=\"709\" w:right=\"709\"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>"
                + "<w:style w:type=\"paragraph\" w:styleId=\"ListParagraph\"><w:name w:val=\"List Paragraph\"/><w:basedOn w:val=\"Normal\"/>"
                + "<w:pPr><w:ind w:left=\"720\" w:hanging=\"360\"/></w:pPr></w:style>"
                + "<w:style w:type=\"paragraph\" w:styleId=\"Cena\"><w:name w:val=\"Quebra de cena\"/><w:basedOn w:val=\"Normal\"/>"
                + "<w:pPr><w:spacing w:before=\"240\" w:after=\"240\"/><w:jc w:val=\"center\"/></w:pPr></w:style>"
                + "</w:styles>";
    }

    private static String estilo(String id, String nome, int tamanho, boolean negrito, int depois) {
        return "<w:style w:type=\"paragraph\" w:styleId=\"" + id + "\"><w:name w:val=\"" + nome + "\"/>"
                + "<w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:pPr><w:keepNext/><w:spacing w:before=\"240\" w:after=\""
                + depois + "\"/><w:jc w:val=\"center\"/>" + (id.startsWith("Heading") ? "<w:outlineLvl w:val=\"" + (id.charAt(7) - '1') + "\"/>" : "")
                + "</w:pPr><w:rPr>" + (negrito ? "<w:b/>" : "") + "<w:sz w:val=\"" + tamanho + "\"/></w:rPr></w:style>";
    }

    /** Usado nos testes para conferir o XML gerado. */
    static String lower(String s) {
        return s.toLowerCase(Locale.ROOT);
    }

    /** Evita aviso de import não usado quando HtmlReader não é chamado diretamente. */
    static String escapeForTests(String s) {
        return HtmlReader.escape(s);
    }
}
