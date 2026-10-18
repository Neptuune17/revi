// Accueil : dossiers de premier niveau (boutons qui ouvrent la page du dossier), séries sans dossier, recherche, état vide.
// Exporte aussi les éléments partagés par les pages de dossier et de série : tuiles, chemins, choix d'un dossier.
import { h, setChildren, add, icon, hlbar, toast, promptDialog, choiceDialog } from '../ui.js';
import { store, folderKey, joinPath, parentPath, displayPath } from '../store.js';
import { plural, fmtRelative, pct, normalize } from '../util.js';
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
  add(ctx.main, head, searchWrap, list);

  const render = () => {
    const entries = Object.entries(store.state.sets);
    const all = store.folderList();
    const roots = store.subfolders('');
    searchWrap.classList.toggle('hidden', entries.length < 5 && all.length < 5);
    head.classList.toggle('hidden', entries.length === 0 && all.length === 0);
    if (!entries.length && !all.length) {
      const s = store.state;
      // Nouvel appareil connecté : le cache est vide tant que le serveur n'a pas répondu.
      if (s.mode === 'cloud' && s.fromCache && s.online) { setChildren(list, h('div', { class: 'loading' }, h('div', { class: 'spinner' }), h('p', null, 'Récupération de vos séries…'))); return; }
      setChildren(list, emptyState(ctx)); return;
    }

    // Recherche : résultats à plat, tous dossiers et sous-dossiers confondus
    const q = normalize(query);
    if (q) {
      const foundFolders = all.filter((f) => normalize(f.label).includes(q));
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

    const loose = entries.filter(([, s]) => !folderKey(s.folder));
    setChildren(list,
      roots.length ? h('section', { class: 'shelf' }, h('h2', null, 'Dossiers'),
        h('div', { class: 'folders' }, roots.map((f) => folderTile(f)))) : null,
      loose.length ? h('section', { class: 'shelf' }, roots.length ? h('h2', null, 'Séries sans dossier') : null,
        h('div', { class: 'decks' }, sortSets(loose).map(([id, s]) => deckTile(id, s)))) : null);
  };
  ctx.watch(render);
}

/** Plus récemment révisées (ou modifiées) d'abord. */
export function sortSets(entries) {
  return entries.slice().sort(([ia, a], [ib, b]) => (store.lastStudied(ib) || b.updatedAt || 0) - (store.lastStudied(ia) || a.updatedAt || 0));
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
