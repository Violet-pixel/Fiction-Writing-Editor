// Testes do núcleo em JavaScript, inclusive as fixtures de paridade com o Java, o C e o C++.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countText, countWords, isDialogue, spellTokens } from '../../web/js/core/texto.js';
import { Speller, weightedDistance } from '../../web/js/core/ortografia.js';
import { IdeaEngine } from '../../web/js/core/ideias.js';
import { toWattpad, toAO3, toText, projectToDocx, projectToEpub, docxToHtml, docxXmlToHtml } from '../../web/js/core/exportar.js';
import { sanitizeHtml, plainTextFromHtml, applyTextStyles } from '../../web/js/core/html.js';
import { crc32, makeZip } from '../../web/js/core/zip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const fixture = (name) => {
  const p = path.join(root, 'tests/fixtures', name);
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  return Array.isArray(data) ? data : data.casos || data.cases || [];
};
let speller = null;
const getSpeller = () => {
  speller ??= new Speller(read('web/dicionario/pt-BR.aff'), read('web/dicionario/pt-BR.dic'));
  return speller;
};
const engine = new IdeaEngine(JSON.parse(read('web/dados/regras.json')), JSON.parse(read('web/dados/verbos.json')));

test('contagem básica', () => {
  const s = countText('— Olá, tudo bem?\nEla respondeu... Sim! E foi embora');
  assert.equal(s.words, 9);
  assert.equal(s.paragraphs, 2);
  assert.equal(s.dialogues, 1);
  assert.equal(s.sentences, 4);
  assert.equal(countWords('guarda-chuva d’água 3,5 — ... —Olá'), 4);
  assert.equal(countText('').words, 0);
  assert.equal(countText('   \n  ').paragraphs, 0);
});

test('fixtures de contagem (paridade)', (t) => {
  const cases = fixture('contagem.json');
  if (!cases) return t.skip('tests/fixtures/contagem.json ausente');
  for (const c of cases) {
    const got = countText(c.text ?? c.texto);
    const exp = c.expected ?? c.esperado;
    for (const k of Object.keys(exp)) assert.equal(got[k], exp[k], `${k} em ${JSON.stringify(c.text ?? c.texto)}`);
  }
});

test('falas', () => {
  for (const s of ['— Oi', '– Oi', '- Oi', '“Oi”', '"Oi"', '«Oi»', '  — Oi']) assert.ok(isDialogue(s), s);
  for (const s of ['Oi', '-Oi', '', 'Ela disse — oi']) assert.ok(!isDialogue(s), s);
});

test('corretor: palavras certas e erradas', () => {
  const sp = getSpeller();
  for (const w of ['caminhava', 'escrevêramos', 'guarda-chuva', 'você', 'rapidamente', 'disse-lhe', 'Brasil', 'CASA']) assert.ok(sp.check(w), w);
  for (const w of ['voce', 'nao', 'cachoro', 'excessão', 'paralizar']) assert.ok(!sp.check(w), w);
  assert.equal(sp.suggest('voce')[0], 'você');
  assert.equal(sp.suggest('Cachoro')[0], 'Cachorro');
  assert.equal(sp.suggest('paralizar')[0], 'paralisar');
  sp.setPersonal(['Hogwarts']);
  assert.ok(sp.check('hogwarts'));
});

test('fixtures de ortografia (paridade)', (t) => {
  const cases = fixture('ortografia.json');
  if (!cases) return t.skip('tests/fixtures/ortografia.json ausente');
  const sp = getSpeller();
  sp.setPersonal([]);
  for (const c of cases) {
    sp.setPersonal(c.personal ?? c.pessoal ?? []);
    const text = c.text ?? c.texto;
    const wrong = spellTokens(text).filter((tk) => !sp.check(tk.word)).map((tk) => tk.word);
    const exp = c.misspelled ?? c.expected ?? c.erradas ?? c.esperado;
    assert.deepEqual(wrong, exp.map((e) => (typeof e === 'string' ? e : e.word)), text);
  }
});

test('distância ponderada', () => {
  assert.ok(weightedDistance('voce', 'você', getSpeller()) < 0.5);
  assert.equal(weightedDistance('casa', 'casa'), 0);
  assert.equal(weightedDistance('ab', 'ba'), 1);
});

test('ideias: tempo verbal, concordância e regras', () => {
  const ids = (t) => engine.analyze(t).map((i) => i.rule);
  assert.ok(ids('Ela caminhava pelo quarto e vê as páginas.').includes('tempo-verbal-frase'));
  assert.ok(!ids('— Eu vejo tudo — disse ela.').includes('tempo-verbal-frase'));
  assert.ok(ids('Eles foi embora cedo.').includes('concordancia-pronome'));
  assert.ok(ids('Ela subiu para cima da mesa.').some((r) => r.includes('subir') || r.includes('pleonasmo')));
  assert.ok(ids('Ele disse que que não iria.').includes('palavra-repetida'));
  assert.deepEqual(ids('A chuva caía e o vento trazia o cheiro da terra.'), []);
  const sug = engine.analyze('Ela caminhava e vê o mar.').find((i) => i.rule === 'tempo-verbal-frase');
  assert.equal(sug.suggestion, 'viu');
});

test('fixtures de ideias (paridade)', (t) => {
  const cases = fixture('ideias.json');
  if (!cases) return t.skip('tests/fixtures/ideias.json ausente');
  for (const c of cases) {
    const text = c.text ?? c.texto;
    const got = engine.analyze(text).map((i) => ({ rule: i.rule, start: i.start, end: i.end }));
    const exp = (c.expected ?? c.esperado).map((i) => ({ rule: i.rule, start: i.start, end: i.end }));
    assert.deepEqual(got, exp, text);
  }
});

test('exportação Wattpad e AO3', () => {
  const html = '<p>Era noite.</p><p>— Oi — disse ela.</p><p>— Oi.</p><p>Ele <strong>riu</strong>.</p><hr class="cena"><p style="text-align: center">Fim</p>';
  assert.equal(toWattpad(html), ['<p>Era noite.</p>', '<p>&nbsp;</p>', '<p>— Oi — disse ela.</p>', '<p>— Oi.</p>', '<p>&nbsp;</p>',
    '<p>Ele <b>riu</b>.</p>', '<p style="text-align:center">* * *</p>', '<p style="text-align:center">Fim</p>'].join('\n'));
  assert.equal(toAO3(html), ['<p>Era noite.</p>', '<p>&nbsp;</p>', '<p>— Oi — disse ela.</p>', '<p>— Oi.</p>',
    '<p>Ele <strong>riu</strong>.</p>', '<hr />', '<p align="center">Fim</p>'].join('\n'));
  assert.equal(toText(html), 'Era noite.\n\n— Oi — disse ela.\n\n— Oi.\n\nEle riu.\n\n* * *\n\nFim');
});

test('fixtures de exportação (paridade)', (t) => {
  const cases = fixture('exportacao.json');
  if (!cases) return t.skip('tests/fixtures/exportacao.json ausente');
  const fns = { wattpad: toWattpad, ao3: toAO3, txt: toText, text: toText };
  for (const c of cases) {
    assert.equal(fns[c.format](c.html, c.options || {}), c.expected, `${c.format}: ${c.html}`);
  }
});

test('sanitizador', () => {
  const dirty = '<p onclick="x()">Oi<script>alert(1)</script> <a href="javascript:alert(1)">link</a><img src="x" onerror="y"></p><style>p{}</style>';
  const clean = sanitizeHtml(dirty);
  assert.ok(!/script|onclick|onerror|javascript:|<style/i.test(clean), clean);
  assert.equal(plainTextFromHtml('<p>Um</p><p>— Dois</p>'), 'Um\n— Dois');
});

test('docx e epub são ZIP válidos', () => {
  const project = { id: 'x', title: 'Teste', settings: {}, chapters: [{ id: 'a', title: 'Um', position: 0, html: '<p>Olá <em>mundo</em></p>' }] };
  const docx = projectToDocx(project);
  assert.equal(docx[0], 0x50);
  assert.equal(docx[1], 0x4b);
  const epub = projectToEpub(project);
  assert.equal(new TextDecoder().decode(epub.subarray(30, 38)), 'mimetype');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.ok(makeZip([{ name: 'a.txt', data: 'a' }]).length > 0);
});

test('estilos de texto: o sanitizador mantém e a exportação converte', () => {
  const html = sanitizeHtml('<p class="estilo-pensamento fala">Será?</p><p class="estilo-mensagem">oi</p><p class="estilo-carta">Querida,</p><p class="estilo-inventado">x</p>');
  assert.equal(html, '<p class="estilo-pensamento">Será?</p><p class="estilo-mensagem">oi</p><p class="estilo-carta">Querida,</p><p>x</p>');
  const out = applyTextStyles(html);
  assert.equal(out, '<p><em>Será?</em></p><p style="text-align: center"><b>oi</b></p><blockquote><p>Querida,</p></blockquote><p>x</p>');
  assert.match(toAO3(out), /<em>Será\?<\/em>/);
  assert.match(toWattpad(out), /<b>oi<\/b>/);
});

test('importação de .docx: lê as tags com prefixo w: do Word', async () => {
  const xml = '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Capítulo 1</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t xml:space="preserve">A chuva caía </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>forte</w:t></w:r><w:r><w:t>.</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>* * *</w:t></w:r></w:p><w:p><w:r><w:t>— Vem? — disse ela.</w:t></w:r></w:p></w:body></w:document>';
  assert.equal(docxXmlToHtml(xml), '<h1>Capítulo 1</h1><p>A chuva caía <strong>forte</strong>.</p><hr class="cena"><p>— Vem? — disse ela.</p>');
  const project = { title: 'T', settings: {}, chapters: [{ id: 'c1', title: 'Um', position: 0, html: '<p>Olá, <em>mundo</em>.</p><p>— Tudo bem?</p>' }] };
  const html = await docxToHtml(projectToDocx(project, 'c1'));
  assert.match(html, /Olá, <em>mundo<\/em>\./);
  assert.match(html, /— Tudo bem\?/);
});
