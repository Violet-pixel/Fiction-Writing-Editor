// Balão de ideias: regras de estilo, sentido e tempo verbal sobre o texto puro do capítulo.
// Lê web/dados/regras.json e web/dados/verbos.json, os mesmos arquivos que o servidor Java usa.

import { isDialogue, countWords } from './texto.js';

const PERSONS = ['1s', '3s', '1p', '3p'];
const PRONOUNS = {
  eu: '1s', 'nós': '1p', ele: '3s', ela: '3s', 'você': '3s', eles: '3p', elas: '3p', 'vocês': '3p',
};
const REPEAT_OK = new Set(['se', 'nos', 'lo', 'la']);
const BEFORE_PRONOUN_SKIP = new Set(['e', 'ou', 'nem', 'a', 'para', 'pra', 'de', 'com', 'por', 'sem', 'contra', 'entre', 'sobre', 'até']);
const PAST = new Set(['perfeito', 'imperfeito']);

export function conjugate(verb, data) {
  const out = {};
  const irr = data.irregulares?.[verb];
  if (irr) {
    for (const t of Object.keys(irr)) out[t] = irr[t].slice();
    return out;
  }
  const end = verb.slice(-2);
  const table = data.terminacoes?.[end];
  if (!table) return out;
  const stem = verb.slice(0, -2);
  for (const tense of Object.keys(table)) out[tense] = table[tense].map((s) => stem + s);
  const adj = data.ajustes || {};
  for (const [tail, rep] of Object.entries(adj.perfeito1s || {})) {
    if (verb.endsWith(tail) && out.perfeito) out.perfeito[0] = verb.slice(0, -tail.length) + rep;
  }
  for (const [tail, rep] of Object.entries(adj.presente1s || {})) {
    if (verb.endsWith(tail) && out.presente) out.presente[0] = verb.slice(0, -tail.length) + rep;
  }
  return out;
}

export class IdeaEngine {
  constructor(rulesData, verbsData) {
    this.rules = (rulesData?.regras || []).map((r) => {
      try {
        return { ...r, re: new RegExp(`(?<!\\p{L})(?:${r.padrao})(?!\\p{L})`, 'giu') };
      } catch {
        return null;
      }
    }).filter(Boolean);
    this.verbs = verbsData || {};
    this.forms = new Map();
    this.table = new Map();
    const homographs = new Set((this.verbs.homografos || []).map((h) => h.toLowerCase()));
    const all = [...(this.verbs.regulares || []), ...Object.keys(this.verbs.irregulares || {})];
    const irregular = this.verbs.irregulares || {};
    for (const verb of all) {
      const conj = conjugate(verb, this.verbs);
      this.table.set(verb, conj);
      for (const [tense, list] of Object.entries(conj)) {
        list.forEach((form, i) => {
          if (!form) return;
          // presente 1s dos regulares colide com substantivos (cheiro, olho, canto): fica fora do índice
          if (tense === 'presente' && i === 0 && !irregular[verb]) return;
          const key = form.toLowerCase();
          if (!this.forms.has(key)) this.forms.set(key, []);
          this.forms.get(key).push({ verb, tense, person: PERSONS[i] });
        });
      }
    }
    this.homographs = homographs;
  }

  /** Tempo de uma forma, ou null se não for verbo conhecido, for ambígua ou homógrafa. */
  tenseOf(word) {
    const key = word.toLowerCase();
    if (this.homographs.has(key)) return null;
    const entries = this.forms.get(key);
    if (!entries) return null;
    const tenses = new Set(entries.map((e) => e.tense));
    if (tenses.size !== 1) return null;
    const verbs = new Set(entries.map((e) => e.verb));
    if (verbs.size !== 1) return null;
    return entries[0];
  }

  formFor(verb, tense, person) {
    const conj = this.table.get(verb);
    const i = PERSONS.indexOf(person);
    return conj?.[tense]?.[i] || null;
  }

  /** Ideias para o texto puro (parágrafos separados por \n). */
  analyze(text, opts = {}) {
    const enabled = opts.categories ? new Set(opts.categories) : null;
    const ideas = [];
    const add = (idea) => {
      if (enabled && !enabled.has(idea.category)) return;
      ideas.push(idea);
    };
    // 1. regras por padrão
    for (const r of this.rules) {
      r.re.lastIndex = 0;
      let m;
      while ((m = r.re.exec(text))) {
        if (m[0].length === 0) {
          r.re.lastIndex += 1;
          continue;
        }
        add({ rule: r.id, category: r.categoria, start: m.index, end: m.index + m[0].length,
          message: r.mensagem, suggestion: r.sugestao || '' });
      }
    }
    // 2. palavra repetida
    const rep = /(?<!\p{L})(\p{L}+)(\s+)(\1)(?!\p{L})/giu;
    let m;
    while ((m = rep.exec(text))) {
      if (REPEAT_OK.has(m[1].toLowerCase()) || m[2].includes('\n')) {
        rep.lastIndex = m.index + m[1].length;
        continue;
      }
      add({ rule: 'palavra-repetida', category: 'estilo', start: m.index, end: m.index + m[0].length,
        message: `A palavra “${m[1]}” aparece duas vezes seguidas.`, suggestion: m[1] });
    }
    // parágrafos
    const paragraphs = [];
    let pos = 0;
    for (const line of text.split('\n')) {
      paragraphs.push({ text: line, start: pos, dialogue: isDialogue(line) });
      pos += line.length + 1;
    }
    let pastCount = 0;
    let presentCount = 0;
    const perParagraph = [];
    for (const p of paragraphs) {
      const tokens = this.tokens(p.text, p.start);
      // 6. concordância pronome + verbo (vale também nas falas)
      for (let i = 0; i + 1 < tokens.length; i += 1) {
        const person = PRONOUNS[tokens[i].lower];
        if (!person || tokens[i + 1].gap.trim()) continue;
        // "ele e eu fomos", "para mim", "entre eu e ela": o pronome não é o sujeito sozinho
        if (i > 0 && BEFORE_PRONOUN_SKIP.has(tokens[i - 1].lower) && !tokens[i].gap.trim()) continue;
        const verb = tokens[i + 1];
        const entries = this.forms.get(verb.lower);
        if (!entries || this.homographs.has(verb.lower)) continue;
        const persons = new Set(entries.map((e) => e.person));
        if (persons.size !== 1 || persons.has(person)) continue;
        const e = entries[0];
        const right = this.formFor(e.verb, e.tense, person);
        if (!right || right.toLowerCase() === verb.lower) continue;
        add({ rule: 'concordancia-pronome', category: 'concordancia', start: verb.start, end: verb.end,
          message: `Concordância: com “${tokens[i].word}”, use “${right}” em vez de “${verb.word}”.`,
          suggestion: matchFirst(verb.word, right) });
      }
      if (p.dialogue || !p.text.trim()) {
        perParagraph.push(null);
        continue;
      }
      // 3. frase longa e 4. mistura de tempos na mesma frase
      const info = { past: [], present: [] };
      for (const s of this.sentences(p.text, p.start)) {
        if (countWords(s.text) > 55) {
          add({ rule: 'frase-longa', category: 'estilo', start: s.start, end: s.end,
            message: 'Frase muito longa (mais de 55 palavras). Que tal dividir em duas?', suggestion: '' });
        }
        const masked = maskQuotes(s.text);
        const past = [];
        const present = [];
        for (const t of this.tokens(masked, s.start)) {
          const e = this.tenseOf(t.lower);
          if (!e) continue;
          if (PAST.has(e.tense)) past.push({ t, e });
          else if (e.tense === 'presente') present.push({ t, e });
        }
        info.past.push(...past);
        info.present.push(...present);
        if (past.length && present.length) {
          for (const { t, e } of present) {
            const sug = this.formFor(e.verb, 'perfeito', e.person) || this.formFor(e.verb, 'imperfeito', e.person) || '';
            add({ rule: 'tempo-verbal-frase', category: 'tempo-verbal', start: t.start, end: t.end,
              message: `Mistura de tempos verbais: “${past[0].t.word}” está no passado e “${t.word}” no presente.`,
              suggestion: sug && matchFirst(t.word, sug) });
          }
        }
      }
      pastCount += info.past.length;
      presentCount += info.present.length;
      perParagraph.push(info);
    }
    // 5. tempo verbal do capítulo
    const total = pastCount + presentCount;
    if (total >= 8) {
      const pastMode = pastCount / total >= 0.7;
      const presentMode = presentCount / total >= 0.7;
      for (const info of perParagraph) {
        if (!info) continue;
        if (pastMode && info.present.length >= 2 && info.past.length === 0) {
          const { t, e } = info.present[0];
          const sug = this.formFor(e.verb, 'perfeito', e.person) || '';
          add({ rule: 'tempo-verbal-capitulo', category: 'tempo-verbal', start: t.start, end: t.end,
            message: 'O capítulo é narrado no passado, mas este parágrafo está no presente.', suggestion: sug && matchFirst(t.word, sug) });
        } else if (presentMode && info.past.length >= 2 && info.present.length === 0) {
          const { t, e } = info.past[0];
          const sug = this.formFor(e.verb, 'presente', e.person) || '';
          add({ rule: 'tempo-verbal-capitulo', category: 'tempo-verbal', start: t.start, end: t.end,
            message: 'O capítulo é narrado no presente, mas este parágrafo está no passado.', suggestion: sug && matchFirst(t.word, sug) });
        }
      }
    }
    ideas.sort((a, b) => a.start - b.start || b.end - a.end);
    const out = [];
    for (const idea of ideas) {
      const last = out[out.length - 1];
      if (last && last.start === idea.start && last.end === idea.end && last.rule === idea.rule) continue;
      out.push(idea);
    }
    return out;
  }

  tokens(text, offset) {
    const out = [];
    const re = /\p{L}+(?:[-'’]\p{L}+)*/gu;
    let m;
    let last = 0;
    while ((m = re.exec(text))) {
      out.push({ word: m[0], lower: m[0].toLowerCase(), start: offset + m.index, end: offset + m.index + m[0].length,
        gap: text.slice(last, m.index) });
      last = m.index + m[0].length;
    }
    return out;
  }

  sentences(text, offset) {
    const out = [];
    const re = /[^.!?…]+(?:[.!?…]+|$)/gu;
    let m;
    while ((m = re.exec(text))) {
      if (!m[0].trim()) {
        if (m[0].length === 0) re.lastIndex += 1;
        continue;
      }
      const lead = m[0].length - m[0].trimStart().length;
      out.push({ text: m[0].trim(), start: offset + m.index + lead, end: offset + m.index + lead + m[0].trim().length });
    }
    return out;
  }
}

function matchFirst(original, s) {
  const f = original.charAt(0);
  return f !== f.toLowerCase() ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Troca o que está entre aspas por espaços, mantendo os offsets (fala citada no meio da narração). */
export function maskQuotes(s) {
  return s.replace(/“[^”]*”|"[^"]*"|«[^»]*»/g, (q) => ' '.repeat(q.length));
}
