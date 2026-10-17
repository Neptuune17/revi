// Fonctions utilitaires sans dépendance : identifiants, sentinelles de fusion, correction des réponses,
// analyse de l'import texte, formatage français, minuteur actif, lecture à voix haute, stockage local sûr.

// ---------- Sentinelles de fusion (voir store.js) ----------
// DELETE : supprime une clé lors d'une fusion. inc(n) : incrémente un nombre (compatible synchro).
export const DELETE = Object.freeze({ __revi: 'delete' });
export const inc = (n = 1) => ({ __revi: 'inc', n });
export const isDelete = (v) => v === DELETE || (v && v.__revi === 'delete');
export const isInc = (v) => !!v && typeof v === 'object' && v.__revi === 'inc';
export const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !v.__revi;

/** Fusion profonde, même logique que Firestore setDoc(..., { merge: true }). Ne modifie pas `target`. */
export function deepMerge(target, patch) {
  const out = isPlainObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (isDelete(v)) delete out[k];
    else if (isInc(v)) out[k] = (typeof out[k] === 'number' ? out[k] : 0) + v.n;
    else if (isPlainObject(v)) out[k] = deepMerge(isPlainObject(out[k]) ? out[k] : {}, v);
    else out[k] = v;
  }
  return out;
}

// ---------- Identifiants ----------
export function uid(prefix = 'x') {
  const rnd = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return prefix + Date.now().toString(36).slice(-6) + rnd;
}

// ---------- Tableaux ----------
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const sample = (arr, n) => shuffle(arr).slice(0, n);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- Correction des réponses écrites ----------
const stripAccents = (s) => s.normalize('NFD').replace(/\p{M}/gu, '');
const stripParens = (s) => s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');

/** Normalisation : minuscules, apostrophes et ponctuation ignorées, espaces regroupés. Garde les accents. */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFC').toLowerCase()
    .replace(/[’‘`´']/g, '')
    .replace(/…|\.{2,}/g, ' ')
    .replace(/[.,;:!?¿¡"“”«»()[\]{}*]/g, ' ')
    .replace(/[-–—_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Formes acceptées pour une réponse attendue : complète, sans parenthèses, et chaque variante séparée par , ; / */
export function acceptedForms(expected) {
  const forms = [];
  const add = (s, partial) => { const n = normalize(s); if (n && !forms.some((f) => f.text === n)) forms.push({ text: n, partial }); };
  add(expected, false);
  const noParen = stripParens(expected);
  add(noParen, false);
  const parts = noParen.split(/[,;/]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) parts.forEach((p) => add(p, true));
  return forms;
}

const tolerance = (len) => (len <= 3 ? 0 : len <= 7 ? 1 : len <= 14 ? 2 : 3);

/**
 * Corrige une réponse écrite.
 * @returns {{ok:boolean, kind:'exact'|'partial'|'accents'|'typo'|'wrong'|'empty', note?:string}}
 */
export function grade(input, expected) {
  const inp = normalize(input);
  if (!inp) return { ok: false, kind: 'empty' };
  const forms = acceptedForms(expected);
  for (const f of forms) if (inp === f.text) return f.partial ? { ok: true, kind: 'partial', note: 'Réponse complète : ' + expected } : { ok: true, kind: 'exact' };
  const inpA = stripAccents(inp);
  for (const f of forms) if (inpA === stripAccents(f.text)) return { ok: true, kind: 'accents', note: 'Attention aux accents : ' + expected };
  for (const f of forms) {
    const t = stripAccents(f.text);
    if (levenshtein(inpA, t) <= tolerance(t.length)) return { ok: true, kind: 'typo', note: 'Petite faute, la réponse exacte est : ' + expected };
  }
  return { ok: false, kind: 'wrong' };
}

export const sameAnswer = (a, b) => normalize(a) === normalize(b);

// ---------- Import de texte (export Quizlet, tableur, etc.) ----------
export function detectSeparators(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { term: '\t', card: '\n' };
  if (lines.length === 1 && lines[0].includes(';') && !lines[0].includes('\t')) {
    return { term: lines[0].includes(' - ') ? ' - ' : ',', card: ';' };
  }
  if (lines.some((l) => l.includes('\t'))) return { term: '\t', card: '\n' };
  if (lines.every((l) => l.includes(' - '))) return { term: ' - ', card: '\n' };
  if (lines.every((l) => l.includes(' : ') || l.includes(': '))) return { term: ':', card: '\n' };
  if (lines.every((l) => l.includes(';'))) return { term: ';', card: '\n' };
  if (lines.every((l) => l.includes(','))) return { term: ',', card: '\n' };
  return { term: '\t', card: '\n' };
}

export function parseImport(text, seps) {
  const { term: ts, card: cs } = seps || detectSeparators(text);
  const chunks = cs === '\n' ? String(text).split(/\r?\n/) : String(text).split(cs);
  const out = [];
  for (const raw of chunks) {
    const chunk = raw.replace(/\r/g, '');
    if (!chunk.trim()) continue;
    const i = chunk.indexOf(ts);
    if (i < 0) out.push({ term: chunk.trim(), definition: '' });
    else out.push({ term: chunk.slice(0, i).trim(), definition: chunk.slice(i + ts.length).trim() });
  }
  return out;
}

export function toExportText(cards) {
  return cards.map((c) => `${c.term.replace(/[\t\n]/g, ' ')}\t${c.definition.replace(/[\t\n]/g, ' ')}`).join('\n');
}

// ---------- Formatage (français) ----------
const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function fmtSeconds(ms) {
  const s = ms / 1000;
  if (s < 60) return nf1.format(s) + ' s';
  const m = Math.floor(s / 60);
  return `${m} min ${nf1.format(s - m * 60).padStart(4, '0')} s`;
}
export function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}
export function fmtRelative(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  const min = Math.round(d / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const days = Math.round(h / 24);
  if (days === 1) return 'hier';
  if (days < 7) return `il y a ${days} jours`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
export const plural = (n, one, many) => `${n} ${n > 1 ? many || one + 's' : one}`;
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// ---------- Minuteur de temps actif (pause quand l'onglet est caché) ----------
export class ActiveTimer {
  constructor() {
    this.total = 0; this.since = document.hidden ? null : performance.now();
    this._vis = () => { if (document.hidden) this.pause(); else this.resume(); };
    document.addEventListener('visibilitychange', this._vis);
  }
  pause() { if (this.since != null) { this.total += performance.now() - this.since; this.since = null; } }
  resume() { if (this.since == null) this.since = performance.now(); }
  get ms() { return this.total + (this.since != null ? performance.now() - this.since : 0); }
  stop() { this.pause(); document.removeEventListener('visibilitychange', this._vis); return this.total; }
}

// ---------- Lecture à voix haute ----------
export const LANGS = [
  ['', 'Aucune'], ['fr-FR', 'Français'], ['en-GB', 'Anglais (UK)'], ['en-US', 'Anglais (US)'], ['es-ES', 'Espagnol'],
  ['de-DE', 'Allemand'], ['it-IT', 'Italien'], ['pt-PT', 'Portugais'], ['nl-NL', 'Néerlandais'], ['zh-CN', 'Chinois'], ['ja-JP', 'Japonais'], ['ar', 'Arabe'],
];
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export function speak(text, lang) {
  if (!canSpeak() || !lang) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(stripParens(text));
    u.lang = lang;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    if (voice) u.voice = voice;
    window.speechSynthesis.speak(u);
  } catch { /* lecture indisponible */ }
}

// ---------- Stockage local sûr (certains navigateurs bloquent localStorage) ----------
const memory = new Map();
export const ls = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return memory.has(key) ? memory.get(key) : fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { memory.set(key, value); return e; }
  },
  remove(key) { try { localStorage.removeItem(key); } catch { /* ignore */ } memory.delete(key); },
};

export function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function downloadFile(name, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); return ok;
  }
}
