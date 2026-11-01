import { el, uiZoom } from './dialogs.js';

export const FONT_GROUPS = [
  ['sistema', 'Do computador'],
  ['livro', 'Livro e romance'],
  ['moderna', 'Modernas e limpas'],
  ['maquina', 'Máquina de escrever'],
  ['manuscrita', 'Manuscritas'],
  ['tematica', 'Temáticas'],
];

const GROUPED = {
  sistema: ['Georgia', 'Times New Roman', 'Garamond', 'Palatino Linotype', 'Book Antiqua', 'Cambria', 'Constantia', 'Calibri',
    'Arial', 'Verdana', 'Trebuchet MS', 'Segoe UI', 'Courier New', 'Comic Sans MS'],
  livro: ['Lora', 'Merriweather', 'EB Garamond', 'Libre Baskerville', 'Crimson Text', 'Crimson Pro', 'Playfair Display',
    'Cormorant Garamond', 'Spectral', 'Source Serif 4', 'PT Serif', 'Noto Serif', 'Libre Caslon Text', 'Literata', 'Alegreya',
    'Vollkorn', 'Cardo', 'Old Standard TT', 'Gentium Book Plus', 'Bitter', 'Domine', 'Zilla Slab', 'Roboto Slab', 'Newsreader',
    'Gelasio', 'IM Fell English'],
  moderna: ['Inter', 'Open Sans', 'Lato', 'Roboto', 'Nunito', 'Poppins', 'Montserrat', 'Raleway', 'Work Sans', 'Source Sans 3',
    'Atkinson Hyperlegible', 'Lexend', 'Quicksand', 'Karla', 'DM Sans', 'Fira Sans', 'PT Sans', 'Josefin Sans', 'Comfortaa'],
  maquina: ['Courier Prime', 'Special Elite', 'IBM Plex Mono', 'JetBrains Mono', 'Space Mono', 'Cutive Mono'],
  manuscrita: ['Caveat', 'Dancing Script', 'Indie Flower', 'Patrick Hand', 'Shadows Into Light', 'Kalam', 'Satisfy', 'Great Vibes',
    'Gloria Hallelujah', 'Architects Daughter', 'Homemade Apple', 'Sacramento', 'Parisienne'],
  tematica: ['Cinzel', 'Uncial Antiqua', 'MedievalSharp', 'Pirata One', 'UnifrakturMaguntia', 'Creepster', 'Orbitron', 'Audiowide',
    'Press Start 2P', 'VT323', 'Amatic SC', 'Lobster', 'Pacifico'],
};

const HINTS = {
  Lora: 'romance', 'EB Garamond': 'clássico', 'Libre Baskerville': 'livro impresso', Literata: 'leitura longa', Merriweather: 'leitura na tela',
  'Playfair Display': 'títulos elegantes', 'IM Fell English': 'época', 'Atkinson Hyperlegible': 'alta legibilidade', Lexend: 'leitura fácil',
  'Courier Prime': 'manuscrito de editora', 'Special Elite': 'máquina antiga', Caveat: 'diário', Kalam: 'cartas', 'Great Vibes': 'convites',
  Cinzel: 'épico', 'Uncial Antiqua': 'fantasia celta', MedievalSharp: 'medieval', 'Pirata One': 'piratas', UnifrakturMaguntia: 'gótico',
  Creepster: 'terror', Orbitron: 'ficção científica', Audiowide: 'futurista', 'Press Start 2P': 'games e pixel', VT323: 'terminal retrô',
  'Amatic SC': 'cartaz', Lobster: 'retrô', Pacifico: 'praia e verão', 'Comic Sans MS': 'informal',
};

export const ALL_FONTS = FONT_GROUPS.flatMap(([g]) => GROUPED[g].map((name) => ({ name, group: g, hint: HINTS[name] || '' })));
export const BUNDLED_COUNT = ALL_FONTS.filter((f) => f.group !== 'sistema').length;

export function fontStack(name) {
  const f = ALL_FONTS.find((x) => x.name === name);
  const fallback = f && (f.group === 'moderna' ? 'system-ui, sans-serif' : f.group === 'maquina' ? 'monospace' : f.group === 'manuscrita' ? 'cursive' : 'Georgia, serif');
  return `'${name}', ${fallback || 'Georgia, serif'}`;
}

function readRecent() {
  try {
    const v = JSON.parse(localStorage.getItem('serifa.fontesRecentes') || '[]');
    return Array.isArray(v) ? v.filter((n) => ALL_FONTS.some((f) => f.name === n)).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function pushRecent(name) {
  try {
    const list = [name, ...readRecent().filter((n) => n !== name)].slice(0, 6);
    localStorage.setItem('serifa.fontesRecentes', JSON.stringify(list));
  } catch { }
}

let openPicker = null;

export function closeFontPicker() {
  if (openPicker) {
    openPicker.remove();
    openPicker = null;
  }
}

export function showFontPicker(anchor, current, onPick, { title = 'Escolha a fonte', sample = 'Era uma vez, num lugar distante…' } = {}) {
  closeFontPicker();
  const box = el('div', { class: 'font-picker', role: 'dialog', 'aria-label': title });
  const search = el('input', { type: 'search', placeholder: `Procurar entre ${ALL_FONTS.length} fontes…`, 'aria-label': 'Procurar fonte' });
  const chips = el('div', { class: 'fp-chips' });
  const list = el('div', { class: 'fp-list', role: 'listbox' });
  let group = 'todas';
  const groups = [['todas', 'Todas'], ['recentes', 'Recentes'], ...FONT_GROUPS];
  for (const [g, label] of groups) {
    const c = el('button', { type: 'button', class: 'fp-chip', 'data-g': g, 'aria-pressed': String(g === group) }, label);
    c.addEventListener('click', () => {
      group = g;
      chips.querySelectorAll('.fp-chip').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.g === g)));
      render();
    });
    chips.append(c);
  }
  const render = () => {
    const q = search.value.trim().toLocaleLowerCase('pt-BR');
    list.textContent = '';
    const recent = readRecent();
    let items = ALL_FONTS;
    if (group === 'recentes') items = recent.map((n) => ALL_FONTS.find((f) => f.name === n));
    else if (group !== 'todas') items = ALL_FONTS.filter((f) => f.group === group);
    if (q) items = items.filter((f) => f.name.toLocaleLowerCase('pt-BR').includes(q) || f.hint.includes(q));
    if (!items.length) list.append(el('div', { class: 'fp-empty' }, group === 'recentes' && !q ? 'As fontes que você usar aparecem aqui.' : 'Nenhuma fonte com esse nome.'));
    let lastGroup = null;
    for (const f of items) {
      if (group === 'todas' && !q && f.group !== lastGroup) {
        lastGroup = f.group;
        list.append(el('div', { class: 'fp-group' }, FONT_GROUPS.find(([g]) => g === f.group)[1]));
      }
      const item = el('button', { type: 'button', class: 'fp-item', role: 'option', 'aria-selected': String(f.name === current) });
      const name = el('span', { class: 'fp-name' }, f.name);
      name.style.fontFamily = fontStack(f.name);
      const prev = el('span', { class: 'fp-sample' }, sample);
      prev.style.fontFamily = fontStack(f.name);
      item.append(name, f.hint ? el('span', { class: 'fp-hint' }, f.hint) : '', prev);
      item.addEventListener('click', () => {
        pushRecent(f.name);
        closeFontPicker();
        onPick(f.name);
      });
      list.append(item);
    }
  };
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFontPicker();
    if (e.key === 'Enter') list.querySelector('.fp-item')?.click();
  });
  box.append(el('div', { class: 'fp-head' }, el('b', {}, title), el('span', { class: 'fp-count' }, `${ALL_FONTS.length} fontes`)), search, chips, list);
  document.body.append(box);
  openPicker = box;
  const u = uiZoom();
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth / u;
  const vh = window.innerHeight / u;
  const w = Math.min(380, vw - 16);
  box.style.width = `${w}px`;
  box.style.left = `${Math.max(8, Math.min(r.left / u, vw - w - 8))}px`;
  box.style.top = `${Math.max(8, Math.min(r.bottom / u + 6, vh - Math.min(460, vh * 0.8) - 8))}px`;
  render();
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  search.focus();
  setTimeout(() => {
    const away = (e) => {
      if (!openPicker) return document.removeEventListener('mousedown', away);
      if (!box.contains(e.target) && !anchor.contains(e.target)) {
        closeFontPicker();
        document.removeEventListener('mousedown', away);
      }
    };
    document.addEventListener('mousedown', away);
  }, 0);
}
