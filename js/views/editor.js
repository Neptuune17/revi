// Création et modification d'une série, avec import de texte (export Quizlet, tableur...).
import { h, setChildren, add, icon, toast, confirmDialog, autoGrow } from '../ui.js';
import { store } from '../store.js';
import { LANGS, detectSeparators, parseImport, plural } from '../util.js';

const TERM_SEPS = [['auto', 'Détection automatique'], ['\t', 'Tabulation'], [',', 'Virgule'], [';', 'Point-virgule'], [' - ', 'Tiret « - »'], [':', 'Deux-points'], ['custom', 'Autre…']];
const CARD_SEPS = [['auto', 'Détection automatique'], ['\n', 'Nouvelle ligne'], [';', 'Point-virgule'], ['custom', 'Autre…']];

export function editorView(ctx) {
  const id = ctx.params.id;
  const set = id ? store.getSet(id) : null;
  if (id && !set) { add(ctx.main, h('div', { class: 'empty' }, h('h2', null, 'Série introuvable'), h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, 'Revenir à l’accueil')))); return; }
  const fromFolder = !set && ctx.query.folder ? store.canonicalFolder(ctx.query.folder) : '';
  const backPath = set ? `/set/${id}` : fromFolder ? '/folder/' + encodeURIComponent(fromFolder) : '/';
  ctx.setHeader({ title: set ? 'Modifier la série' : 'Nouvelle série', back: backPath });

  let rows = set ? store.cardsOf(set).map((c) => ({ id: c.id, term: c.term, definition: c.definition }))
    : ctx.params.import ? [] : [{ term: '', definition: '' }, { term: '', definition: '' }, { term: '', definition: '' }];
  let dirty = false;
  const markDirty = () => { dirty = true; };

  // ---- Informations ----
  const title = h('input', { class: 'input', value: set?.title || '', placeholder: 'Ex. : Connecteurs logiques', maxlength: 120, oninput: markDirty });
  const folder = h('input', { class: 'input', value: set?.folder || fromFolder, placeholder: 'Aucun (ex. : Anglais)', list: 'folders-list', maxlength: 60, oninput: markDirty });
  const folders = h('datalist', { id: 'folders-list' }, store.folders().map((f) => h('option', { value: f })));
  const langSelect = (val) => h('select', { class: 'select', onchange: markDirty }, LANGS.map(([v, l]) => h('option', { value: v, selected: v === (val || '') }, l)));
  const termLang = langSelect(set?.termLang);
  const defLang = langSelect(set?.defLang);

  const meta = h('div', { class: 'editor-meta' },
    h('label', { class: 'field' }, h('span', null, 'Titre'), title),
    h('label', { class: 'field' }, h('span', null, 'Dossier'), folder, folders),
    h('div', { class: 'full' },
      h('div', { class: 'langs' },
        h('label', { class: 'field' }, h('span', null, 'Langue des termes'), termLang),
        h('label', { class: 'field' }, h('span', null, 'Langue des définitions'), defLang)),
      h('p', { class: 'small muted', style: { marginTop: '6px' } }, 'La langue sert à la lecture à voix haute des cartes.')));

  // ---- Import ----
  const importText = h('textarea', { class: 'input', rows: 6, placeholder: 'Collez votre liste ici : un terme et sa définition par ligne, séparés par une tabulation.', oninput: () => updatePreview() });
  const termSep = h('select', { class: 'select', onchange: () => { termCustom.classList.toggle('hidden', termSep.value !== 'custom'); updatePreview(); } }, TERM_SEPS.map(([v, l]) => h('option', { value: v }, l)));
  const cardSep = h('select', { class: 'select', onchange: () => { cardCustom.classList.toggle('hidden', cardSep.value !== 'custom'); updatePreview(); } }, CARD_SEPS.map(([v, l]) => h('option', { value: v }, l)));
  const termCustom = h('input', { class: 'input hidden', placeholder: 'Séparateur', oninput: () => updatePreview() });
  const cardCustom = h('input', { class: 'input hidden', placeholder: 'Séparateur', oninput: () => updatePreview() });
  const preview = h('div', { class: 'preview hidden', 'aria-live': 'polite' });
  const importBtn = h('button', { class: 'btn btn-primary', type: 'button', disabled: true, onclick: () => doImport() }, 'Ajouter les cartes');
  let parsed = [];
  const seps = () => {
    const auto = detectSeparators(importText.value);
    const t = termSep.value === 'auto' ? auto.term : termSep.value === 'custom' ? termCustom.value || '\t' : termSep.value;
    const c = cardSep.value === 'auto' ? auto.card : cardSep.value === 'custom' ? cardCustom.value || '\n' : cardSep.value;
    return { term: t, card: c };
  };
  function updatePreview() {
    parsed = importText.value.trim() ? parseImport(importText.value, seps()) : [];
    preview.classList.toggle('hidden', !parsed.length);
    importBtn.disabled = !parsed.length;
    importBtn.textContent = parsed.length ? `Ajouter ${plural(parsed.length, 'carte')}` : 'Ajouter les cartes';
    if (!parsed.length) return;
    const missing = parsed.filter((p) => !p.definition).length;
    setChildren(preview, 
      h('div', null, h('b', null, plural(parsed.length, 'carte détectée', 'cartes détectées')),
        missing ? h('span', { style: { color: 'var(--red)' } }, ` (${missing} sans définition : vérifiez le séparateur)`) : null),
      h('table', null, h('tbody', null, parsed.slice(0, 4).map((p) => h('tr', null, h('td', null, p.term), h('td', null, p.definition || '—'))))),
      parsed.length > 4 ? h('div', { class: 'small muted', style: { marginTop: '4px' } }, `et ${parsed.length - 4} autres`) : null);
  }
  function doImport() {
    if (!parsed.length) return;
    rows = rows.filter((r) => r.term.trim() || r.definition.trim()).concat(parsed.map((p) => ({ term: p.term, definition: p.definition })));
    const n = parsed.length;
    importText.value = ''; updatePreview(); details.open = false; dirty = true;
    renderRows();
    toast(`${plural(n, 'carte ajoutée', 'cartes ajoutées')}.`);
    if (!title.value.trim()) title.focus();
  }
  const details = h('details', { class: 'import', open: !!ctx.params.import },
    h('summary', null, icon('text', 20), 'Importer une liste (Quizlet, tableur, Word…)'),
    h('div', { class: 'body' },
      h('p', { class: 'small muted' }, 'Sur Quizlet, utilisez l’option Exporter de votre série, copiez le texte puis collez-le ici. Un tableau copié depuis Excel ou Google Sheets fonctionne aussi.'),
      importText,
      h('div', { class: 'langs' },
        h('label', { class: 'field' }, h('span', null, 'Entre le terme et la définition'), termSep, termCustom),
        h('label', { class: 'field' }, h('span', null, 'Entre deux cartes'), cardSep, cardCustom)),
      preview,
      h('div', null, importBtn)));
  if (ctx.params.import) details.setAttribute('open', '');

  // ---- Cartes ----
  const rowsHost = h('div', { class: 'card-rows' });
  const countLabel = h('span', { class: 'muted small' });
  function renderRows(focusIndex, focusField = 'term') {
    countLabel.textContent = plural(rows.filter((r) => r.term.trim() || r.definition.trim()).length, 'carte');
    setChildren(rowsHost, ...rows.map((r, i) => {
      const term = autoGrow(h('textarea', { class: 'input', rows: 1, placeholder: 'Terme', 'aria-label': `Terme ${i + 1}`, value: r.term,
        oninput: (e) => { r.term = e.target.value; markDirty(); countLabel.textContent = plural(rows.filter((x) => x.term.trim() || x.definition.trim()).length, 'carte'); e.target.classList.remove('invalid'); },
        onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); def.focus(); } } }));
      const def = autoGrow(h('textarea', { class: 'input', rows: 1, placeholder: 'Définition', 'aria-label': `Définition ${i + 1}`, value: r.definition,
        oninput: (e) => { r.definition = e.target.value; markDirty(); countLabel.textContent = plural(rows.filter((x) => x.term.trim() || x.definition.trim()).length, 'carte'); e.target.classList.remove('invalid'); },
        onkeydown: (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (i === rows.length - 1) { rows.push({ term: '', definition: '' }); renderRows(i + 1); }
            else rowsHost.querySelectorAll('.card-row')[i + 1]?.querySelector('textarea')?.focus();
          }
        } }));
      if (r.invalid) { if (!r.term.trim()) term.classList.add('invalid'); if (!r.definition.trim()) def.classList.add('invalid'); }
      const el = h('div', { class: 'card-row' },
        h('div', { class: 'num' }, i + 1),
        h('div', { class: 'pair' }, h('div', null, term), h('div', null, def)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Supprimer la carte ${i + 1}`, onclick: () => { rows.splice(i, 1); markDirty(); renderRows(); } }, icon('trash', 20)));
      if (i === focusIndex) requestAnimationFrame(() => (focusField === 'term' ? term : def).focus());
      return el;
    }));
  }
  renderRows();

  const addBtn = h('button', { class: 'btn btn-block', type: 'button', style: { marginTop: '12px', borderStyle: 'dashed' }, onclick: () => { rows.push({ term: '', definition: '' }); renderRows(rows.length - 1); } }, icon('plus', 20), 'Ajouter une carte');
  const swapBtn = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => {
    rows.forEach((r) => { [r.term, r.definition] = [r.definition, r.term]; });
    [termLang.value, defLang.value] = [defLang.value, termLang.value];
    markDirty(); renderRows(); toast('Termes et définitions échangés.');
  } }, icon('flip', 20), 'Échanger termes et définitions');

  // ---- Enregistrement ----
  function save() {
    const t = title.value.trim();
    if (!t) { title.classList.add('invalid'); title.focus(); toast('Donnez un titre à la série.'); return; }
    title.classList.remove('invalid');
    rows.forEach((r) => { r.term = r.term.trim(); r.definition = r.definition.trim(); r.invalid = false; });
    const filled = rows.filter((r) => r.term || r.definition);
    const incomplete = filled.filter((r) => !r.term || !r.definition);
    if (incomplete.length) {
      incomplete.forEach((r) => { r.invalid = true; });
      renderRows();
      toast(`${plural(incomplete.length, 'carte n’a', 'cartes n’ont')} pas de terme ou de définition.`);
      rowsHost.querySelector('.invalid')?.focus();
      return;
    }
    if (!filled.length) { toast('Ajoutez au moins une carte.'); return; }
    const data = { title: t, folder: folder.value.trim(), termLang: termLang.value, defLang: defLang.value };
    let target = id;
    if (set) store.updateSet(id, { ...data, cards: filled });
    else target = store.createSet({ ...data, cards: filled });
    dirty = false;
    toast('Série enregistrée.');
    ctx.go('/set/' + target, { replace: true });
  }
  async function cancel() {
    if (dirty && !(await confirmDialog({ title: 'Abandonner les modifications ?', body: 'Les changements non enregistrés seront perdus.', confirm: 'Abandonner', danger: true }))) return;
    dirty = false;
    ctx.go(backPath);
  }
  const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); } };
  document.addEventListener('keydown', onKey);
  const onUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onUnload);
  ctx.onCleanup(() => { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); });

  add(ctx.main, 
    h('div', { class: 'page-head' }, h('h1', null, set ? 'Modifier la série' : 'Nouvelle série')),
    meta, details,
    h('div', { class: 'section-head', style: { marginTop: '26px', marginBottom: '0' } }, h('h2', null, 'Cartes'), countLabel),
    rowsHost, addBtn,
    h('div', { class: 'row', style: { marginTop: '10px' } }, swapBtn),
    h('div', { class: 'savebar' },
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: cancel }, 'Annuler'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn btn-primary btn-lg', type: 'button', onclick: save }, 'Enregistrer')));
  if (ctx.params.import) requestAnimationFrame(() => importText.focus());
  else if (!set) requestAnimationFrame(() => title.focus());
}
