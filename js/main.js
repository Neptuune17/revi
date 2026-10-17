// Point d'entrée : thème, routeur (#/...), barre du haut, démarrage local ou Firebase, service worker, journal d'erreurs.

import { store, LocalBackend, LS_DATA } from './store.js';
import { h, setChildren, icon, toast, clear, confirmDialog } from './ui.js';
import { ls, plural } from './util.js';
import { APP_VERSION } from './version.js';
import { homeView } from './views/home.js';
import { setView } from './views/set.js';
import { editorView } from './views/editor.js';
import { cardsView } from './views/cards.js';
import { learnView } from './views/learn.js';
import { testView } from './views/test.js';
import { matchView } from './views/match.js';
import { settingsView } from './views/settings.js';
import { gateView, deniedView } from './views/gate.js';
import { folderView } from './views/folder.js';

const topbar = document.getElementById('topbar');
const main = document.getElementById('main');

// ---------- Journal d'erreurs (visible dans Réglages > Diagnostic) ----------
const errors = ls.get('revi.errors', []);
export function logError(err, where = '') {
  const entry = { at: new Date().toISOString(), where, msg: String(err?.message || err), code: err?.code || '', stack: String(err?.stack || '').split('\n').slice(0, 4).join(' | ') };
  errors.unshift(entry); errors.length = Math.min(errors.length, 15);
  ls.set('revi.errors', errors);
  console.error('[Révi]', where, err);
}
export const getErrors = () => errors;
export const clearErrors = () => { errors.length = 0; ls.set('revi.errors', []); };
window.addEventListener('error', (e) => logError(e.error || e.message, 'window'));
window.addEventListener('unhandledrejection', (e) => logError(e.reason, 'promise'));
store.onError((e) => { logError(e, 'store'); toast(e.message, { kind: 'error' }); });

// ---------- Thème ----------
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme; else delete root.dataset.theme;
  ls.set('revi.theme', theme);
  const dark = theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121827' : '#EBEEF4');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyTheme(ls.get('revi.theme', 'auto')));

// ---------- Barre du haut ----------
let header = { title: '', back: null, study: false };
let syncEl = null;
function syncInfo() {
  const s = store.state;
  if (!s.cloudConfigured) return { state: 'local', label: 'Sur cet appareil', tip: 'Synchronisation non configurée : les données restent sur cet appareil.' };
  if (!s.user) return { state: 'local', label: 'Non connecté', tip: 'Connectez-vous pour synchroniser vos séries.' };
  if (!s.online) return { state: 'offline', label: 'Hors ligne', tip: 'Hors ligne : vos modifications seront envoyées au retour du réseau.' };
  if (s.pending) return { state: 'pending', label: 'Envoi…', tip: 'Modifications en cours d’envoi.' };
  return { state: 'synced', label: 'Synchronisé', tip: 'Vos données sont synchronisées.' };
}
function renderSync() {
  const i = syncInfo();
  const el = h('a', { class: 'sync', href: '#/settings', 'data-state': i.state, title: i.tip, 'aria-label': i.tip }, h('span', { class: 'dot' }), h('span', { class: 'label' }, i.label));
  if (syncEl) syncEl.replaceWith(el);
  syncEl = el;
  return el;
}
let prevPath = null, curPath = null;
function renderHeader() {
  const { title, back, study, gate } = header;
  syncEl = null;
  const left = back
    ? h('a', { class: 'icon-btn', href: '#' + back, 'aria-label': study ? 'Quitter' : 'Retour', onclick: (e) => {
      if (prevPath === back && history.length > 1) { e.preventDefault(); history.back(); }
    } }, icon(study ? 'close' : 'back'))
    : h('div', { class: 'logo-wrap' }, h('a', { class: 'logo', href: '#/', 'aria-label': 'Révi, accueil' }, 'Révi'));
  setChildren(topbar, 
    left,
    back ? h('div', { class: 'title' }, title || '') : null,
    gate ? null : renderSync(),
    study || gate ? null : h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'Réglages' }, icon('settings')),
  );
}
window.addEventListener('scroll', () => topbar.classList.toggle('scrolled', window.scrollY > 4), { passive: true });

// ---------- Routeur ----------
const routes = [
  [/^\/$/, homeView],
  [/^\/new$/, editorView],
  [/^\/import$/, editorView, { import: true }],
  [/^\/settings$/, settingsView],
  [/^\/folder\/(.+)$/, folderView],
  [/^\/set\/([A-Za-z0-9_-]+)$/, setView],
  [/^\/set\/([A-Za-z0-9_-]+)\/edit$/, editorView],
  [/^\/set\/([A-Za-z0-9_-]+)\/cards$/, cardsView],
  [/^\/set\/([A-Za-z0-9_-]+)\/learn$/, learnView],
  [/^\/set\/([A-Za-z0-9_-]+)\/test$/, testView],
  [/^\/set\/([A-Za-z0-9_-]+)\/match$/, matchView],
];
let cleanups = [];
let waitingReady = false;

export function go(path, { replace = false } = {}) {
  if (replace) location.replace('#' + path); else location.hash = path;
}

function route() {
  cleanups.forEach((f) => { try { f(); } catch (e) { logError(e, 'cleanup'); } });
  cleanups = [];
  const raw = decodeURI(location.hash.slice(1)) || '/';
  const [path, qs] = raw.split('?');
  if (path !== curPath) { prevPath = curPath; curPath = path; }
  document.body.classList.remove('study');
  main.className = '';
  header = { title: '', back: null, study: false };

  if (!store.state.ready) {
    waitingReady = true;
    renderHeader();
    setChildren(main, h('div', { class: 'loading' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Chargement' })));
    return;
  }
  waitingReady = false;
  lastGate = gateKey();
  // Compte connecté mais refusé par les règles Firestore, ou connexion obligatoire (config.js > requireLogin).
  const gate = store.state.accessDenied ? deniedView : (store.state.requireLogin && !store.state.user) ? gateView : null;
  const match = gate ? [null, gate] : routes.find(([re]) => re.test(path));
  if (!match) { go('/', { replace: true }); return; }
  const [re, view, extra] = match;
  const m = re ? path.match(re) : [];
  const params = { id: m[1], ...(extra || {}) };
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  clear(main);
  window.scrollTo(0, 0);
  const ctx = {
    main, params, query, go, store,
    setHeader(opts) { header = { ...header, ...opts }; if (header.study) document.body.classList.add('study'); renderHeader(); },
    onCleanup(fn) { cleanups.push(fn); },
    /** Réaffiche la vue à chaque changement de données. Renvoie la fonction de rendu. */
    watch(render) {
      const run = () => { try { render(); } catch (e) { logError(e, 'render ' + path); } };
      cleanups.push(store.subscribe(run));
      run();
      return run;
    },
  };
  renderHeader();
  try { view(ctx); }
  catch (e) {
    logError(e, 'view ' + path);
    setChildren(main, h('div', { class: 'empty' }, h('h2', null, 'Cette page n’a pas pu s’afficher'),
      h('p', null, 'Le détail est dans Réglages > Diagnostic. Vous pouvez copier le rapport pour le faire corriger.'),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, 'Revenir à l’accueil'), h('a', { class: 'btn', href: '#/settings' }, 'Voir le diagnostic'))));
  }
}
window.addEventListener('hashchange', route);

// Change d'écran quand l'accès change (connexion, déconnexion, accès refusé).
let lastGate = null;
const gateKey = () => [store.state.accessDenied, store.state.requireLogin && !store.state.user].join('|');
store.subscribe(() => {
  if (waitingReady && store.state.ready) route();
  else if (!waitingReady && store.state.ready && gateKey() !== lastGate) route();
  else if (syncEl) renderSync();
});
window.addEventListener('online', () => store.set({ online: true }));
window.addEventListener('offline', () => store.set({ online: false }));

// ---------- Démarrage ----------
let cloud = null;
export const getCloud = () => cloud;

async function boot() {
  applyTheme(ls.get('revi.theme', 'auto'));
  const cfg = window.REVI_CONFIG && window.REVI_CONFIG.firebase;
  const configured = !!(cfg && cfg.apiKey && cfg.projectId);
  store.state.cloudConfigured = configured;
  // requireLogin : l'appli n'est utilisable qu'une fois connecté (ignoré si Firebase n'est pas configuré).
  store.state.requireLogin = configured && !!window.REVI_CONFIG.requireLogin;
  store.state.allowSignup = window.REVI_CONFIG.allowSignup ?? !store.state.requireLogin;
  const lastMode = ls.get('revi.lastMode', 'local');

  if (!configured || lastMode !== 'cloud') store.useBackend(new LocalBackend());
  route();

  if (configured) {
    try {
      cloud = await import('./cloud.js');
      cloud.initCloud(cfg);
      cloud.handleRedirect().catch((e) => { logError(e, 'redirect'); toast(cloud.authMessage(e), { kind: 'error' }); });
      cloud.onAuth((user) => onUser(user));
    } catch (e) {
      logError(e, 'firebase init');
      store.state.cloudError = 'Firebase n’a pas pu démarrer : ' + (e.message || e);
      store.useBackend(new LocalBackend());
    }
    // Filet de sécurité : si la session n'est pas restaurée en 6 s, on affiche les données locales.
    setTimeout(() => { if (!store.backend) { logError(new Error('Délai de connexion dépassé'), 'boot'); store.useBackend(new LocalBackend()); } }, 6000);
  }
  registerSW();
}

let currentUid = null;
async function onUser(user) {
  if (user) {
    if (currentUid === user.uid) return;
    currentUid = user.uid;
    store.state.user = { uid: user.uid, email: user.email || '', name: user.displayName || '' };
    store.state.accessDenied = false;
    store.state.cloudError = null;
    ls.set('revi.lastMode', 'cloud');
    store.useBackend(new cloud.CloudBackend(user, (e) => {
      logError(e, 'firestore');
      // Les règles Firestore refusent ce compte : on affiche un écran dédié au lieu d'attendre indéfiniment.
      if (e.code === 'permission-denied') store.set({ accessDenied: true, ready: true, cloudError: cloud.authMessage(e) });
      else store.set({ cloudError: cloud.authMessage(e) });
    }), { ready: false });
    await maybeMigrate(user);
  } else {
    currentUid = null;
    store.state.user = null;
    store.state.accessDenied = false;
    ls.set('revi.lastMode', 'local');
    store.useBackend(new LocalBackend());
  }
}

/** Première connexion sur un appareil qui a déjà des séries locales : proposer de les envoyer dans le compte. */
async function maybeMigrate(user) {
  const flag = 'revi.migrated.' + user.uid;
  const local = new LocalBackend().data;
  const n = Object.keys(local.sets).length;
  if (!n || ls.get(flag)) return;
  const yes = await confirmDialog({
    title: 'Ajouter les séries de cet appareil à votre compte ?',
    body: `${plural(n, 'série')} ${n > 1 ? 'ont été créées' : 'a été créée'} sur cet appareil avant la connexion. Elles seront ensuite disponibles partout.`,
    confirm: 'Ajouter à mon compte', cancel: 'Plus tard',
  });
  if (!yes) return;
  store.copyInto(local);
  ls.set(LS_DATA + '.backup', local);
  ls.remove(LS_DATA);
  ls.set(flag, true);
  toast(`${plural(n, 'série ajoutée', 'séries ajoutées')} à votre compte.`);
}

// ---------- Service worker (hors ligne + mises à jour) ----------
function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (!reg) return;
    const ask = (worker) => toast('Une nouvelle version de Révi est prête.', {
      action: 'Mettre à jour', timeout: 0, onAction: () => worker.postMessage('skipWaiting'),
    });
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => logError(e, 'service worker'));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

// Invite d'installation (Android / Chrome / Edge)
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__reviInstall = e; store.emit(); });

// Accès de débogage depuis la console : revi.store.state, revi.errors, revi.export()
window.revi = { store, version: APP_VERSION, errors, export: () => store.exportAll(), go };

boot();
