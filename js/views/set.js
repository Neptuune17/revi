// Page d'une série : modes d'étude, progression, statistiques, liste des cartes.
import { h, setChildren, add, icon, menuButton, confirmDialog, toast } from '../ui.js';
import { store } from '../store.js';
import { plural, pct, fmtSeconds, fmtDuration, fmtRelative, toExportText, copyText, downloadFile, speak, canSpeak } from '../util.js';

const MODES = [
  ['cards', 'cards', 'Cartes', 'Retourner et trier'],
  ['learn', 'learn', 'Apprendre', 'QCM puis réponse écrite'],
  ['test', 'test', 'Test', 'Examen noté'],
  ['match', 'match', 'Associer', 'Contre la montre'],
];
const STATUS_LABEL = ['Pas vue', 'En cours', 'Maîtrisée'];

export function setView(ctx) {
  const id = ctx.params.id;
  ctx.setHeader({ back: '/', title: '' });
  let starredOnly = false;

  const render = () => {
    const set = store.getSet(id);
    if (!set) {
      setChildren(ctx.main, h('div', { class: 'empty' }, h('h2', null, 'Série introuvable'),
        h('p', null, 'Elle a peut-être été supprimée sur un autre appareil.'),
        h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: '#/' }, 'Revenir à l’accueil'))));
      return;
    }
    const cards = store.cardsOf(set);
    const statuses = cards.map((c) => store.statusOf(id, c.id));
    const count = [0, 1, 2].map((s) => statuses.filter((x) => x === s).length);
    const sessions = store.sessionsOf(id);
    const prog = store.progressOf(id);

    // En-tête
    const head = h('div', { class: 'page-head', style: { alignItems: 'flex-start' } },
      h('div', { class: 'stack', style: { gap: '8px', minWidth: '0', flex: '1' } },
        h('h1', { class: 'set-title' }, set.title || 'Sans titre'),
        h('div', { class: 'row' }, set.folder ? h('span', { class: 'chip' }, set.folder) : null, h('span', { class: 'muted' }, plural(cards.length, 'carte')))),
      h('div', { class: 'actions' },
        h('a', { class: 'btn', href: `#/set/${id}/edit` }, icon('edit', 20), 'Modifier'),
        menuButton([
          { label: 'Copier la liste (format Quizlet)', icon: 'copy', onclick: async () => { toast((await copyText(toExportText(cards))) ? 'Liste copiée.' : 'Copie impossible sur ce navigateur.'); } },
          { label: 'Télécharger la liste (.txt)', icon: 'download', onclick: () => downloadFile(`${(set.title || 'serie').replace(/[^\p{L}\p{N} _-]/gu, '')}.txt`, toExportText(cards), 'text/plain;charset=utf-8') },
          { label: 'Recommencer l’apprentissage', icon: 'restart', onclick: async () => {
            if (await confirmDialog({ title: 'Recommencer l’apprentissage ?', body: 'Toutes les cartes repasseront en « pas vues » dans le mode Apprendre. L’historique et les records sont conservés.', confirm: 'Recommencer' })) { store.resetLearn(id); toast('Progression remise à zéro.'); }
          } },
          { label: 'Supprimer la série', icon: 'trash', danger: true, onclick: async () => {
            if (await confirmDialog({ title: 'Supprimer « ' + (set.title || 'Sans titre') + ' » ?', body: 'La série, sa progression et son historique seront supprimés sur tous vos appareils.', confirm: 'Supprimer', danger: true })) { store.deleteSet(id); toast('Série supprimée.'); ctx.go('/', { replace: true }); }
          } },
        ])));

    // Modes
    const modes = h('nav', { class: 'modes', 'aria-label': 'Modes de révision' }, MODES.map(([path, ic, label, hint]) =>
      h('a', { class: 'mode', href: `#/set/${id}/${path}` }, icon(ic, 26), h('b', null, label), h('span', null, hint))));

    // Progression
    const n = cards.length || 1;
    const progress = h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, 'Progression'), h('span', { class: 'muted small' }, `${pct(count[2], cards.length)} % maîtrisé`)),
      h('div', { class: 'panel' },
        h('div', { class: 'mastery', role: 'img', 'aria-label': `${count[2]} maîtrisées, ${count[1]} en cours, ${count[0]} pas vues` },
          count[2] ? h('i', { class: 'm2', style: { width: (count[2] / n) * 100 + '%' } }) : null,
          count[1] ? h('i', { class: 'm1', style: { width: (count[1] / n) * 100 + '%' } }) : null),
        h('div', { class: 'legend' },
          h('span', null, h('i', { style: { background: 'var(--hl-strong)' } }), 'Maîtrisées ', h('b', null, count[2])),
          h('span', null, h('i', { style: { background: 'var(--hl-soft)' } }), 'En cours ', h('b', null, count[1])),
          h('span', null, h('i', { style: { background: 'var(--track)', border: '1px solid var(--line)' } }), 'Pas vues ', h('b', null, count[0]))),
        !sessions.length ? h('p', { class: 'small muted', style: { marginTop: '10px' } }, 'Lancez le mode Apprendre pour faire progresser vos cartes.') : null));

    // Statistiques
    const tests = sessions.filter((s) => s.mode === 'test');
    const matches = sessions.filter((s) => s.mode === 'match' && s.ms);
    const totalTime = sessions.reduce((a, s) => a + (s.dur || 0), 0);
    const stats = h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, 'Résultats')),
      h('div', { class: 'panel' },
        h('div', { class: 'figures' },
          figure(prog.best?.match ? fmtSeconds(prog.best.match) : '—', 'Meilleur temps en Associer'),
          figure(tests[0] ? `${tests[0].score} %` : '—', 'Dernier test'),
          figure(totalTime ? fmtDuration(totalTime) : '—', 'Temps de révision')),
        tests.length >= 2 ? barChart('Scores des derniers tests', tests.slice(0, 10).reverse(), (s) => s.score, 100, (s) => `${s.score} % (${s.ok}/${s.total}), ${fmtRelative(s.at)}`, (v) => v + ' %') : null,
        matches.length >= 2 ? barChart('Temps en Associer', matches.slice(0, 10).reverse(), (s) => s.ms / 1000, null, (s) => `${fmtSeconds(s.ms)}${s.errors ? `, ${plural(s.errors, 'erreur')}` : ''}, ${fmtRelative(s.at)}`, (v) => Math.round(v) + ' s') : null,
        hardCards(id, cards),
        sessions.length ? h('div', { style: { marginTop: '16px' } }, h('h3', { style: { fontSize: '.92rem', color: 'var(--ink-2)', marginBottom: '4px' } }, 'Dernières sessions'),
          h('ul', { class: 'history' }, sessions.slice(0, 6).map((s) => h('li', null, h('span', { class: 'what' }, sessionLabel(s)), h('span', { class: 'when' }, fmtRelative(s.at))))))
          : h('p', { class: 'small muted', style: { marginTop: '12px' } }, 'Vos sessions et vos records apparaîtront ici.')));

    // Liste des cartes
    const starredCount = cards.filter((c) => c.starred).length;
    const shown = starredOnly ? cards.filter((c) => c.starred) : cards;
    const list = h('section', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', null, `Cartes (${cards.length})`),
        starredCount ? h('button', { class: 'btn btn-ghost', 'aria-pressed': String(starredOnly), onclick: () => { starredOnly = !starredOnly; render(); } },
          icon(starredOnly ? 'starFill' : 'star', 18), starredOnly ? 'Toutes les cartes' : `Étoilées (${starredCount})`) : null),
      shown.length ? h('div', { class: 'sheet' }, shown.map((c) => {
        const st = store.statusOf(id, c.id);
        return h('div', { class: 'sheet-row' },
          h('div', { class: 'term' }, c.term),
          h('div', { class: 'def' }, c.definition),
          h('div', { class: 'tools' },
            h('span', { class: `status-dot m${st}`, title: STATUS_LABEL[st], role: 'img', 'aria-label': STATUS_LABEL[st] }),
            canSpeak() && (set.termLang || set.defLang) ? h('button', { class: 'icon-btn', 'aria-label': 'Écouter', onclick: () => speak(set.termLang ? c.term : c.definition, set.termLang || set.defLang) }, icon('speaker', 19)) : null,
            h('button', { class: 'icon-btn' + (c.starred ? ' on' : ''), 'aria-label': c.starred ? 'Retirer l’étoile' : 'Ajouter une étoile', 'aria-pressed': String(c.starred), onclick: () => store.toggleStar(id, c.id) }, icon(c.starred ? 'starFill' : 'star', 20))));
      })) : h('p', { class: 'muted' }, cards.length ? 'Aucune carte étoilée.' : 'Cette série est vide. Ajoutez des cartes avec « Modifier ».'));

    setChildren(ctx.main, head, modes, progress, stats, list);
  };
  ctx.watch(render);
}

const figure = (v, k) => h('div', { class: 'figure' }, h('div', { class: 'v' }, v), h('div', { class: 'k' }, k));

export function sessionLabel(s) {
  const d = s.dur ? `, ${fmtDuration(s.dur)}` : '';
  switch (s.mode) {
    case 'cards': return s.sorted ? `Cartes : ${s.ok} sues, ${s.ko} à revoir${d}` : `Cartes : ${plural(s.total || 0, 'carte parcourue', 'cartes parcourues')}${d}`;
    case 'learn': return `Apprendre : ${s.ok} sur ${(s.ok || 0) + (s.ko || 0)} bonnes réponses${d}`;
    case 'test': return `Test : ${s.ok}/${s.total} (${s.score} %)${d}`;
    case 'match': return `Associer : ${fmtSeconds(s.ms)}${s.errors ? `, ${plural(s.errors, 'erreur')}` : ''}`;
    default: return 'Session';
  }
}

function hardCards(id, cards) {
  const list = cards.map((c) => ({ c, p: store.cardProgress(id, c.id) }))
    .filter((x) => (x.p.ko || 0) > 0)
    .sort((a, b) => ((b.p.ko || 0) - (b.p.ok || 0)) - ((a.p.ko || 0) - (a.p.ok || 0)) || (b.p.ko || 0) - (a.p.ko || 0))
    .slice(0, 5);
  if (!list.length) return null;
  return h('div', { style: { marginTop: '16px' } },
    h('h3', { style: { fontSize: '.92rem', color: 'var(--ink-2)', marginBottom: '4px' } }, 'Cartes à retravailler'),
    h('ul', { class: 'history' }, list.map(({ c, p }) => h('li', null,
      h('span', { class: 'what' }, h('b', null, c.term), h('span', { class: 'muted' }, ' : ' + c.definition)),
      h('span', { class: 'when', style: { color: 'var(--red)' } }, plural(p.ko, 'erreur'))))));
}

/** Petit diagramme en barres (une série) avec info-bulle au survol / focus. */
function barChart(title, items, value, fixedMax, tipText, fmtAxis) {
  const W = 600, H = 150, pl = 40, pr = 6, pt = 12, pb = 18;
  const vals = items.map(value);
  const max = fixedMax || Math.max(...vals) * 1.15 || 1;
  const step = (W - pl - pr) / items.length;
  const bw = Math.min(46, step * 0.62);
  const y = (v) => pt + (H - pt - pb) * (1 - v / max);
  const base = H - pb;
  const tip = h('div', { class: 'tip', 'aria-live': 'polite' }, 'Survolez une barre pour le détail.');
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': title });
  add(svg, 
    h('line', { class: 'grid', x1: pl, x2: W - pr, y1: y(max), y2: y(max) }),
    h('text', { x: pl - 6, y: y(max) + 4, 'text-anchor': 'end' }, fmtAxis(fixedMax ? max : Math.round(max))),
    h('text', { x: pl - 6, y: base + 4, 'text-anchor': 'end' }, fmtAxis(0)),
    h('line', { class: 'axis', x1: pl, x2: W - pr, y1: base, y2: base }));
  items.forEach((it, i) => {
    const v = vals[i];
    const x = pl + i * step + (step - bw) / 2;
    const top = Math.min(y(v), base - 2);
    const r = Math.min(4, (base - top) / 2, bw / 2);
    const d = `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${base}Z`;
    const label = tipText(it);
    const show = () => { tip.textContent = label; svg.querySelectorAll('.bar').forEach((b) => b.classList.remove('active')); bar.classList.add('active'); };
    // Zone de survol plus large que la barre
    const hit = h('rect', { x: pl + i * step, y: pt, width: step, height: base - pt, fill: 'transparent', onmouseenter: show, onclick: show });
    const bar = h('path', { class: 'bar', d, tabindex: 0, 'aria-label': label, onfocus: show, onmouseenter: show });
    add(svg, hit, bar);
  });
  return h('div', { class: 'chart' }, h('h3', null, title), svg, tip);
}
