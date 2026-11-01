#!/usr/bin/env node
/*
 * Serifa — gera os PDFs de documentação a partir de docs/pdf-src/*.html.
 * Copyright (©) 2026 Clara Portes
 *
 * Uso (na raiz do projeto):
 *   node scripts/build-pdfs.js            gera os dois PDFs
 *   node scripts/build-pdfs.js banco      só o Banco-de-Dados-Serifa.pdf
 *   node scripts/build-pdfs.js manual     só o Manual-Serifa.pdf
 *
 * Precisa do Playwright com o Chromium (require('playwright')). Nenhum pacote novo.
 * Também roda com: npm run build:pdfs
 * As capturas de tela são lidas de docs/images (arquivos tela-*.png); as que não
 * existirem são simplesmente omitidas. Legendas opcionais em docs/images/legendas.json
 * ({"tela-principal.png": "Legenda"}).
 * Saídas: PDFs na raiz do projeto e cópias em docs/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// O projeto é ES module ("type": "module"); o Playwright é carregado com require() para
// também achar instalações globais (NODE_PATH).
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (err) {
  console.error('Não encontrei o Playwright. Instale-o (npm i -D playwright && npx playwright install chromium)');
  console.error('ou rode com NODE_PATH apontando para uma instalação existente.');
  process.exit(1);
}

const RAIZ = path.resolve(__dirname, '..');
const FONTES = path.join(RAIZ, 'docs', 'pdf-src');
const IMAGENS = path.join(RAIZ, 'docs', 'images');
const DOCS = path.join(RAIZ, 'docs');

const DOCUMENTOS = [
  { chave: 'banco', fonte: 'banco-de-dados.html', saida: 'Banco-de-Dados-Serifa.pdf' },
  { chave: 'manual', fonte: 'manual.html', saida: 'Manual-Serifa.pdf' },
];

function listarImagens() {
  try {
    return fs.readdirSync(IMAGENS).filter((n) => /\.(png|jpe?g|webp)$/i.test(n)).sort();
  } catch (_) {
    return [];
  }
}

function lerLegendas() {
  const arq = path.join(IMAGENS, 'legendas.json');
  try {
    const dados = JSON.parse(fs.readFileSync(arq, 'utf8'));
    return dados && typeof dados === 'object' ? dados : {};
  } catch (_) {
    return {};
  }
}

async function gerar(browser, doc, imagens, legendas) {
  const arquivo = path.join(FONTES, doc.fonte);
  if (!fs.existsSync(arquivo)) throw new Error('Fonte não encontrada: docs/pdf-src/' + doc.fonte);

  const context = await browser.newContext({ viewport: { width: 900, height: 1200 }, locale: 'pt-BR' });
  const page = await context.newPage();
  const avisos = [];
  page.on('pageerror', (e) => avisos.push(String(e)));
  await page.emulateMedia({ media: 'print' });
  await page.addInitScript(({ imagens, legendas }) => {
    window.__SERIFA_IMAGENS__ = imagens;
    window.__SERIFA_LEGENDAS__ = legendas;
  }, { imagens, legendas });

  await page.goto(pathToFileURL(arquivo).href, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.pronto === '1', null, { timeout: 180000 });
  const erro = await page.evaluate(() => document.body.dataset.erro || '');
  if (erro) throw new Error('Falha na paginação de ' + doc.fonte + ':\n' + erro);
  const info = await page.evaluate(() => ({
    paginas: Number(document.body.dataset.paginas || 0),
    figuras: document.querySelectorAll('figure.tela img').length,
  }));

  const opcoes = {
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  };
  let pdf;
  try {
    pdf = await page.pdf({ ...opcoes, outline: true, tagged: true });
  } catch (_) {
    pdf = await page.pdf(opcoes); // versões antigas do Playwright não têm outline/tagged
  }
  await context.close();

  fs.writeFileSync(path.join(RAIZ, doc.saida), pdf);
  fs.writeFileSync(path.join(DOCS, doc.saida), pdf);
  avisos.forEach((a) => console.warn('  aviso: ' + a));
  console.log(`${doc.saida}: ${info.paginas} páginas, ${info.figuras} capturas de tela, ${(pdf.length / 1024).toFixed(0)} KB`);
  return info;
}

async function main() {
  const filtro = process.argv.slice(2).map((a) => a.toLowerCase());
  const alvos = filtro.length ? DOCUMENTOS.filter((d) => filtro.includes(d.chave)) : DOCUMENTOS;
  if (!alvos.length) {
    console.error('Use: node scripts/build-pdfs.js [banco] [manual]');
    process.exit(2);
  }
  const imagens = listarImagens();
  const legendas = lerLegendas();
  const browser = await chromium.launch();
  try {
    for (const doc of alvos) await gerar(browser, doc, imagens, legendas);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
