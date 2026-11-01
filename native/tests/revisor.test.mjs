// revisor.test.mjs — testes do CLI `revisor` (C++) contra casos próprios e tests/fixtures/ortografia.json.
// Copyright (©) 2026 Clara Portes
// Rodar da raiz: node --test native/tests/revisor.test.mjs (ou bash native/tests/revisor-test.sh)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXE = path.join(RAIZ, 'native', 'build', process.platform === 'win32' ? 'revisor.exe' : 'revisor');
const DIC = path.join(RAIZ, 'web', 'dicionario', 'pt-BR.dic');
const FIXTURE = path.join(RAIZ, 'tests', 'fixtures', 'ortografia.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'revisor-teste-'));
const existe = fs.existsSync(EXE);

// Revisa vários textos de uma vez (o dicionário é carregado uma vez só).
function revisar(textos, pessoal = []) {
  const args = ['--json', '--dic', DIC];
  if (pessoal.length) {
    const p = path.join(TMP, `pessoal-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(p, pessoal.join('\n') + '\n');
    args.push('--pessoal', p);
  }
  const arquivos = textos.map((t, i) => {
    const f = path.join(TMP, `caso-${i}-${Math.random().toString(36).slice(2)}.txt`);
    fs.writeFileSync(f, t);
    return f;
  });
  const r = spawnSync(EXE, [...args, ...arquivos], { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.ok(r.status === 0 || r.status === 1, `revisor saiu com ${r.status}: ${r.stderr}`);
  const saida = JSON.parse(r.stdout);
  return (Array.isArray(saida) ? saida : [saida]).map((x) => x.spelling);
}

const opcoes = { skip: existe ? false : 'native/build/revisor não compilado (rode scripts/build-native.sh)' };

test('revisor — palavras corretas não são marcadas', opcoes, () => {
  const [erros] = revisar(['Você não sabe o que é casa. Eu andava pela rua e corri muito. Refazendo, desfeito, ' +
    'guarda-chuva, d’água, d\'água. Os EUA e a ONU. CASA Casa Brasil. Andávamos depressa; caminhávamos.']);
  assert.deepEqual(erros.map((e) => e.word), []);
});

test('revisor — erros, offsets UTF-16 e sugestões', opcoes, () => {
  const [a, b, c, d] = revisar(['voce nao caza', '𝔸 voce', 'Voce disse VOCES (VOCE é sigla)', 'Visite www.exemplo.com/xyzq ou ' +
    'mande para qwzx@exemplo.com o código abc123 e kkk2.']);
  assert.deepEqual(a.map((e) => [e.word, e.start, e.end]), [['voce', 0, 4], ['nao', 5, 8], ['caza', 9, 13]]);
  assert.equal(a[0].suggestions[0], 'você');
  assert.equal(a[1].suggestions[0], 'não');
  assert.ok(a[2].suggestions.includes('casa'));
  assert.ok(a.every((e) => e.suggestions.length <= 6));
  assert.deepEqual(b.map((e) => [e.word, e.start, e.end, e.column]), [['voce', 3, 7, 3]]);
  assert.equal(c[0].suggestions[0], 'Você');
  assert.equal(c[1].suggestions[0], 'VOCÊS');
  assert.equal(c.length, 2, 'até 4 maiúsculas é sigla');
  assert.deepEqual(d, [], 'URLs, e-mails e tokens com dígito são ignorados');
});

test('revisor — dicionário pessoal (sem diferenciar maiúsculas)', opcoes, () => {
  const texto = 'Zorbanex chegou cedo.';
  assert.equal(revisar([texto])[0].length, 1);
  assert.equal(revisar([texto], ['zorbanex'])[0].length, 0);
});

test('revisor — carrega o dicionário em menos de 2 s', opcoes, () => {
  const f = path.join(TMP, 'vazio.txt');
  fs.writeFileSync(f, 'casa\n');
  const t0 = process.hrtime.bigint();
  const r = spawnSync(EXE, ['--dic', DIC, f], { encoding: 'utf8' });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(r.status, 0, r.stderr);
  assert.ok(ms < 2000, `levou ${ms.toFixed(0)} ms`);
});

// ---------------------------------------------------------------------------
// Fixture compartilhada (formato flexível: lista de casos com texto + erros esperados,
// ou de palavras com "correct"/"ok" e sugestões esperadas).
function normalizar(json) {
  const lista = Array.isArray(json) ? json : (json.cases ?? json.casos ?? json.check ?? json.spelling ?? []);
  return lista.map((c, i) => {
    const esperado = c.expected ?? c.esperado ?? c;
    return {
      nome: c.name ?? c.nome ?? c.id ?? c.text ?? c.texto ?? c.word ?? c.palavra ?? `caso ${i}`,
      texto: c.text ?? c.texto ?? c.input ?? c.word ?? c.palavra,
      palavra: c.word ?? c.palavra,
      pessoal: c.personal ?? c.pessoal ?? c.dictionary ?? [],
      erros: Array.isArray(esperado) ? esperado : (esperado.spelling ?? esperado.erros ?? esperado.misspellings),
      correta: esperado.correct ?? esperado.ok ?? esperado.valid ?? esperado.correta,
      sugestoes: esperado.suggestions ?? esperado.sugestoes,
      primeira: esperado.firstSuggestion ?? esperado.primeiraSugestao,
      contem: esperado.suggestionsInclude ?? esperado.sugestoesIncluem ?? esperado.contains,
    };
  }).filter((c) => typeof c.texto === 'string');
}

test('revisor — tests/fixtures/ortografia.json', { skip: !existe ? opcoes.skip : (!fs.existsSync(FIXTURE) && 'fixture ainda não existe') }, () => {
  const casos = normalizar(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
  assert.ok(casos.length > 0, 'a fixture tem casos');
  const grupos = new Map();
  for (const c of casos) {
    const k = JSON.stringify(c.pessoal);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(c);
  }
  for (const [k, lista] of grupos) {
    const res = revisar(lista.map((c) => c.texto), JSON.parse(k));
    lista.forEach((c, i) => {
      const obtidos = res[i];
      if (Array.isArray(c.erros)) {
        assert.deepEqual(obtidos.map((e) => [e.word, e.start, e.end]),
          c.erros.map((e) => [e.word, e.start, e.end]), `${c.nome}: erros`);
        c.erros.forEach((e, j) => {
          if (Array.isArray(e.suggestions)) assert.deepEqual(obtidos[j].suggestions, e.suggestions, `${c.nome}: sugestões de ${e.word}`);
          if (Array.isArray(e.suggestionsInclude)) for (const s of e.suggestionsInclude) assert.ok(obtidos[j].suggestions.includes(s), `${c.nome}: ${s}`);
        });
      }
      if (typeof c.correta === 'boolean') {
        assert.equal(obtidos.length === 0, c.correta, `${c.nome}: correta=${c.correta}`);
      }
      const sug = obtidos[0]?.suggestions ?? [];
      if (Array.isArray(c.sugestoes) && !Array.isArray(c.erros)) assert.deepEqual(sug, c.sugestoes, `${c.nome}: sugestões`);
      if (typeof c.primeira === 'string') assert.equal(sug[0], c.primeira, `${c.nome}: primeira sugestão`);
      if (Array.isArray(c.contem)) for (const s of c.contem) assert.ok(sug.includes(s), `${c.nome}: sugere ${s}`);
    });
  }
});
