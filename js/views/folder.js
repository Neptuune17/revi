// Page d'un dossier : fil d'Ariane, sous-dossiers, séries, nouvelle série ou nouveau sous-dossier,
// ranger des séries et dossiers existants, renommer, déplacer, supprimer.
import { h, setChildren, icon, toast, menuButton, confirmDialog, promptDialog, checklistDialog } from '../ui.js';
import { store, joinPath, parentPath, displayPath } from '../store.js';
import { plural } from '../util.js';
import { deckTile, folderTile, sortSets, sortFolders, sortControl, folderPath, newFolder, pickFolder } from './home.js';

export function folderView(ctx) {
  let name = ctx.params.id;
  try { name = decodeURIComponent(name); } catch { /* nom déjà décodé */ }
  const sorter = h('div', { class: 'sort-row' }, sortControl(() => render()));

  const render = () => {
    const f = store.getFolder(name);
    if (!f) {
      ctx.setHeader({ back: parentPath(name) && store.getFolder(parentPath(name)) ? folderPath(store.getFolder(parentPath(name)).name) : '/', title: '' });
      setChildren(ctx.main, h('div', { class: 'empty' }, h('h2', null, 'Dossier introuvable'),
        h('p', null, 'Il a peut-être été renommé, déplacé ou supprimé sur un autre appareil.'),
        h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, 'Revenir à l’accueil'))));
      return;
    }
    name = f.name;
    const ancestors = [];
    for (let p = f.parent ? store.getFolder(f.parent) : null; p; p = p.parent ? store.getFolder(p.parent) : null) ancestors.unshift(p);
    const parent = ancestors[ancestors.length - 1] || null;
    ctx.setHeader({ back: parent ? folderPath(parent.name) : '/', title: '' });

    const subs = sortFolders(f.children);
    const sets = sortSets(f.setIds.map((id) => [id, store.getSet(id)]).filter(([, s]) => s));
    const newSetHref = '#/new?folder=' + encodeURIComponent(f.name);
    // Ce qu'on peut ranger ici : les séries d'ailleurs, et les dossiers qui ne sont ni celui-ci, ni un de ses parents, ni déjà dedans.
    const otherSets = Object.entries(store.state.sets).filter(([id]) => !f.setIds.includes(id));
    const otherFolders = store.folderList().filter((o) => o.key !== f.key && o.parent !== f.key && !f.key.startsWith(o.key + '/'));
    const canAdd = otherSets.length + otherFolders.length > 0;

    const addExisting = async () => {
      const picked = await checklistDialog({
        title: `Ranger dans « ${f.label} »`,
        body: 'Les dossiers et les séries cochés seront déplacés dans ce dossier. Un dossier garde ses sous-dossiers et ses séries.',
        items: [
          ...otherFolders.map((o) => ({ value: 'f:' + o.name, label: o.label, icon: o.children.length ? 'folders' : 'folder', group: 'Dossiers',
            hint: o.parent ? `Dans ${displayPath(parentPath(o.name))}` : 'Sur l’accueil' })),
          ...sortSets(otherSets).map(([id, s]) => ({ value: 's:' + id, label: s.title || 'Sans titre', group: 'Séries',
            hint: s.folder ? `Dans ${displayPath(store.canonicalFolder(s.folder))}` : 'Sans dossier' })),
        ],
        confirm: 'Ranger',
      });
      if (!picked || !picked.length) return;
      const folderPaths = picked.filter((v) => v.startsWith('f:')).map((v) => v.slice(2));
      const setIds = picked.filter((v) => v.startsWith('s:')).map((v) => v.slice(2));
      const { moved, errors } = folderPaths.length ? store.moveFoldersInto(folderPaths, f.name) : { moved: 0, errors: [] };
      if (setIds.length) store.moveSetsToFolder(setIds, f.name);
      const done = [moved ? plural(moved, 'dossier') : null, setIds.length ? plural(setIds.length, 'série') : null].filter(Boolean).join(' et ');
      if (done) toast(`${done} rangé${moved + setIds.length > 1 ? 's' : ''} dans « ${f.label} ».`);
      if (errors.length) toast(errors.join(' '), { kind: 'error', timeout: 6000 });
    };
    const rename = async () => {
      const next = await promptDialog({
        title: 'Renommer le dossier', label: 'Nom du dossier', value: f.label, confirm: 'Renommer',
        validate: (v) => {
          if (!v) return 'Donnez un nom au dossier.';
          if (v.includes('/')) return 'Le nom ne peut pas contenir « / ». Pour ranger ce dossier ailleurs, utilisez « Déplacer le dossier ».';
          const o = store.getFolder(joinPath(parentPath(f.name), v));
          return o && o.key !== f.key ? 'Un dossier porte déjà ce nom à cet endroit.' : null;
        },
      });
      if (!next || next === f.label) return;
      name = store.renameFolder(f.name, next);
      toast('Dossier renommé.');
      ctx.go(folderPath(name), { replace: true });
    };
    const move = async () => {
      const dest = await pickFolder({
        title: `Déplacer « ${f.label} »`,
        body: 'Choisissez où ranger ce dossier. Ses sous-dossiers et ses séries le suivent.',
        current: parentPath(f.name), rootHint: 'Le dossier apparaîtra directement sur l’accueil',
        exclude: (o) => o.key === f.key || o.key.startsWith(f.key + '/'),
        blocked: (o) => (store.getFolder(joinPath(o.name, f.label)) ? `Contient déjà un dossier « ${f.label} »` : null),
      });
      if (dest === null) return;
      try {
        name = store.moveFolder(f.name, joinPath(dest, f.label));
        toast(dest ? `Dossier rangé dans « ${displayPath(dest)} ».` : 'Dossier déplacé sur l’accueil.');
        ctx.go(folderPath(name), { replace: true });
      } catch (e) { toast(e.message, { kind: 'error' }); }
    };
    const remove = async () => {
      const what = [subs.length ? plural(subs.length, 'sous-dossier') : null, sets.length ? plural(sets.length, 'série') : null].filter(Boolean).join(' et ');
      const ok = await confirmDialog({
        title: `Supprimer le dossier « ${f.label} » ?`,
        body: what ? `Son contenu (${what}) ne sera pas supprimé : il remontera ${parent ? `dans « ${parent.label} »` : 'sur l’accueil'}.` : 'Ce dossier est vide.',
        confirm: 'Supprimer le dossier', danger: true,
      });
      if (!ok) return;
      store.deleteFolder(f.name);
      toast('Dossier supprimé.');
      ctx.go(parent ? folderPath(parent.name) : '/', { replace: true });
    };

    const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Emplacement du dossier' },
      icon(subs.length ? 'folders' : 'folder', 20),
      ancestors.length
        ? ancestors.map((a, i) => [i ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '›') : null, h('a', { href: '#' + folderPath(a.name) }, a.label)])
        : h('span', null, 'Dossier'));
    const summary = [subs.length ? plural(subs.length, 'sous-dossier') : null, sets.length ? plural(sets.length, 'série') : null].filter(Boolean).join(', ') || 'Dossier vide';
    const decks = h('div', { class: 'decks', style: subs.length ? null : { marginTop: subs.length + sets.length >= 2 ? '26px' : '8px' } }, sets.map(([id, s]) => deckTile(id, s)));

    setChildren(ctx.main,
      h('div', { class: 'page-head folder-head' },
        h('div', { class: 'stack', style: { gap: '6px', minWidth: '0', flex: '1' } },
          crumbs,
          h('h1', { class: 'set-title' }, f.label),
          h('span', { class: 'muted' }, summary)),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => newFolder(ctx, f.name), 'aria-label': 'Nouveau sous-dossier' }, icon('folderPlus', 20), 'Sous-dossier'),
          h('a', { class: 'btn btn-primary', href: newSetHref }, icon('plus', 20), 'Nouvelle série')),
        menuButton([
          canAdd ? { label: 'Ranger ici des séries ou dossiers', icon: 'move', onclick: addExisting } : null,
          { label: 'Renommer le dossier', icon: 'edit', onclick: rename },
          { label: 'Déplacer le dossier', icon: 'folders', onclick: move },
          { label: 'Supprimer le dossier', icon: 'trash', danger: true, onclick: remove },
        ])),
      subs.length + sets.length >= 2 ? sorter : null,
      subs.length ? h('section', { class: 'shelf' }, h('h2', null, 'Sous-dossiers'), h('div', { class: 'folders' }, subs.map((s) => folderTile(s)))) : null,
      sets.length ? (subs.length ? h('section', { class: 'shelf' }, h('h2', null, 'Séries'), decks) : decks) : null,
      !subs.length && !sets.length ? h('div', { class: 'empty' },
        h('div', { class: 'bristol', 'aria-hidden': 'true' }, h('span', null, 'Dossier vide')),
        h('h2', null, 'Rien dans ce dossier pour l’instant'),
        h('p', null, canAdd ? 'Créez une série ou un sous-dossier directement ici, ou rangez-y des séries et des dossiers que vous avez déjà.' : 'Créez une première série ou un sous-dossier directement ici.'),
        h('div', { class: 'actions' },
          h('a', { class: 'btn btn-primary btn-lg', href: newSetHref }, icon('plus', 20), 'Créer une série ici'),
          h('button', { class: 'btn btn-lg', onclick: () => newFolder(ctx, f.name) }, icon('folderPlus', 20), 'Créer un sous-dossier'),
          canAdd ? h('button', { class: 'btn btn-lg', onclick: addExisting }, icon('move', 20), 'Ranger ici des séries ou dossiers') : null)) : null);
  };
  ctx.watch(render);
}
