// Accueil : dossiers (boutons qui ouvrent la page du dossier), séries sans dossier, recherche, état vide.
import { h, setChildren, add, icon, hlbar, toast, promptDialog } from '../ui.js';
import { store } from '../store.js';
import { plural, fmtRelative, pct, normalize } from '../util.js';
import { SAMPLE_SET } from '../sample.js';

export const folderPath = (name) => '/folder/' + encodeURIComponent(name);

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
      h('button', { class: 'btn', onclick: () => newFolder(ctx) }, icon('folderPlus', 20), 'Nouveau dossier'),
      h('a', { class: 'btn btn-primary', href: '#/new' }, icon('plus', 20), 'Nouvelle série')));
  add(ctx.main, head, searchWrap, list);

  const render = () => {
    const entries = Object.entries(store.state.sets);
    const folders = store.folderList();
    searchWrap.classList.toggle('hidden', entries.length < 5);
    head.classList.toggle('hidden', entries.length === 0 && folders.length === 0);
    if (!entries.length && !folders.length) {
      const s = store.state;
      // Nouvel appareil connecté : le cache est vide tant que le serveur n'a pas répondu.
      if (s.mode === 'cloud' && s.fromCache && s.online) { setChildren(list, h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', null, 'Récupération de vos séries…'))); return; }
      setChildren(list, emptyState(ctx)); return;
    }

    // Recherche : résultats à plat, tous dossiers confondus
    const q = normalize(query);
    if (q) {
      const found = entries.filter(([, s]) => normalize(s.title).includes(q) || normalize(s.folder).includes(q)
        || Object.values(s.cards || {}).some((c) => normalize(c.term).includes(q) || normalize(c.definition).includes(q)));
      setChildren(list, found.length
        ? h('section', { class: 'shelf' }, h('h2', null, plural(found.length, 'résultat')), h('div', { class: 'decks' }, sortSets(found).map(([id, s]) => deckTile(id, s, { showFolder: true }))))
        : h('p', { class: 'muted', style: { marginTop: '24px' } }, 'Aucune série ne correspond à « ' + query + ' ».'));
      return;
    }

    const loose = entries.filter(([, s]) => !(s.folder || '').trim());
    setChildren(list,
      folders.length ? h('section', { class: 'shelf' }, h('h2', null, 'Dossiers'),
        h('div', { class: 'folders' }, folders.map((f) => folderTile(f)))) : null,
      loose.length ? h('section', { class: 'shelf' }, folders.length ? h('h2', null, 'Séries sans dossier') : null,
        h('div', { class: 'decks' }, sortSets(loose).map(([id, s]) => deckTile(id, s)))) : null);
  };
  ctx.watch(render);
}

/** Plus récemment révisées (ou modifiées) d'abord. */
export function sortSets(entries) {
  return entries.slice().sort(([ia, a], [ib, b]) => (store.lastStudied(ib) || b.updatedAt || 0) - (store.lastStudied(ia) || a.updatedAt || 0));
}

function folderTile(f) {
  const sets = f.setIds.map((id) => [id, store.getSet(id)]).filter(([, s]) => s);
  let total = 0, mastered = 0;
  sets.forEach(([id, s]) => { const cards = store.cardsOf(s); total += cards.length; mastered += cards.filter((c) => store.statusOf(id, c.id) === 2).length; });
  return h('a', { class: 'folder-tile', href: '#' + folderPath(f.name), 'aria-label': `Dossier ${f.name}, ${plural(sets.length, 'série')}` },
    icon('folder', 24),
    h('b', null, f.name),
    h('span', { class: 'meta' }, sets.length ? `${plural(sets.length, 'série')}, ${plural(total, 'carte')}` : 'Dossier vide'),
    total ? h('div', { class: 'foot' }, hlbar(mastered / total, 'thin'), h('span', { class: 'meta small' }, `${pct(mastered, total)} % maîtrisé`)) : null);
}

export function deckTile(id, set, { showFolder = false } = {}) {
  const cards = store.cardsOf(set);
  const n = cards.length;
  const mastered = cards.filter((c) => store.statusOf(id, c.id) === 2).length;
  const last = store.lastStudied(id);
  const info = !n ? 'Série vide' : `${pct(mastered, n)} % maîtrisé` + (last ? `, révisée ${fmtRelative(last)}` : ', pas encore révisée');
  return h('div', { class: 'deck-wrap' },
    h('a', { class: 'deck bristol', href: `#/set/${id}` },
      h('h3', null, set.title || 'Sans titre'),
      h('div', { class: 'meta' }, plural(n, 'carte') + (showFolder && set.folder ? `, dossier ${set.folder}` : '')),
      h('div', { class: 'foot' }, hlbar(n ? mastered / n : 0, 'thin'), h('div', { class: 'meta small' }, info))));
}

/** Demande un nom puis crée le dossier et l'ouvre. */
export async function newFolder(ctx) {
  const name = await promptDialog({
    title: 'Nouveau dossier', label: 'Nom du dossier', placeholder: 'Ex. : Anglais', confirm: 'Créer le dossier',
    validate: (v) => (!v ? 'Donnez un nom au dossier.' : store.getFolder(v) ? 'Un dossier porte déjà ce nom.' : null),
  });
  if (!name) return;
  const finalName = store.createFolder(name);
  toast(`Dossier « ${finalName} » créé.`);
  ctx.go(folderPath(finalName));
}

function emptyState(ctx) {
  return h('div', { class: 'empty' },
    h('div', { class: 'bristol', 'aria-hidden': 'true' }, h('span', null, 'Ma première fiche')),
    h('h2', null, 'Aucune série pour l’instant'),
    h('p', null, 'Créez une série de cartes ou un dossier pour les ranger, collez une liste exportée de Quizlet, ou commencez avec la série d’exemple.'),
    h('div', { class: 'actions' },
      h('a', { class: 'btn btn-primary btn-lg', href: '#/new' }, icon('plus', 20), 'Créer une série'),
      h('button', { class: 'btn btn-lg', onclick: () => newFolder(ctx) }, icon('folderPlus', 20), 'Créer un dossier'),
      h('a', { class: 'btn btn-lg', href: '#/import' }, icon('text', 20), 'Importer une liste'),
      h('button', { class: 'btn btn-ghost wrap', onclick: () => { const id = store.createSet(SAMPLE_SET); ctx.go('/set/' + id); } },
        'Ajouter la série d’exemple (connecteurs logiques en anglais)')));
}
