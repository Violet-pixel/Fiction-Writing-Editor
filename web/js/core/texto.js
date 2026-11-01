// Contagem de palavras e detecção de falas. Sem DOM: roda no navegador, no worker e no Node.
// As regras são as mesmas do núcleo em C (native/c/textstats.c) e do Java (serifa.text).

export function isWordChar(cp) {
  return (cp >= 48 && cp <= 57) || (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) ||
    (cp >= 0xc0 && cp <= 0x24f && cp !== 0xd7 && cp !== 0xf7) ||
    (cp >= 0x370 && cp <= 0x1fff) || (cp >= 0x3040 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af);
}

export function isLetter(cp) {
  return isWordChar(cp) && !(cp >= 48 && cp <= 57);
}

export function isSpace(cp) {
  return cp === 9 || cp === 10 || cp === 11 || cp === 12 || cp === 13 || cp === 32 || cp === 0x85 ||
    cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x2028 || cp === 0x2029 ||
    cp === 0x202f || cp === 0x205f || cp === 0x3000;
}

const DASHES = new Set([0x2014, 0x2013, 0x2015]);
const AFTER_TERMINATOR = new Set([0x201d, 0x22, 0x2019, 0xbb, 0x29, 0x2014]);
const TERMINATORS = new Set([0x2e, 0x21, 0x3f, 0x2026]);

/** Um parágrafo é fala quando começa com travessão, hífen + espaço ou aspas de abertura. */
export function isDialogue(paragraph) {
  let i = 0;
  const s = paragraph;
  while (i < s.length && isSpace(s.codePointAt(i))) i += 1;
  if (i >= s.length) return false;
  const c = s[i];
  if (c === '—' || c === '–' || c === '―' || c === '“' || c === '"' || c === '«') return true;
  return c === '-' && i + 1 < s.length && isSpace(s.codePointAt(i + 1));
}

/** Estatísticas do texto puro (parágrafos separados por \n). */
export function countText(text) {
  const cps = Array.from(text, (ch) => ch.codePointAt(0));
  let words = 0;
  let characters = 0;
  let noSpaces = 0;
  let inToken = false;
  let tokenHasWord = false;
  for (const cp of cps) {
    if (cp !== 10 && cp !== 13) characters += 1;
    const space = isSpace(cp);
    if (!space) noSpaces += 1;
    if (space || DASHES.has(cp)) {
      if (inToken && tokenHasWord) words += 1;
      inToken = false;
      tokenHasWord = false;
    } else {
      inToken = true;
      if (isWordChar(cp)) tokenHasWord = true;
    }
  }
  if (inToken && tokenHasWord) words += 1;

  let sentences = 0;
  if (words > 0) {
    let seenWord = false;
    let i = 0;
    while (i < cps.length) {
      const cp = cps[i];
      if (TERMINATORS.has(cp)) {
        let j = i;
        while (j < cps.length && TERMINATORS.has(cps[j])) j += 1;
        const next = j < cps.length ? cps[j] : -1;
        if ((next === -1 || isSpace(next) || AFTER_TERMINATOR.has(next)) && seenWord) {
          sentences += 1;
          seenWord = false;
        }
        i = j;
        continue;
      }
      if (isWordChar(cp)) seenWord = true;
      i += 1;
    }
    if (seenWord) sentences += 1;
  }

  let paragraphs = 0;
  let dialogues = 0;
  for (const line of text.split('\n')) {
    let blank = true;
    for (const ch of line) {
      if (!isSpace(ch.codePointAt(0))) {
        blank = false;
        break;
      }
    }
    if (!blank) {
      paragraphs += 1;
      if (isDialogue(line)) dialogues += 1;
    }
  }
  return {
    words,
    characters,
    charactersNoSpaces: noSpaces,
    paragraphs,
    sentences,
    dialogues,
    readingMinutes: words === 0 ? 0 : Math.ceil(words / 200),
  };
}

/** Só a contagem de palavras (rápida, usada no contador em tempo real). */
export function countWords(text) {
  let words = 0;
  let inToken = false;
  let hasWord = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (isSpace(cp) || DASHES.has(cp)) {
      if (inToken && hasWord) words += 1;
      inToken = false;
      hasWord = false;
    } else {
      inToken = true;
      if (!hasWord && isWordChar(cp)) hasWord = true;
    }
  }
  if (inToken && hasWord) words += 1;
  return words;
}

/**
 * Tokens para a revisão ortográfica: letras unidas por hífen ou apóstrofo.
 * Devolve {word, start, end} com offsets em unidades UTF-16.
 */
export function spellTokens(text) {
  const out = [];
  const n = text.length;
  let i = 0;
  const isUrlish = (pos) => {
    let a = pos;
    while (a > 0 && !isSpace(text.charCodeAt(a - 1))) a -= 1;
    let b = pos;
    while (b < n && !isSpace(text.charCodeAt(b))) b += 1;
    const tok = text.slice(a, b);
    return tok.includes('://') || tok.includes('www.') || tok.includes('@');
  };
  while (i < n) {
    const cp = text.codePointAt(i);
    const w = cp > 0xffff ? 2 : 1;
    if (!isLetter(cp)) {
      i += w;
      continue;
    }
    const start = i;
    let end = i;
    let j = i;
    let digit = false;
    while (j < n) {
      const c = text.codePointAt(j);
      const cw = c > 0xffff ? 2 : 1;
      if (isLetter(c)) {
        j += cw;
        end = j;
      } else if ((c === 45 || c === 39 || c === 0x2019) && j + 1 < n && isLetter(text.codePointAt(j + 1)) && end === j) {
        j += 1;
      } else {
        if (c >= 48 && c <= 57) digit = true;
        break;
      }
    }
    if (start > 0 && /[0-9]/.test(text[start - 1])) digit = true;
    const word = text.slice(start, end);
    i = Math.max(j, end);
    const letters = Array.from(word.replace(/[-'’]/g, '')).length;
    if (digit || letters < 2) continue;
    if (word === word.toUpperCase() && word !== word.toLowerCase() && letters <= 4) continue;
    if (isUrlish(start)) continue;
    out.push({ word, start, end });
  }
  return out;
}

// ---------- WebAssembly (núcleo em C) ----------
let wasm = null;

/** Carrega o textstats.wasm (C). Se falhar, a contagem continua em JavaScript. */
export async function loadTextStatsWasm(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
    const ex = instance.exports;
    if (!ex.ts_buffer || !ex.ts_count || !ex.memory) return false;
    wasm = { ex, encoder: new TextEncoder() };
    return true;
  } catch {
    return false;
  }
}

export function wasmReady() {
  return wasm !== null;
}

/** Contagem pelo WebAssembly, com a mesma saída de countText (menos readingMinutes calculado aqui). */
export function countTextFast(text) {
  if (!wasm) return countText(text);
  const { ex, encoder } = wasm;
  const bytes = encoder.encode(text);
  const ptr = ex.ts_buffer();
  const cap = ex.memory.buffer.byteLength - ptr;
  if (bytes.length > cap) return countText(text);
  new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
  const res = ex.ts_count(bytes.length);
  const v = new Uint32Array(ex.memory.buffer, res, 6);
  return {
    words: v[0],
    characters: v[1],
    charactersNoSpaces: v[2],
    paragraphs: v[3],
    sentences: v[4],
    dialogues: v[5],
    readingMinutes: v[0] === 0 ? 0 : Math.ceil(v[0] / 200),
  };
}
