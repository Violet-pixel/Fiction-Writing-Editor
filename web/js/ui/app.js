// Serifa: aplicação principal (faixa de opções, capítulos, contador, revisão, exportação e armazenamento).
import { countTextFast, countText, loadTextStatsWasm, countWords, wasmReady } from '../core/texto.js';
import { toWattpad, toAO3, projectToText, projectToMarkdown, projectToHtml, projectToDocx, projectToEpub, PRESETS, pageGeometry, docxToHtml } from '../core/exportar.js';
import { textToHtml, sanitizeHtml, escapeText, applyTextStyles, TEXT_STYLES } from '../core/html.js';
import { makeZip } from '../core/zip.js';
import { Editor } from './editor.js';
import * as store from './storage.js';
import { dialog, toast, el, confirmBox, uiZoom } from './dialogs.js';
import { showFontPicker, closeFontPicker, fontStack, ALL_FONTS } from './fontes.js';
import { startTutorial, isTutorialOpen } from './tutorial.js';
import * as desk from './desktop.js';

const VERSION = '1.0.0';
const $ = (id) => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const today = () => new Date().toISOString().slice(0, 10);
const fmt = (n) => n.toLocaleString('pt-BR');

const DEFAULT_SETTINGS = {
  formatMode: 'livro', pageSize: 'a4', orientation: 'retrato', margins: 'normal', paper: 'branca', fontFamily: 'Georgia',
  fontSize: 12, lineHeight: 1.5, firstLineIndent: true, dailyGoal: 1000, sceneBreak: '* * *',
  blankBeforeDialogue: false, blankAfterDialogue: false, blankBetweenParagraphs: false,
};

const state = {
  project: null,
  chapterId: null,
  prefs: { theme: 'light', spell: true, ideas: true, categories: null, zoom: 100, autoDash: true, smartQuotes: true,
    autoEllipsis: true, typewriter: false, showChapters: true, darkPaper: true, welcomed: false, tutorialDone: false, uiScale: 0, exportScope: 'chapter' },
  dirty: false,
  spelling: [],
  ideas: [],
  ignoredWords: new Set(),
  sessionStart: null,
  dayRow: null,
  fileHandle: null,
  server: false,
  checkSeq: 0,
};

let editor;
let worker = null;
let workerReady = false;
const pending = new Map();

// ---------------------------------------------------------------- inicialização
async function main() {
  editor = new Editor($('editor'), { onChange: onEditorChange });
  const saved = await store.getPref('prefs', null);
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(state.prefs)) if (typeof saved[k] === typeof state.prefs[k] || (k === 'categories' && Array.isArray(saved[k]))) state.prefs[k] = saved[k];
  }
  applyUiScale();
  if (!saved && window.innerWidth < 760) state.prefs.zoom = Math.max(50, Math.floor(((window.innerWidth - 32) / 794) * 10) * 10);
  applyTheme();
  bindRibbon();
  bindChapters();
  bindStatus();
  bindKeys();
  bindFind();
  loadTextStatsWasm(new URL('../../wasm/textstats.wasm', import.meta.url)).then(() => updateCounts());
  startWorker();
  const di = await desk.detectDesktop();
  if (di) {
    document.body.classList.add('desktop');
    $('storageBadge').textContent = 'Serifa para Windows';
    $('storageBadge').title = `As histórias são salvas em ${di.base}`;
  } else detectServer();
  renderConfig();

  const lastId = await store.getPref('lastProject', null);
  let project = lastId ? await store.loadProject(lastId) : null;
  if (!project) {
    const list = await store.listProjects();
    project = list.length ? await store.loadProject(list[0].id) : null;
  }
  if (!project) {
    project = sampleProject();
    await store.saveProject(project);
  }
  await openProject(project);
  if (!state.prefs.tutorialDone) setTimeout(showTutorial, 350);
  window.addEventListener('beforeunload', (e) => {
    if (desk.isDesktop()) {
      if (state.dirty) {
        syncChapter();
        const di = desk.desktopInfo();
        if (di.salvarAuto) desk.beaconSave(storyFolder(), `${safeName(state.project.title)}.serifa`, new Blob([serifaJson()], { type: 'application/json' }));
        saveNow();
      }
      return;
    }
    if (state.dirty) {
      saveNow();
      e.preventDefault();
    }
  });
  setInterval(() => {
    if (state.dirty) saveNow();
  }, desk.isDesktop() ? 2500 : 4000);
}

function newChapterDoc(title, position, html = '<p><br></p>') {
  const now = new Date().toISOString();
  return { id: uid(), title, position, html, notes: '', summary: '', pov: '', goal: 0, status: 'rascunho', words: 0, createdAt: now, updatedAt: now };
}

function sampleProject() {
  const now = new Date().toISOString();
  const html1 = [
    '<p>A chuva caía sobre a cidade quando Helena abriu a janela do sótão. O vento trazia o cheiro de terra molhada e de pão saindo do forno.</p>',
    '<p>— Você vai ficar aí a noite toda? — perguntou Tomás, encostado na porta.</p>',
    '<p>— Só até terminar este capítulo — respondeu ela, sem tirar os olhos do caderno.</p>',
    '<p class="estilo-pensamento">Ele nunca vai entender por que essas cartas importam tanto.</p>',
    '<p>Ela caminhava pelo quarto e vê as páginas espalhadas pelo chão. Haviam muitas ideias ali, mas nenhuma parecia certa. Subiu para cima da cadeira e pegou a caixa de cartas antigas.</p>',
    '<hr class="cena">',
    '<p>Na manhã seguinte, a casa estava em silêncio. Helena desceu as escadas devagar, com a caixa debaixo do braço, e encontrou um bilhete sobre a mesa:</p>',
    '<p class="estilo-carta">Fui buscar o café. Não leia as cartas sem mim. — T.</p>',
    '<p>Lá fora, o cachoro do vizinho latiu duas vezes. Ela sorriu. Era tarde demais para isso.</p>',
  ].join('');
  const html2 = [
    '<p class="estilo-nota">Obrigada por ler até aqui! Este capítulo é curtinho, mas prometo que o próximo compensa.</p>',
    '<p>O celular vibrou em cima da caixa de cartas.</p>',
    '<p class="estilo-mensagem">Tomás: já tô voltando, guarda um pão pra mim</p>',
    '<p class="estilo-mensagem">Helena: tarde demais, já abri a primeira carta</p>',
    '<p class="estilo-flashback">Dez anos antes, a avó tinha escondido aquela mesma caixa no fundo do armário, dizendo que algumas histórias precisavam esperar.</p>',
    '<p>Helena respirou fundo e desdobrou o papel amarelado.</p>',
  ].join('');
  const c1 = { ...newChapterDoc('Capítulo 1 — As cartas', 0, html1), notes: 'Exemplo: apague ou reescreva à vontade.', summary: 'Helena encontra a caixa de cartas da avó.', pov: 'Helena' };
  const c2 = { ...newChapterDoc('Capítulo 2 — A primeira carta', 1, html2), summary: 'Mensagens com Tomás e a lembrança da avó.', pov: 'Helena' };
  return {
    format: 'serifa', version: 1, id: uid(), title: 'Minha história', description: 'Uma história de exemplo para você explorar o Serifa. Edite, apague ou crie a sua em “Minhas histórias”.',
    author: '', language: 'pt-BR', createdAt: now, updatedAt: now,
    settings: { ...DEFAULT_SETTINGS },
    chapters: [c1, c2],
    dictionary: [], ignored: [],
  };
}

function newProjectDoc(title, description = '') {
  const now = new Date().toISOString();
  return {
    format: 'serifa', version: 1, id: uid(), title: title || 'Nova história', description, author: '', language: 'pt-BR', createdAt: now, updatedAt: now,
    settings: { ...DEFAULT_SETTINGS }, chapters: [newChapterDoc('Capítulo 1', 0)],
    dictionary: [], ignored: [],
  };
}

/** Valida e completa um documento .serifa vindo de arquivo ou do armazenamento. */
function normalizeProject(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.chapters)) throw new Error('Este arquivo não é um projeto do Serifa.');
  const now = new Date().toISOString();
  const p = {
    format: 'serifa', version: 1, id: typeof doc.id === 'string' && doc.id ? doc.id.slice(0, 64) : uid(),
    title: String(doc.title || 'Sem título').slice(0, 200), description: String(doc.description || '').slice(0, 2000),
    folder: String(doc.folder || '').slice(0, 120),
    author: String(doc.author || '').slice(0, 120), language: 'pt-BR',
    createdAt: doc.createdAt || now, updatedAt: doc.updatedAt || now,
    settings: { ...DEFAULT_SETTINGS }, chapters: [], dictionary: Array.isArray(doc.dictionary) ? doc.dictionary.filter((w) => typeof w === 'string').slice(0, 5000) : [],
    ignored: Array.isArray(doc.ignored) ? doc.ignored.filter((w) => typeof w === 'string').slice(0, 5000) : [],
  };
  const s = doc.settings || {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof s[k] === typeof DEFAULT_SETTINGS[k]) p.settings[k] = s[k];
  }
  if (!['livro', 'wattpad', 'ao3'].includes(p.settings.formatMode)) p.settings.formatMode = 'livro';
  doc.chapters.slice(0, 2000).forEach((c, i) => {
    p.chapters.push({
      id: typeof c.id === 'string' && c.id ? c.id.slice(0, 64) : uid(), title: String(c.title || `Capítulo ${i + 1}`).slice(0, 200), position: i,
      html: sanitizeHtml(String(c.html || '')), notes: String(c.notes || '').slice(0, 20000),
      summary: String(c.summary || '').slice(0, 2000), pov: String(c.pov || '').slice(0, 120), goal: Math.max(0, Math.min(1000000, Number(c.goal) || 0)),
      status: ['rascunho', 'revisao', 'pronto'].includes(c.status) ? c.status : 'rascunho', words: Number(c.words) || 0,
      createdAt: c.createdAt || c.updatedAt || now, updatedAt: c.updatedAt || now,
    });
  });
  if (!p.chapters.length) p.chapters.push(newChapterDoc('Capítulo 1', 0));
  return p;
}

async function openProject(project) {
  if (state.project && state.dirty) await saveNow();
  state.project = normalizeProject(project);
  state.fileHandle = null;
  state.ignoredWords = new Set();
  const personal = await store.listPersonal();
  sendWorker({ type: 'personal', words: [...personal, ...state.project.dictionary] });
  await store.setPref('lastProject', state.project.id);
  $('docTitle').value = state.project.title;
  document.title = `${state.project.title} · Serifa`;
  renderStoryHead();
  for (const c of state.project.chapters) c.words = countWords(textOfHtml(c.html));
  state.sessionStart = totalWords();
  await initDay();
  applySettings();
  selectChapter(state.project.chapters[0].id, true);
  renderChapters();
}

function textOfHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = sanitizeHtml(html);
  const parts = [];
  tmp.querySelectorAll('p,h1,h2,h3,blockquote,li,td').forEach((b) => {
    if (!b.querySelector('p,li')) parts.push(b.textContent);
  });
  return parts.join('\n');
}

function currentChapter() {
  return state.project.chapters.find((c) => c.id === state.chapterId);
}

function selectChapter(id, skipSave) {
  if (!skipSave) syncChapter();
  const ch = state.project.chapters.find((c) => c.id === id);
  if (!ch) return;
  state.chapterId = id;
  $('chapterTitle').textContent = ch.title;
  editor.setHtml(ch.html);
  $('chapterNotes').value = ch.notes || '';
  reflectStatus();
  state.spelling = [];
  state.ideas = [];
  editor.clearHighlights('serifa-erro');
  editor.clearHighlights('serifa-ideia');
  renderBulbs();
  renderChapters();
  updateCounts();
  scheduleCheck(50);
  $('desk').scrollTop = 0;
  if (!$('draftPanel').hidden) renderDraftPanel();
}

/** Copia o conteúdo da folha para o capítulo atual. */
function syncChapter() {
  const ch = currentChapter();
  if (!ch) return;
  ch.html = editor.getHtml();
  ch.title = $('chapterTitle').textContent.trim() || ch.title;
  ch.notes = $('chapterNotes').value;
  ch.words = countWords(editor.text);
  ch.updatedAt = new Date().toISOString();
}

function markDirty() {
  state.dirty = true;
  $('saveState').textContent = 'Alterações não salvas';
}

let saving = null;
async function saveNow(reason) {
  if (!state.project) return;
  if (saving) await saving;
  syncChapter();
  state.project.updatedAt = new Date().toISOString();
  state.project.title = $('docTitle').value.trim() || 'Sem título';
  state.project.words = totalWords();
  state.project.chapterCount = state.project.chapters.length;
  const doc = { ...state.project };
  saving = (async () => {
    try {
      await store.saveProject(state.project);
      if (reason) await store.addRevision(doc, reason);
      state.dirty = false;
      $('saveState').textContent = `Salvo às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
      if (state.server) syncServer(doc);
      if (desk.isDesktop() && desk.desktopInfo().salvarAuto) desktopAutosave();
      await updateDay();
    } catch (err) {
      $('saveState').textContent = 'Não foi possível salvar';
      toast(`Erro ao salvar: ${err.message}`);
    }
  })();
  await saving;
  saving = null;
}

let lastRevision = 0;
function onEditorChange() {
  markDirty();
  editor.refreshText();
  updateCounts();
  scheduleCheck();
  if (state.prefs.typewriter) typewriterScroll();
  if (Date.now() - lastRevision > 5 * 60 * 1000) {
    lastRevision = Date.now();
    setTimeout(() => saveNow('automático'), 1500);
  }
}

// ---------------------------------------------------------------- contador
function totalWords() {
  if (!state.project) return 0;
  let total = 0;
  for (const c of state.project.chapters) total += c.id === state.chapterId && editor ? countWords(editor.text) : (c.words || 0);
  return total;
}

let countTimer = null;
function updateCounts() {
  if (countTimer) return;
  countTimer = requestAnimationFrame(() => {
    countTimer = null;
    if (!state.project) return;
    const stats = wasmReady() ? countTextFast(editor.text) : countText(editor.text);
    const ch = currentChapter();
    if (ch) ch.words = stats.words;
    const total = totalWords();
    $('stWords').innerHTML = '';
    $('stWords').append(el('b', {}, fmt(stats.words)), ` palavras no capítulo · ${fmt(total)} na história`);
    $('stChars').textContent = `${fmt(stats.characters)} caracteres`;
    $('stRead').textContent = `${stats.readingMinutes} min de leitura`;
    const session = Math.max(0, total - (state.sessionStart ?? total));
    $('stSession').textContent = `Sessão: +${fmt(session)}`;
    const goal = state.project.settings.dailyGoal || 1000;
    const todayWords = state.dayRow ? Math.max(0, total - state.dayRow.palavrasInicio + (state.dayRow.acumulado || 0)) : 0;
    $('stGoal').textContent = `Hoje: ${fmt(todayWords)} / ${fmt(goal)}`;
    $('goalBar').max = goal;
    $('goalBar').value = Math.min(goal, todayWords);
    updatePages();
    const li = document.querySelector(`#chapterList li[data-id="${state.chapterId}"] .w`);
    if (li) li.textContent = `${fmt(stats.words)} palavras`;
    $('projectTotals').textContent = `${fmt(total)} palavras na história`;
    if (!$('draftPanel').hidden) updateDraftStats();
  });
}

function updateSelectionCount() {
  const sel = window.getSelection();
  const txt = sel && sel.rangeCount && $('editor').contains(sel.anchorNode) ? sel.toString() : '';
  const n = txt ? countWords(txt) : 0;
  $('stSel').hidden = n === 0;
  $('stSel').textContent = `${fmt(n)} selecionada(s)`;
}

function updatePages() {
  const sheet = $('sheet');
  const pageH = sheet.querySelector('.page-measure')?.offsetHeight || mmToPx(pageGeometry(state.project.settings).height);
  const ed = $('editor');
  const contentH = ed.offsetTop + ed.offsetHeight + mmToPx(pageGeometry(state.project.settings).bottom);
  const pages = Math.max(1, Math.ceil((contentH - 4) / pageH));
  sheet.style.minHeight = `${pages * pageH}px`;
  const sel = window.getSelection();
  let current = 1;
  if (sel.rangeCount && $('editor').contains(sel.anchorNode)) {
    const r = sel.getRangeAt(0).getClientRects()[0] || sel.anchorNode.parentElement?.getBoundingClientRect();
    if (r) current = Math.min(pages, Math.max(1, Math.floor((r.top - sheet.getBoundingClientRect().top) / (pageH * zoomFactor() * uiZoom())) + 1));
  }
  $('stPage').textContent = `Página ${current} de ${pages}`;
  const nums = sheet.querySelectorAll('.page-num');
  if (nums.length !== pages) {
    nums.forEach((n) => n.remove());
    for (let i = 1; i <= pages; i += 1) {
      const n = el('span', { class: 'page-num' }, String(i));
      n.style.top = `${i * pageH - 22}px`;
      sheet.append(n);
    }
  }
}

function mmToPx(mm) {
  return (mm * 96) / 25.4;
}

function zoomFactor() {
  return state.prefs.zoom / 100;
}

// ---------------------------------------------------------------- dia e meta
async function initDay() {
  const d = today();
  let row = await store.getDay(d);
  if (!row) {
    row = { dia: d, palavrasInicio: totalWords(), palavrasFim: totalWords(), acumulado: 0, projetoId: state.project.id };
    await store.putDay(row);
  }
  if (row.projetoId !== state.project.id) {
    // troca de projeto no mesmo dia: guarda o que já foi escrito e recomeça a base
    row.acumulado = Math.max(0, (row.palavrasFim || 0) - (row.palavrasInicio || 0)) + (row.acumulado || 0);
    row.palavrasInicio = totalWords();
    row.projetoId = state.project.id;
    await store.putDay(row);
  }
  state.dayRow = row;
}

async function updateDay() {
  if (!state.dayRow) return;
  if (state.dayRow.dia !== today()) {
    await initDay();
    return;
  }
  state.dayRow.palavrasFim = totalWords();
  await store.putDay(state.dayRow);
}

// ---------------------------------------------------------------- revisão (worker)
function startWorker() {
  try {
    worker = new Worker(new URL('../workers/revisor.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
    return;
  }
  worker.onmessage = (ev) => {
    const msg = ev.data;
    if (msg.type === 'ready') {
      workerReady = true;
      scheduleCheck(10);
    } else if (msg.type === 'result') {
      if (msg.id !== state.checkSeq) return;
      state.spelling = msg.spelling;
      state.ideas = msg.ideas.filter((i) => !isIgnoredIdea(i));
      paintIssues();
    } else if (msg.type === 'suggestions' || msg.type === 'error') {
      const cb = pending.get(msg.id);
      if (cb) {
        pending.delete(msg.id);
        cb(msg);
      }
    }
  };
  worker.onerror = () => {
    workerReady = false;
    $('stIssues').textContent = 'Revisão indisponível';
  };
  sendWorker({ type: 'init' });
}

function sendWorker(msg) {
  if (worker) worker.postMessage(msg);
}

let checkTimer = null;
function scheduleCheck(delay = 450) {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(runCheck, delay);
}

function runCheck() {
  if (!worker || !workerReady) return;
  if (!state.prefs.spell && !state.prefs.ideas) {
    paintIssues();
    return;
  }
  state.checkSeq += 1;
  sendWorker({ type: 'check', id: state.checkSeq, text: editor.text, spelling: state.prefs.spell, ideas: state.prefs.ideas,
    categories: state.prefs.categories, ignoredWords: [...state.ignoredWords] });
}

function ideaKey(idea, text = editor.text) {
  return `${idea.rule}:${text.slice(idea.start, idea.end).toLowerCase()}`;
}

function isIgnoredIdea(idea) {
  return state.project.ignored.includes(ideaKey(idea));
}

function paintIssues() {
  const spell = state.prefs.spell ? state.spelling : [];
  const ideas = state.prefs.ideas ? state.ideas : [];
  editor.setHighlights('serifa-erro', spell);
  editor.setHighlights('serifa-ideia', ideas);
  const parts = [];
  if (state.prefs.spell) parts.push(`${spell.length} erro(s)`);
  if (state.prefs.ideas) parts.push(`${ideas.length} ideia(s)`);
  $('stIssues').textContent = parts.join(' · ');
  renderBulbs();
}

// lâmpadas na margem
function renderBulbs() {
  const layer = $('ideasLayer');
  layer.textContent = '';
  hideBalloon();
  if (!state.prefs.ideas || !state.ideas.length) return;
  const wrap = $('sheetWrap').getBoundingClientRect();
  const sheet = $('sheet').getBoundingClientRect();
  const z = zoomFactor() * uiZoom();
  const groups = [];
  for (const idea of state.ideas) {
    const r = editor.rangeFor(idea.start, idea.end);
    const rect = r?.getClientRects()[0];
    if (!rect) continue;
    const top = (rect.top - wrap.top) / z;
    const g = groups.find((x) => Math.abs(x.top - top) < 18);
    if (g) g.items.push(idea);
    else groups.push({ top, items: [idea] });
  }
  for (const g of groups) {
    const b = el('button', { class: 'bulb', type: 'button', title: g.items[0].message, 'aria-label': 'Ideia de revisão' }, '💡');
    if (g.items.length > 1) b.append(el('span', { class: 'n' }, String(g.items.length)));
    b.style.top = `${g.top - 3}px`;
    b.style.left = `${(sheet.right - wrap.left) / z + 14}px`;
    b.addEventListener('mouseenter', () => editor.setHighlights('serifa-ideia-ativa', g.items));
    b.addEventListener('mouseleave', () => editor.clearHighlights('serifa-ideia-ativa'));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      showBalloon(g, b);
    });
    layer.append(b);
  }
}

const CATEGORY_NAMES = { 'tempo-verbal': 'Tempo verbal', concordancia: 'Concordância', pleonasmo: 'Pleonasmo', crase: 'Crase',
  sentido: 'Sentido', estilo: 'Estilo', ortografia: 'Grafia' };

function showBalloon(group, anchor) {
  const box = $('balloon');
  box.textContent = '';
  for (const idea of group.items) {
    const item = el('div', { class: 'item' });
    item.append(el('div', { class: 'cat' }, CATEGORY_NAMES[idea.category] || idea.category));
    item.append(el('div', { class: 'msg' }, idea.message));
    const acts = el('div', { class: 'acts' });
    if (idea.suggestion) {
      const apply = el('button', { class: 'btn primary', type: 'button' }, 'Trocar por ');
      apply.append(el('span', { class: 'sug' }, idea.suggestion));
      apply.addEventListener('click', () => {
        editor.replaceRange(idea.start, idea.end, idea.suggestion);
        hideBalloon();
      });
      acts.append(apply);
    }
    const ignore = el('button', { class: 'btn', type: 'button' }, 'Ignorar');
    ignore.addEventListener('click', () => {
      state.project.ignored.push(ideaKey(idea));
      state.ideas = state.ideas.filter((i) => i !== idea);
      markDirty();
      paintIssues();
    });
    const off = el('button', { class: 'btn', type: 'button', title: 'Desliga o balão de ideias (Shift+F7)' }, 'Desativar balões');
    off.addEventListener('click', () => toggleIdeas(false));
    acts.append(ignore, off);
    item.append(acts);
    box.append(item);
  }
  box.hidden = false;
  const wrap = $('sheetWrap');
  wrap.append(box);
  box.style.top = `${parseFloat(anchor.style.top) - 6}px`;
  box.style.left = `${parseFloat(anchor.style.left) + 36}px`;
  const rect = box.getBoundingClientRect();
  if (rect.right > window.innerWidth - 10) {
    box.style.left = `${parseFloat(anchor.style.left) - 310}px`;
  }
}

function hideBalloon() {
  $('balloon').hidden = true;
}

// menu de contexto com sugestões
function bindContextMenu() {
  $('editor').addEventListener('contextmenu', (e) => {
    const pos = editor.offsetFromPoint(e.clientX, e.clientY);
    if (pos < 0) return;
    const spell = state.prefs.spell ? state.spelling.find((s) => pos >= s.start && pos <= s.end) : null;
    const idea = state.prefs.ideas ? state.ideas.find((s) => pos >= s.start && pos <= s.end) : null;
    if (!spell && !idea) return;
    e.preventDefault();
    const menu = $('menu');
    menu.textContent = '';
    const item = (label, fn, cls) => {
      const b = el('button', { type: 'button', role: 'menuitem', class: cls || '' }, label);
      b.addEventListener('click', () => {
        hideMenu();
        fn();
      });
      menu.append(b);
      return b;
    };
    if (spell) {
      const loading = el('div', { class: 'note' }, 'Procurando sugestões…');
      menu.append(loading);
      const id = `s${Date.now()}${Math.random()}`;
      pending.set(id, (msg) => {
        loading.remove();
        const first = menu.firstChild;
        const frag = document.createDocumentFragment();
        if (!msg.list || !msg.list.length) frag.append(el('div', { class: 'note' }, 'Nenhuma sugestão'));
        for (const sug of msg.list || []) {
          const b = el('button', { type: 'button', role: 'menuitem', class: 'sug' }, sug);
          b.addEventListener('click', () => {
            hideMenu();
            editor.replaceRange(spell.start, spell.end, sug);
          });
          frag.append(b);
        }
        menu.insertBefore(frag, first);
      });
      sendWorker({ type: 'suggest', id, word: spell.word });
      menu.append(el('div', { class: 'sep' }));
      item(`Ignorar “${spell.word}”`, () => {
        state.ignoredWords.add(spell.word.toLowerCase());
        state.spelling = state.spelling.filter((s) => s.word.toLowerCase() !== spell.word.toLowerCase());
        paintIssues();
      });
      item('Adicionar ao dicionário', async () => {
        await store.addPersonal(spell.word);
        sendWorker({ type: 'personal', words: [...await store.listPersonal(), ...state.project.dictionary] });
        state.spelling = state.spelling.filter((s) => s.word.toLowerCase() !== spell.word.toLowerCase());
        paintIssues();
        toast(`“${spell.word}” foi para o dicionário pessoal.`);
      });
    }
    if (idea) {
      if (spell) menu.append(el('div', { class: 'sep' }));
      menu.append(el('div', { class: 'note' }, `💡 ${idea.message}`));
      if (idea.suggestion) item(`Trocar por “${idea.suggestion}”`, () => editor.replaceRange(idea.start, idea.end, idea.suggestion), 'sug');
      item('Ignorar esta ideia', () => {
        state.project.ignored.push(ideaKey(idea));
        state.ideas = state.ideas.filter((i) => i !== idea);
        markDirty();
        paintIssues();
      });
    }
    menu.append(el('div', { class: 'sep' }));
    item('Recortar', () => document.execCommand('cut'));
    item('Copiar', () => document.execCommand('copy'));
    menu.hidden = false;
    const w = 240;
    placeMenu(menu, e.clientX, e.clientY);
  });
  document.addEventListener('mousedown', (e) => {
    if (!$('menu').contains(e.target)) hideMenu();
    if (!$('balloon').contains(e.target) && !e.target.closest('.bulb')) hideBalloon();
  });
}

function placeMenu(menu, x, y) {
  const u = uiZoom();
  const w = menu.offsetWidth || 240;
  const h = menu.offsetHeight || 260;
  menu.style.left = `${Math.max(4, Math.min(x / u, window.innerWidth / u - w - 8))}px`;
  menu.style.top = `${Math.max(4, Math.min(y / u, window.innerHeight / u - h - 8))}px`;
}

function hideMenu() {
  $('menu').hidden = true;
}

function toggleSpell(force) {
  state.prefs.spell = typeof force === 'boolean' ? force : !state.prefs.spell;
  savePrefs();
  reflectToggles();
  if (state.prefs.spell) scheduleCheck(10);
  else paintIssues();
  toast(state.prefs.spell ? 'Corretor ortográfico ligado' : 'Corretor ortográfico desligado');
}

function toggleIdeas(force) {
  state.prefs.ideas = typeof force === 'boolean' ? force : !state.prefs.ideas;
  savePrefs();
  reflectToggles();
  if (state.prefs.ideas) scheduleCheck(10);
  else paintIssues();
  toast(state.prefs.ideas ? 'Balão de ideias ligado' : 'Balão de ideias desligado');
}

function reflectToggles() {
  for (const id of ['btnSpell', 'swSpell']) $(id).setAttribute('aria-pressed', String(state.prefs.spell));
  for (const id of ['btnIdeas', 'swIdeas']) $(id).setAttribute('aria-pressed', String(state.prefs.ideas));
  $('btnTypewriter').setAttribute('aria-pressed', String(state.prefs.typewriter));
  $('btnChapters').setAttribute('aria-pressed', String(state.prefs.showChapters));
  $('workspace').classList.toggle('no-chapters', !state.prefs.showChapters);
  const cats = state.prefs.categories;
  $('ideaCats').closest('.rows').querySelectorAll('input[type=checkbox]').forEach((c) => {
    c.checked = !cats || cats.includes(c.value);
  });
  $('autoDash').checked = state.prefs.autoDash;
  $('smartQuotes').checked = state.prefs.smartQuotes;
  $('autoEllipsis').checked = state.prefs.autoEllipsis;
  $('darkPaper').checked = state.prefs.darkPaper;
  $('exportScope').value = state.prefs.exportScope;
  editor.options = { autoDash: state.prefs.autoDash, smartQuotes: state.prefs.smartQuotes, autoEllipsis: state.prefs.autoEllipsis };
}

function savePrefs() {
  store.setPref('prefs', state.prefs);
}

// ---------------------------------------------------------------- layout e tema
function applyUiScale() {
  const v = Number(state.prefs.uiScale) || 0;
  document.documentElement.style.zoom = v ? String(v / 100) : '';
  const sel = document.getElementById('uiScale');
  if (sel) sel.value = String(v);
}

function applyTheme() {
  const dark = state.prefs.theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('.titlebar .logo').src = dark ? 'img/logo-escuro.svg' : 'img/logo.svg';
  if (state.project) applySettings();
}

function applySettings() {
  const s = state.project.settings;
  const g = pageGeometry(s);
  const sheet = $('sheet');
  sheet.style.width = `${g.width}mm`;
  sheet.style.padding = `${g.top}mm ${g.right}mm ${g.bottom}mm ${g.left}mm`;
  sheet.style.setProperty('--page-h', `${g.height}mm`);
  sheet.style.fontFamily = fontStack(s.fontFamily);
  sheet.style.fontSize = `${s.fontSize}pt`;
  sheet.style.lineHeight = String(s.lineHeight);
  sheet.style.setProperty('--lh', String(s.lineHeight));
  sheet.dataset.paper = s.paper;
  sheet.classList.toggle('dark-paper', state.prefs.theme === 'dark' && state.prefs.darkPaper && (s.paper === 'branca' || s.paper === 'marfim'));
  let measure = sheet.querySelector('.page-measure');
  if (!measure) {
    measure = el('div', { class: 'page-measure', 'aria-hidden': 'true' });
    measure.style.cssText = 'position:absolute;visibility:hidden;width:1px;left:0;top:0;pointer-events:none';
    sheet.append(measure);
  }
  measure.style.height = `${g.height}mm`;
  const ed = $('editor');
  ed.classList.remove('modo-livro', 'modo-wattpad', 'modo-ao3');
  ed.classList.add(`modo-${s.formatMode}`);
  ed.classList.toggle('recuo', s.firstLineIndent);
  ed.classList.toggle('sem-antes', !s.blankBeforeDialogue);
  ed.classList.toggle('sem-depois', !s.blankAfterDialogue);
  ed.classList.toggle('com-depois', s.blankAfterDialogue);
  ed.classList.toggle('entre-paragrafos', s.blankBetweenParagraphs);
  ed.style.setProperty('--scene', JSON.stringify(s.sceneBreak || '* * *'));
  $('sheetWrap').style.zoom = String(zoomFactor());
  $('zoomLabel').textContent = `${state.prefs.zoom}%`;
  $('zoomRange').value = String(state.prefs.zoom);
  for (const [id, key] of [['pageSize', 'pageSize'], ['orientation', 'orientation'], ['margins', 'margins'], ['paper', 'paper'],
    ['defaultSize', 'fontSize'], ['sceneBreak', 'sceneBreak']]) $(id).value = s[key];
  $('bookFontName').textContent = s.fontFamily;
  $('bookFontName').style.fontFamily = fontStack(s.fontFamily);
  $('fontPickerName').textContent = s.fontFamily;
  $('lineHeight').value = String(s.lineHeight);
  for (const k of ['firstLineIndent', 'blankBeforeDialogue', 'blankAfterDialogue', 'blankBetweenParagraphs']) $(k).checked = Boolean(s[k]);
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === s.formatMode)));
  $('stMode').textContent = { livro: 'Formato: Livro', wattpad: 'Formato: Wattpad', ao3: 'Formato: AO3' }[s.formatMode];
  reflectToggles();
  requestAnimationFrame(() => {
    updatePages();
    renderBulbs();
  });
}

function setMode(mode) {
  const s = state.project.settings;
  s.formatMode = mode;
  const preset = PRESETS[mode];
  s.blankBeforeDialogue = preset.blankBeforeDialogue;
  s.blankAfterDialogue = preset.blankAfterDialogue;
  s.blankBetweenParagraphs = preset.blankBetweenParagraphs;
  s.firstLineIndent = mode === 'livro';
  markDirty();
  applySettings();
  toast({ livro: 'Formato de livro: recuo na primeira linha e texto justificado.',
    wattpad: 'Formato Wattpad: sem recuo e com linhas em branco antes e depois dos diálogos.',
    ao3: 'Formato AO3: sem recuo e com linha em branco antes dos diálogos.' }[mode]);
}

function setZoom(z) {
  state.prefs.zoom = Math.max(50, Math.min(200, Math.round(z)));
  savePrefs();
  applySettings();
}

function typewriterScroll() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const rect = sel.getRangeAt(0).getClientRects()[0];
  if (!rect) return;
  const desk = $('desk');
  const box = desk.getBoundingClientRect();
  desk.scrollTop += (rect.top - (box.top + box.height / 2)) / uiZoom();
}

// ---------------------------------------------------------------- capítulos
const STATUS_NAMES = { rascunho: 'Rascunho', revisao: 'Em revisão', pronto: 'Pronto' };

function renderStoryHead() {
  if (!state.project) return;
  $('storyName').textContent = state.project.title || 'Sem título';
  const d = (state.project.description || '').trim();
  $('storyDesc').textContent = d || 'Sem descrição. Clique no lápis para escrever a sinopse.';
  $('storyDesc').classList.toggle('empty', !d);
}

function renderChapters() {
  const list = $('chapterList');
  list.textContent = '';
  state.project.chapters.forEach((c, i) => {
    const li = el('li', { 'data-id': c.id, draggable: 'true', title: 'Clique para abrir · duplo clique para renomear · arraste para reordenar' });
    if (c.id === state.chapterId) li.classList.add('active');
    const body = el('div', { class: 'cb' }, el('span', { class: 't' }, c.title || `Capítulo ${i + 1}`),
      el('span', { class: 'meta' }, el('span', { class: `dot ${c.status}`, title: STATUS_NAMES[c.status] }), el('span', { class: 'w' }, `${fmt(c.words || 0)} palavras`)));
    const more = el('button', { type: 'button', class: 'more', title: 'Opções do capítulo', 'aria-label': `Opções de ${c.title}` }, '⋯');
    li.append(el('span', { class: 'num' }, String(i + 1)), body, more);
    list.append(li);
  });
  $('chapterCount').textContent = String(state.project.chapters.length);
  $('projectTotals').textContent = `${fmt(totalWords())} palavras na história`;
}

function reflectStatus() {
  const ch = currentChapter();
  const st = ch ? ch.status : 'rascunho';
  $('statusPills').querySelectorAll('[data-status]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.status === st)));
}

function setStatus(st) {
  const ch = currentChapter();
  if (!ch || !STATUS_NAMES[st]) return;
  ch.status = st;
  markDirty();
  reflectStatus();
  renderChapters();
  if (!$('draftPanel').hidden) renderDraftPanel();
}

function chapterMenu(id, x, y) {
  const menu = $('menu');
  menu.textContent = '';
  const add = (label, fn, cls) => {
    const b = el('button', { type: 'button', role: 'menuitem', class: cls || '' }, label);
    b.addEventListener('click', () => {
      hideMenu();
      fn();
    });
    menu.append(b);
  };
  add('✎  Renomear', () => renameChapter(id));
  add('⧉  Duplicar', () => duplicateChapter(id));
  add('↑  Mover para cima', () => moveChapter(id, -1));
  add('↓  Mover para baixo', () => moveChapter(id, 1));
  add('＋  Novo capítulo depois deste', () => newChapter(id));
  menu.append(el('div', { class: 'sep' }));
  add('🗑  Excluir capítulo', () => deleteChapter(id), 'danger');
  menu.hidden = false;
  placeMenu(menu, x, y);
}

function bindChapters() {
  const list = $('chapterList');
  let dragId = null;
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    if (e.target.closest('.more')) {
      const r = e.target.getBoundingClientRect();
      chapterMenu(li.dataset.id, r.left, r.bottom + 4);
      return;
    }
    if (li.dataset.id !== state.chapterId) selectChapter(li.dataset.id);
  });
  list.addEventListener('dblclick', (e) => {
    const li = e.target.closest('li');
    if (li && !e.target.closest('.more')) renameChapter(li.dataset.id);
  });
  list.addEventListener('contextmenu', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    chapterMenu(li.dataset.id, e.clientX, e.clientY);
  });
  list.addEventListener('dragstart', (e) => {
    dragId = e.target.closest('li')?.dataset.id;
    e.target.closest('li')?.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  list.addEventListener('dragend', () => list.querySelectorAll('.dragging').forEach((x) => x.classList.remove('dragging')));
  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    list.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
    e.target.closest('li')?.classList.add('drag-over');
  });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    const target = e.target.closest('li')?.dataset.id;
    list.querySelectorAll('.drag-over').forEach((x) => x.classList.remove('drag-over'));
    if (!dragId || !target || dragId === target) return;
    syncChapter();
    const arr = state.project.chapters;
    const from = arr.findIndex((c) => c.id === dragId);
    const [moved] = arr.splice(from, 1);
    arr.splice(arr.findIndex((c) => c.id === target) + (from <= arr.findIndex((c) => c.id === target) ? 1 : 0), 0, moved);
    arr.forEach((c, i) => { c.position = i; });
    markDirty();
    renderChapters();
  });
  $('chapterTitle').addEventListener('input', () => {
    const ch = currentChapter();
    ch.title = $('chapterTitle').textContent.trim() || 'Sem título';
    const li = document.querySelector(`#chapterList li[data-id="${ch.id}"] .t`);
    if (li) li.textContent = ch.title;
    const dt = document.querySelector('#draftPanel .dp-title');
    if (dt) dt.textContent = ch.title;
    markDirty();
  });
  $('chapterTitle').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('editor').focus();
    }
  });
  $('chapterNotes').addEventListener('input', () => {
    const ch = currentChapter();
    if (ch) ch.notes = $('chapterNotes').value;
    const big = document.querySelector('#draftPanel [name="notes"]');
    if (big && big.value !== $('chapterNotes').value) big.value = $('chapterNotes').value;
    markDirty();
  });
  $('statusPills').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (b) setStatus(b.dataset.status);
  });
  $('docTitle').addEventListener('input', () => {
    state.project.title = $('docTitle').value;
    document.title = `${state.project.title || 'Sem título'} · Serifa`;
    renderStoryHead();
    markDirty();
  });
}

function newChapter(afterId) {
  syncChapter();
  const arr = state.project.chapters;
  const at = afterId ? arr.findIndex((c) => c.id === afterId) + 1 : arr.length;
  const ch = newChapterDoc(`Capítulo ${arr.length + 1}`, at);
  arr.splice(at, 0, ch);
  arr.forEach((c, k) => { c.position = k; });
  markDirty();
  selectChapter(ch.id, true);
  const t = $('chapterTitle');
  t.focus();
  document.getSelection().selectAllChildren(t);
  document.querySelector(`#chapterList li[data-id="${ch.id}"]`)?.scrollIntoView({ block: 'nearest' });
  toast('Capítulo criado. Digite o título e aperte Enter para começar o texto.');
}

async function renameChapter(id) {
  const ch = state.project.chapters.find((c) => c.id === id);
  const res = await dialog({ title: 'Renomear capítulo', fields: [{ name: 'title', label: 'Título do capítulo', value: ch.title }], ok: 'Renomear' });
  if (!res) return;
  ch.title = res.title.trim() || ch.title;
  if (id === state.chapterId) $('chapterTitle').textContent = ch.title;
  markDirty();
  renderChapters();
  if (!$('draftPanel').hidden) renderDraftPanel();
}

function duplicateChapter(id) {
  syncChapter();
  const i = state.project.chapters.findIndex((c) => c.id === id);
  const src = state.project.chapters[i];
  const copy = { ...src, id: uid(), title: `${src.title} (cópia)`, createdAt: new Date().toISOString() };
  state.project.chapters.splice(i + 1, 0, copy);
  state.project.chapters.forEach((c, k) => { c.position = k; });
  markDirty();
  renderChapters();
  toast(`“${src.title}” duplicado.`);
}

function moveChapter(id, dir) {
  syncChapter();
  const arr = state.project.chapters;
  const i = arr.findIndex((c) => c.id === id);
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  arr.forEach((c, k) => { c.position = k; });
  markDirty();
  renderChapters();
}

async function deleteChapter(id) {
  if (state.project.chapters.length === 1) {
    toast('A história precisa de pelo menos um capítulo.');
    return;
  }
  const ch = state.project.chapters.find((c) => c.id === id);
  if (!await confirmBox('Excluir capítulo', `Excluir “${ch.title}”? Uma cópia da história é guardada antes, em Arquivo → Versões.`, 'Excluir')) return;
  await saveNow('antes de excluir capítulo');
  const idx = state.project.chapters.findIndex((c) => c.id === id);
  state.project.chapters = state.project.chapters.filter((c) => c.id !== id);
  state.project.chapters.forEach((c, k) => { c.position = k; });
  if (state.chapterId === id) selectChapter(state.project.chapters[Math.max(0, idx - 1)].id, true);
  markDirty();
  renderChapters();
}

function draftField(label, input, hint) {
  return el('label', { class: 'dp-field' }, el('span', { class: 'dp-label' }, label), input, hint ? el('span', { class: 'dp-hint' }, hint) : '');
}

function renderDraftPanel() {
  const panel = $('draftPanel');
  const ch = currentChapter();
  if (!ch) return;
  panel.textContent = '';
  const idx = state.project.chapters.indexOf(ch);
  const close = el('button', { type: 'button', class: 'icon-btn', title: 'Recolher (Esc)' }, '⤡');
  close.addEventListener('click', () => toggleDraftPanel(false));
  const pills = el('div', { class: 'status-pills big', role: 'radiogroup', 'aria-label': 'Situação do capítulo' });
  for (const [k, v] of Object.entries(STATUS_NAMES)) {
    const b = el('button', { type: 'button', role: 'radio', 'data-status': k, 'aria-checked': String(ch.status === k) }, v);
    b.addEventListener('click', () => setStatus(k));
    pills.append(b);
  }
  const summary = el('textarea', { name: 'summary', rows: 3, placeholder: 'Em poucas linhas, o que acontece neste capítulo?' });
  summary.value = ch.summary || '';
  summary.addEventListener('input', () => { ch.summary = summary.value; markDirty(); });
  const pov = el('input', { type: 'text', name: 'pov', placeholder: 'Ex.: Helena, narrador, terceira pessoa…', maxlength: 120 });
  pov.value = ch.pov || '';
  pov.addEventListener('input', () => { ch.pov = pov.value; markDirty(); });
  const goal = el('input', { type: 'number', name: 'goal', min: 0, step: 100, placeholder: 'Ex.: 2500' });
  goal.value = ch.goal ? String(ch.goal) : '';
  goal.addEventListener('input', () => { ch.goal = Math.max(0, Number(goal.value) || 0); markDirty(); updateDraftStats(); });
  const notes = el('textarea', { name: 'notes', rows: 9, placeholder: 'Ideias, personagens, pendências, links de referência… Nada daqui vai para a exportação.' });
  notes.value = $('chapterNotes').value;
  notes.addEventListener('input', () => { $('chapterNotes').value = notes.value; ch.notes = notes.value; markDirty(); });
  const nav = el('div', { class: 'dp-nav' });
  const prev = el('button', { type: 'button', class: 'btn' }, '← Anterior');
  prev.disabled = idx <= 0;
  prev.addEventListener('click', () => selectChapter(state.project.chapters[idx - 1].id));
  const next = el('button', { type: 'button', class: 'btn' }, 'Próximo →');
  next.disabled = idx >= state.project.chapters.length - 1;
  next.addEventListener('click', () => selectChapter(state.project.chapters[idx + 1].id));
  nav.append(prev, el('span', { class: 'muted' }, `Capítulo ${idx + 1} de ${state.project.chapters.length}`), next);
  const when = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  panel.append(
    el('div', { class: 'dp-head' }, el('div', {}, el('div', { class: 'dp-kicker' }, 'Painel do capítulo'), el('h3', { class: 'dp-title' }, ch.title)), close),
    nav,
    el('div', { class: 'dp-section' }, el('span', { class: 'dp-label' }, 'Situação'), pills),
    el('div', { class: 'dp-stats', id: 'draftStats' }),
    el('div', { class: 'dp-goal', id: 'draftGoal' }),
    draftField('Resumo', summary),
    el('div', { class: 'dp-row' }, draftField('Ponto de vista', pov), draftField('Meta de palavras', goal)),
    draftField('Notas do rascunho', notes, 'Só para você: não aparecem na exportação.'),
    el('div', { class: 'dp-dates' }, el('span', {}, `Criado em ${when(ch.createdAt)}`), el('span', {}, `Última alteração ${when(ch.updatedAt)}`)),
  );
  updateDraftStats();
}

function updateDraftStats() {
  const box = $('draftStats');
  const ch = currentChapter();
  if (!box || !ch) return;
  const st = countText(editor.text);
  const dlg = st.paragraphs ? Math.round((st.dialogues / st.paragraphs) * 100) : 0;
  box.textContent = '';
  for (const [n, l] of [[fmt(st.words), 'palavras'], [fmt(st.characters), 'caracteres'], [fmt(st.paragraphs), 'parágrafos'],
    [fmt(st.sentences), 'frases'], [`${dlg}%`, 'de diálogo'], [`${st.readingMinutes} min`, 'de leitura']]) {
    box.append(el('div', { class: 'dp-stat' }, el('b', {}, n), el('span', {}, l)));
  }
  const g = $('draftGoal');
  g.textContent = '';
  if (ch.goal) {
    const pct = Math.min(100, Math.round((st.words / ch.goal) * 100));
    const bar = el('div', { class: 'dp-bar' }, el('span', { style: `width:${pct}%` }));
    g.append(el('div', { class: 'dp-goal-t' }, `Meta do capítulo: ${fmt(st.words)} de ${fmt(ch.goal)} palavras`, el('b', {}, `${pct}%`)), bar);
  }
}

function toggleDraftPanel(force) {
  const panel = $('draftPanel');
  const open = typeof force === 'boolean' ? force : panel.hidden;
  panel.hidden = !open;
  $('workspace').classList.toggle('with-draft', open);
  $('btnDraftExpand').setAttribute('aria-pressed', String(open));
  if (open) {
    syncChapter();
    renderDraftPanel();
  }
  requestAnimationFrame(() => renderBulbs());
}

// ---------------------------------------------------------------- faixa de opções
function bindRibbon() {
  document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
  }));
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) {
      e.preventDefault();
      run(b.dataset.cmd);
    }
    const ins = e.target.closest('[data-insert]');
    if (ins) {
      const t = ins.dataset.insert;
      if (t.length === 2 && /[“«]/.test(t[0])) {
        const sel = window.getSelection().toString();
        editor.insertText(t[0] + sel + t[1]);
      } else editor.insertText(t);
    }
    const mode = e.target.closest('[data-mode]');
    if (mode) setMode(mode.dataset.mode);
  });
  // botões da faixa não roubam o foco da folha (a seleção continua lá)
  $('ribbon').addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });
  $('fontPickerBtn').addEventListener('click', () => {
    const sel = window.getSelection();
    const inEditor = sel.rangeCount && $('editor').contains(sel.anchorNode);
    const range = inEditor ? sel.getRangeAt(0).cloneRange() : null;
    const hasText = range && !range.collapsed;
    showFontPicker($('fontPickerBtn'), hasText ? $('fontPickerName').textContent : state.project.settings.fontFamily, (name) => {
      if (hasText) {
        sel.removeAllRanges();
        sel.addRange(range);
        editor.exec('fontName', name);
        $('fontPickerName').textContent = name;
        toast(`Fonte ${name} aplicada ao trecho selecionado.`);
      } else {
        setBookFont(name);
      }
    }, { title: hasText ? 'Fonte do trecho selecionado' : 'Fonte da história toda' });
  });
  $('bookFontBtn').addEventListener('click', () => showFontPicker($('bookFontBtn'), state.project.settings.fontFamily, setBookFont, { title: 'Fonte da história toda' }));
  document.querySelectorAll('[data-style]').forEach((b) => b.addEventListener('click', () => toggleTextStyle(b.dataset.style)));
  $('fontSize').addEventListener('change', () => editor.setFontSize($('fontSize').value));
  $('foreColor').addEventListener('input', () => editor.exec('foreColor', $('foreColor').value));
  $('hiliteColor').addEventListener('input', () => editor.exec('hiliteColor', $('hiliteColor').value));
  $('lineHeight').addEventListener('change', () => {
    const blocks = editor.selectedBlocks();
    if (blocks.length > 1 || window.getSelection().toString()) editor.setLineHeight($('lineHeight').value);
    else {
      state.project.settings.lineHeight = Number($('lineHeight').value);
      markDirty();
      applySettings();
    }
  });
  $('specialChar').addEventListener('change', () => {
    if ($('specialChar').value) editor.insertText($('specialChar').value);
    $('specialChar').value = '';
  });
  const setting = (id, key, conv = (v) => v) => $(id).addEventListener('change', () => {
    const input = $(id);
    state.project.settings[key] = conv(input.type === 'checkbox' ? input.checked : input.value);
    markDirty();
    applySettings();
  });
  setting('pageSize', 'pageSize');
  setting('orientation', 'orientation');
  setting('margins', 'margins');
  setting('paper', 'paper');
  setting('firstLineIndent', 'firstLineIndent');
  setting('blankBeforeDialogue', 'blankBeforeDialogue');
  setting('blankAfterDialogue', 'blankAfterDialogue');
  setting('blankBetweenParagraphs', 'blankBetweenParagraphs');
  setting('defaultSize', 'fontSize', (v) => Math.max(8, Math.min(24, Number(v) || 12)));
  setting('sceneBreak', 'sceneBreak', (v) => String(v).slice(0, 12) || '* * *');
  const pref = (id, key) => $(id).addEventListener('change', () => {
    state.prefs[key] = $(id).checked;
    savePrefs();
    reflectToggles();
    applySettings();
  });
  pref('autoDash', 'autoDash');
  pref('smartQuotes', 'smartQuotes');
  pref('autoEllipsis', 'autoEllipsis');
  pref('darkPaper', 'darkPaper');
  $('ideaCats').closest('.rows').addEventListener('change', () => {
    const all = [...$('ideaCats').closest('.rows').querySelectorAll('input[type=checkbox]')];
    state.prefs.categories = all.filter((c) => c.checked).map((c) => c.value);
    savePrefs();
    scheduleCheck(10);
  });
  $('uiScale').addEventListener('change', () => {
    state.prefs.uiScale = Number($('uiScale').value) || 0;
    savePrefs();
    applyUiScale();
    requestAnimationFrame(() => {
      updatePages();
      renderBulbs();
    });
  });
  $('exportScope').addEventListener('change', () => {
    state.prefs.exportScope = $('exportScope').value;
    savePrefs();
  });
  $('fileInput').addEventListener('change', () => importFile($('fileInput').files[0]));
  $('folderInput').addEventListener('change', () => importFolder([...$('folderInput').files]));
  $('cfgCreate').addEventListener('change', () => cfgSet({ criarPasta: $('cfgCreate').checked }));
  $('cfgAuto').addEventListener('change', () => cfgSet({ salvarAuto: $('cfgAuto').checked }));
  $('imageInput').addEventListener('change', () => insertImage($('imageInput').files[0]));
  bindContextMenu();
  document.addEventListener('selectionchange', () => {
    updateSelectionCount();
    reflectFormatState();
  });
  $('desk').addEventListener('scroll', () => hideBalloon(), { passive: true });
  $('editor').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const before = editor.selectedBlocks()[0];
    const keep = before && before.classList.contains('estilo-mensagem');
    setTimeout(() => {
      const now = editor.selectedBlocks()[0];
      if (!now || now === before || keep || now.textContent.trim()) return;
      for (const t of TEXT_STYLES) now.classList.remove(`estilo-${t}`);
      if (!now.classList.length) now.removeAttribute('class');
      reflectFormatState();
    }, 0);
  });
  window.addEventListener('resize', () => renderBulbs());
}

function setBookFont(name) {
  state.project.settings.fontFamily = name;
  markDirty();
  applySettings();
  toast(`A história agora usa a fonte ${name}. Para mudar só um trecho, selecione-o antes.`);
}

function toggleTextStyle(name) {
  if (!TEXT_STYLES.includes(name)) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !$('editor').contains(sel.anchorNode)) {
    $('editor').focus();
    toast('Coloque o cursor no parágrafo que vai receber o estilo.');
    return;
  }
  let blocks = editor.selectedBlocks().filter((b) => b.tagName === 'P');
  const all = blocks.length && blocks.every((b) => b.classList.contains(`estilo-${name}`));
  if (!blocks.length) {
    editor.exec('formatBlock', 'p');
    blocks = editor.selectedBlocks().filter((b) => b.tagName === 'P');
  }
  for (const b of blocks) {
    for (const t of TEXT_STYLES) b.classList.remove(`estilo-${t}`);
    if (!all) b.classList.add(`estilo-${name}`);
    if (!b.classList.length) b.removeAttribute('class');
  }
  onEditorChange();
  reflectFormatState();
}

function reflectFormatState() {
  if (!$('editor').contains(window.getSelection().anchorNode)) return;
  const blk = editor.selectedBlocks()[0];
  document.querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-pressed', String(Boolean(blk && blk.classList.contains(`estilo-${b.dataset.style}`)))));
  const ff = (document.queryCommandValue('fontName') || '').replace(/["']/g, '').split(',')[0].trim();
  if (ff) $('fontPickerName').textContent = ALL_FONTS.some((f) => f.name === ff) ? ff : state.project.settings.fontFamily;
  for (const [cmd, q] of [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'], ['strike', 'strikeThrough'],
    ['subscript', 'subscript'], ['superscript', 'superscript']]) {
    const b = document.querySelector(`.ribbon [data-cmd="${cmd}"]`);
    try {
      b?.setAttribute('aria-pressed', String(document.queryCommandState(q)));
    } catch { /* sem suporte */ }
  }
}

async function run(cmd) {
  const ed = editor;
  switch (cmd) {
    case 'bold': return ed.exec('bold');
    case 'italic': return ed.exec('italic');
    case 'underline': return ed.exec('underline');
    case 'strike': return ed.exec('strikeThrough');
    case 'subscript': return ed.exec('subscript');
    case 'superscript': return ed.exec('superscript');
    case 'clear-format': return ed.exec('removeFormat');
    case 'ul': return ed.exec('insertUnorderedList');
    case 'ol': return ed.exec('insertOrderedList');
    case 'indent': return ed.exec('indent');
    case 'outdent': return ed.exec('outdent');
    case 'align-left': return ed.exec('justifyLeft');
    case 'align-center': return ed.exec('justifyCenter');
    case 'align-right': return ed.exec('justifyRight');
    case 'align-justify': return ed.exec('justifyFull');
    case 'style-p': ed.exec('formatBlock', 'p'); return editor.selectedBlocks().forEach((b) => { if (b.tagName === 'P') b.removeAttribute('class'); });
    case 'style-h1': return ed.exec('formatBlock', 'h1');
    case 'style-h2': return ed.exec('formatBlock', 'h2');
    case 'style-h3': return ed.exec('formatBlock', 'h3');
    case 'style-quote': return ed.exec('formatBlock', 'blockquote');
    case 'undo': return ed.exec('undo');
    case 'redo': return ed.exec('redo');
    case 'cut': $('editor').focus(); return document.execCommand('cut');
    case 'copy': $('editor').focus(); return document.execCommand('copy');
    case 'paste': return pasteFromClipboard();
    case 'find': return openFind(false);
    case 'replace': return openFind(true);
    case 'find-next': return findStep(1);
    case 'find-prev': return findStep(-1);
    case 'find-close': return closeFind();
    case 'replace-one': return replaceOne();
    case 'replace-all': return replaceAll();
    case 'new-chapter': return newChapter();
    case 'scene-break': return ed.insertHtml('<hr class="cena"><p><br></p>');
    case 'page-break': return ed.insertHtml('<div class="quebra-pagina" contenteditable="false"></div><p><br></p>');
    case 'image': return $('imageInput').click();
    case 'table': return insertTable();
    case 'link': return insertLink();
    case 'date': return ed.insertText(new Date().toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }));
    case 'toggle-spell': return toggleSpell();
    case 'toggle-ideas': return toggleIdeas();
    case 'personal-dict': return personalDictDialog();
    case 'word-count': return wordCountDialog();
    case 'repeated': return repeatedDialog();
    case 'goal': return goalDialog();
    case 'theme-toggle': state.prefs.theme = state.prefs.theme === 'dark' ? 'light' : 'dark'; savePrefs(); return applyTheme();
    case 'theme-light': state.prefs.theme = 'light'; savePrefs(); return applyTheme();
    case 'theme-dark': state.prefs.theme = 'dark'; savePrefs(); return applyTheme();
    case 'zoom-in': return setZoom(state.prefs.zoom + 10);
    case 'zoom-out': return setZoom(state.prefs.zoom - 10);
    case 'zoom-reset': return setZoom(100);
    case 'zoom-fit': return setZoom((($('desk').clientWidth - 180) / mmToPx(pageGeometry(state.project.settings).width)) * 100);
    case 'focus': return toggleFocus();
    case 'typewriter': state.prefs.typewriter = !state.prefs.typewriter; savePrefs(); return reflectToggles();
    case 'fullscreen': return document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    case 'toggle-chapters': state.prefs.showChapters = !state.prefs.showChapters; savePrefs(); reflectToggles(); return renderBulbs();
    case 'close-library': return closeLibrary();
    case 'export-zip': return exportZip();
    case 'import-folder': $('folderInput').value = ''; return $('folderInput').click();
    case 'cfg-choose': return cfgChoose();
    case 'cfg-open': return desk.isDesktop() ? desk.openFolder('') : null;
    case 'cfg-open-story': return desk.isDesktop() ? desk.openFolder(storyFolder()) : null;
    case 'cfg-default': return cfgSet({ base: '' });
    case 'new-project': return newProject();
    case 'open-projects': return projectsDialog();
    case 'open-file': $('fileInput').accept = '.serifa,.json,.docx,.txt,.md,.html,.htm'; return $('fileInput').click();
    case 'save': return saveCommand(false);
    case 'save-as': return saveCommand(true);
    case 'revisions': return revisionsDialog();
    case 'project-props': return propsDialog();
    case 'welcome': return showTutorial();
    case 'tutorial': return showTutorial();
    case 'story-edit': return propsDialog();
    case 'draft-expand': return toggleDraftPanel();
    case 'help-shortcuts': return shortcutsDialog();
    case 'tab-config': return document.querySelector('[data-tab="config"]')?.click();
    case 'wattpad-copy': return publishCopy('wattpad', false);
    case 'wattpad-open': return publishCopy('wattpad', true);
    case 'wattpad-file': return publishFile('wattpad');
    case 'ao3-copy': return publishCopy('ao3', false);
    case 'ao3-open': return publishCopy('ao3', true);
    case 'ao3-file': return publishFile('ao3');
    case 'export-docx': return exportDoc('docx');
    case 'export-epub': return exportDoc('epub');
    case 'export-pdf': return exportPdf();
    case 'export-html': return exportDoc('html');
    case 'export-md': return exportDoc('md');
    case 'export-txt': return exportDoc('txt');
    case 'export-serifa': return exportDoc('serifa');
    default: return null;
  }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (text) editor.insertHtml(text.includes('\n') ? textToHtml(text) : escapeText(text));
  } catch {
    toast('O navegador não deixou ler a área de transferência. Use Ctrl+V.');
  }
}

function toggleFocus() {
  document.body.classList.toggle('focus');
  toast(document.body.classList.contains('focus') ? 'Modo foco: F11 ou Esc para sair' : 'Modo foco desligado');
  setTimeout(renderBulbs, 50);
}

async function insertTable() {
  const res = await dialog({ title: 'Inserir tabela', fields: [
    { name: 'rows', label: 'Linhas', value: '3', type: 'number' }, { name: 'cols', label: 'Colunas', value: '3', type: 'number' }], ok: 'Inserir' });
  if (!res) return;
  const r = Math.max(1, Math.min(50, Number(res.rows) || 3));
  const c = Math.max(1, Math.min(12, Number(res.cols) || 3));
  const row = `<tr>${'<td><br></td>'.repeat(c)}</tr>`;
  editor.insertHtml(`<table><tbody>${row.repeat(r)}</tbody></table><p><br></p>`);
}

async function insertLink() {
  const sel = window.getSelection();
  const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  const res = await dialog({ title: 'Inserir link', fields: [{ name: 'url', label: 'Endereço (https://…)', value: 'https://', type: 'url' }], ok: 'Inserir' });
  if (!res || !/^https?:\/\/\S+$/i.test(res.url.trim())) return;
  if (range) {
    sel.removeAllRanges();
    sel.addRange(range);
  }
  if (sel.toString()) editor.exec('createLink', res.url.trim());
  else editor.insertHtml(`<a href="${escapeText(res.url.trim())}">${escapeText(res.url.trim())}</a>`);
}

function insertImage(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 1400;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88);
      editor.insertHtml(`<img src="${data}" alt=""><p><br></p>`);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  $('imageInput').value = '';
}

// ---------------------------------------------------------------- localizar e substituir
const find = { matches: [], index: -1 };
function bindFind() {
  $('findText').addEventListener('input', () => doFind());
  $('findCase').addEventListener('change', () => doFind());
  $('findText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findStep(e.shiftKey ? -1 : 1);
    }
    if (e.key === 'Escape') closeFind();
  });
  $('replaceText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      replaceOne();
    }
    if (e.key === 'Escape') closeFind();
  });
}

function openFind(withReplace) {
  const bar = $('findbar');
  bar.hidden = false;
  $('replaceRow').hidden = !withReplace;
  $('desk').append(bar);
  const sel = window.getSelection().toString();
  if (sel && !sel.includes('\n')) $('findText').value = sel;
  $('findText').focus();
  $('findText').select();
  doFind();
}

function closeFind() {
  $('findbar').hidden = true;
  editor.clearHighlights('serifa-busca');
  editor.clearHighlights('serifa-busca-atual');
  $('editor').focus();
}

function doFind() {
  const q = $('findText').value;
  find.matches = [];
  find.index = -1;
  if (q) {
    const hay = $('findCase').checked ? editor.text : editor.text.toLocaleLowerCase('pt-BR');
    const needle = $('findCase').checked ? q : q.toLocaleLowerCase('pt-BR');
    let i = hay.indexOf(needle);
    while (i >= 0 && find.matches.length < 5000) {
      find.matches.push({ start: i, end: i + needle.length });
      i = hay.indexOf(needle, i + needle.length);
    }
  }
  editor.setHighlights('serifa-busca', find.matches);
  editor.clearHighlights('serifa-busca-atual');
  $('findInfo').textContent = q ? `${find.matches.length} resultado(s)` : '';
}

function findStep(dir) {
  if (!find.matches.length) return;
  find.index = (find.index + dir + find.matches.length) % find.matches.length;
  const m = find.matches[find.index];
  editor.setHighlights('serifa-busca-atual', [m]);
  const r = editor.rangeFor(m.start, m.end);
  r?.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  $('findInfo').textContent = `${find.index + 1} de ${find.matches.length}`;
}

function replaceOne() {
  if (!find.matches.length) return;
  if (find.index < 0) find.index = 0;
  const m = find.matches[find.index];
  editor.replaceRange(m.start, m.end, $('replaceText').value);
  editor.refreshText();
  doFind();
  $('replaceText').focus();
}

function replaceAll() {
  const q = $('findText').value;
  if (!q) return;
  let count = 0;
  for (let k = find.matches.length - 1; k >= 0; k -= 1) {
    const m = find.matches[k];
    const r = editor.rangeFor(m.start, m.end);
    if (!r) continue;
    r.deleteContents();
    r.insertNode(document.createTextNode($('replaceText').value));
    count += 1;
  }
  $('editor').normalize();
  onEditorChange();
  doFind();
  toast(`${count} substituição(ões).`);
}

// ---------------------------------------------------------------- arquivo
async function newProject() {
  const res = await dialog({ title: 'Nova história', fields: [
    { name: 'title', label: 'Nome da história', value: '', placeholder: 'Ex.: O último verão em Hogsmeade', required: true },
    { name: 'description', label: 'Descrição (opcional)', type: 'textarea', value: '', placeholder: 'Sinopse, fandom, ship, avisos… Só você vê, e dá para mudar depois.' },
    { name: 'mode', label: 'Onde você vai publicar?', type: 'select', value: 'wattpad',
      options: [['wattpad', 'Wattpad'], ['ao3', 'AO3 (Archive of Our Own)'], ['livro', 'Livro (recuo e justificado)']] }], ok: 'Criar história' });
  if (!res) return;
  await saveNow();
  const p = newProjectDoc(res.title.trim() || 'Nova história', res.description.trim().slice(0, 2000));
  p.folder = folderName(p.title);
  p.settings.formatMode = res.mode;
  Object.assign(p.settings, PRESETS[res.mode], { firstLineIndent: res.mode === 'livro' });
  await store.saveProject(p);
  closeLibrary();
  await openProject(p);
  if (desk.isDesktop() && desk.desktopInfo().criarPasta) {
    try {
      const r = await desk.createFolder(p.folder);
      toast(`“${p.title}” criada! A pasta ${r.caminho} vai guardar os arquivos dela.`, { label: 'Abrir pasta', fn: () => desk.openFolder(p.folder) });
      desktopAutosave(true);
      return;
    } catch { }
  }
  toast(`“${p.title}” criada! O capítulo 1 já está aberto.`);
}

function timeAgo(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(d)) return '';
  if (d < 60) return 'agora mesmo';
  if (d < 3600) return `há ${Math.floor(d / 60)} min`;
  if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
  if (d < 86400 * 30) return `há ${Math.floor(d / 86400)} dia(s)`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

function closeLibrary() {
  const lib = $('library');
  if (lib.hidden) return;
  lib.hidden = true;
  lib.textContent = '';
}

async function projectsDialog() {
  await saveNow();
  const list = await store.listProjects();
  const lib = $('library');
  lib.textContent = '';
  const search = el('input', { type: 'search', placeholder: 'Procurar história…', 'aria-label': 'Procurar história' });
  const grid = el('div', { class: 'lib-grid' });
  const create = el('button', { type: 'button', class: 'btn primary big' }, '＋ Nova história');
  create.addEventListener('click', () => newProject());
  const imp = el('button', { type: 'button', class: 'btn big' }, '📂 Abrir arquivo');
  imp.addEventListener('click', () => run('open-file'));
  const impDir = el('button', { type: 'button', class: 'btn big' }, '🗂 Importar pasta');
  impDir.addEventListener('click', () => run('import-folder'));
  const close = el('button', { type: 'button', class: 'icon-btn lib-close', title: 'Voltar para a escrita (Esc)' }, '✕');
  close.addEventListener('click', closeLibrary);
  const total = list.reduce((n, p) => n + (Number(p.words) || 0), 0);
  lib.append(el('div', { class: 'lib-inner' },
    el('div', { class: 'lib-head' },
      el('div', {}, el('div', { class: 'lib-kicker' }, 'Serifa'), el('h1', {}, 'Minhas histórias'),
        el('p', { class: 'muted' }, `${list.length} história(s) · ${fmt(total)} palavras escritas`)),
      el('div', { class: 'lib-actions' }, search, impDir, imp, create, close)),
    grid));
  const render = () => {
    const q = search.value.trim().toLocaleLowerCase('pt-BR');
    grid.textContent = '';
    const newCard = el('button', { type: 'button', class: 'lib-card new' }, el('span', { class: 'plus' }, '＋'), el('b', {}, 'Nova história'), el('span', { class: 'muted' }, 'Dê um nome, uma descrição se quiser, e comece pelo capítulo 1.'));
    newCard.addEventListener('click', () => newProject());
    if (!q) grid.append(newCard);
    for (const p of list) {
      if (q && !`${p.title} ${p.description || ''}`.toLocaleLowerCase('pt-BR').includes(q)) continue;
      const current = state.project && p.id === state.project.id;
      const card = el('article', { class: `lib-card${current ? ' current' : ''}`, tabindex: '0' });
      const spines = ['#d8a7b1', '#8395a7', '#b8c9a9', '#b0a08c', '#9c4a5b', '#4a5a6b', '#556b47'];
      card.style.setProperty('--spine', spines[[...p.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % spines.length]);
      const meta = [];
      if (Number.isFinite(p.chapterCount)) meta.push(`${p.chapterCount} capítulo(s)`);
      if (Number.isFinite(p.words)) meta.push(`${fmt(p.words)} palavras`);
      meta.push(`editada ${timeAgo(p.updatedAt)}`);
      const fmtName = { livro: 'Livro', wattpad: 'Wattpad', ao3: 'AO3' }[p.settings?.formatMode] || '';
      const more = el('button', { type: 'button', class: 'more', title: 'Opções', 'aria-label': `Opções de ${p.title}` }, '⋯');
      card.append(
        el('div', { class: 'spine' }),
        el('div', { class: 'lib-body' },
          el('div', { class: 'lib-tags' }, current ? el('span', { class: 'tag on' }, 'Aberta agora') : '', fmtName ? el('span', { class: 'tag' }, fmtName) : ''),
          el('h2', {}, p.title || 'Sem título'),
          el('p', { class: `desc${p.description ? '' : ' empty'}` }, p.description || 'Sem descrição.'),
          el('div', { class: 'lib-meta' }, meta.join(' · '))),
        more);
      const open = async () => {
        closeLibrary();
        if (!current) await openProject(await store.loadProject(p.id));
      };
      card.addEventListener('click', (e) => {
        if (e.target.closest('.more')) return;
        open();
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') open();
      });
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = $('menu');
        menu.textContent = '';
        const add = (label, fn, cls) => {
          const b = el('button', { type: 'button', role: 'menuitem', class: cls || '' }, label);
          b.addEventListener('click', () => {
            hideMenu();
            fn();
          });
          menu.append(b);
        };
        add('📖  Abrir', open);
        add('✎  Editar nome e descrição', async () => {
          const res = await dialog({ title: 'Editar história', fields: [
            { name: 'title', label: 'Nome da história', value: p.title, required: true },
            { name: 'description', label: 'Descrição (opcional)', type: 'textarea', value: p.description || '' }], ok: 'Salvar' });
          if (!res) return;
          if (current) {
            state.project.title = res.title.trim() || state.project.title;
            state.project.description = res.description.trim().slice(0, 2000);
            $('docTitle').value = state.project.title;
            renderStoryHead();
            await saveNow();
          } else {
            const doc = await store.loadProject(p.id);
            doc.title = res.title.trim() || doc.title;
            doc.description = res.description.trim().slice(0, 2000);
            await store.saveProject(doc);
          }
          projectsDialog();
        });
        add('⧉  Duplicar', async () => {
          const doc = normalizeProject(await store.loadProject(p.id));
          doc.id = uid();
          doc.title = `${doc.title} (cópia)`;
          doc.chapters.forEach((c) => { c.id = uid(); });
          doc.createdAt = new Date().toISOString();
          doc.updatedAt = doc.createdAt;
          doc.words = p.words;
          doc.chapterCount = doc.chapters.length;
          await store.saveProject(doc);
          projectsDialog();
          toast('História duplicada.');
        });
        add('⤓  Baixar arquivo .serifa', async () => {
          const doc = await store.loadProject(p.id);
          download(`${safeName(doc.title)}.serifa`, new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
        });
        menu.append(el('div', { class: 'sep' }));
        add('🗑  Excluir história', async () => {
          if (current) {
            toast('Abra outra história antes de excluir esta.');
            return;
          }
          if (!await confirmBox('Excluir história', `Excluir “${p.title}”, todos os capítulos e versões? Não dá para desfazer.`, 'Excluir')) return;
          await store.deleteProject(p.id);
          list.splice(list.indexOf(p), 1);
          render();
        }, 'danger');
        menu.hidden = false;
        const r = more.getBoundingClientRect();
        placeMenu(menu, r.left, r.bottom + 4);
      });
      grid.append(card);
    }
    if (q && !grid.children.length) grid.append(el('p', { class: 'muted' }, 'Nenhuma história com esse nome.'));
  };
  search.addEventListener('input', render);
  render();
  lib.hidden = false;
  (list.length ? search : create).focus();
}

async function saveCommand(asNew) {
  await saveNow('salvo pelo usuário');
  const doc = JSON.stringify({ ...state.project, words: totalWords() }, null, 2);
  const name = `${safeName(state.project.title)}.serifa`;
  if (desk.isDesktop()) {
    let file = name;
    if (asNew) {
      const res = await dialog({ title: 'Salvar como', fields: [{ name: 'name', label: `Nome do arquivo (vai para a pasta “${storyFolder()}”)`, value: safeName(state.project.title), required: true }], ok: 'Salvar' });
      if (!res) return;
      file = `${safeName(res.name)}.serifa`;
    }
    return download(file, new Blob([doc], { type: 'application/json' }));
  }
  if (window.showSaveFilePicker) {
    try {
      if (!state.fileHandle || asNew) {
        state.fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Projeto do Serifa', accept: { 'application/json': ['.serifa'] } }] });
      }
      const w = await state.fileHandle.createWritable();
      await w.write(doc);
      await w.close();
      toast(`Salvo em ${state.fileHandle.name}`);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  if (asNew) download(name, new Blob([doc], { type: 'application/json' }));
  else toast('Salvo neste navegador. Para ter o arquivo, use Salvar como.');
}

async function revisionsDialog() {
  const list = await store.listRevisions(state.project.id);
  const table = el('table');
  table.append(el('tr', {}, el('th', {}, 'Quando'), el('th', {}, 'Motivo'), el('th', { class: 'num' }, 'Palavras'), el('th', {}, '')));
  await dialog({ title: 'Versões do projeto', body: list.length ? table : el('p', { class: 'muted' }, 'Nenhuma versão guardada ainda. O Serifa guarda uma a cada 5 minutos de escrita e a cada Ctrl+S.'), ok: 'Fechar', cancel: null, build: (api) => {
    for (const r of list) {
      const btn = el('button', { class: 'btn', type: 'button' }, 'Restaurar');
      btn.addEventListener('click', async () => {
        if (!await confirmBox('Restaurar versão', 'O projeto atual será guardado como versão antes de restaurar.', 'Restaurar')) return;
        await saveNow('antes de restaurar');
        const doc = JSON.parse(r.documento);
        api.close();
        await store.saveProject(normalizeProject(doc));
        await openProject(await store.loadProject(doc.id));
        toast('Versão restaurada.');
      });
      table.append(el('tr', {}, el('td', {}, new Date(r.criadoEm).toLocaleString('pt-BR')), el('td', {}, r.motivo || ''), el('td', { class: 'num' }, fmt(r.palavras || 0)), el('td', {}, btn)));
    }
  } });
}

async function propsDialog() {
  const res = await dialog({ title: 'Detalhes da história', fields: [
    { name: 'title', label: 'Nome da história', value: state.project.title, required: true },
    { name: 'description', label: 'Descrição (opcional)', type: 'textarea', value: state.project.description || '', placeholder: 'Sinopse, fandom, ship, avisos…' },
    { name: 'author', label: 'Pseudônimo (opcional, vai no EPUB)', value: state.project.author || '' },
    { name: 'goal', label: 'Meta diária de palavras', value: String(state.project.settings.dailyGoal), type: 'number' }], ok: 'Salvar' });
  if (!res) return;
  state.project.title = res.title.trim() || state.project.title;
  state.project.description = res.description.trim().slice(0, 2000);
  state.project.author = res.author.trim().slice(0, 120);
  state.project.settings.dailyGoal = Math.max(50, Math.min(100000, Number(res.goal) || 1000));
  $('docTitle').value = state.project.title;
  document.title = `${state.project.title} · Serifa`;
  renderStoryHead();
  markDirty();
  updateCounts();
}

async function goalDialog() {
  const res = await dialog({ title: 'Meta diária', fields: [{ name: 'goal', label: 'Quantas palavras por dia?', value: String(state.project.settings.dailyGoal), type: 'number' }], ok: 'Definir' });
  if (!res) return;
  state.project.settings.dailyGoal = Math.max(50, Math.min(100000, Number(res.goal) || 1000));
  markDirty();
  updateCounts();
}

async function importFile(file) {
  $('fileInput').value = '';
  if (!file) return;
  closeLibrary();
  if (file.size > 30 * 1024 * 1024) {
    toast('Arquivo grande demais (máx. 30 MB).');
    return;
  }
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.serifa') || name.endsWith('.json')) {
      const doc = normalizeProject(JSON.parse(await file.text()));
      const existing = await store.loadProject(doc.id);
      if (existing) doc.id = uid();
      await store.saveProject(doc);
      await openProject(doc);
      toast(`Projeto “${doc.title}” aberto.`);
      return;
    }
    let html;
    if (name.endsWith('.docx')) {
      html = await docxToHtml(await file.arrayBuffer());
    } else if (name.endsWith('.html') || name.endsWith('.htm')) {
      html = sanitizeHtml(await file.text());
    } else if (name.endsWith('.md')) {
      html = textToHtml((await file.text()).replace(/^#+\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1'));
    } else {
      html = textToHtml(await file.text());
    }
    syncChapter();
    const ch = newChapterDoc(file.name.replace(/\.[^.]+$/, ''), state.project.chapters.length, html);
    state.project.chapters.push(ch);
    markDirty();
    selectChapter(ch.id, true);
    toast(`“${file.name}” virou um capítulo novo.`);
  } catch (err) {
    toast(`Não foi possível abrir: ${err.message}`);
  }
}

// ---------------------------------------------------------------- exportar
function scopeId() {
  return state.prefs.exportScope === 'all' ? null : state.chapterId;
}

function exportOptions() {
  const s = state.project.settings;
  return { sceneBreak: s.sceneBreak || '* * *' };
}

function publishHtml(kind) {
  syncChapter();
  const s = state.project.settings;
  const chapters = scopeId() ? [currentChapter()] : state.project.chapters;
  const userOpts = s.formatMode === kind ? { blankBeforeDialogue: s.blankBeforeDialogue, blankAfterDialogue: s.blankAfterDialogue, blankBetweenParagraphs: s.blankBetweenParagraphs } : {};
  const fn = kind === 'wattpad' ? toWattpad : toAO3;
  return chapters.map((c) => ({ title: c.title, html: fn(applyTextStyles(c.html), { ...exportOptions(), ...userOpts }) }));
}

async function publishCopy(kind, open) {
  const parts = publishHtml(kind);
  const html = parts.map((p) => (parts.length > 1 ? `<p style="text-align:center"><b>${escapeText(p.title)}</b></p>\n${p.html}` : p.html)).join('\n<p>&nbsp;</p>\n');
  const plain = parts.map((p) => p.html.replace(/<p>&nbsp;<\/p>/g, '').replace(/<br\s*\/?>/g, '\n').replace(/<\/p>/g, '\n\n').replace(/<hr \/>/g, `${state.project.settings.sceneBreak}\n\n`).replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()).join('\n\n');
  try {
    if (kind === 'wattpad' && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]);
    } else {
      await navigator.clipboard.writeText(kind === 'ao3' ? html : plain);
    }
    toast(kind === 'wattpad' ? 'Copiado! No Wattpad, abra a parte nova e cole com Ctrl+V (o título vai no campo de título).'
      : 'HTML copiado! No AO3, em “Post New Work”, escolha a aba HTML do texto e cole com Ctrl+V.');
  } catch {
    download(`${safeName(state.project.title)}-${kind}.html`, new Blob([html], { type: 'text/html' }));
    toast('O navegador não deixou copiar; baixei o arquivo.');
  }
  if (open) window.open(kind === 'wattpad' ? 'https://www.wattpad.com/myworks' : 'https://archiveofourown.org/works/new', '_blank', 'noopener');
}

function publishFile(kind) {
  const parts = publishHtml(kind);
  const body = parts.map((p) => `<!-- ${p.title.replace(/--/g, '—')} -->\n${p.html}`).join('\n\n');
  download(`${safeName(state.project.title)}-${kind}.html`, new Blob([`<!doctype html>\n<meta charset="utf-8">\n${body}\n`], { type: 'text/html' }));
}

async function exportDoc(kind) {
  await saveNow();
  const p = { ...state.project, chapters: state.project.chapters.map((c) => ({ ...c, html: kind === 'serifa' ? c.html : applyTextStyles(c.html) })) };
  const id = scopeId();
  const base = safeName(id ? `${p.title}-${currentChapter().title}` : p.title);
  if (kind === 'docx') download(`${base}.docx`, new Blob([projectToDocx(p, id)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  else if (kind === 'epub') download(`${safeName(p.title)}.epub`, new Blob([projectToEpub(p)], { type: 'application/epub+zip' }));
  else if (kind === 'html') download(`${base}.html`, new Blob([projectToHtml(p, id)], { type: 'text/html' }));
  else if (kind === 'md') download(`${base}.md`, new Blob([projectToMarkdown(p, id)], { type: 'text/markdown' }));
  else if (kind === 'txt') download(`${base}.txt`, new Blob([projectToText(p, id)], { type: 'text/plain' }));
  else if (kind === 'serifa') download(`${safeName(p.title)}.serifa`, new Blob([JSON.stringify({ ...p, words: totalWords() }, null, 2)], { type: 'application/json' }));
  if (kind === 'epub' && id) toast('O EPUB sempre leva o livro inteiro.');
}

function exportPdf() {
  const s = state.project.settings;
  const g = pageGeometry(s);
  let style = document.getElementById('printPage');
  if (!style) {
    style = document.createElement('style');
    style.id = 'printPage';
    document.head.append(style);
  }
  style.textContent = `@page { size: ${g.width}mm ${g.height}mm; margin: ${g.top}mm ${g.right}mm ${g.bottom}mm ${g.left}mm; }`;
  toast('Na janela de impressão, escolha “Salvar como PDF”.');
  setTimeout(() => window.print(), 300);
}

async function download(name, blob) {
  if (desk.isDesktop()) {
    try {
      const folder = storyFolder();
      const r = await desk.saveToFolder(folder, name, blob);
      toast(`Salvo em ${r.caminho}`, { label: 'Abrir pasta', fn: () => desk.openFolder(folder) });
      return;
    } catch (err) {
      toast(`Não consegui salvar na pasta (${err.message}). Baixando pelo navegador.`);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function safeName(s) {
  return (s || 'serifa').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'serifa';
}

// ---------------------------------------------------------------- diálogos de revisão
async function personalDictDialog() {
  const words = await store.listPersonal();
  const box = el('div');
  const render = (list) => {
    box.textContent = '';
    if (!list.length) box.append(el('p', { class: 'muted' }, 'Vazio. Clique com o botão direito numa palavra sublinhada e escolha “Adicionar ao dicionário”.'));
    const t = el('table');
    for (const w of list) {
      const b = el('button', { class: 'btn', type: 'button' }, 'Remover');
      b.addEventListener('click', async () => {
        await store.removePersonal(w);
        const next = await store.listPersonal();
        sendWorker({ type: 'personal', words: [...next, ...state.project.dictionary] });
        render(next);
        scheduleCheck(10);
      });
      t.append(el('tr', {}, el('td', {}, w), el('td', { class: 'num' }, b)));
    }
    box.append(t);
  };
  render(words);
  await dialog({ title: 'Dicionário pessoal', body: box, ok: 'Fechar', cancel: null });
}

async function wordCountDialog() {
  syncChapter();
  const ch = countText(editor.text);
  const all = countText(state.project.chapters.map((c) => (c.id === state.chapterId ? editor.text : textOfHtml(c.html))).join('\n'));
  const t = el('table');
  t.append(el('tr', {}, el('th', {}, ''), el('th', { class: 'num' }, 'Capítulo'), el('th', { class: 'num' }, 'História')));
  for (const [label, k] of [['Palavras', 'words'], ['Caracteres (com espaços)', 'characters'], ['Caracteres (sem espaços)', 'charactersNoSpaces'],
    ['Parágrafos', 'paragraphs'], ['Frases', 'sentences'], ['Falas (diálogos)', 'dialogues'], ['Tempo de leitura (min)', 'readingMinutes']]) {
    t.append(el('tr', {}, el('td', {}, label), el('td', { class: 'num' }, fmt(ch[k])), el('td', { class: 'num' }, fmt(all[k]))));
  }
  const note = el('p', { class: 'muted' }, `Contagem ${wasmReady() ? 'feita pelo núcleo em C (WebAssembly)' : 'feita em JavaScript'}. Hífen não separa palavras (guarda-chuva = 1); travessão separa.`);
  const body = el('div', {}, t, note);
  await dialog({ title: 'Contagem de palavras', body, ok: 'Fechar', cancel: null });
}

const STOP = new Set('a o e é de da do das dos em no na nos nas um uma uns umas que se por para com sem não mais mas como ao aos à às ou já eu ele ela eles elas você me te lhe nos seu sua seus suas meu minha foi era ser está estava há tem isso isto aquilo esse essa este esta pelo pela pelos pelas quando onde muito também só'.split(' '));
async function repeatedDialog() {
  const counts = new Map();
  for (const m of editor.text.toLocaleLowerCase('pt-BR').matchAll(/\p{L}+(?:-\p{L}+)*/gu)) {
    const w = m[0];
    if (w.length < 3 || STOP.has(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  const top = [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 30);
  const t = el('table');
  t.append(el('tr', {}, el('th', {}, 'Palavra'), el('th', { class: 'num' }, 'Vezes no capítulo')));
  for (const [w, n] of top) {
    const link = el('button', { class: 'btn', type: 'button' }, w);
    link.addEventListener('click', () => {
      $('dialog').close();
      openFind(false);
      $('findText').value = w;
      doFind();
      findStep(1);
    });
    t.append(el('tr', {}, el('td', {}, link), el('td', { class: 'num' }, fmt(n))));
  }
  await dialog({ title: 'Palavras repetidas', body: top.length ? t : el('p', { class: 'muted' }, 'Nenhuma repetição relevante.'), ok: 'Fechar', cancel: null });
}

function shortcutsDialog() {
  const rows = [['Ctrl+S', 'Salvar (no Chrome e no Edge, grava o .serifa onde você escolher)'], ['Ctrl+Shift+S', 'Salvar como…'], ['Ctrl+O', 'Minhas histórias'],
    ['Ctrl+N', 'Novo capítulo'], ['Ctrl+B / I / U', 'Negrito, itálico, sublinhado'], ['Ctrl+E / L / R / J', 'Centralizar, esquerda, direita, justificar'],
    ['Ctrl+0', 'Estilo Normal'], ['Ctrl+Alt+1 / 2 / 3', 'Título 1, 2 e 3'], ['Ctrl+Alt+4 a 8', 'Pensamento, Flashback, Mensagem, Carta e Nota do autor'], ['Ctrl+Enter', 'Quebra de página'], ['Ctrl+Shift+Enter', 'Quebra de cena'],
    ['Ctrl+F / Ctrl+H', 'Localizar / substituir'], ['Ctrl+Z / Ctrl+Y', 'Desfazer / refazer'], ['F7', 'Liga e desliga o corretor'],
    ['Shift+F7', 'Liga e desliga o balão de ideias'], ['F11', 'Modo foco'], ['Ctrl+Shift+D', 'Tema claro ou escuro'], ['Ctrl+= / Ctrl+-', 'Zoom'],
    ['-- (dois hífens)', 'Vira travessão —'], ['- e espaço no começo', 'Vira travessão de diálogo'], ['Botão direito', 'Sugestões do corretor e das ideias']];
  const t = el('table');
  for (const [k, v] of rows) t.append(el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, v)));
  dialog({ title: 'Atalhos do teclado', body: t, ok: 'Fechar', cancel: null });
}

function showTutorial() {
  closeLibrary();
  toggleDraftPanel(false);
  if (!state.prefs.showChapters) {
    state.prefs.showChapters = true;
    reflectToggles();
  }
  startTutorial({
    logo: 'img/logo.svg',
    onTab: (tab) => document.querySelector(`[data-tab="${tab}"]`)?.click(),
    onEnd: () => {
      state.prefs.tutorialDone = true;
      state.prefs.welcomed = true;
      savePrefs();
      document.querySelector('[data-tab="inicio"]')?.click();
      $('editor').focus();
    },
  });
}

// ---------------------------------------------------------------- atalhos e status
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F7') {
      e.preventDefault();
      if (e.shiftKey) toggleIdeas();
      else toggleSpell();
    } else if (e.key === 'F11') {
      e.preventDefault();
      toggleFocus();
    } else if (e.key === 'Escape') {
      if (isTutorialOpen()) return;
      hideMenu();
      hideBalloon();
      closeFontPicker();
      if (!$('library').hidden) closeLibrary();
      else if (!$('draftPanel').hidden && !$('dialog').open) toggleDraftPanel(false);
      if (document.body.classList.contains('focus')) toggleFocus();
    } else if (mod && k === 's') {
      e.preventDefault();
      saveCommand(e.shiftKey);
    } else if (mod && k === 'o') {
      e.preventDefault();
      projectsDialog();
    } else if (mod && k === 'n' && !e.shiftKey) {
      e.preventDefault();
      newChapter();
    } else if (mod && k === 'f') {
      e.preventDefault();
      openFind(false);
    } else if (mod && k === 'h') {
      e.preventDefault();
      openFind(true);
    } else if (mod && e.shiftKey && k === 'd') {
      e.preventDefault();
      run('theme-toggle');
    } else if (mod && e.key === 'Enter') {
      e.preventDefault();
      run(e.shiftKey ? 'scene-break' : 'page-break');
    } else if (mod && !e.shiftKey && ['e', 'l', 'r', 'j'].includes(k) && $('editor').contains(document.activeElement)) {
      e.preventDefault();
      run({ e: 'align-center', l: 'align-left', r: 'align-right', j: 'align-justify' }[k]);
    } else if (mod && e.altKey && ['1', '2', '3'].includes(e.key)) {
      e.preventDefault();
      run(`style-h${e.key}`);
    } else if (mod && e.altKey && ['4', '5', '6', '7', '8'].includes(e.key)) {
      e.preventDefault();
      toggleTextStyle(TEXT_STYLES[Number(e.key) - 4]);
    } else if (mod && !e.altKey && e.key === '0') {
      e.preventDefault();
      run('style-p');
    } else if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      setZoom(state.prefs.zoom + 10);
    } else if (mod && e.key === '-') {
      e.preventDefault();
      setZoom(state.prefs.zoom - 10);
    }
  });
}

function bindStatus() {
  $('zoomRange').addEventListener('input', () => setZoom(Number($('zoomRange').value)));
}

// ---------------------------------------------------------------- desktop, zip e importação de pasta
function folderName(s) {
  return (String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 80)) || 'Sem título';
}

function storyFolder() {
  if (!state.project.folder) {
    state.project.folder = folderName(state.project.title);
    markDirty();
  }
  return state.project.folder;
}

function serifaJson() {
  return JSON.stringify({ ...state.project, words: totalWords() }, null, 2);
}

let lastDesktopSave = 0;
let desktopTimer = null;
function desktopAutosave(now) {
  clearTimeout(desktopTimer);
  const wait = now ? 0 : Math.max(0, 3000 - (Date.now() - lastDesktopSave));
  desktopTimer = setTimeout(async () => {
    lastDesktopSave = Date.now();
    try {
      await desk.saveToFolder(storyFolder(), `${safeName(state.project.title)}.serifa`, new Blob([serifaJson()], { type: 'application/json' }));
      $('saveState').textContent = `Salvo na pasta às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch { }
  }, wait);
}

function renderConfig() {
  const on = desk.isDesktop();
  document.querySelectorAll('[data-desktop]').forEach((n) => { n.hidden = !on; });
  document.querySelectorAll('[data-web]').forEach((n) => { n.hidden = on; });
  if (!on) return;
  const di = desk.desktopInfo();
  $('cfgBase').value = di.base || '';
  $('cfgBase').title = di.base || '';
  $('cfgCreate').checked = di.criarPasta !== false;
  $('cfgAuto').checked = di.salvarAuto !== false;
  $('cfgDefaultNote').textContent = di.base === di.padrao ? 'Usando a pasta Downloads (padrão).' : `Padrão: ${di.padrao}`;
  $('storageBadge').title = `As histórias são salvas em ${di.base}`;
}

async function cfgChoose() {
  if (!desk.isDesktop()) return;
  try {
    const d = await desk.chooseBase();
    if (d.base) {
      await desk.setConfig({ base: d.base });
      renderConfig();
      toast(`As próximas histórias e arquivos vão para ${d.base}.`);
    }
  } catch (err) {
    toast(`Não foi possível escolher a pasta: ${err.message}`);
  }
}

async function cfgSet(cfg) {
  if (!desk.isDesktop()) return;
  try {
    await desk.setConfig(cfg);
    renderConfig();
    toast('Configuração salva.');
  } catch (err) {
    toast(`Não foi possível salvar a configuração: ${err.message}`);
  }
}

const ZIP_FORMATS = {
  docx: ['Word (.docx)', 'docx'], txt: ['Texto (.txt)', 'txt'], md: ['Markdown (.md)', 'md'], html: ['Página HTML (.html)', 'html'],
  wattpad: ['HTML para o Wattpad', 'html'], ao3: ['HTML para o AO3', 'html'],
};

async function exportZip() {
  syncChapter();
  const res = await dialog({ title: 'Exportar a história em .zip', fields: [
    { name: 'fmt', label: 'Formato de cada capítulo', type: 'select', value: 'docx', options: Object.entries(ZIP_FORMATS).map(([k, v]) => [k, v[0]]) },
    { name: 'serifa', label: 'Incluir também o arquivo .serifa da história?', type: 'select', value: 'sim', options: [['sim', 'Sim, para abrir no Serifa depois'], ['nao', 'Não']] }],
  body: el('p', { class: 'muted' }, `Cada capítulo vira um arquivo, numerado na ordem da história, dentro da pasta “${folderName(state.project.title)}”.`), ok: 'Gerar .zip' });
  if (!res) return;
  await saveNow();
  const p = { ...state.project, chapters: state.project.chapters.map((c) => ({ ...c, html: applyTextStyles(c.html) })) };
  const dir = folderName(p.title);
  const pad = String(p.chapters.length).length < 2 ? 2 : String(p.chapters.length).length;
  const ext = ZIP_FORMATS[res.fmt][1];
  const files = p.chapters.map((c, i) => {
    const name = `${dir}/${String(i + 1).padStart(pad, '0')} - ${folderName(c.title)}.${ext}`;
    let data;
    if (res.fmt === 'docx') data = projectToDocx(p, c.id);
    else if (res.fmt === 'txt') data = projectToText(p, c.id);
    else if (res.fmt === 'md') data = projectToMarkdown(p, c.id);
    else if (res.fmt === 'html') data = projectToHtml(p, c.id);
    else {
      const s = p.settings;
      const fn = res.fmt === 'wattpad' ? toWattpad : toAO3;
      const opts = { sceneBreak: s.sceneBreak || '* * *', ...(s.formatMode === res.fmt ? { blankBeforeDialogue: s.blankBeforeDialogue, blankAfterDialogue: s.blankAfterDialogue, blankBetweenParagraphs: s.blankBetweenParagraphs } : {}) };
      data = `<!doctype html>\n<meta charset="utf-8">\n<title>${escapeText(c.title)}</title>\n${fn(c.html, opts)}\n`;
    }
    return { name, data };
  });
  if (res.serifa === 'sim') files.push({ name: `${dir}/${dir}.serifa`, data: serifaJson() });
  const zip = makeZip(files, new Date());
  await download(`${safeName(p.title)}.zip`, new Blob([zip], { type: 'application/zip' }));
  if (!desk.isDesktop()) toast(`${p.chapters.length} capítulo(s) exportado(s) em .zip.`);
}

const IMPORT_EXT = { pdf: 'PDF', txt: 'TXT', md: 'Markdown', docx: 'Word' };

function chapterTitleFromFile(name) {
  let t = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^\d{1,4}\s*[-.)–—:]\s*(.+)$/.exec(t);
  if (m && m[1].trim()) t = m[1].trim();
  return t.slice(0, 200) || 'Capítulo';
}

async function decodeText(file) {
  const buf = await file.arrayBuffer();
  const utf = new TextDecoder('utf-8').decode(buf);
  if (!utf.includes('�')) return utf.replace(/^﻿/, '');
  return new TextDecoder('windows-1252').decode(buf);
}

let pdfjs = null;
async function pdfToHtml(file) {
  if (!pdfjs) {
    pdfjs = await import('../../vendor/pdfjs/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const lines = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    let cur = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5];
      const x = it.transform[4];
      if (!cur || (Math.abs(cur.y - y) > (it.height || 10) * 0.5 && it.str.trim())) {
        if (cur) lines.push(cur);
        cur = { text: '', y, x, h: it.height || 10, page: n };
      }
      cur.text += it.str;
      if (it.hasEOL) {
        lines.push(cur);
        cur = null;
      }
    }
    if (cur) lines.push(cur);
    page.cleanup();
  }
  await doc.destroy();
  const clean = lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text && !/^\d{1,4}$/.test(l.text));
  if (!clean.length) return '';
  const gaps = [];
  for (let k = 1; k < clean.length; k += 1) if (clean[k].page === clean[k - 1].page) gaps.push(Math.abs(clean[k - 1].y - clean[k].y));
  gaps.sort((a, b) => a - b);
  const typical = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 14;
  const minX = Math.min(...clean.map((l) => l.x));
  const paras = [];
  let buf = '';
  clean.forEach((l, k) => {
    const prev = clean[k - 1];
    let brk = !prev;
    if (prev) {
      const gap = prev.page === l.page ? Math.abs(prev.y - l.y) : typical;
      if (gap > typical * 1.45) brk = true;
      else if (l.x > minX + 8 && /[.!?…:”"»)]$/.test(prev.text)) brk = true;
      else if (/^[—–-]\s/.test(l.text) && /[.!?…:”"»)]$/.test(prev.text)) brk = true;
    }
    if (brk && buf) {
      paras.push(buf);
      buf = '';
    }
    buf = buf ? `${buf} ${l.text}` : l.text;
  });
  if (buf) paras.push(buf);
  return paras.map((t) => (/^(\*\s*){3,}$|^#$/.test(t) ? '<hr class="cena">' : `<p>${escapeText(t)}</p>`)).join('');
}

async function fileToHtml(file, ext) {
  if (ext === 'pdf') return pdfToHtml(file);
  if (ext === 'docx') return docxToHtml(await file.arrayBuffer());
  const text = await decodeText(file);
  if (ext === 'md') return textToHtml(text.replace(/^#+\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1'));
  return textToHtml(text);
}

async function importFolder(files) {
  if (!files.length) return;
  const root = (files[0].webkitRelativePath || '').split('/')[0] || 'Nova história';
  const items = [];
  const ignored = [];
  for (const f of files) {
    const rel = f.webkitRelativePath || f.name;
    if (/(^|\/)\./.test(rel)) continue;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (IMPORT_EXT[ext] && f.size <= 50 * 1024 * 1024) items.push({ file: f, ext, rel, title: chapterTitleFromFile(f.name), use: true });
    else ignored.push(rel);
  }
  items.sort((a, b) => a.rel.localeCompare(b.rel, 'pt-BR', { numeric: true, sensitivity: 'base' }));
  if (!items.length) {
    toast('Nenhum PDF, TXT, Markdown ou Word nessa pasta.');
    return;
  }
  const formats = [...new Set(items.map((i) => IMPORT_EXT[i.ext]))];
  const body = el('div', { class: 'imp' });
  if (formats.length > 1) {
    body.append(el('div', { class: 'imp-warn' }, el('b', {}, 'Atenção: formatos diferentes na pasta. '),
      `Há arquivos ${formats.join(', ')} misturados. Confira se todos são capítulos da mesma história e desmarque o que não for.`));
  }
  if (ignored.length) body.append(el('div', { class: 'imp-note' }, `${ignored.length} arquivo(s) de outros formatos ficaram de fora: ${ignored.slice(0, 6).join(', ')}${ignored.length > 6 ? '…' : ''}`));
  const all = el('label', { class: 'imp-all' }, el('input', { type: 'checkbox', checked: true }), ' Marcar todos');
  const count = el('span', { class: 'muted' });
  const list = el('ol', { class: 'imp-list' });
  const refresh = () => {
    const n = items.filter((i) => i.use).length;
    count.textContent = `${n} de ${items.length} capítulo(s) selecionado(s)`;
    all.querySelector('input').checked = n === items.length;
  };
  items.forEach((it) => {
    const chk = el('input', { type: 'checkbox', checked: true, 'aria-label': `Importar ${it.rel}` });
    chk.addEventListener('change', () => { it.use = chk.checked; li.classList.toggle('off', !chk.checked); refresh(); });
    const title = el('input', { type: 'text', value: it.title, maxlength: 200, 'aria-label': 'Título do capítulo' });
    title.addEventListener('input', () => { it.title = title.value; });
    const li = el('li', {}, chk, el('div', { class: 'imp-main' }, title, el('span', { class: 'imp-file' }, it.rel.split('/').slice(1).join('/') || it.rel)),
      el('span', { class: `imp-fmt f-${it.ext}` }, IMPORT_EXT[it.ext]), el('span', { class: 'imp-size' }, `${Math.max(1, Math.round(it.file.size / 1024))} KB`));
    it.chk = chk;
    it.li = li;
    list.append(li);
  });
  all.querySelector('input').addEventListener('change', (e) => {
    for (const it of items) {
      it.use = e.target.checked;
      it.chk.checked = it.use;
      it.li.classList.toggle('off', !it.use);
    }
    refresh();
  });
  body.append(el('div', { class: 'imp-bar' }, all, count), list,
    el('p', { class: 'muted' }, 'A ordem dos capítulos segue o nome dos arquivos (1, 2, 3… 10). PDFs escaneados como imagem não têm texto para importar.'));
  refresh();
  const res = await dialog({ title: 'Importar pasta como história', fields: [
    { name: 'title', label: 'Nome da história', value: root, required: true },
    { name: 'description', label: 'Descrição (opcional)', type: 'textarea', value: '' }], body, ok: 'Importar capítulos', wide: true });
  if (!res) return;
  const chosen = items.filter((i) => i.use);
  if (!chosen.length) {
    toast('Nenhum capítulo marcado.');
    return;
  }
  await saveNow();
  const p = newProjectDoc(res.title.trim() || root, res.description.trim().slice(0, 2000));
  p.folder = folderName(p.title);
  p.chapters = [];
  const falhas = [];
  for (let k = 0; k < chosen.length; k += 1) {
    const it = chosen[k];
    toast(`Lendo ${k + 1} de ${chosen.length}: ${it.file.name}`);
    try {
      const html = sanitizeHtml(await fileToHtml(it.file, it.ext)) || '<p><br></p>';
      p.chapters.push(newChapterDoc(it.title.trim() || `Capítulo ${k + 1}`, p.chapters.length, html));
    } catch (err) {
      falhas.push(it.file.name);
    }
  }
  if (!p.chapters.length) {
    toast('Não consegui ler nenhum dos arquivos.');
    return;
  }
  await store.saveProject(p);
  closeLibrary();
  await openProject(p);
  if (desk.isDesktop() && desk.desktopInfo().criarPasta) desk.createFolder(p.folder).then(() => desktopAutosave(true)).catch(() => {});
  const empty = state.project.chapters.filter((c) => !c.words).length;
  toast(`“${p.title}” importada com ${p.chapters.length} capítulo(s).${falhas.length ? ` Não deu para ler: ${falhas.join(', ')}.` : ''}${empty ? ` ${empty} capítulo(s) ficaram sem texto.` : ''}`);
}

// ---------------------------------------------------------------- servidor Java (opcional)
async function detectServer() {
  // só o servidor Java tem a API; o GitHub Pages e o visualizar.bat (portas 8790-8820) não
  const port = Number(location.port);
  if (!['localhost', '127.0.0.1'].includes(location.hostname) || (port >= 8790 && port <= 8820)) return;
  try {
    const res = await fetch('api/v1/health', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.status === 'ok') {
      state.server = true;
      $('storageBadge').textContent = 'Servidor local + navegador';
      $('storageBadge').title = `API do Serifa ${data.version || ''} neste computador`;
    }
  } catch { /* sem servidor: tudo fica no navegador */ }
}

async function syncServer(doc) {
  try {
    const body = JSON.stringify(doc);
    let res = await fetch(`api/v1/projects/${encodeURIComponent(doc.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    if (res.status === 404) res = await fetch('api/v1/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    $('storageBadge').textContent = 'Neste navegador (servidor fora do ar)';
  }
}

main().catch((err) => {
  console.error(err);
  toast(`Erro ao iniciar: ${err.message}`);
});

export { VERSION };
