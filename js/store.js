// Magasin de données central. Toute lecture passe par store.state, toute écriture par les méthodes ci-dessous.
// Deux "backends" interchangeables :
//   - LocalBackend : données dans localStorage (mode hors compte / sans Firebase).
//   - CloudBackend (cloud.js) : Firestore avec cache hors ligne, données sous users/{uid}/...
// Chaque écriture est un "patch" (objet imbriqué) fusionné en profondeur, avec DELETE et inc() comme sentinelles.
// Collections : "sets" (séries et cartes) et "progress" (progression, sessions, records), clé = id de la série.

import { DELETE, inc, deepMerge, uid, ls, isPlainObject } from './util.js';
import { APP_VERSION } from './version.js';

export const LS_DATA = 'revi.data.v1';
const MAX_SESSIONS = 60;

const emptyData = () => ({ sets: {}, progress: {} });

export class LocalBackend {
  constructor(key = LS_DATA) {
    this.kind = 'local';
    this.key = key;
    const saved = ls.get(key);
    this.data = saved && saved.sets ? { sets: saved.sets || {}, progress: saved.progress || {} } : emptyData();
  }
  start(onData) {
    this.onData = onData;
    this._onStorage = (e) => {
      if (e.key !== this.key) return;
      const saved = ls.get(this.key);
      this.data = saved && saved.sets ? saved : emptyData();
      this.onData(this.data, {});
    };
    window.addEventListener('storage', this._onStorage);
    onData(this.data, {});
  }
  stop() { window.removeEventListener('storage', this._onStorage); }
  apply(coll, id, patch) {
    const cur = this.data[coll][id];
    this.data = { ...this.data, [coll]: { ...this.data[coll], [id]: deepMerge(cur || {}, patch) } };
    this._save();
  }
  remove(coll, id) {
    const next = { ...this.data[coll] };
    delete next[id];
    this.data = { ...this.data, [coll]: next };
    this._save();
  }
  _save() {
    const r = ls.set(this.key, this.data);
    if (r !== true) store.emitError(new Error('Impossible d’enregistrer sur cet appareil (stockage plein ou bloqué).'));
    this.onData && this.onData(this.data, {});
  }
}

export const store = {
  state: {
    sets: {}, progress: {}, ready: false, mode: 'local', user: null,
    pending: false, fromCache: false, online: navigator.onLine, cloudConfigured: false, cloudError: null,
    requireLogin: false, allowSignup: true, accessDenied: false,
  },
  backend: null,
  listeners: new Set(),
  errorListeners: new Set(),

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit() { for (const fn of [...this.listeners]) { try { fn(this.state); } catch (e) { console.error(e); } } },
  onError(fn) { this.errorListeners.add(fn); return () => this.errorListeners.delete(fn); },
  emitError(err) { for (const fn of this.errorListeners) fn(err); },
  set(partial) { Object.assign(this.state, partial); this.emit(); },

  useBackend(backend, { ready = true } = {}) {
    if (this.backend && this.backend !== backend) this.backend.stop();
    this.backend = backend;
    this.state.mode = backend.kind;
    this.state.ready = ready;
    backend.start((data, meta = {}) => {
      this.state.sets = data.sets || {};
      this.state.progress = data.progress || {};
      this.state.pending = !!meta.pending;
      this.state.fromCache = !!meta.fromCache;
      this.state.ready = true;
      this.emit();
    });
  },

  // ---------- Lecture ----------
  getSet(id) { return this.state.sets[id] || null; },
  cardsOf(set) {
    if (!set || !set.cards) return [];
    return Object.entries(set.cards)
      .map(([id, c]) => ({ id, term: c.term || '', definition: c.definition || '', order: c.order ?? 0, starred: !!c.starred }))
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  },
  progressOf(setId) { return this.state.progress[setId] || {}; },
  cardProgress(setId, cardId) { return (this.progressOf(setId).cards || {})[cardId] || {}; },
  /** 0 = pas vue, 1 = en cours, 2 = maîtrisée */
  statusOf(setId, cardId) {
    const p = this.cardProgress(setId, cardId);
    if ((p.lvl || 0) >= 2) return 2;
    if ((p.lvl || 0) >= 1 || (p.ok || 0) + (p.ko || 0) > 0) return 1;
    return 0;
  },
  sessionsOf(setId) {
    const s = this.progressOf(setId).sessions || {};
    return Object.entries(s).map(([id, v]) => ({ id, ...v })).sort((a, b) => (b.at || 0) - (a.at || 0));
  },
  lastStudied(setId) { const s = this.sessionsOf(setId)[0]; return s ? s.at : 0; },
  folders() {
    return [...new Set(Object.values(this.state.sets).map((s) => (s.folder || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  },

  // ---------- Écriture : séries ----------
  createSet({ title, folder = '', termLang = '', defLang = '', cards = [] }) {
    const id = uid('s');
    const now = Date.now();
    const map = {};
    cards.forEach((c, i) => { map[uid('c')] = { term: c.term, definition: c.definition, order: i, starred: !!c.starred }; });
    this.backend.apply('sets', id, { title, folder, termLang, defLang, cards: map, createdAt: now, updatedAt: now });
    return id;
  },

  /** cards : liste ordonnée [{id?, term, definition, starred?}] — calcule la différence avec l'existant. */
  updateSet(id, { title, folder, termLang, defLang, cards }) {
    const set = this.getSet(id);
    if (!set) return;
    const patch = { updatedAt: Date.now() };
    for (const [k, v] of Object.entries({ title, folder, termLang, defLang })) if (v !== undefined && v !== set[k]) patch[k] = v;
    if (cards) {
      const existing = set.cards || {};
      const keep = new Set();
      const cp = {};
      cards.forEach((c, i) => {
        if (c.id && existing[c.id]) {
          keep.add(c.id);
          const e = existing[c.id];
          const diff = {};
          if (e.term !== c.term) diff.term = c.term;
          if (e.definition !== c.definition) diff.definition = c.definition;
          if (e.order !== i) diff.order = i;
          if (Object.keys(diff).length) cp[c.id] = diff;
        } else {
          cp[uid('c')] = { term: c.term, definition: c.definition, order: i, starred: !!c.starred };
        }
      });
      const removed = Object.keys(existing).filter((cid) => !keep.has(cid));
      removed.forEach((cid) => { cp[cid] = DELETE; });
      if (Object.keys(cp).length) patch.cards = cp;
      if (removed.length && this.state.progress[id]?.cards) {
        const pp = {}; removed.forEach((cid) => { pp[cid] = DELETE; });
        this.backend.apply('progress', id, { cards: pp });
      }
    }
    this.backend.apply('sets', id, patch);
  },

  toggleStar(setId, cardId) {
    const c = this.getSet(setId)?.cards?.[cardId];
    if (!c) return;
    this.backend.apply('sets', setId, { cards: { [cardId]: { starred: !c.starred } } });
  },

  deleteSet(id) {
    this.backend.remove('sets', id);
    this.backend.remove('progress', id);
  },

  // ---------- Écriture : progression ----------
  /** Enregistre une réponse. lvl (optionnel) = nouveau niveau d'apprentissage de la carte. */
  recordAnswer(setId, cardId, ok, lvl) {
    const p = { last: Date.now() };
    p[ok ? 'ok' : 'ko'] = inc(1);
    if (lvl !== undefined) p.lvl = lvl;
    this.backend.apply('progress', setId, { cards: { [cardId]: p }, updatedAt: Date.now() });
  },
  /** Corrige un comptage (ex. « En fait, j'avais juste » dans le test). */
  adjustCounts(setId, cardId, okDelta, koDelta) {
    this.backend.apply('progress', setId, { cards: { [cardId]: { ok: inc(okDelta), ko: inc(koDelta) } } });
  },
  setLevel(setId, cardId, lvl) {
    this.backend.apply('progress', setId, { cards: { [cardId]: { lvl } } });
  },
  resetLearn(setId) {
    const cards = this.progressOf(setId).cards || {};
    const p = {};
    Object.keys(cards).forEach((cid) => { p[cid] = { lvl: 0 }; });
    if (Object.keys(p).length) this.backend.apply('progress', setId, { cards: p });
  },
  /** session : { mode: 'cards'|'learn'|'test'|'match', dur, ok, ko, total, score, ms, errors } — renvoie son id */
  addSession(setId, session, existingId) {
    const sid = existingId || uid('x');
    const patch = { sessions: { [sid]: { ...session, at: session.at || Date.now() } }, updatedAt: Date.now() };
    if (!existingId) {
      const list = this.sessionsOf(setId);
      if (list.length >= MAX_SESSIONS) list.slice(MAX_SESSIONS - 1).forEach((s) => { patch.sessions[s.id] = DELETE; });
    }
    this.backend.apply('progress', setId, patch);
    return sid;
  },
  setBestMatch(setId, ms) {
    const best = this.progressOf(setId).best?.match;
    if (!best || ms < best) { this.backend.apply('progress', setId, { best: { match: Math.round(ms) } }); return true; }
    return false;
  },

  // ---------- Sauvegarde / import ----------
  exportAll() {
    return { app: 'revi', format: 1, version: APP_VERSION, exportedAt: new Date().toISOString(), sets: this.state.sets, progress: this.state.progress };
  },
  /** Fusionne une sauvegarde : les séries existantes (même id) sont mises à jour, les autres ajoutées. */
  importAll(data) {
    if (!data || !isPlainObject(data.sets)) throw new Error('Fichier non reconnu : ce n’est pas une sauvegarde Révi.');
    let n = 0;
    for (const [id, s] of Object.entries(data.sets)) { if (isPlainObject(s)) { this.backend.apply('sets', id, s); n++; } }
    for (const [id, p] of Object.entries(data.progress || {})) { if (isPlainObject(p)) this.backend.apply('progress', id, p); }
    return n;
  },
  /** Copie des données brutes (ex. local -> compte) dans le backend actif. */
  copyInto(data) {
    for (const [id, s] of Object.entries(data.sets || {})) this.backend.apply('sets', id, s);
    for (const [id, p] of Object.entries(data.progress || {})) this.backend.apply('progress', id, p);
  },
};
