// Service worker de Révi : met l'appli en cache pour qu'elle s'ouvre et fonctionne hors ligne.
// IMPORTANT : à chaque nouvelle mise en ligne, changer CACHE_VERSION (et APP_VERSION dans js/version.js).
// Si vous ajoutez un fichier à l'appli, ajoutez-le aussi à la liste FILES ci-dessous.
const CACHE_VERSION = '1.2.0';
const CACHE = 'revi-' + CACHE_VERSION;
const FILES = [
  './',
  'index.html',
  'config.js',
  'manifest.webmanifest',
  'css/app.css',
  'js/main.js',
  'js/store.js',
  'js/cloud.js',
  'js/util.js',
  'js/ui.js',
  'js/version.js',
  'js/sample.js',
  'js/views/home.js',
  'js/views/set.js',
  'js/views/editor.js',
  'js/views/cards.js',
  'js/views/learn.js',
  'js/views/test.js',
  'js/views/match.js',
  'js/views/settings.js',
  'js/views/gate.js',
  'js/views/folder.js',
  'vendor/firebase.js',
  'fonts/atkinson-latin.woff2',
  'fonts/atkinson-latin-ext.woff2',
  'fonts/kalam-700.woff2',
  'icons/favicon.svg',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('revi-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase et autres services : réseau direct

  // Navigation : on sert la page de l'appli depuis le cache (routes en #/..., une seule page).
  if (req.mode === 'navigate') {
    event.respondWith(caches.match(new URL('index.html', self.registration.scope).href).then((r) => r || fetch(req)));
    return;
  }
  // config.js : réseau d'abord (pour prendre en compte une nouvelle configuration), cache si hors ligne.
  if (url.pathname.endsWith('/config.js')) {
    event.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req)));
    return;
  }
  // Le reste : cache d'abord, réseau sinon (et mise en cache au passage).
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
