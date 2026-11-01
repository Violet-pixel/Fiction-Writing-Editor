// wasm.test.mjs — testes dos módulos WebAssembly do Serifa (textstats.wasm e fuzzy.wasm).
// Copyright (©) 2026 Clara Portes
// Rodar da raiz do repositório: node --test native/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WASM = path.join(RAIZ, 'web', 'wasm');
const FIXTURE_CONTAGEM = path.join(RAIZ, 'tests', 'fixtures', 'contagem.json');
const CAMPOS = ['words', 'characters', 'charactersNoSpaces', 'paragraphs', 'sentences', 'dialogues'];

async function carregar(nome) {
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(path.join(WASM, nome)), {});
  return instance.exports;
}

const ts = await carregar('textstats.wasm');
const fz = await carregar('fuzzy.wasm');

function contar(texto) {
  const bytes = new TextEncoder().encode(texto);
  if (bytes.length > ts.ts_capacity()) assert.notEqual(ts.ts_reserve(bytes.length), 0);
  new Uint8Array(ts.memory.buffer, ts.ts_buffer(), bytes.length).set(bytes);
  const p = ts.ts_count(bytes.length);
  const v = new Uint32Array(ts.memory.buffer, p, 6);
  const r = {};
  CAMPOS.forEach((c, i) => { r[c] = v[i]; });
  r.readingMinutes = r.words === 0 ? 0 : Math.ceil(r.words / 200);
  return r;
}

const cps = (s) => Array.from(s, (c) => c.codePointAt(0));

function distancia(a, b) {
  const A = cps(a), B = cps(b);
  const u = new Uint32Array(fz.memory.buffer, fz.fz_buffer(), A.length + B.length);
  u.set(A);
  u.set(B, A.length);
  return fz.fz_distance(A.length, B.length);
}

function ordenar(palavra, candidatos) {
  const dados = cps(palavra);
  for (const c of candidatos) { const x = cps(c); dados.push(x.length, ...x); }
  new Uint32Array(fz.memory.buffer, fz.fz_buffer(), dados.length).set(dados);
  const n = fz.fz_rank(cps(palavra).length, candidatos.length);
  return Array.from(new Uint32Array(fz.memory.buffer, fz.fz_buffer(), n));
}

// ---------------------------------------------------------------------------
test('ABI do textstats.wasm', () => {
  for (const nome of ['memory', 'ts_buffer', 'ts_capacity', 'ts_reserve', 'ts_count']) assert.ok(nome in ts, nome);
  assert.ok(ts.ts_capacity() >= 16 * 1024 * 1024, 'buffer de pelo menos 16 MiB');
  assert.equal(ts.ts_buffer() % 16, 0, 'buffer alinhado');
});

const CASOS_CONTAGEM = [
  ['', [0, 0, 0, 0, 0, 0]],
  ['guarda-chuva', [1, 12, 12, 1, 1, 0]],
  ["d'água 3,5 ...", [2, 14, 12, 1, 1, 0]],
  ['—Olá! —disse ela.\n\n“Vamos?”\n- Sim.\n-Não', [6, 35, 32, 4, 5, 3]],
  ['Ele tem 3.5 kg. Fim', [5, 19, 15, 1, 2, 0]],
  ['... ?!', [0, 6, 5, 1, 0, 0]],
  ['Olá...mundo', [1, 11, 11, 1, 1, 0]],
  ['Era uma vez…» E depois', [5, 22, 18, 1, 2, 0]],
  ['Linha um.\r\nLinha dois.\r\n', [4, 20, 18, 2, 2, 0]],
  ['こんにちは 世界', [2, 8, 7, 1, 1, 0]],
  ['  \n\t\n', [0, 3, 0, 0, 0, 0]],
  ['« Fala com aspas angulares. »\n"Outra fala!"', [6, 42, 36, 2, 2, 2]],
];

test('contagem — casos próprios', () => {
  for (const [texto, esperado] of CASOS_CONTAGEM) {
    const r = contar(texto);
    assert.deepEqual(CAMPOS.map((c) => r[c]), esperado, JSON.stringify(texto));
  }
});

test('contagem — UTF-8 inválido vira U+FFFD (como o TextDecoder)', () => {
  const bytes = new Uint8Array([0x61, 0xE2, 0x82, 0x20, 0x62, 0xFF]);
  new Uint8Array(ts.memory.buffer, ts.ts_buffer(), bytes.length).set(bytes);
  const v = new Uint32Array(ts.memory.buffer, ts.ts_count(bytes.length), 6);
  const esperado = new TextDecoder().decode(bytes);
  assert.equal(v[1], Array.from(esperado).length);
});

test('contagem — ts_reserve faz a memória crescer', () => {
  const grande = 'palavra '.repeat(2_500_000); // 20 MB
  const r = contar(grande);
  assert.equal(r.words, 2_500_000);
  assert.equal(r.readingMinutes, 12_500);
});

function casosDaFixture(json) {
  const lista = Array.isArray(json) ? json : (json.cases ?? json.casos ?? json.count ?? json.contagem ?? []);
  return lista.map((c, i) => ({
    nome: c.name ?? c.nome ?? c.id ?? `caso ${i}`,
    texto: c.text ?? c.texto ?? c.input ?? c.entrada,
    esperado: c.expected ?? c.esperado ?? c.output ?? c.saida ?? c.stats,
  })).filter((c) => typeof c.texto === 'string' && c.esperado && typeof c.esperado === 'object');
}

test('contagem — tests/fixtures/contagem.json', (t) => {
  if (!fs.existsSync(FIXTURE_CONTAGEM)) { t.skip('fixture ainda não existe'); return; }
  const casos = casosDaFixture(JSON.parse(fs.readFileSync(FIXTURE_CONTAGEM, 'utf8')));
  assert.ok(casos.length > 0, 'a fixture tem casos');
  for (const c of casos) {
    const r = contar(c.texto);
    for (const campo of [...CAMPOS, 'readingMinutes']) {
      if (campo in c.esperado) assert.equal(r[campo], c.esperado[campo], `${c.nome}: ${campo}`);
    }
  }
});

// ---------------------------------------------------------------------------
test('ABI do fuzzy.wasm', () => {
  for (const nome of ['memory', 'fz_buffer', 'fz_capacity', 'fz_distance', 'fz_rank']) assert.ok(nome in fz, nome);
  assert.ok(fz.fz_capacity() >= 65536);
});

const CASOS_DISTANCIA = [
  ['voce', 'você', 300], ['nao', 'não', 300], ['acao', 'ação', 600], ['ACAO', 'ação', 600],
  ['casa', 'casa', 0], ['Casa', 'casa', 0], ['casa', 'xasa', 700], ['q', 'a', 700], ['l', 'ç', 700],
  ['casa', 'csaa', 1000], ['teste', 'tetse', 1000], ['gato', 'pato', 1000], ['casa', 'casas', 1000],
  ['cansado', 'cançado', 1000], ['', 'abc', 3000], ['abc', '', 3000], ['', '', 0],
  ['agua', 'água', 300], ['pao', 'pão', 300], ['coracao', 'coração', 600], ['pinguim', 'pingüim', 300],
];

test('distância Damerau-Levenshtein ponderada', () => {
  for (const [a, b, d] of CASOS_DISTANCIA) {
    assert.equal(distancia(a, b), d, `${a} × ${b}`);
    assert.equal(distancia(b, a), d, `${b} × ${a} (simétrica)`);
  }
});

test('fz_rank ordena por distância e mantém a ordem original no empate', () => {
  assert.deepEqual(ordenar('voce', ['vice', 'você', 'voe', 'doce']), [1, 0, 2, 3]);
  assert.deepEqual(ordenar('nao', ['ano', 'no', 'não', 'na']), [2, 0, 1, 3]);
  assert.deepEqual(ordenar('abc', []), []);
});
