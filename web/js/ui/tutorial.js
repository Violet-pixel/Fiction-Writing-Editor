import { el, uiZoom } from './dialogs.js';

const STEPS = [
  { intro: true, icon: '✒', title: 'Boas-vindas ao Serifa', text: 'Um editor feito para quem escreve histórias e fanfics. Em um minuto você conhece o essencial. Se preferir, pule e comece a escrever agora.' },
  { target: '#btnLibrary', icon: '📚', title: 'Suas histórias', text: 'Cada história tem nome, descrição e capítulos. Aqui você cria uma nova, troca de história, importa uma pasta de capítulos e vê quantas palavras já escreveu.' },
  { target: '.story-head', icon: '🪶', title: 'A história aberta', text: 'Nome e descrição ficam no topo da lateral. O lápis edita a sinopse quando você quiser.' },
  { target: '#chapterList', icon: '📖', title: 'Capítulo por capítulo', text: 'Clique para abrir, arraste para mudar a ordem e use os três pontinhos para renomear, duplicar ou excluir. A bolinha mostra se está em rascunho, revisão ou pronto.' },
  { target: '#btnAddChapter', icon: '＋', title: 'Novo capítulo', text: 'Entra no fim da lista com o título pronto para digitar. Atalho: Ctrl+N.' },
  { target: '.draft', icon: '📝', title: 'Rascunho do capítulo', text: 'Situação e notas rápidas. O botão ⤢ expande o painel com resumo, ponto de vista, meta do capítulo e estatísticas.' },
  { target: '#sheet', icon: '📄', title: 'A folha', text: 'Escreva aqui. Tudo é salvo sozinho enquanto você digita.' },
  { target: '#styleGallery', tab: 'inicio', icon: '💬', title: 'Estilos para fanfic', text: 'Pensamento, flashback, mensagem de celular, carta e nota do autor. Coloque o cursor no parágrafo e clique.' },
  { target: '#fontPickerBtn', tab: 'inicio', icon: 'Aa', title: 'Mais de 90 fontes', text: 'De livro, modernas, de máquina de escrever, manuscritas e temáticas. Sem nada selecionado, a fonte vale para a história toda.' },
  { target: '[data-tab="layout"]', icon: '📐', title: 'Wattpad, AO3 ou livro', text: 'Em Layout, escolha onde vai publicar: o Serifa ajusta recuo e linhas antes dos diálogos.' },
  { target: '[data-tab="exportar"]', icon: '🚀', title: 'Publicar e exportar', text: 'Copie o capítulo para o Wattpad ou o AO3, baixe em Word, EPUB e PDF, ou leve a história inteira num .zip.' },
  { target: '[data-tab="config"]', icon: '⚙', title: 'Configurações', text: 'Tamanho da interface e, no Serifa para Windows, a pasta onde cada história é salva (Downloads, por padrão).' },
  { target: '.statusbar', icon: '🔢', title: 'Contador e revisão', text: 'Palavras do capítulo e da história, meta diária, corretor e balão de ideias.' },
  { outro: true, icon: '✓', title: 'Tudo pronto!', text: 'Reveja este tutorial quando quiser no botão “? Ajuda”. Boa escrita!' },
];

let active = null;

export function isTutorialOpen() {
  return Boolean(active);
}

export function startTutorial({ onTab, onEnd, logo } = {}) {
  if (active) active.finish(false);
  let i = 0;
  let busy = false;
  const shade = el('div', { class: 'tour-shade' });
  const ring = el('div', { class: 'tour-ring', hidden: true });
  const card = el('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-live': 'polite' });
  document.body.append(shade, ring, card);
  requestAnimationFrame(() => shade.classList.add('on'));
  const finish = (completed) => {
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', keys, true);
    card.classList.add('out');
    shade.classList.remove('on');
    ring.classList.add('out');
    setTimeout(() => {
      shade.remove();
      ring.remove();
      card.remove();
    }, 220);
    active = null;
    if (onEnd) onEnd(completed);
  };
  const keys = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    }
  };
  const target = () => {
    const s = STEPS[i];
    if (!s.target) return null;
    const t = document.querySelector(s.target);
    if (!t) return null;
    const b = t.getBoundingClientRect();
    const u = uiZoom();
    const r = { left: b.left / u, top: b.top / u, width: b.width / u, height: b.height / u, right: b.right / u, bottom: b.bottom / u };
    return r.width && r.height ? r : null;
  };
  function place() {
    const r = target();
    const pad = 8;
    const u = uiZoom();
    const vw = window.innerWidth / u;
    const vh = window.innerHeight / u;
    if (r) {
      ring.hidden = false;
      shade.classList.add('clear');
      ring.style.left = `${r.left - pad}px`;
      ring.style.top = `${r.top - pad}px`;
      ring.style.width = `${r.width + pad * 2}px`;
      ring.style.height = `${r.height + pad * 2}px`;
      const cw = card.offsetWidth;
      const ch = card.offsetHeight;
      let left = r.left + r.width / 2 - cw / 2;
      let top = r.bottom + 18;
      card.dataset.side = 'below';
      if (top + ch > vh - 12) {
        top = r.top - ch - 18;
        card.dataset.side = 'above';
      }
      if (top < 12) {
        top = Math.min(vh - ch - 12, Math.max(12, r.top + 12));
        left = r.right + 18 + cw < vw ? r.right + 18 : r.left - cw - 18;
        card.dataset.side = 'side';
      }
      card.style.left = `${Math.max(12, Math.min(left, vw - cw - 12))}px`;
      card.style.top = `${Math.max(12, top)}px`;
      card.classList.remove('center');
    } else {
      ring.hidden = true;
      shade.classList.remove('clear');
      card.classList.add('center');
      card.style.left = `${(vw - card.offsetWidth) / 2}px`;
      card.style.top = `${Math.max(12, (vh - card.offsetHeight) / 2)}px`;
    }
  }
  function render() {
    const s = STEPS[i];
    if (s.tab && onTab) onTab(s.tab);
    card.textContent = '';
    card.classList.toggle('hero', Boolean(s.intro || s.outro));
    const progress = el('div', { class: 'tour-progress' }, el('span', { style: `width:${Math.round(((i + 1) / STEPS.length) * 100)}%` }));
    const skip = el('button', { type: 'button', class: 'tour-skip' }, s.intro ? 'Pular e começar a escrever' : 'Pular tutorial');
    skip.addEventListener('click', () => finish(false));
    const back = el('button', { type: 'button', class: 'btn' }, 'Voltar');
    back.addEventListener('click', () => go(-1));
    const next = el('button', { type: 'button', class: 'btn primary' }, s.outro ? 'Começar a escrever' : s.intro ? 'Fazer o tour  →' : 'Próximo  →');
    next.addEventListener('click', () => go(1));
    const icon = el('div', { class: 'tour-icon', 'aria-hidden': 'true' });
    if (s.intro && logo) icon.append(el('img', { src: logo, alt: '' }));
    else icon.append(s.icon);
    card.append(progress);
    if (s.intro || s.outro) {
      card.append(icon, el('h3', {}, s.title), el('p', {}, s.text));
      if (s.intro) {
        const chips = el('div', { class: 'tour-chips' });
        for (const t of ['Histórias e capítulos', 'Estilos para fanfic', '90+ fontes', 'Wattpad e AO3']) chips.append(el('span', {}, t));
        card.append(chips);
      }
      card.append(el('div', { class: 'tour-foot hero-foot' }, s.intro ? skip : (i ? back : ''), next));
    } else {
      card.append(
        el('div', { class: 'tour-top' }, icon, el('div', { class: 'tour-head' }, el('span', { class: 'tour-step' }, `Passo ${i} de ${STEPS.length - 2}`), el('h3', {}, s.title)), skip),
        el('p', {}, s.text),
        el('div', { class: 'tour-foot' }, el('span', { class: 'tour-keys' }, el('kbd', {}, '←'), el('kbd', {}, '→'), ' navegar · ', el('kbd', {}, 'Esc'), ' sair'), el('div', { class: 'tour-acts' }, back, next)),
      );
    }
    requestAnimationFrame(() => {
      place();
      card.classList.remove('out');
      card.classList.add('in');
      next.focus({ preventScroll: true });
    });
  }
  function go(d) {
    if (busy) return;
    const n = i + d;
    if (n < 0) return;
    if (n >= STEPS.length) {
      finish(true);
      return;
    }
    busy = true;
    card.classList.remove('in');
    card.classList.add('out');
    setTimeout(() => {
      i = n;
      render();
      busy = false;
    }, 140);
  }
  window.addEventListener('resize', place);
  document.addEventListener('keydown', keys, true);
  active = { finish };
  render();
}
