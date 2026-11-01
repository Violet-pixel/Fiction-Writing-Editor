/* Serifa — paginação dos PDFs no navegador.
   Copyright (©) 2026 Clara Portes

   Lê o conteúdo de #fonte (capa, sumário e seções .capitulo), distribui os blocos em
   páginas A4 de tamanho fixo (cabeçalho, corpo e rodapé com número), divide tabelas,
   listas e blocos de código entre páginas, monta o sumário com os números de página e
   coloca as capturas de tela que existirem em docs/images.

   Variáveis definidas pelo scripts/build-pdfs.js antes da página carregar:
     window.__SERIFA_IMAGENS__  nomes dos arquivos de imagem encontrados em docs/images
     window.__SERIFA_LEGENDAS__ legendas opcionais (docs/images/legendas.json)
*/
(function () {
  'use strict';

  const APP = 'Serifa';
  const COPY = 'Copyright (©) 2026 Clara Portes';
  const PASTA_IMAGENS = '../images/';

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function legendaDoNome(nome) {
    const base = nome.replace(/\.[a-z0-9]+$/i, '').replace(/^tela-/, '').replace(/^\d+-/, '');
    const t = base.replace(/[-_]+/g, ' ').trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* ---------- Figuras a partir de docs/images ---------- */
  async function prepararFiguras(fonte) {
    const imagens = Array.isArray(window.__SERIFA_IMAGENS__) ? window.__SERIFA_IMAGENS__ : [];
    const legendas = window.__SERIFA_LEGENDAS__ || {};
    const existe = new Set(imagens);
    const usados = new Set();

    fonte.querySelectorAll('figure.tela').forEach((f) => {
      // data-src pode ter alternativas separadas por espaço: usa a primeira que existir
      const opcoes = (f.dataset.src || '').split(/\s+/).filter(Boolean);
      const nome = opcoes.find((n) => existe.has(n));
      if (!nome) { f.remove(); return; }
      usados.add(nome);
      const img = el('img');
      img.src = PASTA_IMAGENS + encodeURIComponent(nome);
      const cap = f.querySelector('figcaption');
      if (legendas[nome] && cap) cap.textContent = legendas[nome];
      img.alt = cap ? cap.textContent : legendaDoNome(nome);
      f.insertBefore(img, f.firstChild);
    });

    // Capturas que nenhum trecho do texto citou vão para a galeria (se o documento tiver uma).
    const galeria = fonte.querySelector('#galeria');
    if (galeria) {
      const sobra = imagens.filter((n) => /^tela-.*\.(png|jpe?g|webp)$/i.test(n) && !usados.has(n));
      if (!sobra.length) {
        galeria.remove();
      } else {
        for (const nome of sobra) {
          const f = el('figure', 'tela');
          const img = el('img');
          img.src = PASTA_IMAGENS + encodeURIComponent(nome);
          const cap = el('figcaption');
          cap.textContent = legendas[nome] || legendaDoNome(nome);
          img.alt = cap.textContent;
          f.appendChild(img);
          f.appendChild(cap);
          galeria.appendChild(f);
        }
      }
    }

    let n = 0;
    fonte.querySelectorAll('figure figcaption').forEach((c) => {
      n += 1;
      c.insertBefore(el('span', 'fig-num', 'Figura ' + n + ' · '), c.firstChild);
    });

    const imgs = Array.from(fonte.querySelectorAll('img'));
    await Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => {}) : Promise.resolve())));
    // imagem que não carregou: tira a figura inteira
    imgs.forEach((i) => { if (!i.naturalWidth) { const f = i.closest('figure'); if (f) f.remove(); } });
  }

  /* ---------- Paginação ---------- */
  function paginar(fonte, saida) {
    const DOC = document.body.dataset.doc || '';
    const LOGO = (document.getElementById('logo') || { innerHTML: '' }).innerHTML;
    let corpo = null;

    function criarPagina(classe) {
      const p = el('div', 'pagina' + (classe ? ' ' + classe : ''));
      p.innerHTML =
        '<header class="cab"><span class="marca">' + LOGO + '<span>' + APP + '</span></span>' +
        '<span class="doc">' + DOC + '</span></header>' +
        '<div class="corpo"></div>' +
        '<footer class="rod"><span>' + APP + ' · ' + DOC + ' · ' + COPY + '</span><span class="num"></span></footer>';
      saida.appendChild(p);
      return p.querySelector('.corpo');
    }

    const cabe = () => corpo.scrollHeight <= corpo.clientHeight + 1;
    const ehTitulo = (e) => /^H[1-4]$/.test(e.tagName) || e.classList.contains('rotulo') || e.classList.contains('manter');

    function novaPagina(semLevar) {
      const levar = [];
      if (corpo && !semLevar) {
        let k = corpo.children.length;
        while (k > 0 && ehTitulo(corpo.children[k - 1])) k -= 1;
        if (k > 0) while (corpo.children.length > k) levar.unshift(corpo.lastElementChild), corpo.lastElementChild.remove();
      }
      corpo = criarPagina();
      levar.forEach((e) => corpo.appendChild(e));
    }

    function partes(e) {
      if (e.tagName === 'TABLE' && e.tBodies.length === 1 && e.tBodies[0].rows.length > 1) {
        return {
          itens: Array.from(e.tBodies[0].rows),
          casca() {
            const c = e.cloneNode(false);
            if (e.tHead) c.appendChild(e.tHead.cloneNode(true));
            const tb = document.createElement('tbody');
            c.appendChild(tb);
            return { raiz: c, caixa: tb };
          },
        };
      }
      if ((e.tagName === 'UL' || e.tagName === 'OL') && e.children.length > 1) {
        const inicio = parseInt(e.getAttribute('start') || '1', 10);
        return {
          itens: Array.from(e.children),
          casca(i) {
            const c = e.cloneNode(false);
            if (e.tagName === 'OL') {
              c.setAttribute('start', String(inicio + i));
              if (c.classList.contains('passos')) c.style.counterReset = 'passo ' + (inicio + i - 1);
            }
            return { raiz: c, caixa: c };
          },
        };
      }
      if (e.tagName === 'PRE') {
        const linhas = e.innerHTML.replace(/\n$/, '').split('\n');
        if (linhas.length < 4) return null;
        return {
          itens: linhas.map((l) => el('span', 'ln', l || ' ')),
          casca() { const c = e.cloneNode(false); return { raiz: c, caixa: c }; },
        };
      }
      return null;
    }

    function dividir(e, p) {
      let pedaco = p.casca(0);
      corpo.appendChild(pedaco.raiz);
      let naPagina = 0;
      for (let i = 0; i < p.itens.length; i += 1) {
        pedaco.caixa.appendChild(p.itens[i]);
        if (cabe()) { naPagina += 1; continue; }
        pedaco.caixa.removeChild(p.itens[i]);
        if (naPagina === 0) pedaco.raiz.remove();
        if (naPagina === 0 && corpo.children.length === 0) {
          // nem um item cabe numa página vazia: coloca assim mesmo
          corpo.appendChild(pedaco.raiz);
          pedaco.caixa.appendChild(p.itens[i]);
          naPagina = 1;
          continue;
        }
        novaPagina();
        pedaco = p.casca(i);
        corpo.appendChild(pedaco.raiz);
        pedaco.caixa.appendChild(p.itens[i]);
        naPagina = 1;
      }
    }

    function colocar(e) {
      corpo.appendChild(e);
      if (cabe()) return;
      e.remove();
      const p = partes(e);
      if (p) { dividir(e, p); return; }
      if (corpo.children.length === 0) { corpo.appendChild(e); return; }
      novaPagina();
      corpo.appendChild(e);
    }

    // 1) Capa
    const capa = fonte.querySelector('.capa');
    if (capa) {
      const pg = el('div', 'pagina capa');
      pg.appendChild(capa);
      saida.appendChild(pg);
    }

    // 2) Sumário (números preenchidos no fim)
    const capitulos = Array.from(fonte.querySelectorAll('section.capitulo'));
    let idSeq = 0;
    const entradas = [];
    capitulos.forEach((cap) => {
      cap.querySelectorAll('h1, h2').forEach((h) => {
        if (!h.id) h.id = 'sec-' + (++idSeq);
        if (h.closest('.sem-sumario')) return;
        entradas.push({ id: h.id, nivel: h.tagName === 'H1' ? 1 : 2, texto: h.dataset.curto || h.textContent.trim() });
      });
    });
    if (fonte.querySelector('#sumario')) {
      novaPagina(true);
      colocar(el('h1', null, 'Sumário'));
      for (const ent of entradas) {
        const a = el('a', 'toc n' + ent.nivel);
        a.href = '#' + ent.id;
        a.appendChild(el('span', 't', ent.texto));
        const pg = el('span', 'p', '00');
        pg.dataset.alvo = ent.id;
        a.appendChild(pg);
        colocar(a);
      }
    }

    // 3) Capítulos
    let numCap = 0;
    capitulos.forEach((cap) => {
      novaPagina(true);
      const semNumero = cap.classList.contains('sem-numero');
      if (!semNumero) {
        numCap += 1;
        colocar(el('div', 'rotulo', cap.dataset.rotulo || 'Capítulo ' + numCap));
      } else if (cap.dataset.rotulo) {
        colocar(el('div', 'rotulo', cap.dataset.rotulo));
      }
      Array.from(cap.children).forEach((filho) => colocar(filho));
    });

    // 4) Números de página e sumário
    const paginas = Array.from(saida.querySelectorAll('.pagina'));
    paginas.forEach((p, i) => {
      p.dataset.num = String(i + 1);
      const n = p.querySelector('.rod .num');
      if (n) n.textContent = String(i + 1);
    });
    saida.querySelectorAll('.toc .p').forEach((s) => {
      const alvo = document.getElementById(s.dataset.alvo);
      const pg = alvo && alvo.closest('.pagina');
      s.textContent = pg ? pg.dataset.num : '';
    });
    return paginas.length;
  }

  async function iniciar() {
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const fonte = document.getElementById('fonte');
      await prepararFiguras(fonte);
      const saida = el('div');
      saida.id = 'paginas';
      document.body.appendChild(saida);
      const total = paginar(fonte, saida);
      fonte.remove();
      document.body.dataset.paginas = String(total);
      document.body.dataset.pronto = '1';
    } catch (err) {
      document.body.dataset.erro = String(err && err.stack || err);
      document.body.dataset.pronto = '1';
    }
  }

  if (document.readyState === 'complete') iniciar();
  else window.addEventListener('load', iniciar);
})();
