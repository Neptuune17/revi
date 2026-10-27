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
// Règle stricte : seule la réponse exacte est acceptée. Souplesses : contenu entre parenthèses facultatif,
// une seule variante suffit (séparées par , ; /), majuscules, espaces et ponctuation ignorés. Accents et lettres exacts.
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

/**
 * Variantes d'une réponse : morceaux séparés par , ; / en dehors des parenthèses (et des crochets).
 * « devoir (conseil, ordre d'autrui) ; être censé » -> « devoir (conseil, ordre d'autrui) » et « être censé » :
 * la virgule entre parenthèses ne découpe pas. Renvoie [{ start, end }] (positions dans la chaîne, en caractères).
 */
function variantRanges(chars) {
  const out = [];
  let depth = 0, start = 0;
  chars.forEach((ch, i) => {
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    else if (depth === 0 && (ch === ',' || ch === ';' || ch === '/')) { out.push({ start, end: i }); start = i + 1; }
  });
  out.push({ start, end: chars.length });
  return out.filter((r) => normalize(stripParens(chars.slice(r.start, r.end).join(''))));
}

/**
 * Formes acceptées : la réponse complète, avec ou sans ce qui est entre parenthèses, et chaque variante
 * (avec ou sans ses parenthèses). Le découpage en variantes se fait hors parenthèses.
 */
export function acceptedForms(expected) {
  const forms = [];
  const add = (s, partial) => { const n = normalize(s); if (n && !forms.some((f) => f.text === n)) forms.push({ text: n, partial }); };
  const text = String(expected ?? '');
  add(text, false);
  add(stripParens(text), false);
  const chars = Array.from(text);
  const parts = variantRanges(chars);
  if (parts.length >= 2) parts.forEach((r) => { const p = chars.slice(r.start, r.end).join(''); add(p, true); add(stripParens(p), true); });
  return forms;
}

/**
 * Corrige une réponse écrite.
 * @returns {{ok:boolean, kind:'exact'|'partial'|'wrong'|'empty', note?:string, diff?:object|null}}
 * diff (réponse fausse mais proche) : voir answerDiff.
 */
export function grade(input, expected) {
  const inp = normalize(input);
  if (!inp) return { ok: false, kind: 'empty' };
  for (const f of acceptedForms(expected)) {
    if (inp === f.text) return f.partial ? { ok: true, kind: 'partial', note: 'Réponse complète : ' + expected } : { ok: true, kind: 'exact' };
  }
  return { ok: false, kind: 'wrong', diff: answerDiff(input, expected) };
}

// Comparaison lettre à lettre, pour montrer les lettres erronées d'une réponse proche.
const IGNORED = /[’‘`´'.,;:!?¿¡"“”«»()[\]{}*…]/u; // ponctuation : ignorée par la correction
const SEPARATOR = /[\s\-–—_/\\]/u; // équivaut à une espace pour la correction
const charKey = (ch) => (SEPARATOR.test(ch) ? ' ' : ch.toLocaleLowerCase());

/**
 * Aligne la réponse tapée sur la réponse attendue (ou sur la variante la plus proche).
 * Ignore les majuscules, la ponctuation et le contenu entre parenthèses, comme grade().
 * Renvoie null si la réponse n'est pas proche (plus de 40 % de lettres fausses) : on affiche alors seulement la réponse.
 * Sinon { yours, expected } : listes de morceaux { t: texte, k: '' | 'bad' | 'miss' | 'fix' }.
 *   yours : 'bad' = lettre fausse ou en trop, 'miss' = repère d'une lettre manquante ;
 *   expected (réponse attendue complète) : 'fix' = lettre que la réponse tapée n'avait pas.
 */
export function answerDiff(input, expected) {
  const typed = Array.from(String(input ?? '').normalize('NFC').replace(/\s+/g, ' ').trim());
  const full = Array.from(String(expected ?? '').normalize('NFC'));
  if (!typed.length || !full.length) return null;
  // Lettres facultatives de la réponse attendue : entre parenthèses ou crochets, ponctuation.
  const optional = [];
  let depth = 0;
  full.forEach((ch, i) => {
    if (ch === '(' || ch === '[') depth++;
    optional[i] = depth > 0 || IGNORED.test(ch);
    if ((ch === ')' || ch === ']') && depth > 0) depth--;
  });
  const typedFree = typed.map((ch) => IGNORED.test(ch));

  let best = null;
  const ranges = variantRanges(full);
  if (ranges.length > 1) ranges.unshift({ start: 0, end: full.length });
  for (const { start, end } of ranges) {
    const S = full.slice(start, end);
    const opt = optional.slice(start, end);
    // Espaces facultatives : en début et fin de variante, en double, ou collées à une partie facultative.
    let prevSep = true;
    const kept = [];
    S.forEach((ch, j) => {
      if (opt[j]) return;
      const sep = charKey(ch) === ' ';
      if (sep && prevSep) opt[j] = true; else kept.push(j);
      prevSep = sep;
    });
    if (kept.length && charKey(S[kept[kept.length - 1]]) === ' ') opt[kept.pop()] = true;
    const letters = kept.filter((j) => charKey(S[j]) !== ' ').length;
    const r = align(typed, typedFree, S, opt);
    const errors = r.ops.filter((o) => o.type === 'sub' || ((o.type === 'miss' || o.type === 'extra') && !o.free)).length;
    const ratio = letters ? errors / letters : Infinity;
    if (!best || ratio < best.ratio || (ratio === best.ratio && r.cost < best.cost)) best = { ...r, start, end, letters, errors, ratio };
  }
  if (!best || best.errors < 1 || best.errors > Math.floor(best.letters * 0.4)) return null;

  const yours = [], exp = [];
  const push = (list, t, k) => { const last = list[list.length - 1]; if (last && last.k === k && k !== 'miss') last.t += t; else list.push({ t, k }); };
  full.slice(0, best.start).forEach((ch) => push(exp, ch, ''));
  let missing = false;
  for (const op of best.ops) {
    if (op.type === 'miss') {
      push(exp, op.s, op.free ? '' : 'fix');
      if (!op.free && !missing) { yours.push({ t: '', k: 'miss' }); missing = true; }
      continue;
    }
    missing = false;
    if (op.type === 'match') { push(yours, op.t, ''); push(exp, op.s, ''); }
    else if (op.type === 'sub') { push(yours, op.t, 'bad'); push(exp, op.s, 'fix'); }
    else push(yours, op.t, op.free ? '' : 'bad'); // lettre en trop
  }
  full.slice(best.end).forEach((ch) => push(exp, ch, ''));
  return { yours, expected: exp };
}

/**
 * Distance d'édition avec coûts nuls pour ce que la correction ignore. Renvoie { cost, ops } (ops dans l'ordre).
 * Une lettre tapée qui correspond à une partie facultative coûte presque rien (EPS) : à coût égal,
 * on préfère montrer une lettre remplacée plutôt qu'une lettre « retrouvée » entre parenthèses.
 */
const EPS = 1e-3;
function align(T, tFree, S, sOpt) {
  const n = T.length, m = S.length;
  const W = m + 1;
  const d = new Float64Array((n + 1) * W);
  const delT = (i) => (tFree[i] ? 0 : 1);
  const delS = (j) => (sOpt[j] ? 0 : 1);
  const keep = (j) => (sOpt[j] ? EPS : 0);
  for (let j = 1; j <= m; j++) d[j] = d[j - 1] + delS(j - 1);
  for (let i = 1; i <= n; i++) {
    d[i * W] = d[(i - 1) * W] + delT(i - 1);
    for (let j = 1; j <= m; j++) {
      const same = charKey(T[i - 1]) === charKey(S[j - 1]);
      let v = Math.min(d[(i - 1) * W + j] + delT(i - 1), d[i * W + j - 1] + delS(j - 1));
      if (same) v = Math.min(v, d[(i - 1) * W + j - 1] + keep(j - 1));
      else if (!sOpt[j - 1] && !tFree[i - 1]) v = Math.min(v, d[(i - 1) * W + j - 1] + 1);
      d[i * W + j] = v;
    }
  }
  const ops = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const cur = d[i * W + j];
    if (i > 0 && j > 0) {
      const same = charKey(T[i - 1]) === charKey(S[j - 1]);
      if (same && cur === d[(i - 1) * W + j - 1] + keep(j - 1)) { ops.push({ type: 'match', t: T[i - 1], s: S[j - 1] }); i--; j--; continue; }
      if (!same && !sOpt[j - 1] && !tFree[i - 1] && cur === d[(i - 1) * W + j - 1] + 1) { ops.push({ type: 'sub', t: T[i - 1], s: S[j - 1] }); i--; j--; continue; }
    }
    if (j > 0 && cur === d[i * W + j - 1] + delS(j - 1)) { ops.push({ type: 'miss', s: S[j - 1], free: !!sOpt[j - 1] }); j--; continue; }
    ops.push({ type: 'extra', t: T[i - 1], free: !!tFree[i - 1] }); i--;
  }
  return { cost: d[n * W + m], ops: ops.reverse() };
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
  ['de-DE', 'Allemand'], ['it-IT', 'Italien'], ['pt-PT', 'Portugais'], ['nl-NL', 'Néerlandais'], ['lt-LT', 'Lituanien'], ['zh-CN', 'Chinois'], ['ja-JP', 'Japonais'], ['ar', 'Arabe'],
];
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
let speechUnlocked = false;
/**
 * iPhone (Safari et appli installée) : la voix n'est autorisée qu'à la suite d'un toucher.
 * Une phrase muette lancée pendant le premier toucher de la séance débloque les lectures suivantes,
 * même celles lancées après une animation (lecture automatique du mode Cartes).
 */
export function unlockSpeech() {
  if (speechUnlocked || !canSpeak()) return;
  speechUnlocked = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); } catch { /* lecture indisponible */ }
}
const langTag = (l) => String(l || '').replace(/_/g, '-').toLowerCase();
/** Voix de l'appareil pour une langue : d'abord la langue exacte (« en-GB »), sinon la même langue d'une autre région (« en-US »). */
export function voiceFor(lang) {
  if (!canSpeak() || !lang) return null;
  try {
    const want = langTag(lang), base = want.split('-')[0];
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => langTag(v.lang) === want) || voices.find((v) => langTag(v.lang).split('-')[0] === base) || null;
  } catch { return null; }
}
/** true si l'appareil a chargé ses voix et n'en a aucune pour cette langue (la lecture prendrait alors une autre voix). */
export function missingVoice(lang) {
  if (!canSpeak() || !lang) return false;
  try { return window.speechSynthesis.getVoices().length > 0 && !voiceFor(lang); } catch { return false; }
}
/** Lit un texte dans la langue donnée, sans ce qui est entre parenthèses. Coupe la lecture en cours. */
export function speak(text, lang) {
  if (!canSpeak() || !lang) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(stripParens(text));
    u.lang = lang;
    const voice = voiceFor(lang);
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
