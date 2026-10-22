// Magasin de données central. Toute lecture passe par store.state, toute écriture par les méthodes ci-dessous.
// Deux "backends" interchangeables :
//   - LocalBackend : données dans localStorage (mode hors compte / sans Firebase).
//   - CloudBackend (cloud.js) : Firestore avec cache hors ligne, données sous users/{uid}/...
// Chaque écriture est un "patch" (objet imbriqué) fusionné en profondeur, avec DELETE et inc() comme sentinelles.
// Collections : "sets" (séries et cartes), "progress" (progression, sessions, records ; clé = id de la série)
// et "folders" (dossiers, y compris vides). Une série appartient à un dossier par son champ texte `folder` (chemin du dossier).
// Sous-dossiers : le chemin sépare les niveaux par « / » (ex. "Allemand/Verbes" = dossier Verbes rangé dans Allemand).

import { DELETE, inc, deepMerge, uid, ls, isPlainObject } from './util.js';
import { APP_VERSION } from './version.js';

export const LS_DATA = 'revi.data.v1';
const MAX_SESSIONS = 60;

const emptyData = () => ({ sets: {}, progress: {}, folders: {} });
const withFolders = (d) => ({ sets: d.sets || {}, progress: d.progress || {}, folders: d.folders || {} });
// ---------- Chemins de dossier ----------
const MAX_FOLDER_NAME = 60;
const lower = (s) => s.toLocaleLowerCase('fr');
/** "Allemand / Verbes " -> ["Allemand", "Verbes"] (espaces nettoyés, niveaux vides ignorés). */
export const splitPath = (path) => String(path || '').split('/').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
/** Assemble des morceaux de chemin : joinPath("Allemand", "Verbes") -> "Allemand/Verbes". */
export const joinPath = (...parts) => parts.flatMap(splitPath).join('/');
/** Clé de comparaison d'un chemin (insensible à la casse et aux espaces autour de chaque niveau). */
export const folderKey = (path) => lower(splitPath(path).join('/'));
export const parentPath = (path) => splitPath(path).slice(0, -1).join('/');
export const baseName = (path) => splitPath(path).pop() || '';
/** Chemin lisible : "Allemand › Verbes". */
export const displayPath = (path) => splitPath(path).join(' › ');
/** Chemin à taper dans un champ : "Allemand / Verbes". */
export const inputPath = (path) => splitPath(path).join(' / ');
const inTree = (key, rootKey) => key === rootKey || key.startsWith(rootKey + '/');
const sortByLabel = (a, b) => a.label.localeCompare(b.label, 'fr', { numeric: true, sensitivity: 'base' });

export class LocalBackend {
  constructor(key = LS_DATA) {
    this.kind = 'local';
    this.key = key;
    const saved = ls.get(key);
    this.data = saved && saved.sets ? withFolders(saved) : emptyData();
  }
  start(onData) {
    this.onData = onData;
    this._onStorage = (e) => {
      if (e.key !== this.key) return;
      const saved = ls.get(this.key);
      this.data = saved && saved.sets ? withFolders(saved) : emptyData();
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
    sets: {}, progress: {}, folders: {}, ready: false, mode: 'local', user: null,
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
      this.state.folders = data.folders || {};
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
  /** Chemins de tous les dossiers (pour les listes de choix). */
  folders() { return this.folderList().map((f) => f.name); },
  /**
   * Arborescence des dossiers, recalculée seulement quand les séries ou les dossiers changent.
   * Un dossier existe s'il a un document dans "folders" (même vide) ou si une série y est rangée.
   * Ses parents existent alors aussi, même sans document (ex. "Allemand" pour "Allemand/Verbes").
   * Chaque dossier : { key, id, ids, name (chemin complet), label (dernier niveau), parent (clé, '' = accueil),
   *                    depth, setIds (séries directement dedans), children (sous-dossiers triés) }.
   */
  _folderIndex() {
    const st = this.state;
    if (this._fi && this._fi.folders === st.folders && this._fi.sets === st.sets) return this._fi;
    const map = new Map();
    const roots = [];
    const ensure = (path) => {
      let parent = null;
      for (const label of splitPath(path)) {
        const key = (parent ? parent.key + '/' : '') + lower(label);
        let f = map.get(key);
        if (!f) {
          f = { key, id: null, ids: [], name: (parent ? parent.name + '/' : '') + label, label, parent: parent ? parent.key : '', depth: parent ? parent.depth + 1 : 0, setIds: [], children: [] };
          map.set(key, f);
          (parent ? parent.children : roots).push(f);
        }
        parent = f;
      }
      return parent;
    };
    // Les parents d'abord, puis les plus anciens : leur casse fait foi.
    const docs = Object.entries(st.folders || {}).filter(([, d]) => d && splitPath(d.name).length)
      .sort(([, a], [, b]) => splitPath(a.name).length - splitPath(b.name).length || (a.createdAt || 0) - (b.createdAt || 0));
    for (const [id, d] of docs) { const f = ensure(d.name); f.ids.push(id); f.id = f.id || id; }
    for (const [sid, s] of Object.entries(st.sets)) { const f = s && ensure(s.folder); if (f) f.setIds.push(sid); }
    roots.sort(sortByLabel);
    for (const f of map.values()) f.children.sort(sortByLabel);
    const list = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true, sensitivity: 'base' }));
    this._fi = { folders: st.folders, sets: st.sets, map, roots, list };
    return this._fi;
  },
  /** Tous les dossiers, sous-dossiers compris, triés par chemin. */
  folderList() { return this._folderIndex().list; },
  getFolder(path) { const k = folderKey(path); return k ? this._folderIndex().map.get(k) || null : null; },
  /** Sous-dossiers directs d'un dossier ('' = dossiers de l'accueil). */
  subfolders(path = '') { return folderKey(path) ? this.getFolder(path)?.children || [] : this._folderIndex().roots; },
  /** Séries d'un dossier ; avec deep, aussi celles de ses sous-dossiers. */
  folderSetIds(path, deep = false) {
    const f = this.getFolder(path);
    if (!f) return [];
    if (!deep) return f.setIds;
    const out = [];
    const walk = (x) => { out.push(...x.setIds); x.children.forEach(walk); };
    walk(f);
    return out;
  },
  /**
   * Date de création d'un dossier : celle de son document le plus ancien. À défaut (dossier sans document :
   * parent créé seulement par le chemin d'une série, dossier d'avant 1.2.0 ou venu d'un import), celle du plus
   * ancien élément qu'il contient (séries et sous-dossiers). 0 = inconnue.
   */
  folderCreatedAt(f) {
    const docs = this.state.folders || {};
    const own = f.ids.map((id) => docs[id]?.createdAt).filter(Boolean);
    if (own.length) return Math.min(...own);
    let min = 0;
    const take = (t) => { if (t && (!min || t < min)) min = t; };
    const walk = (x) => {
      x.setIds.forEach((sid) => { const s = this.state.sets[sid]; take(s?.createdAt || s?.updatedAt); });
      x.ids.forEach((id) => take(docs[id]?.createdAt));
      x.children.forEach(walk);
    };
    walk(f);
    return min;
  },
  /** Dernière révision d'un dossier : la plus récente des séries qu'il contient, sous-dossiers compris. 0 = jamais révisé. */
  folderStudiedAt(f) {
    return this.folderSetIds(f.name, true).reduce((max, id) => Math.max(max, this.lastStudied(id) || 0), 0);
  },
  /** Chemin avec la casse des dossiers existants (« allemand/verbes » -> « Allemand/Verbes »), sinon le chemin nettoyé. */
  canonicalFolder(path) {
    const { map } = this._folderIndex();
    let key = '';
    return splitPath(path).map((seg) => {
      key = (key ? key + '/' : '') + lower(seg);
      return map.get(key)?.label || seg.slice(0, MAX_FOLDER_NAME);
    }).join('/');
  },

  // ---------- Écriture : dossiers ----------
  /** Crée le dossier (et ses parents) s'il n'existe pas encore. Renvoie son chemin exact. */
  createFolder(path) {
    const name = this.canonicalFolder(path);
    if (!name) throw new Error('Donnez un nom au dossier.');
    const { map } = this._folderIndex();
    const segs = splitPath(name);
    const now = Date.now();
    // Un document par niveau qui n'en a pas : le dossier reste visible même vide.
    // Un dossier qui existait déjà sans document garde sa date (celle de son contenu) pour le tri par date.
    segs.forEach((_, i) => {
      const p = segs.slice(0, i + 1).join('/');
      const existing = map.get(folderKey(p));
      if (!existing?.ids.length) this.backend.apply('folders', uid('f'), { name: p, createdAt: (existing && this.folderCreatedAt(existing)) || now, updatedAt: now });
    });
    return name;
  },
  /**
   * Renomme ou déplace un dossier, avec tout ce qu'il contient (sous-dossiers et séries).
   * newPath = nouveau chemin complet. Renvoie le chemin final.
   */
  moveFolder(oldPath, newPath, { taken } = {}) {
    const f = this.getFolder(oldPath);
    if (!f) throw new Error('Dossier introuvable.');
    const segs = splitPath(newPath).map((s) => s.slice(0, MAX_FOLDER_NAME));
    if (!segs.length) throw new Error('Donnez un nom au dossier.');
    const parent = segs.length > 1 ? this.canonicalFolder(segs.slice(0, -1).join('/')) : '';
    const dest = joinPath(parent, segs[segs.length - 1]);
    const destKey = folderKey(dest);
    if (destKey.startsWith(f.key + '/')) throw new Error('Un dossier ne peut pas être rangé dans un de ses sous-dossiers.');
    const other = this.getFolder(dest);
    if ((other && other.key !== f.key) || taken?.has(destKey)) throw new Error(`Il y a déjà un dossier « ${segs[segs.length - 1]} » à cet endroit.`);
    if (dest === f.name) return dest;
    const now = Date.now();
    const created = this.folderCreatedAt(f) || now; // un dossier renommé ou déplacé garde sa date de création
    const rebase = (path) => joinPath(dest, splitPath(path).slice(f.depth + 1).join('/'));
    const docs = Object.entries(this.state.folders || {}).filter(([, d]) => d && inTree(folderKey(d.name), f.key));
    const sets = Object.entries(this.state.sets).filter(([, s]) => s && s.folder && inTree(folderKey(s.folder), f.key));
    if (parent) this.createFolder(parent);
    // Tous les documents concernés (il peut exister des doublons créés hors ligne sur deux appareils).
    // Seuls le nom et updatedAt changent : createdAt est conservé.
    if (!docs.some(([, d]) => folderKey(d.name) === f.key)) this.backend.apply('folders', uid('f'), { name: dest, createdAt: created, updatedAt: now });
    docs.forEach(([id, d]) => this.backend.apply('folders', id, { name: rebase(d.name), updatedAt: now }));
    sets.forEach(([sid, s]) => this.backend.apply('sets', sid, { folder: rebase(s.folder), updatedAt: now }));
    taken?.add(destKey);
    return dest;
  },
  /** Renomme un dossier sans le déplacer. Renvoie son nouveau chemin. */
  renameFolder(oldPath, newName) {
    const n = String(newName || '').trim();
    if (n.includes('/')) throw new Error('Le nom ne peut pas contenir « / ».');
    if (!n) throw new Error('Donnez un nom au dossier.');
    return this.moveFolder(oldPath, joinPath(parentPath(this.getFolder(oldPath)?.name || oldPath), n));
  },
  /**
   * Range des dossiers dans destPath ('' = accueil). Les dossiers déjà contenus dans un autre dossier choisi suivent leur parent.
   * Renvoie { moved, errors } (errors : messages des dossiers qui n'ont pas pu être déplacés).
   */
  moveFoldersInto(paths, destPath) {
    const dest = destPath ? this.canonicalFolder(destPath) : '';
    const picked = paths.map((p) => this.getFolder(p)).filter(Boolean);
    const top = picked.filter((f) => !picked.some((o) => o !== f && f.key.startsWith(o.key + '/')));
    const taken = new Set();
    let moved = 0; const errors = [];
    if (dest && top.length) this.createFolder(dest);
    for (const f of top) {
      try { this.moveFolder(f.name, joinPath(dest, f.label), { taken }); moved++; } catch (e) { errors.push(e.message); }
    }
    return { moved, errors };
  },
  /** Supprime le dossier. Rien n'est perdu : ses séries et ses sous-dossiers remontent d'un niveau. */
  deleteFolder(path) {
    const f = this.getFolder(path);
    if (!f) return 0;
    const parent = f.parent ? this.getFolder(f.parent).name : '';
    const now = Date.now();
    const rebase = (p) => joinPath(parent, splitPath(p).slice(f.depth + 1).join('/'));
    const docs = Object.entries(this.state.folders || {}).filter(([, d]) => d && inTree(folderKey(d.name), f.key));
    const sets = Object.entries(this.state.sets).filter(([, s]) => s && s.folder && inTree(folderKey(s.folder), f.key));
    if (parent) this.createFolder(parent);
    docs.forEach(([id, d]) => {
      if (folderKey(d.name) === f.key) this.backend.remove('folders', id);
      else this.backend.apply('folders', id, { name: rebase(d.name), updatedAt: now });
    });
    sets.forEach(([sid, s]) => this.backend.apply('sets', sid, { folder: rebase(s.folder), updatedAt: now }));
    return f.setIds.length;
  },
  moveSetsToFolder(setIds, path) {
    const n = path ? this.createFolder(path) : '';
    const now = Date.now();
    setIds.forEach((sid) => { if (this.state.sets[sid]) this.backend.apply('sets', sid, { folder: n, updatedAt: now }); });
  },

  // ---------- Écriture : séries ----------
  createSet({ title, folder = '', termLang = '', defLang = '', cards = [] }) {
    const id = uid('s');
    folder = folder ? this.createFolder(folder) : '';
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
    if (folder) folder = this.createFolder(folder);
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
    return { app: 'revi', format: 1, version: APP_VERSION, exportedAt: new Date().toISOString(), sets: this.state.sets, progress: this.state.progress, folders: this.state.folders };
  },
  /** Fusionne une sauvegarde : les séries existantes (même id) sont mises à jour, les autres ajoutées. */
  importAll(data) {
    if (!data || !isPlainObject(data.sets)) throw new Error('Fichier non reconnu : ce n’est pas une sauvegarde Révi.');
    let n = 0;
    const now = Date.now();
    // createdAt (tri par date) : celui du fichier, sinon celui de la série déjà présente, sinon la date de modification ou d'import.
    for (const [id, s] of Object.entries(data.sets)) {
      if (!isPlainObject(s)) continue;
      this.backend.apply('sets', id, { ...s, createdAt: s.createdAt || this.state.sets[id]?.createdAt || s.updatedAt || now });
      n++;
    }
    for (const [id, p] of Object.entries(data.progress || {})) { if (isPlainObject(p)) this.backend.apply('progress', id, p); }
    for (const [id, f] of Object.entries(data.folders || {})) { if (isPlainObject(f) && f.name && !this.getFolder(f.name)) this.backend.apply('folders', id, f); }
    return n;
  },
  /** Copie des données brutes (ex. local -> compte) dans le backend actif. */
  copyInto(data) {
    for (const [id, s] of Object.entries(data.sets || {})) this.backend.apply('sets', id, s);
    for (const [id, p] of Object.entries(data.progress || {})) this.backend.apply('progress', id, p);
    for (const [id, f] of Object.entries(data.folders || {})) this.backend.apply('folders', id, f);
  },
};
