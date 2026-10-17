// Mode Associer : relier termes et définitions le plus vite possible. +1 s par erreur. Record et historique par série.
import { h, setChildren, add, icon } from '../ui.js';
import { store } from '../store.js';
import { shuffle, sample, normalize, fmtSeconds, plural, fmtRelative } from '../util.js';

const MAX_PAIRS = 6;
const PENALTY = 1000;

export function matchView(ctx) {
  const id = ctx.params.id;
  const set = store.getSet(id);
  if (!set) { ctx.go('/', { replace: true }); return; }
  ctx.setHeader({ study: true, back: `/set/${id}`, title: 'Associer' });
  const all = store.cardsOf(set);
  let raf = null;

  if (all.length < 2) {
    add(ctx.main, h('div', { class: 'empty' }, h('h2', null, 'Il faut au moins 2 cartes'), h('p', null, 'Ajoutez des cartes à cette série pour jouer à Associer.'),
      h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: `#/set/${id}/edit` }, 'Ajouter des cartes'))));
    return;
  }
  const pairs = Math.min(MAX_PAIRS, all.length);

  function recentTimes() {
    return store.sessionsOf(id).filter((s) => s.mode === 'match' && s.ms).slice(0, 5);
  }

  function startScreen() {
    cancelAnimationFrame(raf);
    const best = store.progressOf(id).best?.match;
    const recent = recentTimes();
    const go = h('button', { class: 'btn btn-primary btn-lg', onclick: play }, 'Commencer');
    setChildren(ctx.main, h('div', { class: 'match-start' },
      h('div', { class: 'bristol' },
        h('h1', { style: { marginBottom: '10px' } }, 'Associer'),
        h('p', { class: 'muted' }, `Reliez les ${pairs} termes à leur définition le plus vite possible. Touchez un terme, puis sa définition. Chaque erreur ajoute 1 seconde.`)),
      best ? h('p', { style: { marginBottom: '18px' } }, 'Votre record : ', h('b', { class: 'tnum' }, fmtSeconds(best))) : null,
      go,
      recent.length ? h('div', { style: { maxWidth: '420px', margin: '28px auto 0', textAlign: 'left' } },
        h('h2', { style: { fontSize: '1rem', color: 'var(--ink-2)' } }, 'Derniers temps'),
        h('ul', { class: 'history' }, recent.map((s) => h('li', null, h('span', { class: 'what tnum' }, fmtSeconds(s.ms), s.errors ? h('span', { class: 'muted' }, ` (${plural(s.errors, 'erreur')})`) : null), h('span', { class: 'when' }, fmtRelative(s.at)))))) : null));
    requestAnimationFrame(() => { if (matchMedia('(hover: hover)').matches) go.focus({ preventScroll: true }); });
  }

  function play() {
    const cards = sample(all, pairs);
    const tiles = shuffle([
      ...cards.map((c) => ({ card: c, side: 'term', text: c.term })),
      ...cards.map((c) => ({ card: c, side: 'def', text: c.definition })),
    ]);
    let selected = null, errors = 0, left = pairs, locked = false;
    const t0 = performance.now();
    const clock = h('div', { class: 'clock', 'aria-live': 'off' }, '0,0 s');
    const errEl = h('span', { class: 'muted small' }, '');
    const grid = h('div', { class: 'tiles' });
    const elapsed = () => performance.now() - t0 + errors * PENALTY;
    const tick = () => { clock.textContent = fmtSeconds(elapsed()); raf = requestAnimationFrame(tick); };

    // Deux cartes peuvent avoir le même terme ou la même définition : on accepte alors l'une ou l'autre.
    const isPair = (a, b) => {
      if (a.side === b.side) return false;
      const term = a.side === 'term' ? a : b;
      const def = a.side === 'term' ? b : a;
      return term.card.id === def.card.id
        || normalize(term.card.definition) === normalize(def.text)
        || normalize(term.text) === normalize(def.card.term);
    };

    tiles.forEach((t) => {
      t.el = h('button', { class: 'tile' + (t.text.length > 48 ? ' long' : ''), lang: (t.side === 'term' ? set.termLang : set.defLang) || null, onclick: () => tap(t) }, t.text);
      add(grid, t.el);
    });

    function tap(t) {
      if (locked || t.done) return;
      if (!selected) { selected = t; t.el.classList.add('sel'); return; }
      if (selected === t) { t.el.classList.remove('sel'); selected = null; return; }
      if (selected.side === t.side) { selected.el.classList.remove('sel'); selected = t; t.el.classList.add('sel'); return; }
      const a = selected; selected = null;
      if (isPair(a, t)) {
        a.done = t.done = true;
        a.el.classList.remove('sel');
        [a.el, t.el].forEach((el) => el.classList.add('good'));
        setTimeout(() => { [a.el, t.el].forEach((el) => el.classList.add('gone')); }, 160);
        left--;
        if (left === 0) setTimeout(finish, 260);
      } else {
        errors++;
        errEl.textContent = `+${errors} s de pénalité`;
        a.el.classList.remove('sel');
        [a.el, t.el].forEach((el) => { el.classList.remove('bad'); void el.offsetWidth; el.classList.add('bad'); });
        const r = t.el.getBoundingClientRect(), g = grid.getBoundingClientRect();
        const pen = h('span', { class: 'penalty', style: { left: r.left - g.left + r.width / 2 - 14 + 'px', top: r.top - g.top + 6 + 'px' } }, '+1 s');
        add(grid, pen);
        setTimeout(() => pen.remove(), 950);
        locked = true;
        setTimeout(() => { [a.el, t.el].forEach((el) => el.classList.remove('bad')); locked = false; }, 380);
      }
    }

    function finish() {
      cancelAnimationFrame(raf);
      const ms = Math.round(elapsed());
      const prevBest = store.progressOf(id).best?.match;
      const isRecord = store.setBestMatch(id, ms);
      store.addSession(id, { mode: 'match', ms, errors, pairs, dur: Math.round(performance.now() - t0) });
      const again = h('button', { class: 'btn btn-primary btn-lg', onclick: play }, icon('restart', 20), 'Rejouer');
      setChildren(ctx.main, h('div', { class: 'match-start' },
        h('p', { class: 'muted' }, 'Terminé en'),
        h('div', { class: 'result-time' }, fmtSeconds(ms)),
        errors ? h('p', { class: 'muted' }, `dont ${errors} s de pénalité (${plural(errors, 'erreur')})`) : h('p', { class: 'muted' }, 'Sans aucune erreur.'),
        isRecord ? h('div', { class: 'record' }, prevBest ? 'Nouveau record !' : 'Premier record !') : h('p', { style: { marginTop: '8px' } }, 'Record : ', h('b', { class: 'tnum' }, fmtSeconds(prevBest))),
        h('div', { class: 'stack', style: { maxWidth: '320px', margin: '26px auto 0' } }, again,
          h('a', { class: 'btn btn-ghost', href: `#/set/${id}` }, 'Retour à la série'))));
      requestAnimationFrame(() => { if (matchMedia('(hover: hover)').matches) again.focus({ preventScroll: true }); });
    }

    setChildren(ctx.main, h('div', { class: 'match-top' }, clock, errEl), grid);
    tick();
  }

  ctx.onCleanup(() => cancelAnimationFrame(raf));
  startScreen();
}
