const PORT = '8840';
let info = null;

export async function detectDesktop() {
  if (!['127.0.0.1', 'localhost'].includes(location.hostname) || location.port !== PORT) return null;
  try {
    const r = await fetch('api/desktop/info', { cache: 'no-store', headers: { 'X-Serifa': '1' } });
    const data = r.ok ? await r.json() : null;
    info = data && data.desktop ? data : null;
  } catch {
    info = null;
  }
  if (info) {
    setInterval(() => {
      fetch('api/desktop/ping', { method: 'POST', headers: { 'X-Serifa': '1' } }).catch(() => {});
    }, 5000);
  }
  return info;
}

export function isDesktop() {
  return Boolean(info);
}

export function desktopInfo() {
  return info;
}

async function call(path, opts = {}) {
  const r = await fetch(`api/desktop/${path}`, { method: 'POST', ...opts, headers: { 'X-Serifa': '1', ...(opts.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erro || `erro ${r.status}`);
  return data;
}

const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v ?? '')}`).join('&');

export function saveToFolder(folder, name, blob) {
  return call(`salvar?${q({ pasta: folder, arquivo: name })}`, { body: blob });
}

export function createFolder(folder) {
  return call(`criar-pasta?${q({ pasta: folder })}`);
}

export function openFolder(folder) {
  return call(`abrir-pasta?${q({ pasta: folder || '' })}`);
}

export async function chooseBase() {
  const d = await call('escolher-pasta');
  if (d.base) info.base = d.base;
  return d;
}

export async function setConfig(cfg) {
  const d = await call('config', { body: JSON.stringify(cfg), headers: { 'Content-Type': 'application/json' } });
  Object.assign(info, d);
  return d;
}

export function beaconSave(folder, name, blob) {
  try {
    return navigator.sendBeacon(`api/desktop/salvar?${q({ pasta: folder, arquivo: name })}`, blob);
  } catch {
    return false;
  }
}
