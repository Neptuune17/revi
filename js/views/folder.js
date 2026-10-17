// Page d'un dossier : ses séries, nouvelle série dans le dossier, ajout de séries existantes, renommer, supprimer.
import { h, setChildren, icon, toast, menuButton, confirmDialog, promptDialog, checklistDialog } from '../ui.js';
import { store } from '../store.js';
import { plural } from '../util.js';
import { deckTile, sortSets, folderPath } from './home.js';

export function folderView(ctx) {
  let name = ctx.params.id;
  try { name = decodeURIComponent(name); } catch { /* nom déjà décodé */ }
  ctx.setHeader({ back: '/', title: '' });

  const render = () => {
    const f = store.getFolder(name);
    if (!f) {
      setChildren(ctx.main, h('div', { class: 'empty' }, h('h2', null, 'Dossier introuvable'),
        h('p', null, 'Il a peut-être été renommé ou supprimé sur un autre appareil.'),
        h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, 'Revenir à l’accueil'))));
      return;
    }
    const sets = sortSets(f.setIds.map((id) => [id, store.getSet(id)]).filter(([, s]) => s));
    const others = Object.entries(store.state.sets).filter(([id]) => !f.setIds.includes(id));
    const newSetHref = '#/new?folder=' + encodeURIComponent(f.name);

    const addExisting = async () => {
      const picked = await checklistDialog({
        title: `Ajouter des séries à « ${f.name} »`,
        body: 'Les séries cochées seront rangées dans ce dossier.',
        items: sortSets(others).map(([id, s]) => ({ value: id, label: s.title || 'Sans titre', hint: s.folder ? `Actuellement dans ${s.folder}` : 'Sans dossier' })),
        confirm: 'Ajouter',
      });
      if (!picked || !picked.length) return;
      store.moveSetsToFolder(picked, f.name);
      toast(`${plural(picked.length, 'série ajoutée', 'séries ajoutées')} au dossier.`);
    };
    const rename = async () => {
      const next = await promptDialog({
        title: 'Renommer le dossier', label: 'Nom du dossier', value: f.name, confirm: 'Renommer',
        validate: (v) => { if (!v) return 'Donnez un nom au dossier.'; const o = store.getFolder(v); return o && o.key !== f.key ? 'Un dossier porte déjà ce nom.' : null; },
      });
      if (!next || next === f.name) return;
      const finalName = store.renameFolder(f.name, next);
      name = finalName;
      toast('Dossier renommé.');
      ctx.go(folderPath(finalName), { replace: true });
    };
    const remove = async () => {
      const n = sets.length;
      const ok = await confirmDialog({
        title: `Supprimer le dossier « ${f.name} » ?`,
        body: n ? `Les ${plural(n, 'série')} qu’il contient ne seront pas supprimées : elles reviendront sur l’accueil, sans dossier.` : 'Ce dossier est vide.',
        confirm: 'Supprimer le dossier', danger: true,
      });
      if (!ok) return;
      store.deleteFolder(f.name);
      toast('Dossier supprimé.');
      ctx.go('/', { replace: true });
    };

    setChildren(ctx.main,
      h('div', { class: 'page-head', style: { alignItems: 'flex-start' } },
        h('div', { class: 'stack', style: { gap: '6px', minWidth: '0', flex: '1' } },
          h('div', { class: 'row', style: { gap: '8px', color: 'var(--pen)' } }, icon('folder', 22), h('span', { class: 'small', style: { fontWeight: 650 } }, 'Dossier')),
          h('h1', { class: 'set-title' }, f.name),
          h('span', { class: 'muted' }, plural(sets.length, 'série'))),
        h('div', { class: 'actions' },
          others.length ? h('button', { class: 'btn', onclick: addExisting }, icon('move', 20), 'Ajouter des séries') : null,
          h('a', { class: 'btn btn-primary', href: newSetHref }, icon('plus', 20), 'Nouvelle série'),
          menuButton([
            { label: 'Renommer le dossier', icon: 'edit', onclick: rename },
            { label: 'Supprimer le dossier', icon: 'trash', danger: true, onclick: remove },
          ]))),
      sets.length
        ? h('div', { class: 'decks', style: { marginTop: '8px' } }, sets.map(([id, s]) => deckTile(id, s)))
        : h('div', { class: 'empty' },
          h('div', { class: 'bristol', 'aria-hidden': 'true' }, h('span', null, 'Dossier vide')),
          h('h2', null, 'Rien dans ce dossier pour l’instant'),
          h('p', null, others.length ? 'Créez une série directement ici, ou rangez-y des séries que vous avez déjà.' : 'Créez une première série directement dans ce dossier.'),
          h('div', { class: 'actions' },
            h('a', { class: 'btn btn-primary btn-lg', href: newSetHref }, icon('plus', 20), 'Créer une série ici'),
            others.length ? h('button', { class: 'btn btn-lg', onclick: addExisting }, icon('move', 20), 'Ajouter des séries existantes') : null)));
  };
  ctx.watch(render);
}
