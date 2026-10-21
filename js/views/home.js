// Accueil : dossiers de premier niveau (boutons qui ouvrent la page du dossier), séries sans dossier, recherche, tri, état vide.
// Exporte aussi les éléments partagés par les pages de dossier et de série : tuiles, tri, chemins, choix d'un dossier.
import { h, setChildren, add, icon, hlbar, toast, promptDialog, choiceDialog } from '../ui.js';
import { store, folderKey, joinPath, parentPath, displayPath } from '../store.js';
import { plural, fmtRelative, pct, normalize, ls } from '../util.js';
import { SAMPLE_SET } from '../sample.js';

/** Adresse de la page d'un dossier : #/folder/Allemand/Verbes (chaque niveau encodé). */
export const folderPath = (path) => '/folder/' + String(path || '').split('/').map(encodeURIComponent).join('/');

export function homeView(ctx) {
  ctx.setHeader({});
  let query = '';
  const list = h('div');
  const search = h('input', {
    class: 'input', type: 'search', placeholder: 'Rechercher une série, une carte ou un dossier', 'aria-label': 'Rechercher',
    oninput: (e) => { query = e.target.value; render(); },
  });
  const searchWrap = h('div', { class: 'hidden', style: { marginBottom: '6px' } }, search);
  const head = h('div', { class: 'page-head' },
    h('h1', null, 'Mes séries'),
    h('div', { class: 'actions' },
      h('a', { class: 'btn', href: '#/import' }, icon('text', 20), 'Importer'),
      h('button', { class: 'btn', onclick: () => newFolder(ctx) }, icon('folderPlus', 20), 'Nouveau dossier'),
      h('a', { class: 'btn btn-primary', href: '#/new' }, icon('plus', 20), 'Nouvelle série')));
  const sortRow = h('div', { class: 'sort-row hidden' }, sortControl(() => render()));
  add(ctx.main, head, searchWrap, sortRow, list);

  const render = () => {
    const entries = Object.entries(store.state.sets);
    const all = store.folderList();
    const roots = sortFolders(store.subfolders(''));
    const loose = entries.filter(([, s]) => !folderKey(s.folder));
    searchWrap.classList.toggle('hidden', entries.length < 5 && all.length < 5);
    head.classList.toggle('hidden', entries.length === 0 && all.length === 0);
    sortRow.classList.toggle('hidden', roots.length + loose.length < 2 && !query);
    if (!entries.length && !all.length) {
      const s = store.state;
      // Nouvel appareil connecté : le cache est vide tant que le serveur n'a pas répondu.
      if (s.mode === 'cloud' && s.fromCache && s.online) { setChildren(list, h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', null, 'Récupération de vos séries…'))); return; }
      setChildren(list, emptyState(ctx)); return;
    }

    // Recherche : résultats à plat, tous dossiers et sous-dossiers confondus
    const q = normalize(query);
    if (q) {
      const foundFolders = sortFolders(all.filter((f) => normalize(f.label).includes(q)));
      const found = entries.filter(([, s]) => normalize(s.title).includes(q) || normalize(s.folder).includes(q)
        || Object.values(s.cards || {}).some((c) => normalize(c.term).includes(q) || normalize(c.definition).includes(q)));
      setChildren(list, !found.length && !foundFolders.length
        ? h('p', { class: 'muted', style: { marginTop: '24px' } }, 'Rien ne correspond à « ' + query + ' ».')
        : [
          foundFolders.length ? h('section', { class: 'shelf' }, h('h2', null, plural(foundFolders.length, 'dossier')),
            h('div', { class: 'folders' }, foundFolders.map((f) => folderTile(f, { showParent: true })))) : null,
          found.length ? h('section', { class: 'shelf' }, h('h2', null, plural(found.length, 'série')),
            h('div', { class: 'decks' }, sortSets(found).map(([id, s]) => deckTile(id, s, { showFolder: true })))) : null,
        ]);
      return;
    }

    setChildren(list,
      roots.length ? h('section', { class: 'shelf' }, h('h2', null, 'Dossiers'),
        h('div', { class: 'folders' }, roots.map((f) => folderTile(f)))) : null,
      loose.length ? h('section', { class: 'shelf' }, roots.length ? h('h2', null, 'Séries sans dossier') : null,
        h('div', { class: 'decks' }, sortSets(loose).map(([id, s]) => deckTile(id, s)))) : null);
  };
  ctx.watch(render);
}

// ---------- Tri des dossiers et des séries ----------
// Un seul réglage pour l'accueil et tous les dossiers, mémorisé sur l'appareil (revi.opts.sort).
// Les dossiers restent avant les séries ; chaque groupe suit le même tri.
export const SORTS = [['name', 'Nom (A → Z)'], ['newest', 'Plus récentes d’abord'], ['oldest', 'Plus anciennes d’abord'], ['studied', 'Dernière révision']];
const SORT_KEY = 'revi.opts.sort';
const SORT_DEFAULT = 'studied'; // le tri des séries d'avant 1.4.0
export function sortMode() {
  const v = ls.get(SORT_KEY, SORT_DEFAULT);
  return SORTS.some(([k]) => k === v) ? v : SORT_DEFAULT;
}
const byName = (a, b) => a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' });

/** Trie selon le réglage. Une date inconnue (0) passe à la fin ; à égalité, ordre alphabétique (« Leçon 2 » avant « Leçon 10 »). */
function sortBy(items, nameOf, createdOf, studiedOf) {
  const mode = sortMode();
  const byDate = mode === 'newest' || mode === 'oldest';
  const keyed = items.map((it) => ({ it, name: nameOf(it), d: byDate ? createdOf(it) : mode === 'studied' ? studiedOf(it) : 0 }));
  keyed.sort((a, b) => {
    if (mode !== 'name') {
      if (!a.d !== !b.d) return a.d ? -1 : 1;
      if (a.d !== b.d) return mode === 'oldest' ? a.d - b.d : b.d - a.d;
    }
    return byName(a.name, b.name);
  });
  return keyed.map((k) => k.it);
}

/** Séries : par titre, par date de création, ou par dernière révision (à défaut, dernière modification). */
export function sortSets(entries) {
  return sortBy(entries, ([, s]) => s.title || '', ([, s]) => s.createdAt || s.updatedAt || 0, ([id, s]) => store.lastStudied(id) || s.updatedAt || 0);
}

/** Dossiers : par nom, par date de création (store.folderCreatedAt), ou par la révision la plus récente de leurs séries. */
export function sortFolders(list) {
  return sortBy(list, (f) => f.label, (f) => store.folderCreatedAt(f), (f) => store.folderStudiedAt(f));
}

/** Menu « Trier » présent à chaque niveau. onChange : réaffiche la page. */
export function sortControl(onChange) {
  const select = h('select', { class: 'sort-select', 'aria-label': 'Trier les dossiers et les séries',
    onchange: (e) => { ls.set(SORT_KEY, e.target.value); onChange(); } },
  SORTS.map(([v, label]) => h('option', { value: v }, label)));
  select.value = sortMode();
  return h('label', { class: 'sortbar' }, icon('sort', 18), h('span', { 'aria-hidden': 'true' }, 'Trier :'), select);
}

/** Bouton d'un dossier. Les chiffres et la progression comptent aussi les séries des sous-dossiers. */
export function folderTile(f, { showParent = false } = {}) {
  const sets = store.folderSetIds(f.name, true).map((id) => [id, store.getSet(id)]).filter(([, s]) => s);
  let total = 0, mastered = 0;
  sets.forEach(([id, s]) => { const cards = store.cardsOf(s); total += cards.length; mastered += cards.filter((c) => store.statusOf(id, c.id) === 2).length; });
  const nSub = f.children.length;
  const meta = nSub
    ? [plural(nSub, 'sous-dossier'), sets.length ? plural(sets.length, 'série') : null].filter(Boolean).join(', ')
    : sets.length ? `${plural(sets.length, 'série')}, ${plural(total, 'carte')}` : 'Dossier vide';
  const where = showParent && f.parent ? displayPath(parentPath(f.name)) : '';
  return h('a', { class: 'folder-tile' + (nSub ? ' has-sub' : ''), href: '#' + folderPath(f.name), 'aria-label': `Dossier ${f.label}${where ? ', dans ' + where : ''}, ${meta}` },
    icon(nSub ? 'folders' : 'folder', 24),
    where ? h('span', { class: 'meta small path' }, where) : null,
    h('b', null, f.label),
    h('span', { class: 'meta' }, meta),
    total ? h('div', { class: 'foot' }, hlbar(mastered / total, 'thin'), h('span', { class: 'meta small' }, `${pct(mastered, total)} % maîtrisé`)) : null);
}

export function deckTile(id, set, { showFolder = false } = {}) {
  const cards = store.cardsOf(set);
  const n = cards.length;
  const mastered = cards.filter((c) => store.statusOf(id, c.id) === 2).length;
  const last = store.lastStudied(id);
  const info = !n ? 'Série vide' : `${pct(mastered, n)} % maîtrisé` + (last ? `, révisée ${fmtRelative(last)}` : ', pas encore révisée');
  const folder = showFolder && folderKey(set.folder) ? displayPath(store.canonicalFolder(set.folder)) : '';
  return h('div', { class: 'deck-wrap' },
    h('a', { class: 'deck bristol', href: `#/set/${id}` },
      h('h3', null, set.title || 'Sans titre'),
      h('div', { class: 'meta' }, plural(n, 'carte') + (folder ? `, dossier ${folder}` : '')),
      h('div', { class: 'foot' }, hlbar(n ? mastered / n : 0, 'thin'), h('div', { class: 'meta small' }, info))));
}

/**
 * Demande un nom puis crée le dossier. parent = chemin du dossier qui l'accueille ('' = accueil).
 * Sur l'accueil, ouvre le nouveau dossier ; dans un dossier, reste sur place pour pouvoir en créer plusieurs d'affilée.
 */
export async function newFolder(ctx, parent = '') {
  const parentLabel = parent ? store.getFolder(parent)?.label || parent : '';
  const name = await promptDialog({
    title: parent ? `Nouveau sous-dossier dans « ${parentLabel} »` : 'Nouveau dossier',
    label: parent ? 'Nom du sous-dossier' : 'Nom du dossier', placeholder: parent ? 'Ex. : Verbes' : 'Ex. : Allemand', confirm: 'Créer le dossier',
    validate: (v) => (!v ? 'Donnez un nom au dossier.' : store.getFolder(joinPath(parent, v)) ? (parent ? 'Ce dossier contient déjà un sous-dossier de ce nom.' : 'Un dossier porte déjà ce nom.') : null),
  });
  if (!name) return;
  const finalName = store.createFolder(joinPath(parent, name));
  if (!parent) { toast(`Dossier « ${displayPath(finalName)} » créé.`); ctx.go(folderPath(finalName)); return; }
  toast(`Sous-dossier « ${name} » créé.`, { action: 'Ouvrir', onAction: () => ctx.go(folderPath(finalName)) });
}

/**
 * Choisir un dossier de destination. current = chemin actuel (affiché, non sélectionnable).
 * exclude(f) : dossiers à ne pas proposer. blocked(f) : message si le dossier ne peut pas être choisi (ou null).
 * rootLabel : libellé de l'accueil (null = ne pas le proposer). Renvoie le chemin choisi ('' = accueil) ou null si annulé.
 */
export function pickFolder({ title, body, confirm = 'Déplacer', current = '', rootLabel = 'Accueil', rootHint = '', exclude = () => false, blocked = () => null }) {
  const cur = folderKey(current);
  const items = [];
  if (rootLabel) items.push({ value: '', label: rootLabel, hint: !cur ? 'Emplacement actuel' : rootHint, icon: 'home', disabled: !cur });
  store.folderList().filter((f) => !exclude(f)).forEach((f) => {
    const reason = f.key === cur ? 'Emplacement actuel' : blocked(f);
    items.push({ value: f.name, label: displayPath(f.name), hint: reason || '', icon: 'folder', disabled: !!reason });
  });
  return choiceDialog({ title, body, items, confirm });
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
