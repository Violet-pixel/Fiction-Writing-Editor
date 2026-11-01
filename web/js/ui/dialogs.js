// Diálogos, avisos e criação de elementos. Nenhum texto do usuário passa por innerHTML.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function uiZoom() {
  const z = parseFloat(getComputedStyle(document.documentElement).zoom);
  return z > 0 ? z : 1;
}

let toastTimer = null;
export function toast(msg, action) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  if (action) {
    const b = el('button', { type: 'button', class: 'toast-act' }, action.label);
    b.addEventListener('click', () => {
      t.hidden = true;
      action.fn();
    });
    t.append(b);
  }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, action ? 6500 : 3800);
}

/**
 * Abre o diálogo modal. fields: [{name, label, value, type, options}] devolvem um objeto com os valores;
 * body: um nó pronto; build(api): monta conteúdo com api.close(). Resolve null quando cancelado.
 */
export function dialog({ title, fields, body, ok = 'OK', cancel = 'Cancelar', build, danger = false, wide = false }) {
  const dlg = document.getElementById('dialog');
  if (dlg.open) dlg.close('replaced');
  dlg.classList.toggle('wide', Boolean(wide));
  dlg.textContent = '';
  const form = el('form', { method: 'dialog' });
  form.append(el('div', { class: 'dh' }, title));
  const content = el('div', { class: 'db' });
  const inputs = {};
  for (const f of fields || []) {
    const label = el('label', { class: 'field' }, f.label);
    let input;
    if (f.type === 'select') {
      input = el('select', { name: f.name });
      for (const [v, t] of f.options) input.append(el('option', { value: v }, t));
      input.value = f.value;
    } else if (f.type === 'textarea') {
      input = el('textarea', { name: f.name, rows: 4, placeholder: f.placeholder || null });
      input.value = f.value || '';
    } else {
      input = el('input', { name: f.name, type: f.type || 'text', autocomplete: 'off', placeholder: f.placeholder || null, required: f.required || null, maxlength: f.type ? null : 200 });
      input.value = f.value ?? '';
    }
    inputs[f.name] = input;
    label.append(input);
    content.append(label);
  }
  if (body) content.append(body);
  form.append(content);
  const foot = el('div', { class: 'df' });
  if (cancel) foot.append(el('button', { class: 'btn', value: 'cancel', type: 'submit', formnovalidate: true }, cancel));
  foot.append(el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, value: 'ok', type: 'submit' }, ok));
  form.append(foot);
  dlg.append(form);
  return new Promise((resolve) => {
    const api = { close: () => dlg.close('closed') };
    if (build) build(api);
    dlg.addEventListener('close', () => {
      if (dlg.returnValue === 'ok') {
        const out = {};
        for (const [k, i] of Object.entries(inputs)) out[k] = i.value;
        resolve(out);
      } else resolve(null);
    }, { once: true });
    dlg.returnValue = '';
    dlg.showModal();
    const first = Object.values(inputs)[0];
    if (first) {
      first.focus();
      if (first.select) first.select();
    }
  });
}

export async function confirmBox(title, text, ok = 'Confirmar') {
  const res = await dialog({ title, body: el('p', {}, text), ok, danger: true });
  return res !== null;
}
