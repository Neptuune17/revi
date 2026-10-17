// Petits outils d'interface : création d'éléments (h), icônes SVG, toasts, dialogues, menus.

/**
 * h('button', { class: 'btn', onclick: fn, disabled: true }, 'Texte', autreNoeud)
 * - on* : écouteurs d'événements ; class, style, data-…, aria-… : attributs ;
 * - value, checked, disabled, selected, hidden, innerHTML (à éviter) : propriétés.
 */
export function h(tag, props, ...children) {
  const svgTags = new Set(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'g', 'text']);
  const el = svgTags.has(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (['value', 'checked', 'disabled', 'selected', 'hidden', 'indeterminate'].includes(k)) el[k] = v;
      else if (k === 'ref' && typeof v === 'function') v(el);
      else el.setAttribute(k === 'className' ? 'class' : k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el) => { while (el.firstChild) el.firstChild.remove(); return el; };
/** Remplace les enfants d'un élément (ignore null/false, aplatit les tableaux). */
export function setChildren(el, ...children) { clear(el); append(el, children); return el; }
/** Ajoute des enfants (ignore null/false, aplatit les tableaux). */
export function add(el, ...children) { append(el, children); return el; }

// ---------- Icônes (traits 24x24, dessinées pour l'appli) ----------
const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cards: '<rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v10"/>',
  learn: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  test: '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 9l1.5 1.5L13 8M9 15h6"/>',
  match: '<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="14" y="13" width="7" height="7" rx="1.5"/><path d="M10 7.5h3.5a2 2 0 0 1 2 2V13"/>',
  star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  starFill: '<path fill="currentColor" d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>',
  shuffle: '<path d="M4 7h3.5c4.5 0 4.5 10 9 10H20M4 17h3.5c1.6 0 2.6-1.3 3.4-3M13 10c.8-1.7 1.8-3 3.5-3H20M17 4l3 3-3 3M17 14l3 3-3 3"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/>',
  flip: '<path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6"/><path d="M18 3v3.6h-3.6M6 21v-3.6h3.6"/>',
  arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  cloud: '<path d="M7 18.5h10a4 4 0 0 0 .6-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 18.5z"/>',
  text: '<path d="M5 6h14M5 11h14M5 16h9"/>',
  install: '<rect x="6.5" y="2.8" width="11" height="18.4" rx="2.5"/><path d="M12 7.5v7M9 11.8l3 3 3-3"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4v4h4"/>',
};
export function icon(name, size = 22, extra = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', size); el.setAttribute('height', size);
  el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', extra.stroke || 1.9); el.setAttribute('stroke-linecap', 'round'); el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = ICONS[name] || '';
  return el;
}

// ---------- Toasts ----------
let toastHost;
export function toast(message, { action, onAction, timeout = 3600, kind } = {}) {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = h('div', { class: 'toast' + (kind === 'error' ? ' error' : '') }, h('span', { class: 'msg' }, message));
  const close = () => { t.remove(); };
  if (action) t.append(h('button', { onclick: () => { close(); onAction && onAction(); } }, action));
  toastHost.append(t);
  if (timeout) setTimeout(close, timeout);
  return close;
}

// ---------- Dialogues ----------
export function confirmDialog({ title, body, confirm = 'Confirmer', cancel = 'Annuler', danger = false }) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'modal' });
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.append(h('form', { method: 'dialog', class: 'inner', onsubmit: (e) => { e.preventDefault(); done(true); } },
      h('h2', null, title),
      body ? h('p', { class: 'muted' }, body) : null,
      h('div', { class: 'btns' },
        cancel ? h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => done(false) }, cancel) : null,
        h('button', { type: 'submit', class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), autofocus: true }, confirm))));
    d.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(d);
    d.showModal();
  });
}

/** Menu déroulant ancré à un bouton. items: [{label, icon, onclick, danger}] */
export function menuButton(items, { label = 'Plus d’options', iconName = 'more' } = {}) {
  const wrap = h('div', { class: 'menu-wrap' });
  let menu = null;
  const closeMenu = () => { menu && menu.remove(); menu = null; document.removeEventListener('click', outside, true); };
  const outside = (e) => { if (!wrap.contains(e.target)) closeMenu(); };
  const btn = h('button', { class: 'icon-btn', 'aria-label': label, 'aria-haspopup': 'true', onclick: () => {
    if (menu) return closeMenu();
    menu = h('div', { class: 'menu', role: 'menu' }, items.filter(Boolean).map((it) =>
      h('button', { role: 'menuitem', class: it.danger ? 'danger' : '', onclick: () => { closeMenu(); it.onclick(); } }, it.icon ? icon(it.icon, 20) : null, it.label)));
    wrap.append(menu);
    setTimeout(() => document.addEventListener('click', outside, true));
  } }, icon(iconName));
  wrap.append(btn);
  return wrap;
}

/** Contrôle segmenté : options [[valeur, libellé]] */
export function segmented(options, value, onChange, ariaLabel) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': ariaLabel || '' });
  const render = (val) => {
    setChildren(el, ...options.map(([v, label]) => h('button', { type: 'button', 'aria-pressed': String(v === val), onclick: () => { render(v); onChange(v); } }, label)));
  };
  render(value);
  return el;
}

export function hlbar(fraction, cls = '') {
  return h('div', { class: 'hlbar ' + cls, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(fraction * 100) },
    h('i', { style: { width: Math.max(0, Math.min(1, fraction)) * 100 + '%' } }));
}

/** Ajuste la hauteur d'un textarea à son contenu. */
export function autoGrow(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return ta;
}
