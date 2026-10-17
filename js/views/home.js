// Accueil : séries regroupées par matière, recherche, état vide avec série d'exemple.
import { h, setChildren, add, icon, hlbar } from '../ui.js';
import { store } from '../store.js';
import { plural, fmtRelative, pct, normalize } from '../util.js';
import { SAMPLE_SET } from '../sample.js';

export function homeView(ctx) {
  ctx.setHeader({});
  let query = '';
  const list = h('div');
  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'Rechercher une série ou une carte', 'aria-label': 'Rechercher',
    oninput: (e) => { query = e.target.value; render(); },
  });
  const searchWrap = h('div', { class: 'hidden', style: { marginBottom: '6px' } }, search);
  const head = h('div', { class: 'page-head' },
    h('h1', null, 'Mes séries'),
    h('div', { class: 'actions' },
      h('a', { class: 'btn', href: '#/import' }, icon('text', 20), 'Importer'),
      h('a', { class: 'btn btn-primary', href: '#/new' }, icon('plus', 20), 'Nouvelle série')));
  add(ctx.main, head, searchWrap, list);

  const render = () => {
    const entries = Object.entries(store.state.sets);
    searchWrap.classList.toggle('hidden', entries.length < 5);
    head.classList.toggle('hidden', entries.length === 0);
    if (!entries.length) {
      const s = store.state;
      // Nouvel appareil connecté : le cache est vide tant que le serveur n'a pas répondu.
      if (s.mode === 'cloud' && s.fromCache && s.online) { setChildren(list, h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', null, 'Récupération de vos séries…'))); return; }
      setChildren(list, emptyState(ctx)); return;
    }

    const q = normalize(query);
    const filtered = entries.filter(([, s]) => {
      if (!q) return true;
      if (normalize(s.title).includes(q) || normalize(s.folder).includes(q)) return true;
      return Object.values(s.cards || {}).some((c) => normalize(c.term).includes(q) || normalize(c.definition).includes(q));
    });
    if (!filtered.length) { setChildren(list, h('p', { class: 'muted', style: { marginTop: '24px' } }, 'Aucune série ne correspond à « ' + query + ' ».')); return; }

    const groups = new Map();
    for (const [id, s] of filtered) {
      const f = (s.folder || '').trim() || 'Sans matière';
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f).push([id, s]);
    }
    const names = [...groups.keys()].sort((a, b) => (a === 'Sans matière') - (b === 'Sans matière') || a.localeCompare(b, 'fr'));
    setChildren(list, ...names.map((name) => {
      const items = groups.get(name).sort(([ia, a], [ib, b]) => (store.lastStudied(ib) || b.updatedAt || 0) - (store.lastStudied(ia) || a.updatedAt || 0));
      return h('section', { class: 'folder' }, h('h2', null, name), h('div', { class: 'decks' }, items.map(([id, s]) => deck(id, s))));
    }));
  };
  ctx.watch(render);
}

function deck(id, set) {
  const cards = store.cardsOf(set);
  const n = cards.length;
  const mastered = cards.filter((c) => store.statusOf(id, c.id) === 2).length;
  const last = store.lastStudied(id);
  const info = !n ? 'Série vide' : `${pct(mastered, n)} % maîtrisé` + (last ? `, révisée ${fmtRelative(last)}` : ', pas encore révisée');
  return h('div', { class: 'deck-wrap' },
    h('a', { class: 'deck bristol', href: `#/set/${id}` },
      h('h3', null, set.title || 'Sans titre'),
      h('div', { class: 'meta' }, plural(n, 'carte')),
      h('div', { class: 'foot' }, hlbar(n ? mastered / n : 0, 'thin'), h('div', { class: 'meta small' }, info))));
}

function emptyState(ctx) {
  return h('div', { class: 'empty' },
    h('div', { class: 'bristol', 'aria-hidden': 'true' }, h('span', null, 'Ma première fiche')),
    h('h2', null, 'Aucune série pour l’instant'),
    h('p', null, 'Créez une série de cartes, collez une liste exportée de Quizlet, ou commencez avec la série d’exemple.'),
    h('div', { class: 'actions' },
      h('a', { class: 'btn btn-primary btn-lg', href: '#/new' }, icon('plus', 20), 'Créer une série'),
      h('a', { class: 'btn btn-lg', href: '#/import' }, icon('text', 20), 'Importer une liste'),
      h('button', { class: 'btn btn-ghost wrap', onclick: () => { const id = store.createSet(SAMPLE_SET); ctx.go('/set/' + id); } },
        'Ajouter la série d’exemple (connecteurs logiques en anglais)')));
}
