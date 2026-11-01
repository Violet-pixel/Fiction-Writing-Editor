// Folha de edição: texto puro com offsets, destaques da revisão, autocorreção, colar e comandos de formatação.
import { sanitizeHtml, textToHtml } from '../core/html.js';
import { isDialogue } from '../core/texto.js';

const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI', 'DIV', 'TD', 'TH', 'FIGCAPTION', 'PRE']);

export class Editor {
  constructor(el, hooks = {}) {
    this.el = el;
    this.hooks = hooks;
    this.segments = [];
    this.text = '';
    this.options = { autoDash: true, smartQuotes: true, autoEllipsis: true };
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch { /* navegador antigo */ }
    el.addEventListener('input', (e) => this.onInput(e));
    el.addEventListener('paste', (e) => this.onPaste(e));
    el.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  setHtml(html) {
    this.el.innerHTML = sanitizeHtml(html || '') || '<p><br></p>';
    this.normalize();
    this.refreshText();
  }

  getHtml() {
    const clone = this.el.cloneNode(true);
    clone.querySelectorAll('p.fala').forEach((p) => {
      p.classList.remove('fala');
      if (!p.className) p.removeAttribute('class');
    });
    return sanitizeHtml(clone.innerHTML);
  }

  normalize() {
    // texto solto vira parágrafo; <div> do navegador vira <p>
    for (const node of [...this.el.childNodes]) {
      if (node.nodeType === Node.TEXT_NODE && node.data.trim()) {
        const p = document.createElement('p');
        node.replaceWith(p);
        p.append(node);
      } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'DIV' && !node.classList.contains('quebra-pagina')) {
        const p = document.createElement('p');
        while (node.firstChild) p.append(node.firstChild);
        if (node.getAttribute('style')) p.setAttribute('style', node.getAttribute('style'));
        node.replaceWith(p);
      }
    }
    if (!this.el.firstElementChild) this.el.innerHTML = '<p><br></p>';
    this.el.querySelectorAll('.quebra-pagina').forEach((d) => d.setAttribute('contenteditable', 'false'));
  }

  /** Recalcula o texto puro (um parágrafo por linha) e o mapa de offsets para os nós de texto. */
  refreshText() {
    const segs = [];
    let text = '';
    let lastBlock = null;
    const walker = document.createTreeWalker(this.el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => {
        if (n.nodeType === Node.ELEMENT_NODE) return n.tagName === 'BR' || n.tagName === 'HR' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    const blockOf = (node) => {
      let e = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      while (e && e !== this.el && !BLOCKS.has(e.tagName)) e = e.parentElement;
      return e;
    };
    const dialogueBlocks = new Map();
    while ((n = walker.nextNode())) {
      const block = blockOf(n);
      if (block !== lastBlock) {
        if (lastBlock !== null) text += '\n';
        lastBlock = block;
      }
      if (n.nodeType === Node.ELEMENT_NODE) {
        if (n.tagName === 'BR' && n.nextSibling) text += '\n';
        continue;
      }
      segs.push({ node: n, start: text.length, end: text.length + n.data.length });
      text += n.data;
      if (block && block.tagName === 'P' && !dialogueBlocks.has(block)) dialogueBlocks.set(block, true);
    }
    this.segments = segs;
    this.text = text;
    // classe .fala nos parágrafos de diálogo (espaçamento automático do Wattpad/AO3)
    for (const p of this.el.querySelectorAll('p')) {
      const dlg = isDialogue(p.textContent || '');
      if (dlg !== p.classList.contains('fala')) p.classList.toggle('fala', dlg);
    }
    return text;
  }

  offsetOf(node, offset) {
    for (const s of this.segments) {
      if (s.node === node) return s.start + Math.min(offset, s.node.data.length);
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node.childNodes[offset] || null;
      if (child) {
        const w = document.createTreeWalker(child, NodeFilter.SHOW_TEXT);
        const t = child.nodeType === Node.TEXT_NODE ? child : w.nextNode();
        if (t) return this.offsetOf(t, 0);
      }
    }
    return -1;
  }

  rangeFor(start, end) {
    const segs = this.segments;
    const find = (pos, preferEnd) => {
      let lo = 0;
      let hi = segs.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const s = segs[mid];
        if (pos < s.start) hi = mid - 1;
        else if (pos > s.end || (pos === s.end && !preferEnd && mid + 1 < segs.length && segs[mid + 1].start === pos)) lo = mid + 1;
        else return [s.node, pos - s.start];
      }
      return null;
    };
    const a = find(start, false);
    const b = find(end, true);
    if (!a || !b) return null;
    const r = document.createRange();
    try {
      r.setStart(a[0], a[1]);
      r.setEnd(b[0], b[1]);
    } catch {
      return null;
    }
    return r;
  }

  setHighlights(name, items) {
    if (!('highlights' in CSS)) return 0;
    const ranges = [];
    for (const it of items) {
      const r = this.rangeFor(it.start, it.end);
      if (r) ranges.push(r);
    }
    if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
    else CSS.highlights.delete(name);
    return ranges.length;
  }

  clearHighlights(name) {
    if ('highlights' in CSS) CSS.highlights.delete(name);
  }

  caretOffset() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !this.el.contains(sel.anchorNode)) return -1;
    return this.offsetOf(sel.anchorNode, sel.anchorOffset);
  }

  offsetFromPoint(x, y) {
    let node;
    let offset;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (!p) return -1;
      node = p.offsetNode;
      offset = p.offset;
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (!r) return -1;
      node = r.startContainer;
      offset = r.startOffset;
    } else return -1;
    if (!this.el.contains(node)) return -1;
    return this.offsetOf(node, offset);
  }

  replaceRange(start, end, text) {
    const r = this.rangeFor(start, end);
    if (!r) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    this.el.focus();
    // insertText entra no desfazer do navegador
    if (!document.execCommand('insertText', false, text)) {
      r.deleteContents();
      r.insertNode(document.createTextNode(text));
    }
    return true;
  }

  selectRange(start, end) {
    const r = this.rangeFor(start, end);
    if (!r) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    const rect = r.getBoundingClientRect();
    const desk = this.el.closest('.desk');
    if (desk && (rect.top < 120 || rect.bottom > window.innerHeight - 60)) {
      desk.scrollTop += rect.top - window.innerHeight / 2;
    }
  }

  onInput(e) {
    if (e.inputType === 'insertText' && e.data) this.autocorrect(e.data);
    if (!this.el.firstElementChild) this.normalize();
    this.hooks.onChange?.();
  }

  autocorrect(data) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const node = sel.anchorNode;
    const off = sel.anchorOffset;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const before = node.data.slice(0, off);
    const replace = (len, text) => {
      node.replaceData(off - len, len, text);
      const pos = off - len + text.length;
      sel.collapse(node, pos);
    };
    if (this.options.autoDash && data === '-' && before.endsWith('--')) {
      replace(2, '—');
      return;
    }
    if (this.options.autoDash && (data === ' ' || data === '\u00a0') && /-[ \u00a0]$/.test(before)) {
      // começo do parágrafo: "- " vira travessão de diálogo; " - " no meio vira meia-risca
      const block = node.parentElement?.closest('p,li,blockquote,h1,h2,h3');
      let prefix = before;
      if (block) {
        const r = document.createRange();
        r.selectNodeContents(block);
        r.setEnd(node, off);
        prefix = r.toString();
      }
      if (/^[ \u00a0]*-[ \u00a0]$/.test(prefix)) {
        replace(2, '—\u00a0');
        return;
      }
      if (/[ \u00a0]-[ \u00a0]$/.test(before)) {
        replace(2, '–\u00a0');
        return;
      }
    }
    if (this.options.autoEllipsis && data === '.' && before.endsWith('...')) {
      replace(3, '…');
      return;
    }
    if (this.options.smartQuotes && (data === '"' || data === "'")) {
      const prev = before.slice(-2, -1);
      const opening = !prev || /[\s(\[{—–]/.test(prev);
      const ch = data === '"' ? (opening ? '“' : '”') : (opening ? '‘' : '’');
      replace(1, ch);
    }
  }

  onPaste(e) {
    const html = e.clipboardData?.getData('text/html');
    const text = e.clipboardData?.getData('text/plain');
    e.preventDefault();
    let out;
    if (html) {
      out = sanitizeHtml(html.replace(/<!--StartFragment-->|<!--EndFragment-->/g, ''));
    } else if (text) {
      if (!text.includes('\n')) {
        document.execCommand('insertText', false, text);
        return;
      }
      out = textToHtml(text);
    }
    if (out) document.execCommand('insertHTML', false, out);
  }

  onKeyDown(e) {
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const li = window.getSelection().anchorNode?.parentElement?.closest('li');
      if (li) document.execCommand(e.shiftKey ? 'outdent' : 'indent');
      else document.execCommand('insertText', false, ' ');
    }
  }

  exec(cmd, value) {
    this.el.focus();
    const css = ['foreColor', 'hiliteColor', 'fontName', 'backColor'].includes(cmd);
    if (css) document.execCommand('styleWithCSS', false, true);
    const ok = document.execCommand(cmd, false, value);
    if (css) document.execCommand('styleWithCSS', false, false);
    this.normalize();
    this.hooks.onChange?.();
    return ok;
  }

  setFontSize(pt) {
    this.el.focus();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    for (const f of this.el.querySelectorAll('font[size="7"]')) {
      const span = document.createElement('span');
      span.style.fontSize = `${pt}pt`;
      while (f.firstChild) span.append(f.firstChild);
      f.replaceWith(span);
    }
    this.hooks.onChange?.();
  }

  selectedBlocks() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return [];
    const range = sel.getRangeAt(0);
    const blocks = [];
    for (const el of this.el.querySelectorAll('p,h1,h2,h3,blockquote,li')) {
      if (range.intersectsNode(el)) blocks.push(el);
    }
    if (!blocks.length) {
      const b = sel.anchorNode?.parentElement?.closest('p,h1,h2,h3,blockquote,li');
      if (b && this.el.contains(b)) blocks.push(b);
    }
    return blocks;
  }

  setLineHeight(v) {
    for (const b of this.selectedBlocks()) b.style.lineHeight = v;
    this.hooks.onChange?.();
  }

  insertHtml(html) {
    this.el.focus();
    document.execCommand('insertHTML', false, html);
    this.normalize();
    this.hooks.onChange?.();
  }

  insertText(text) {
    this.el.focus();
    document.execCommand('insertText', false, text);
  }
}
