// Corretor ortográfico "hunspell-lite": lê os arquivos .aff e .dic do VERO (pt-BR) e confere palavras
// desfazendo prefixos e sufixos, sem expandir o dicionário (cabe na memória do navegador).
// O mesmo algoritmo existe no Java (serifa.spell) e no C++ (native/cpp/revisor).

const MAP_COST = 0.3;
const NEAR_COST = 0.7;

// Teclado ABNT2 (linhas sem acento), para custo menor de troca entre teclas vizinhas.
const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjklç', 'zxcvbnm'];
const KEY_POS = new Map();
ROWS.forEach((row, r) => Array.from(row).forEach((ch, c) => KEY_POS.set(ch, [r, c + r * 0.5])));

function compileCondition(cond, suffix) {
  if (!cond || cond === '.') return null;
  const src = cond.replace(/[.+*?(){}|\\^$]/g, (m, off) => {
    // ^ dentro de [ ] é negação e deve continuar
    if (m === '^' && cond[off - 1] === '[') return '^';
    if (m === '.') return '[\\s\\S]';
    return `\\${m}`;
  });
  return new RegExp(suffix ? `(?:${src})$` : `^(?:${src})`, 'u');
}

export class Speller {
  constructor(affText, dicText) {
    this.words = new Map();
    this.sfx = new Map();
    this.pfx = new Map();
    this.rep = [];
    this.map = [];
    this.tryChars = '';
    this.forbidden = null;
    this.noSuggest = null;
    this.maxSfx = 0;
    this.maxPfx = 0;
    this.personal = new Set();
    this.cache = new Map();
    this.parseAff(affText);
    this.parseDic(dicText);
  }

  parseAff(text) {
    const lines = text.split(/\r?\n/);
    const condCache = new Map();
    const headers = new Map();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line[0] === '#') continue;
      const parts = line.split(/\s+/);
      const kind = parts[0];
      if (kind === 'SFX' || kind === 'PFX') {
        const flag = parts[1];
        const key = `${kind}:${flag}`;
        if (!headers.has(key)) {
          headers.set(key, parts[2] === 'Y');
          continue;
        }
        if (parts.length < 4) continue;
        const strip = parts[2] === '0' ? '' : parts[2];
        let add = parts[3] || '';
        const slash = add.indexOf('/');
        if (slash >= 0) add = add.slice(0, slash);
        if (add === '0') add = '';
        const condStr = parts[4] || '.';
        const ck = `${kind}${condStr}`;
        if (!condCache.has(ck)) condCache.set(ck, compileCondition(condStr, kind === 'SFX'));
        const entry = { flag, strip, add, cond: condCache.get(ck), cross: headers.get(key) };
        const table = kind === 'SFX' ? this.sfx : this.pfx;
        if (!table.has(add)) table.set(add, []);
        table.get(add).push(entry);
        if (kind === 'SFX') this.maxSfx = Math.max(this.maxSfx, add.length);
        else this.maxPfx = Math.max(this.maxPfx, add.length);
      } else if (kind === 'REP' && parts.length >= 3) {
        this.rep.push([parts[1], parts[2]]);
      } else if (kind === 'MAP' && parts.length >= 2 && !/^\d+$/.test(parts[1])) {
        this.map.push(Array.from(parts[1]));
      } else if (kind === 'TRY') {
        this.tryChars = parts[1] || '';
      } else if (kind === 'FORBIDDENWORD') {
        this.forbidden = parts[1];
      } else if (kind === 'NOSUGGEST') {
        this.noSuggest = parts[1];
      }
    }
    this.mapGroup = new Map();
    for (const group of this.map) {
      for (const ch of group) this.mapGroup.set(ch, group);
    }
  }

  parseDic(text) {
    const lines = text.split(/\r?\n/);
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      const slash = line.indexOf('/');
      let word;
      let flags = '';
      if (slash > 0) {
        word = line.slice(0, slash);
        flags = line.slice(slash + 1).split(/\s/)[0];
      } else {
        word = line.split(/\s/)[0];
      }
      const prev = this.words.get(word);
      this.words.set(word, prev ? prev + flags : flags);
    }
  }

  has(stem, flag) {
    const f = this.words.get(stem);
    if (f === undefined) return false;
    if (this.forbidden && f.includes(this.forbidden)) return false;
    return flag ? f.includes(flag) : true;
  }

  sfxStems(w, cb) {
    const len = w.length;
    for (let k = 0; k <= Math.min(this.maxSfx, len - 1); k += 1) {
      const entries = this.sfx.get(w.slice(len - k));
      if (!entries) continue;
      const base = w.slice(0, len - k);
      for (const e of entries) {
        const stem = base + e.strip;
        if (!stem) continue;
        if (e.cond && !e.cond.test(stem)) continue;
        if (cb(stem, e)) return true;
      }
    }
    return false;
  }

  lookup(w) {
    if (!w) return false;
    const f = this.words.get(w);
    if (f !== undefined) return !(this.forbidden && f.includes(this.forbidden));
    if (this.sfxStems(w, (stem, e) => this.has(stem, e.flag))) return true;
    const len = w.length;
    for (let k = 1; k <= Math.min(this.maxPfx, len - 1); k += 1) {
      const entries = this.pfx.get(w.slice(0, k));
      if (!entries) continue;
      const rest = w.slice(k);
      for (const e of entries) {
        const stem = e.strip + rest;
        if (e.cond && !e.cond.test(stem)) continue;
        if (this.has(stem, e.flag)) return true;
        if (e.cross) {
          const ok = this.sfxStems(stem, (root, s) => s.cross && (!e.cond || e.cond.test(root)) &&
            this.has(root, s.flag) && this.has(root, e.flag));
          if (ok) return true;
        }
      }
    }
    return false;
  }

  /** A palavra está correta? Usa o dicionário pessoal, maiúsculas e palavras compostas com hífen. */
  check(word) {
    if (!word) return true;
    const cached = this.cache.get(word);
    if (cached !== undefined) return cached;
    let ok = this.checkUncached(word);
    if (this.cache.size > 50000) this.cache.clear();
    this.cache.set(word, ok);
    return ok;
  }

  checkUncached(word) {
    const w = word.replace(/’/g, "'");
    const lower = w.toLowerCase();
    if (this.personal.has(lower)) return true;
    if (this.lookup(w)) return true;
    const cap = lower.charAt(0).toUpperCase() + lower.slice(1);
    if (w === cap && this.lookup(lower)) return true;
    if (w === w.toUpperCase() && w !== lower && (this.lookup(lower) || this.lookup(cap))) return true;
    if (w.includes('-')) {
      const parts = w.split('-').filter(Boolean);
      if (parts.length > 1 && parts.every((p) => this.check(p))) return true;
    }
    return false;
  }

  setPersonal(words) {
    this.personal = new Set(words.map((x) => x.toLowerCase()));
    this.cache.clear();
  }

  addPersonal(word) {
    this.personal.add(word.toLowerCase());
    this.cache.delete(word);
  }

  suggestable(word) {
    if (!this.check(word)) return false;
    if (this.noSuggest) {
      const f = this.words.get(word);
      if (f && f.includes(this.noSuggest)) return false;
    }
    return true;
  }

  /** Até 6 sugestões, ordenadas pela distância ponderada. */
  suggest(word, rank = weightedDistance) {
    const lower = word.toLowerCase();
    const candidates = [];
    const seen = new Set([lower]);
    const tryAdd = (c) => {
      if (!c || seen.has(c)) return;
      seen.add(c);
      let ok;
      if (c.includes(' ')) ok = c.split(' ').every((p) => p.length > 1 && this.suggestable(p));
      else if (c.includes('-')) ok = this.lookup(c);
      else ok = this.suggestable(c);
      if (ok) candidates.push(c);
    };
    // 1. REP: erros comuns do português
    for (const [from, to] of this.rep) {
      const startAnchor = from.startsWith('^');
      const endAnchor = from.endsWith('$');
      const pat = from.replace(/^\^/, '').replace(/\$$/, '').replace(/_/g, ' ');
      const rep = to.replace(/_/g, ' ');
      if (!pat) continue;
      let idx = lower.indexOf(pat);
      while (idx >= 0) {
        if ((!startAnchor || idx === 0) && (!endAnchor || idx + pat.length === lower.length)) {
          tryAdd(lower.slice(0, idx) + rep + lower.slice(idx + pat.length));
        }
        idx = lower.indexOf(pat, idx + 1);
      }
    }
    // 2. MAP: acentos e cedilha
    const chars = Array.from(lower);
    const variants = (arr, from, depth) => {
      for (let i = from; i < arr.length; i += 1) {
        const group = this.mapGroup.get(arr[i]);
        if (!group) continue;
        for (const alt of group) {
          if (alt === arr[i] || alt !== alt.toLowerCase()) continue;
          const copy = arr.slice();
          copy[i] = alt;
          tryAdd(copy.join(''));
          if (depth > 1 && arr.length <= 14) variants(copy, i + 1, depth - 1);
        }
      }
    };
    variants(chars, 0, 2);
    // 3. Uma edição
    const letters = Array.from(this.tryChars || 'aeiosrnmtcdlup').filter((c) => c === c.toLowerCase());
    for (let i = 0; i <= chars.length; i += 1) {
      if (i < chars.length) {
        tryAdd([...chars.slice(0, i), ...chars.slice(i + 1)].join(''));
        if (i + 1 < chars.length) {
          const t = chars.slice();
          [t[i], t[i + 1]] = [t[i + 1], t[i]];
          tryAdd(t.join(''));
        }
        for (const l of letters) {
          if (l !== chars[i]) {
            const t = chars.slice();
            t[i] = l;
            tryAdd(t.join(''));
          }
        }
      }
      for (const l of letters) tryAdd([...chars.slice(0, i), l, ...chars.slice(i)].join(''));
    }
    const scored = candidates.map((c, i) => ({ c, d: rank(lower, c, this) + (/[ -]/.test(c) && !/[ -]/.test(lower) ? 0.6 : 0), i }));
    scored.sort((a, b) => a.d - b.d || a.i - b.i);
    const top = scored.slice(0, 6).map((s) => s.c);
    return top.map((c) => matchCase(word, c));
  }
}

export function matchCase(original, candidate) {
  if (original.length > 1 && original === original.toUpperCase() && original !== original.toLowerCase()) {
    return candidate.toUpperCase();
  }
  const first = original.charAt(0);
  if (first !== first.toLowerCase()) return candidate.charAt(0).toUpperCase() + candidate.slice(1);
  return candidate;
}

function subCost(a, b, speller) {
  if (a === b) return 0;
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return 0;
  const group = speller?.mapGroup?.get(la);
  if (group && group.includes(lb)) return MAP_COST;
  const pa = KEY_POS.get(la);
  const pb = KEY_POS.get(lb);
  if (pa && pb && Math.abs(pa[0] - pb[0]) <= 1 && Math.abs(pa[1] - pb[1]) <= 1) return NEAR_COST;
  return 1;
}

/** Damerau-Levenshtein ponderada (a mesma do fuzzy.wasm em C++). */
export function weightedDistance(a, b, speller) {
  const s = Array.from(a);
  const t = Array.from(b);
  const n = s.length;
  const m = t.length;
  const d = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 0; i <= n; i += 1) d[i][0] = i;
  for (let j = 0; j <= m; j += 1) d[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + subCost(s[i - 1], t[j - 1], speller));
      if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
    }
  }
  return d[n][m];
}
