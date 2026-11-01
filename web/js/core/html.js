// Leitor do subconjunto de HTML dos capítulos, sem DOM (funciona no Node e no worker).
// Transforma o HTML numa árvore simples e depois numa lista de blocos para exportar.

import { isDialogue } from './texto.js';

const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col', 'wbr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', copy: '©', deg: '°', middot: '·' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

export function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(s) {
  return escapeText(s).replace(/"/g, '&quot;');
}

function parseAttrs(src) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Árvore: {tag, attrs, children} ou {text}. */
export function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9:_.-]*)([^>]*)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[3] !== undefined || m[0] === '<') {
      top.children.push({ text: decodeEntities(m[3] ?? '<') });
      continue;
    }
    const tag = m[1].toLowerCase();
    if (m[0][1] === '/') {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (tag === 'script' || tag === 'style') {
      const close = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      re.lastIndex = close < 0 ? html.length : close;
      continue;
    }
    const node = { tag, attrs: parseAttrs(m[2] || ''), children: [] };
    if (tag === 'p' && top.tag === 'p') stack.pop();
    stack[stack.length - 1].children.push(node);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[2] || '')) stack.push(node);
  }
  return root;
}

export function textOf(node) {
  if (node.text !== undefined) return node.text;
  if (node.tag === 'br') return '\n';
  if (node.tag === 'img') return '';
  return node.children.map(textOf).join('');
}

function styleProp(node, prop) {
  const style = node.attrs?.style || '';
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(style);
  return m ? m[1].trim().toLowerCase() : null;
}

function alignOf(node) {
  const a = styleProp(node, 'text-align') || (node.attrs?.align || '').toLowerCase();
  return a === 'center' || a === 'right' ? a : null;
}

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'hr', 'div',
  'table', 'tr', 'figure', 'section', 'article', 'header', 'footer', 'pre']);

function hasBlockChild(node) {
  return node.children?.some((c) => c.tag && BLOCK_TAGS.has(c.tag));
}

function hasImage(node) {
  if (node.tag === 'img') return true;
  return Boolean(node.children?.some(hasImage));
}

/**
 * Lista de blocos: {type: p|h|quote|li|cena|quebra, align, nodes, text, dialogue}.
 * Blocos p sem texto e sem imagem são descartados.
 */
export function blocksFromHtml(html) {
  const root = typeof html === 'string' ? parseHtml(html) : html;
  const blocks = [];
  let loose = [];
  const flush = () => {
    if (loose.length) {
      pushBlock('p', null, loose);
      loose = [];
    }
  };
  const pushBlock = (type, align, nodes) => {
    const text = nodes.map(textOf).join('').replace(/[\s ]+/g, ' ').trim();
    if ((type === 'p' || type === 'li' || type === 'quote' || type === 'h') && !text &&
      !nodes.some(hasImage)) return;
    blocks.push({ type, align, nodes, text, dialogue: type !== 'cena' && type !== 'h' && isDialogue(text) });
  };
  const walk = (node, ctx) => {
    for (const child of node.children) {
      if (child.text !== undefined || !BLOCK_TAGS.has(child.tag)) {
        if (child.text !== undefined && !child.text.trim() && !loose.length) continue;
        loose.push(child);
        continue;
      }
      flush();
      const tag = child.tag;
      const cls = ` ${(child.attrs.class || '').toLowerCase()} `;
      if (tag === 'hr') {
        blocks.push({ type: cls.includes(' quebra-pagina ') ? 'quebra' : 'cena', align: 'center', nodes: [], text: '', dialogue: false });
      } else if (tag === 'div' && (cls.includes(' quebra-pagina ') || styleProp(child, 'page-break-after') === 'always' ||
        styleProp(child, 'break-after') === 'page')) {
        blocks.push({ type: 'quebra', align: null, nodes: [], text: '', dialogue: false });
      } else if (tag === 'p' && cls.includes(' cena ')) {
        blocks.push({ type: 'cena', align: 'center', nodes: [], text: '', dialogue: false });
      } else if (/^h[1-6]$/.test(tag)) {
        pushBlock('h', alignOf(child), child.children);
      } else if (tag === 'blockquote') {
        if (hasBlockChild(child)) {
          const inner = [];
          for (const c of child.children) {
            if (c.tag && BLOCK_TAGS.has(c.tag)) inner.push(c);
          }
          for (const c of inner) pushBlock('quote', alignOf(c), c.children);
        } else {
          pushBlock('quote', alignOf(child), child.children);
        }
      } else if (tag === 'ul' || tag === 'ol') {
        for (const li of child.children) {
          if (li.tag === 'li') pushBlock('li', alignOf(li), li.children);
        }
      } else if (tag === 'li') {
        pushBlock('li', alignOf(child), child.children);
      } else if (tag === 'table') {
        const rows = [];
        const collect = (n) => {
          for (const c of n.children || []) {
            if (c.tag === 'tr') rows.push(c);
            else if (c.tag) collect(c);
          }
        };
        collect(child);
        for (const tr of rows) {
          const cells = tr.children.filter((c) => c.tag === 'td' || c.tag === 'th');
          const nodes = [];
          cells.forEach((c, i) => {
            if (i) nodes.push({ text: ' | ' });
            nodes.push(...c.children);
          });
          pushBlock('p', null, nodes);
        }
      } else if (hasBlockChild(child)) {
        walk(child, ctx);
      } else {
        pushBlock('p', alignOf(child), child.children);
      }
    }
    flush();
  };
  walk(root, {});
  return blocks;
}

/**
 * Renderiza nós inline com um mapa de tags. map: {b: 'b', strong: 'b', ...}; tags fora do mapa somem (fica o texto).
 * opts.br: texto do <br>; opts.links: mantém <a href> http(s); opts.images: mantém <img src>.
 */
export function renderInline(nodes, map, opts = {}) {
  const out = [];
  const render = (node) => {
    if (node.text !== undefined) {
      out.push(escapeText(node.text.replace(/[\s ]+/g, ' ')));
      return;
    }
    const tag = node.tag;
    if (tag === 'br') {
      out.push(opts.br ?? '<br>');
      return;
    }
    if (tag === 'img') {
      if (opts.images && /^(https?:|data:image\/)/i.test(node.attrs.src || '')) {
        out.push(`<img src="${escapeAttr(node.attrs.src)}" alt="${escapeAttr(node.attrs.alt || '')}"${opts.voidSlash ? ' /' : ''}>`);
      }
      return;
    }
    let open = '';
    let close = '';
    if (tag === 'a' && opts.links && /^https?:\/\//i.test(node.attrs.href || '')) {
      open = `<a href="${escapeAttr(node.attrs.href)}">`;
      close = '</a>';
    } else if (map[tag]) {
      open = `<${map[tag]}>`;
      close = `</${map[tag]}>`;
    } else if (tag === 'span') {
      const deco = styleProp(node, 'text-decoration') || styleProp(node, 'text-decoration-line') || '';
      const weight = styleProp(node, 'font-weight') || '';
      const fstyle = styleProp(node, 'font-style') || '';
      const wraps = [];
      if ((weight === 'bold' || Number(weight) >= 600) && map.b) wraps.push(map.b);
      if (fstyle === 'italic' && map.i) wraps.push(map.i);
      if (deco.includes('underline') && map.u) wraps.push(map.u);
      if (deco.includes('line-through') && map.s) wraps.push(map.s);
      open = wraps.map((t) => `<${t}>`).join('');
      close = wraps.reverse().map((t) => `</${t}>`).join('');
    }
    out.push(open);
    for (const c of node.children) render(c);
    out.push(close);
  };
  for (const n of nodes) render(n);
  let html = out.join('');
  // nunca dois espaços seguidos, mesmo atravessando tags
  html = html.replace(/ ((?:<[^>]+>)*) /g, ' $1');
  html = html.replace(/^((?:<[^>]+>)*) +/, '$1').replace(/ +((?:<\/[^>]+>)*)$/, '$1');
  // tags vazias que sobraram
  let prev;
  do {
    prev = html;
    html = html.replace(/<(b|i|u|s|em|strong|sub|sup)><\/\1>/g, '');
  } while (html !== prev);
  return html;
}

/** Texto puro do HTML do capítulo, um parágrafo por linha (o mesmo texto que a revisão usa). */
export function plainTextFromHtml(html) {
  return blocksFromHtml(html).filter((b) => b.type !== 'quebra').map((b) => (b.type === 'cena' ? '' : b.text)).join('\n');
}

export const TEXT_STYLES = ['pensamento', 'flashback', 'mensagem', 'carta', 'nota'];

const STYLE_EXPORT = {
  pensamento: (inner, st) => `<p${st}><em>${inner}</em></p>`,
  flashback: (inner, st) => `<p${st}><em>${inner}</em></p>`,
  mensagem: (inner) => `<p style="text-align: center"><b>${inner}</b></p>`,
  carta: (inner, st) => `<blockquote><p${st}>${inner}</p></blockquote>`,
  nota: (inner) => `<p style="text-align: center"><em>${inner}</em></p>`,
};

export function applyTextStyles(html) {
  return String(html || '').replace(/<p( style="[^"]*")? class="estilo-([a-z]+)">([\s\S]*?)<\/p>/g, (m, st, name, inner) => {
    const fn = STYLE_EXPORT[name];
    return fn ? fn(inner, st || '') : `<p${st || ''}>${inner}</p>`;
  });
}

const SAFE_BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'table', 'tbody', 'thead', 'tr', 'td', 'th', 'figure', 'figcaption']);
const SAFE_INLINE = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'a', 'span', 'font', 'mark']);
const SAFE_STYLE = new Set(['text-align', 'color', 'background-color', 'font-family', 'font-size', 'font-weight',
  'font-style', 'text-decoration', 'text-decoration-line', 'margin-left', 'line-height', 'text-indent']);

function cleanStyle(style) {
  const keep = [];
  for (const part of (style || '').split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 1).trim();
    if (!SAFE_STYLE.has(prop)) continue;
    if (/url\(|expression|javascript:|[<>"]/i.test(val)) continue;
    if (val.length > 80) continue;
    keep.push(`${prop}: ${val}`);
  }
  return keep.join('; ');
}

/** Sanitiza HTML colado ou importado para o subconjunto do editor (lista do que é permitido). */
export function sanitizeHtml(html) {
  const root = parseHtml(html);
  const out = [];
  const render = (node, depth) => {
    if (depth > 60) return;
    if (node.text !== undefined) {
      out.push(escapeText(node.text));
      return;
    }
    let tag = node.tag;
    const cls = ` ${(node.attrs.class || '').toLowerCase()} `;
    if (tag === 'br') return out.push('<br>');
    if (tag === 'hr') return out.push(cls.includes(' quebra-pagina ') ? '<div class="quebra-pagina" contenteditable="false"></div>' : '<hr class="cena">');
    if (tag === 'div' && cls.includes(' quebra-pagina ')) return out.push('<div class="quebra-pagina" contenteditable="false"></div>');
    if (tag === 'img') {
      const src = node.attrs.src || '';
      if (/^(https:|data:image\/(png|jpeg|gif|webp);base64,)/i.test(src)) {
        out.push(`<img src="${escapeAttr(src)}" alt="${escapeAttr(node.attrs.alt || '')}">`);
      }
      return;
    }
    if (/^h[4-6]$/.test(tag)) tag = 'h3';
    if (tag === 'div' || tag === 'section' || tag === 'article' || tag === 'header' || tag === 'footer' || tag === 'pre') {
      tag = hasBlockChild(node) ? null : 'p';
    }
    if (tag === 'strike') tag = 's';
    if (tag === 'font' || tag === 'mark') tag = 'span';
    if (tag && !SAFE_BLOCK.has(tag) && !SAFE_INLINE.has(tag)) tag = null;
    if (!tag) {
      for (const c of node.children) render(c, depth + 1);
      return;
    }
    let attrs = '';
    const style = cleanStyle(node.attrs.style);
    const align = (node.attrs.align || '').toLowerCase();
    let st = style;
    if (!/text-align/.test(st) && (align === 'center' || align === 'right' || align === 'justify')) {
      st = st ? `${st}; text-align: ${align}` : `text-align: ${align}`;
    }
    if (st) attrs += ` style="${escapeAttr(st)}"`;
    if (tag === 'a') {
      const href = node.attrs.href || '';
      if (/^(https?:|mailto:)/i.test(href)) attrs += ` href="${escapeAttr(href)}" rel="noopener noreferrer"`;
    }
    if (tag === 'p' && cls.includes(' cena ')) return out.push('<hr class="cena">');
    if (tag === 'p') {
      const estilo = TEXT_STYLES.find((e) => cls.includes(` estilo-${e} `));
      if (estilo) attrs += ` class="estilo-${estilo}"`;
    }
    out.push(`<${tag}${attrs}>`);
    for (const c of node.children) render(c, depth + 1);
    out.push(`</${tag}>`);
  };
  for (const c of root.children) render(c, 0);
  return out.join('');
}

/** Converte texto puro em parágrafos HTML. */
export function textToHtml(text) {
  const parts = text.replace(/\r\n?/g, '\n').split(/\n/);
  return parts.map((line) => {
    const t = line.trim();
    if (!t) return '';
    if (/^(\*\s*){3,}$|^#$|^~{3,}$|^-{3,}$/.test(t)) return '<hr class="cena">';
    return `<p>${escapeText(t)}</p>`;
  }).join('');
}
