// Armazenamento no navegador (IndexedDB). Os object stores espelham as tabelas do banco do servidor
// (veja Banco-de-Dados-Serifa.pdf): projetos, capitulos, revisoes, dicionario, sessoes e preferencias.

const DB_NAME = 'serifa';
const DB_VERSION = 1;
const MAX_REVISIONS = 50;
let dbPromise = null;
const memory = { projetos: new Map(), capitulos: new Map(), revisoes: new Map(), dicionario: new Map(), sessoes: new Map(), preferencias: new Map() };
let useMemory = false;
let seq = 1;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      useMemory = true;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projetos')) db.createObjectStore('projetos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('capitulos')) {
        db.createObjectStore('capitulos', { keyPath: 'id' }).createIndex('projetoId', 'projetoId');
      }
      if (!db.objectStoreNames.contains('revisoes')) {
        db.createObjectStore('revisoes', { keyPath: 'id', autoIncrement: true }).createIndex('projetoId', 'projetoId');
      }
      if (!db.objectStoreNames.contains('dicionario')) db.createObjectStore('dicionario', { keyPath: 'palavra' });
      if (!db.objectStoreNames.contains('sessoes')) {
        db.createObjectStore('sessoes', { keyPath: 'dia' });
      }
      if (!db.objectStoreNames.contains('preferencias')) db.createObjectStore('preferencias', { keyPath: 'chave' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      useMemory = true;
      resolve(null);
    };
    req.onblocked = () => {
      useMemory = true;
      resolve(null);
    };
  });
  return dbPromise;
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  if (!db || useMemory) return fn(null, memory[store]);
  const t = db.transaction(store, mode);
  const result = await fn(t.objectStore(store), null);
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return result;
}

export function isPersistent() {
  return !useMemory;
}

export async function listProjects() {
  return tx('projetos', 'readonly', async (s, m) => {
    const all = m ? [...m.values()] : await reqP(s.getAll());
    return all.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  });
}

export async function loadProject(id) {
  const meta = await tx('projetos', 'readonly', (s, m) => (m ? m.get(id) : reqP(s.get(id))));
  if (!meta) return null;
  const chapters = await tx('capitulos', 'readonly', (s, m) => {
    if (m) return [...m.values()].filter((c) => c.projetoId === id);
    return reqP(s.index('projetoId').getAll(id));
  });
  chapters.sort((a, b) => a.position - b.position);
  const { projetoId, ...rest } = meta;
  return { ...rest, chapters: chapters.map(({ projetoId: _p, ...c }) => c) };
}

/** Grava o projeto inteiro (metadados e capítulos) e apaga capítulos que saíram. */
export async function saveProject(project) {
  const { chapters, ...meta } = project;
  await tx('projetos', 'readwrite', (s, m) => (m ? m.set(meta.id, meta) : reqP(s.put(meta))));
  const ids = new Set(chapters.map((c) => c.id));
  await tx('capitulos', 'readwrite', async (s, m) => {
    if (m) {
      for (const [k, v] of m) if (v.projetoId === project.id && !ids.has(k)) m.delete(k);
      for (const c of chapters) m.set(c.id, { ...c, projetoId: project.id });
      return;
    }
    const existing = await reqP(s.index('projetoId').getAllKeys(project.id));
    for (const k of existing) if (!ids.has(k)) s.delete(k);
    for (const c of chapters) s.put({ ...c, projetoId: project.id });
  });
}

export async function saveChapter(projectId, chapter) {
  await tx('capitulos', 'readwrite', (s, m) => (m ? m.set(chapter.id, { ...chapter, projetoId: projectId }) : reqP(s.put({ ...chapter, projetoId: projectId }))));
}

export async function deleteProject(id) {
  await tx('projetos', 'readwrite', (s, m) => (m ? m.delete(id) : reqP(s.delete(id))));
  await tx('capitulos', 'readwrite', async (s, m) => {
    if (m) {
      for (const [k, v] of m) if (v.projetoId === id) m.delete(k);
      return;
    }
    for (const k of await reqP(s.index('projetoId').getAllKeys(id))) s.delete(k);
  });
  await tx('revisoes', 'readwrite', async (s, m) => {
    if (m) {
      for (const [k, v] of m) if (v.projetoId === id) m.delete(k);
      return;
    }
    for (const k of await reqP(s.index('projetoId').getAllKeys(id))) s.delete(k);
  });
}

/** Guarda uma versão do projeto (no máximo 50 por projeto; as mais antigas saem). */
export async function addRevision(project, reason) {
  const rev = { projetoId: project.id, criadoEm: new Date().toISOString(), motivo: reason, palavras: project.words || 0, documento: JSON.stringify(project) };
  await tx('revisoes', 'readwrite', async (s, m) => {
    if (m) {
      m.set(seq, { ...rev, id: seq });
      seq += 1;
      return;
    }
    s.add(rev);
  });
  const list = await listRevisions(project.id);
  if (list.length > MAX_REVISIONS) {
    const extra = list.slice(MAX_REVISIONS);
    await tx('revisoes', 'readwrite', (s, m) => {
      for (const r of extra) {
        if (m) m.delete(r.id);
        else s.delete(r.id);
      }
    });
  }
}

export async function listRevisions(projectId) {
  const list = await tx('revisoes', 'readonly', (s, m) => {
    if (m) return [...m.values()].filter((r) => r.projetoId === projectId);
    return reqP(s.index('projetoId').getAll(projectId));
  });
  return list.sort((a, b) => b.id - a.id);
}

export async function getPref(key, fallback) {
  const row = await tx('preferencias', 'readonly', (s, m) => (m ? m.get(key) : reqP(s.get(key))));
  return row ? row.valor : fallback;
}

export async function setPref(key, value) {
  await tx('preferencias', 'readwrite', (s, m) => (m ? m.set(key, { chave: key, valor: value }) : reqP(s.put({ chave: key, valor: value }))));
}

export async function listPersonal() {
  const rows = await tx('dicionario', 'readonly', (s, m) => (m ? [...m.values()] : reqP(s.getAll())));
  return rows.map((r) => r.palavra).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export async function addPersonal(word) {
  await tx('dicionario', 'readwrite', (s, m) => {
    const row = { palavra: word.toLowerCase(), criadoEm: new Date().toISOString() };
    return m ? m.set(row.palavra, row) : reqP(s.put(row));
  });
}

export async function removePersonal(word) {
  await tx('dicionario', 'readwrite', (s, m) => (m ? m.delete(word) : reqP(s.delete(word))));
}

/** Sessão de escrita do dia: palavras no começo do dia e agora (para a meta diária). */
export async function getDay(day) {
  return tx('sessoes', 'readonly', (s, m) => (m ? m.get(day) : reqP(s.get(day))));
}

export async function putDay(row) {
  await tx('sessoes', 'readwrite', (s, m) => (m ? m.set(row.dia, row) : reqP(s.put(row))));
}
