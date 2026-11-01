// Worker da revisão: carrega o dicionário VERO, as regras e os verbos e confere o texto fora da thread da tela.
import { Speller, weightedDistance } from '../core/ortografia.js';
import { IdeaEngine } from '../core/ideias.js';
import { spellTokens } from '../core/texto.js';

let speller = null;
let ideas = null;
let fuzzy = null;
let ready = null;

async function loadFuzzy() {
  try {
    const res = await fetch(new URL('../../wasm/fuzzy.wasm', import.meta.url));
    if (!res.ok) return;
    const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
    const ex = instance.exports;
    if (ex.fz_buffer && ex.fz_distance && ex.memory) fuzzy = ex;
  } catch {
    fuzzy = null;
  }
}

/** Distância pelo WebAssembly (C++); cai para o JavaScript se o módulo não carregou. */
function rank(a, b, sp) {
  if (!fuzzy) return weightedDistance(a, b, sp);
  const ca = Array.from(a, (c) => c.codePointAt(0));
  const cb = Array.from(b, (c) => c.codePointAt(0));
  const ptr = fuzzy.fz_buffer();
  const mem = new Uint32Array(fuzzy.memory.buffer, ptr, ca.length + cb.length);
  mem.set(ca, 0);
  mem.set(cb, ca.length);
  return fuzzy.fz_distance(ca.length, cb.length) / 1000;
}

async function init() {
  const base = new URL('../../', import.meta.url);
  const [aff, dic, regras, verbos] = await Promise.all([
    fetch(new URL('dicionario/pt-BR.aff', base)).then((r) => r.text()),
    fetch(new URL('dicionario/pt-BR.dic', base)).then((r) => r.text()),
    fetch(new URL('dados/regras.json', base)).then((r) => r.json()).catch(() => ({ regras: [] })),
    fetch(new URL('dados/verbos.json', base)).then((r) => r.json()).catch(() => ({})),
    loadFuzzy(),
  ]);
  speller = new Speller(aff, dic);
  ideas = new IdeaEngine(regras, verbos);
  return { rules: ideas.rules.length, wasm: Boolean(fuzzy) };
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (!ready) ready = init();
    const info = await ready;
    if (msg.type === 'init') {
      self.postMessage({ type: 'ready', ...info });
    } else if (msg.type === 'personal') {
      speller.setPersonal(msg.words || []);
    } else if (msg.type === 'check') {
      const spelling = [];
      if (msg.spelling) {
        const ignored = new Set((msg.ignoredWords || []).map((w) => w.toLowerCase()));
        for (const t of spellTokens(msg.text)) {
          if (ignored.has(t.word.toLowerCase())) continue;
          if (!speller.check(t.word)) spelling.push(t);
        }
      }
      const found = msg.ideas ? ideas.analyze(msg.text, { categories: msg.categories }) : [];
      self.postMessage({ type: 'result', id: msg.id, spelling, ideas: found });
    } else if (msg.type === 'suggest') {
      self.postMessage({ type: 'suggestions', id: msg.id, word: msg.word, list: speller.suggest(msg.word, rank) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, message: String(err && err.message ? err.message : err) });
  }
};
