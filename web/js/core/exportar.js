// Exportação: Wattpad, AO3, texto, Markdown, HTML, Word (.docx) e EPUB. Sem DOM.
// A saída do Wattpad, do AO3 e do texto é idêntica à do servidor Java (tests/fixtures/exportacao.json).

import { blocksFromHtml, renderInline, escapeText, escapeAttr, parseHtml } from './html.js';
import { makeZip, readZip } from './zip.js';

export const PRESETS = {
  wattpad: { blankBetweenParagraphs: false, blankBeforeDialogue: true, blankAfterDialogue: true },
  ao3: { blankBetweenParagraphs: false, blankBeforeDialogue: true, blankAfterDialogue: false },
  livro: { blankBetweenParagraphs: false, blankBeforeDialogue: false, blankAfterDialogue: false },
};

const WATTPAD_MAP = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u' };
const AO3_MAP = { b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'u', s: 's', strike: 's', del: 's', sub: 'sub', sup: 'sup' };

function withSpacing(blocks, opts, renderBlock, blank) {
  const out = [];
  let prev = null;
  for (const b of blocks) {
    if (b.type === 'quebra') continue;
    if (prev) {
      let gap = false;
      if (opts.blankBetweenParagraphs) gap = true;
      if (opts.blankBeforeDialogue && b.dialogue && !prev.dialogue) gap = true;
      if (opts.blankAfterDialogue && !b.dialogue && prev.dialogue) gap = true;
      if (gap && out[out.length - 1] !== blank) out.push(blank);
    }
    out.push(renderBlock(b));
    prev = b;
  }
  while (out.length && out[out.length - 1] === blank) out.pop();
  return out.join('\n');
}

function options(preset, opts) {
  return { ...PRESETS[preset], sceneBreak: '* * *', ...(opts || {}) };
}

/** HTML para colar no editor do Wattpad. */
export function toWattpad(html, opts) {
  const o = options('wattpad', opts);
  const blocks = blocksFromHtml(html);
  const blank = '<p>&nbsp;</p>';
  return withSpacing(blocks, o, (b) => {
    const style = b.align ? ` style="text-align:${b.align}"` : '';
    if (b.type === 'cena') return `<p style="text-align:center">${escapeText(o.sceneBreak)}</p>`;
    if (b.type === 'h') return `<p style="text-align:center"><b>${escapeText(b.text)}</b></p>`;
    const inner = renderInline(b.nodes, WATTPAD_MAP, { br: '<br>', images: true });
    if (b.type === 'quote') return `<p${style}><i>${inner}</i></p>`;
    return `<p${style}>${inner}</p>`;
  }, blank);
}

/** HTML para o campo "Work Text" do AO3 (modo HTML). */
export function toAO3(html, opts) {
  const o = options('ao3', opts);
  const blocks = blocksFromHtml(html);
  const blank = '<p>&nbsp;</p>';
  return withSpacing(blocks, o, (b) => {
    const align = b.align ? ` align="${b.align}"` : '';
    if (b.type === 'cena') return '<hr />';
    if (b.type === 'h') return `<h3>${escapeText(b.text)}</h3>`;
    const inner = renderInline(b.nodes, AO3_MAP, { br: '<br />', links: true, images: true, voidSlash: true });
    if (b.type === 'quote') return `<blockquote><p${align}>${inner}</p></blockquote>`;
    return `<p${align}>${inner}</p>`;
  }, blank);
}

/** Texto puro: blocos separados por uma linha em branco. */
export function toText(html, opts) {
  const o = { sceneBreak: '* * *', ...(opts || {}) };
  return blocksFromHtml(html).filter((b) => b.type !== 'quebra')
    .map((b) => (b.type === 'cena' ? o.sceneBreak : b.text)).join('\n\n');
}

function mdInline(nodes) {
  const map = { b: '**', strong: '**', i: '*', em: '*', s: '~~', strike: '~~' };
  const out = [];
  const render = (n) => {
    if (n.text !== undefined) {
      out.push(n.text.replace(/[\s\u00a0]+/g, ' ').replace(/([*_`~\\[\]])/g, '\\$1'));
      return;
    }
    if (n.tag === 'br') return out.push('  \n');
    if (n.tag === 'img') return out.push(`![${n.attrs.alt || ''}](${n.attrs.src || ''})`);
    const mark = map[n.tag] || '';
    if (n.tag === 'a' && /^https?:/i.test(n.attrs.href || '')) {
      out.push('[');
      n.children.forEach(render);
      out.push(`](${n.attrs.href})`);
      return;
    }
    out.push(mark);
    n.children.forEach(render);
    out.push(mark);
  };
  nodes.forEach(render);
  return out.join('').replace(/\s+/g, ' ').trim().replace(/\*\*\*\*/g, '').replace(/(?<!\*)\*\*(?!\*)/g, '**');
}

export function toMarkdown(html, opts) {
  const o = { sceneBreak: '* * *', ...(opts || {}) };
  const lines = [];
  for (const b of blocksFromHtml(html)) {
    if (b.type === 'quebra') continue;
    if (b.type === 'cena') lines.push(o.sceneBreak.replace(/\*/g, '\\*'));
    else if (b.type === 'h') lines.push(`### ${b.text}`);
    else if (b.type === 'quote') lines.push(`> ${mdInline(b.nodes)}`);
    else if (b.type === 'li') lines.push(`- ${mdInline(b.nodes)}`);
    else lines.push(mdInline(b.nodes));
  }
  return lines.join('\n\n');
}

const PAGE_MM = {
  a4: [210, 297], a5: [148, 210], carta: [215.9, 279.4], oficio: [215.9, 355.6], 'livro-6x9': [152.4, 228.6],
  'bolso-5x8': [127, 203.2], b5: [176, 250],
};
const MARGINS_MM = {
  normal: [25, 30, 25, 30], estreita: [12.7, 12.7, 12.7, 12.7], moderada: [25.4, 19.1, 25.4, 19.1],
  larga: [25.4, 50.8, 25.4, 50.8], espelhada: [25.4, 25.4, 25.4, 31.8],
};

export function pageGeometry(settings = {}) {
  let [w, h] = PAGE_MM[settings.pageSize] || PAGE_MM.a4;
  if (settings.orientation === 'paisagem') [w, h] = [h, w];
  const [top, right, bottom, left] = MARGINS_MM[settings.margins] || MARGINS_MM.normal;
  return { width: w, height: h, top, right, bottom, left };
}

function chapterList(project, chapterId) {
  const list = [...(project.chapters || [])].sort((a, b) => a.position - b.position);
  return chapterId ? list.filter((c) => c.id === chapterId) : list;
}

export function projectToText(project, chapterId) {
  const s = project.settings || {};
  return chapterList(project, chapterId)
    .map((c) => `${c.title}\n\n${toText(c.html, { sceneBreak: s.sceneBreak || '* * *' })}`).join('\n\n\n');
}

export function projectToMarkdown(project, chapterId) {
  const s = project.settings || {};
  const head = chapterId ? '' : `# ${project.title}\n\n`;
  return head + chapterList(project, chapterId)
    .map((c) => `## ${c.title}\n\n${toMarkdown(c.html, { sceneBreak: s.sceneBreak || '* * *' })}`).join('\n\n');
}

/** Página HTML completa, pronta para abrir ou imprimir. */
export function projectToHtml(project, chapterId) {
  const s = project.settings || {};
  const g = pageGeometry(s);
  const mode = s.formatMode || 'livro';
  const body = chapterList(project, chapterId).map((c) => {
    const inner = mode === 'livro' ? c.html : toAO3(c.html, { ...PRESETS[mode], sceneBreak: s.sceneBreak || '* * *' });
    return `<section class="capitulo"><h2>${escapeText(c.title)}</h2>\n${inner}\n</section>`;
  }).join('\n');
  const indent = mode === 'livro' && s.firstLineIndent !== false ? 'text-indent:1.25cm;margin:0;' : 'margin:0 0 1em;';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${escapeText(project.title)}</title>
<style>@page{size:${g.width}mm ${g.height}mm;margin:${g.top}mm ${g.right}mm ${g.bottom}mm ${g.left}mm}
body{font-family:${escapeText(s.fontFamily || 'Georgia')},serif;font-size:${Number(s.fontSize) || 12}pt;line-height:${Number(s.lineHeight) || 1.5};max-width:${g.width - g.left - g.right}mm;margin:2em auto;color:#111}
p{${indent}}h1,h2{text-align:center;font-weight:normal}section.capitulo{break-before:page}hr.cena,hr{border:0;text-align:center}hr.cena::after,hr::after{content:"${(s.sceneBreak || '* * *').replace(/["\\]/g, '')}"}
.quebra-pagina{break-after:page}</style></head>
<body><h1>${escapeText(project.title)}</h1>
${body}
</body></html>
`;
}

// ---------------- DOCX ----------------
function xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function docxRuns(nodes) {
  const runs = [];
  const walk = (n, fmt) => {
    if (n.text !== undefined) {
      const t = n.text.replace(/[\s\u00a0]+/g, ' ');
      if (t) runs.push({ t, ...fmt });
      return;
    }
    if (n.tag === 'br') return runs.push({ br: true });
    const f = { ...fmt };
    if (n.tag === 'b' || n.tag === 'strong') f.b = true;
    if (n.tag === 'i' || n.tag === 'em') f.i = true;
    if (n.tag === 'u') f.u = true;
    if (n.tag === 's' || n.tag === 'strike' || n.tag === 'del') f.s = true;
    if (n.tag === 'sup') f.sup = true;
    if (n.tag === 'sub') f.sub = true;
    n.children.forEach((c) => walk(c, f));
  };
  nodes.forEach((n) => walk(n, {}));
  if (runs.length && runs[0].t) runs[0].t = runs[0].t.replace(/^ +/, '');
  const last = runs[runs.length - 1];
  if (last && last.t) last.t = last.t.replace(/ +$/, '');
  return runs.map((r) => {
    if (r.br) return '<w:r><w:br/></w:r>';
    const pr = [r.b && '<w:b/>', r.i && '<w:i/>', r.u && '<w:u w:val="single"/>', r.s && '<w:strike/>',
      r.sup && '<w:vertAlign w:val="superscript"/>', r.sub && '<w:vertAlign w:val="subscript"/>'].filter(Boolean).join('');
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(r.t)}</w:t></w:r>`;
  }).join('');
}

/** Documento do Word (.docx) com o tamanho de página, as margens e a fonte do projeto. */
export function projectToDocx(project, chapterId) {
  const s = project.settings || {};
  const g = pageGeometry(s);
  const twip = (mm) => Math.round((mm / 25.4) * 1440);
  const size = Math.round((Number(s.fontSize) || 12) * 2);
  const line = Math.round(240 * (Number(s.lineHeight) || 1.5));
  const mode = s.formatMode || 'livro';
  const indent = mode === 'livro' && s.firstLineIndent !== false ? '<w:ind w:firstLine="709"/>' : '';
  const after = mode === 'livro' ? 0 : 200;
  const paras = [];
  const chapters = chapterList(project, chapterId);
  chapters.forEach((c, ci) => {
    paras.push(`<w:p><w:pPr><w:pStyle w:val="Heading1"/>${ci ? '<w:pageBreakBefore/>' : ''}<w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(c.title)}</w:t></w:r></w:p>`);
    for (const b of blocksFromHtml(c.html)) {
      if (b.type === 'quebra') {
        paras.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
        continue;
      }
      if (b.type === 'cena') {
        paras.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(s.sceneBreak || '* * *')}</w:t></w:r></w:p>`);
        continue;
      }
      const jc = b.align ? `<w:jc w:val="${b.align === 'right' ? 'right' : 'center'}"/>` : (mode === 'livro' ? '<w:jc w:val="both"/>' : '');
      const style = b.type === 'h' ? '<w:pStyle w:val="Heading2"/>' : b.type === 'quote' ? '<w:pStyle w:val="Quote"/>' : '';
      const ind = b.type === 'p' && !b.align && !b.dialogue ? indent : (b.type === 'p' && b.dialogue && mode === 'livro' ? indent : '');
      paras.push(`<w:p><w:pPr>${style}<w:spacing w:after="${after}" w:line="${line}" w:lineRule="auto"/>${ind}${jc}</w:pPr>${docxRuns(b.nodes)}</w:p>`);
    }
  });
  const font = xmlEscape(s.fontFamily || 'Georgia');
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="${twip(g.width)}" w:h="${twip(g.height)}"${s.orientation === 'paisagem' ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${twip(g.top)}" w:right="${twip(g.right)}" w:bottom="${twip(g.bottom)}" w:left="${twip(g.left)}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="${size}"/><w:lang w:val="pt-BR"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="480" w:after="360"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:sz w:val="${size + 16}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size + 4}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:rPr><w:i/></w:rPr></w:style></w:styles>`;
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(project.title || '')}</dc:title><dc:language>pt-BR</dc:language></cp:coreProperties>` },
  ];
  return makeZip(files);
}

// ---------------- EPUB ----------------
function xhtmlFromHtml(html) {
  const parts = [];
  for (const b of blocksFromHtml(html)) {
    if (b.type === 'quebra') continue;
    if (b.type === 'cena') {
      parts.push('<p class="cena">* * *</p>');
      continue;
    }
    const inner = renderInline(b.nodes, AO3_MAP, { br: '<br/>', links: true, images: false });
    const cls = b.align ? ` class="${b.align}"` : (b.dialogue ? ' class="fala"' : '');
    if (b.type === 'h') parts.push(`<h3>${escapeText(b.text)}</h3>`);
    else if (b.type === 'quote') parts.push(`<blockquote><p>${inner}</p></blockquote>`);
    else parts.push(`<p${cls}>${inner}</p>`);
  }
  return parts.join('\n');
}

export function projectToEpub(project) {
  const id = project.id || 'serifa';
  const chapters = chapterList(project);
  const title = xmlEscape(project.title || 'Sem título');
  const css = 'body{font-family:serif;line-height:1.5}p{margin:0;text-indent:1.25em}p.fala{text-indent:1.25em}p.cena,p.center{text-align:center;text-indent:0;margin:1em 0}p.right{text-align:right}h2{text-align:center;font-weight:normal;margin:2em 0 1em}';
  const files = [
    { name: 'mimetype', data: 'application/epub+zip' },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/estilo.css', data: css },
  ];
  const manifest = [];
  const spine = [];
  const nav = [];
  chapters.forEach((c, i) => {
    const name = `cap${String(i + 1).padStart(3, '0')}.xhtml`;
    files.push({ name: `OEBPS/${name}`, data: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="pt-BR"><head><title>${xmlEscape(c.title)}</title><link rel="stylesheet" href="estilo.css"/></head><body><h2>${xmlEscape(c.title)}</h2>\n${xhtmlFromHtml(c.html)}\n</body></html>` });
    manifest.push(`<item id="c${i}" href="${name}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="c${i}"/>`);
    nav.push(`<li><a href="${name}">${xmlEscape(c.title)}</a></li>`);
  });
  files.push({ name: 'OEBPS/nav.xhtml', data: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="pt-BR"><head><title>Sumário</title></head><body><nav epub:type="toc"><h1>Sumário</h1><ol>${nav.join('')}</ol></nav></body></html>` });
  const modified = (project.updatedAt || '2026-01-01T00:00:00Z').replace(/\.\d+Z$/, 'Z');
  files.push({ name: 'OEBPS/content.opf', data: `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="pt-BR"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:${xmlEscape(id)}</dc:identifier><dc:title>${title}</dc:title><dc:language>pt-BR</dc:language>${project.author ? `<dc:creator>${xmlEscape(project.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${xmlEscape(modified)}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="estilo.css" media-type="text/css"/>${manifest.join('')}</manifest><spine>${spine.join('')}</spine></package>` });
  return makeZip(files);
}

// ---------------- Importar .docx ----------------
/** Converte o word/document.xml de um .docx em HTML do editor. */
export async function docxToHtml(buffer) {
  const zip = await readZip(buffer);
  let name = 'word/document.xml';
  if (!zip.has(name)) {
    const rels = zip.get('_rels/.rels');
    const m = rels ? /Target="\/?([^"]+)"[^>]*Type="[^"]*officeDocument"|Type="[^"]*officeDocument"[^>]*Target="\/?([^"]+)"/.exec(new TextDecoder().decode(rels)) : null;
    name = m ? (m[1] || m[2]) : [...zip.keys()].find((k) => /^word\/document\d*\.xml$/.test(k));
  }
  const xml = name ? zip.get(name) : null;
  if (!xml) throw new Error('Não achei o texto dentro do .docx.');
  return docxXmlToHtml(new TextDecoder().decode(xml));
}

export function docxXmlToHtml(xml) {
  const root = parseHtml(xml.replace(/<\?xml[^>]*\?>/, ''));
  const out = [];
  const skip = new Set(['mc:fallback', 'w:del', 'w:moveFrom'.toLowerCase(), 'w:footnotereference']);
  const find = (n, tag, acc = []) => {
    for (const c of n.children || []) {
      if (c.tag === tag) acc.push(c);
      else if (c.tag && !skip.has(c.tag)) find(c, tag, acc);
    }
    return acc;
  };
  for (const p of find(root, 'w:p')) {
    const ppr = (p.children || []).find((c) => c.tag === 'w:ppr');
    const jc = ppr ? find(ppr, 'w:jc')[0] : null;
    const st = ppr ? find(ppr, 'w:pstyle')[0] : null;
    const align = jc ? jc.attrs['w:val'] : '';
    const styleName = st ? (st.attrs['w:val'] || '').toLowerCase() : '';
    let html = '';
    let pageBreak = false;
    for (const r of find(p, 'w:r')) {
      const rpr = (r.children || []).find((c) => c.tag === 'w:rpr');
      const has = (t) => rpr && find(rpr, t).some((x) => (x.attrs['w:val'] || 'true') !== 'false' && x.attrs['w:val'] !== '0' && x.attrs['w:val'] !== 'none');
      for (const c of r.children || []) {
        if (c.tag === 'w:t') {
          let t = escapeText(c.children.map((x) => x.text || '').join(''));
          if (has('w:b')) t = `<strong>${t}</strong>`;
          if (has('w:i')) t = `<em>${t}</em>`;
          if (has('w:u')) t = `<u>${t}</u>`;
          if (has('w:strike')) t = `<s>${t}</s>`;
          html += t;
        } else if (c.tag === 'w:br') {
          if (c.attrs['w:type'] === 'page') pageBreak = true;
          else html += '<br>';
        } else if (c.tag === 'w:tab') html += ' ';
      }
    }
    const text = html.replace(/<[^>]+>/g, '').trim();
    if (pageBreak && !text) {
      out.push('<div class="quebra-pagina" contenteditable="false"></div>');
      continue;
    }
    if (!text) continue;
    if (/^(\*\s*){3,}$|^#$/.test(text)) {
      out.push('<hr class="cena">');
      continue;
    }
    const style = align === 'center' ? ' style="text-align: center"' : align === 'right' ? ' style="text-align: right"' : align === 'both' ? ' style="text-align: justify"' : '';
    if (/heading1|ttulo1|titulo1/.test(styleName)) out.push(`<h1>${html}</h1>`);
    else if (/heading2|ttulo2|titulo2/.test(styleName)) out.push(`<h2>${html}</h2>`);
    else if (/heading3|ttulo3|titulo3/.test(styleName)) out.push(`<h3>${html}</h3>`);
    else out.push(`<p${style}>${html}</p>`);
  }
  return out.join('');
}

export { escapeAttr };
