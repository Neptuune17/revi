// Mode Apprendre : manches de N cartes. Niveau 0 (pas vue) -> QCM ; niveau 1 (en cours) -> réponse écrite ; niveau 2 = maîtrisée.
// Une erreur remet la carte au niveau 0 et elle revient une fois en fin de manche.
import { h, setChildren, add, icon, segmented, hlbar } from '../ui.js';
import { store } from '../store.js';
import { shuffle, sample, ls, grade, normalize, ActiveTimer, plural, speak, canSpeak, LANGS } from '../util.js';

const RIGHT = ['Exact !', 'Bien joué !', 'Parfait !', 'Oui !', 'Bravo !'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const langName = (code) => ((LANGS.find(([c]) => c === code) || [, ''])[1] || '').replace(/\s*\(.*\)/, '');
const hasKeyboard = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
const focusSoft = (el) => { if (el && hasKeyboard()) el.focus({ preventScroll: true }); };

export function learnView(ctx) {
  const id = ctx.params.id;
  const set = store.getSet(id);
  if (!set) { ctx.go('/', { replace: true }); return; }
  ctx.setHeader({ study: true, back: `/set/${id}`, title: 'Apprendre' });

  const opts = { types: 'both', answer: 'def', starred: false, roundSize: 7, ...ls.get('revi.opts.learn', {}) };
  const saveOpts = () => ls.set('revi.opts.learn', opts);
  const all = store.cardsOf(set);
  // Cache local des niveaux (le stockage cloud met à jour de façon asynchrone)
  const levels = new Map(all.map((c) => [c.id, store.cardProgress(id, c.id).lvl || 0]));
  const timer = new ActiveTimer();
  const sess = { ok: 0, ko: 0 };
  let recorded = false;
  let queue = [], pos = 0, roundNo = 0, roundCards = [], requeued = new Set(), firstTry = new Map();
  let current = null, answered = false, autoNext = null;

  const root = h('div');
  const topHost = h('div', { class: 'study-top' });
  const body = h('div');
  add(ctx.main, optionsPanel(), topHost, body);

  const pool = () => {
    if (opts.starred) { const s = all.filter((c) => c.starred); if (s.length) return s; }
    return all;
  };
  const masteredCount = () => pool().filter((c) => levels.get(c.id) >= 2).length;
  const distinctAnswers = (side) => new Set(all.map((c) => normalize(side === 'def' ? c.definition : c.term))).size;

  function renderTop() {
    const p = pool();
    setChildren(topHost, hlbar(p.length ? masteredCount() / p.length : 0), h('span', { class: 'count' }, `${masteredCount()} / ${p.length} maîtrisées`));
  }

  function optionsPanel() {
    return h('details', { class: 'options panel' },
      h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, 'Options'),
      h('div', { class: 'options-grid', style: { marginTop: '14px' } },
        h('div', { class: 'opt' }, h('span', null, 'Questions'), segmented([['both', 'QCM puis écrit'], ['mcq', 'QCM seulement'], ['written', 'Écrit seulement']], opts.types, (v) => { opts.types = v; saveOpts(); newRound(true); })),
        h('div', { class: 'opt' }, h('span', null, 'Répondre avec'), segmented([['def', 'La définition'], ['term', 'Le terme'], ['both', 'Les deux']], opts.answer, (v) => { opts.answer = v; saveOpts(); newRound(true); })),
        h('div', { class: 'opt' }, h('span', null, 'Cartes par manche'), segmented([[5, '5'], [7, '7'], [10, '10'], [15, '15']], opts.roundSize, (v) => { opts.roundSize = v; saveOpts(); newRound(true); })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.starred, onchange: (e) => { opts.starred = e.target.checked; saveOpts(); newRound(true); } }), 'Cartes étoilées seulement')));
  }

  function start() {
    if (!all.length) { setChildren(body, h('div', { class: 'empty' }, h('h2', null, 'Cette série est vide'), h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: `#/set/${id}/edit` }, 'Ajouter des cartes')))); return; }
    newRound();
  }

  function newRound(restart = false) {
    clearTimeout(autoNext);
    renderTop();
    const p = pool();
    const todo = p.filter((c) => levels.get(c.id) < 2);
    if (!todo.length) { allDone(); return; }
    const inProgress = shuffle(todo.filter((c) => levels.get(c.id) === 1));
    const fresh = todo.filter((c) => levels.get(c.id) === 0);
    queue = inProgress.concat(fresh).slice(0, opts.roundSize);
    queue = shuffle(queue);
    roundCards = queue.slice();
    if (!restart || roundNo === 0) roundNo++;
    pos = 0; requeued = new Set(); firstTry = new Map();
    ask();
  }

  function questionType(card) {
    const side = current?.side;
    if (distinctAnswers(side) < 2) return 'written';
    if (opts.types === 'mcq') return 'mcq';
    if (opts.types === 'written') return 'written';
    return levels.get(card.id) >= 1 ? 'written' : 'mcq';
  }

  function ask() {
    clearTimeout(autoNext);
    if (pos >= queue.length) { roundEnd(); return; }
    const card = queue[pos];
    const side = opts.answer === 'both' ? (Math.random() < 0.5 ? 'def' : 'term') : opts.answer;
    current = { card, side };
    current.type = questionType(card);
    current.prompt = side === 'def' ? card.term : card.definition;
    current.answer = side === 'def' ? card.definition : card.term;
    current.promptLang = side === 'def' ? set.termLang : set.defLang;
    current.answerLang = side === 'def' ? set.defLang : set.termLang;
    answered = false;

    const qcard = h('div', { class: 'qcard bristol' },
      h('div', { class: 'side' }, h('span', null, side === 'def' ? 'Terme' : 'Définition'),
        canSpeak() && current.promptLang ? h('button', { class: 'icon-btn', 'aria-label': 'Écouter', onclick: () => speak(current.prompt, current.promptLang) }, icon('speaker', 20)) : null),
      h('div', { class: 'prompt' }, current.prompt));
    const feedback = h('div', { 'aria-live': 'polite' });
    current.feedbackEl = feedback;

    if (current.type === 'mcq') {
      const others = [...new Map(all.filter((c) => c.id !== card.id).map((c) => {
        const t = side === 'def' ? c.definition : c.term; return [normalize(t), t];
      })).entries()].filter(([n]) => n !== normalize(current.answer)).map(([, t]) => t);
      const options = shuffle([current.answer, ...sample(others, 3)]);
      const buttons = options.map((opt, i) => h('button', { class: 'choice', onclick: () => chooseMcq(opt, buttons, i) },
        h('span', { class: 'kbd' }, i + 1), h('span', { class: 'txt' }, opt)));
      current.options = options; current.buttons = buttons;
      setChildren(body, qcard, h('p', { class: 'ask' }, 'Choisissez la bonne réponse'),
        h('div', { class: 'choices' + (options.every((o) => o.length < 40) ? ' grid2' : '') }, buttons), feedback,
        h('button', { class: 'btn btn-ghost dont-know', style: { marginTop: '12px' }, onclick: () => dontKnow() }, 'Je ne sais pas'),
        h('p', { class: 'hint-keys' }, 'Touches 1 à 4 pour répondre, Entrée pour continuer'));
    } else {
      const input = h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', autocorrect: 'off',
        lang: current.answerLang || null, placeholder: 'Votre réponse', 'aria-label': 'Votre réponse',
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (!answered) submitWritten(input.value); else next(); } } });
      current.input = input;
      const lang = langName(current.answerLang);
      setChildren(body, qcard,
        h('p', { class: 'ask' }, 'Écrivez ' + (side === 'def' ? 'la définition' : 'le terme') + (lang && current.answerLang ? ` (${lang.toLowerCase()})` : '')),
        h('div', { class: 'answer-row' }, input, h('button', { class: 'btn btn-primary', onclick: () => submitWritten(input.value) }, 'Valider')),
        feedback,
        h('button', { class: 'btn btn-ghost dont-know', style: { marginTop: '12px' }, onclick: () => dontKnow() }, 'Je ne sais pas'));
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
    }
  }

  function chooseMcq(opt, buttons, i) {
    if (answered) return;
    const ok = normalize(opt) === normalize(current.answer);
    buttons.forEach((b, j) => {
      b.disabled = true;
      if (normalize(current.options[j]) === normalize(current.answer)) b.classList.add('right');
      else if (j === i) b.classList.add('wrong');
      else b.classList.add('dim');
    });
    settle(ok, { yours: ok ? null : opt });
  }

  function submitWritten(value) {
    if (answered) return;
    if (!value.trim()) { current.input.focus(); return; }
    const g = grade(value, current.answer);
    current.input.disabled = true;
    settle(g.ok, { yours: value, note: g.note, kind: g.kind });
  }

  function dontKnow() {
    if (answered) return;
    if (current.buttons) current.buttons.forEach((b, j) => { b.disabled = true; b.classList.add(normalize(current.options[j]) === normalize(current.answer) ? 'right' : 'dim'); });
    if (current.input) current.input.disabled = true;
    settle(false, { dontKnow: true });
  }

  function settle(ok, info) {
    answered = true;
    body.querySelector('.dont-know')?.classList.add('hidden');
    const card = current.card;
    const lvl = levels.get(card.id) || 0;
    let newLvl;
    if (!ok) newLvl = 0;
    else if (current.type === 'written') newLvl = 2;
    else newLvl = opts.types === 'mcq' ? Math.min(2, lvl + 1) : Math.max(lvl, 1);
    levels.set(card.id, newLvl);
    store.recordAnswer(id, card.id, ok, newLvl);
    sess[ok ? 'ok' : 'ko']++;
    if (!firstTry.has(card.id)) firstTry.set(card.id, ok);
    if (!ok && !requeued.has(card.id)) { requeued.add(card.id); queue.push(card); }
    renderTop();

    const fb = current.feedbackEl;
    const cont = h('button', { class: 'btn btn-primary', onclick: next }, 'Continuer');
    if (ok) {
      setChildren(fb, h('div', { class: 'feedback ok' },
        h('div', { class: 'verdict' }, pick(RIGHT)),
        info.note ? h('div', { class: 'note' }, info.note) : null,
        info.note ? h('div', { class: 'row' }, cont) : null));
      if (!info.note) autoNext = setTimeout(next, current.type === 'mcq' ? 900 : 1100);
    } else {
      const override = current.type === 'written' && !info.dontKnow
        ? h('button', { class: 'btn btn-ghost', onclick: () => overrideCorrect(card) }, 'En fait, j’avais juste') : null;
      setChildren(fb, h('div', { class: 'feedback ko' },
        h('div', { class: 'verdict' }, info.dontKnow ? 'On la revoit bientôt' : 'Pas tout à fait'),
        info.yours && current.type === 'written' ? h('div', null, 'Votre réponse : ', h('span', { class: 'yours' }, info.yours)) : null,
        h('div', null, 'Réponse : ', h('span', { class: 'expected' }, current.answer)),
        h('div', { class: 'row' }, cont, override)));
      requestAnimationFrame(() => focusSoft(cont));
    }
    fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function overrideCorrect(card) {
    store.adjustCounts(id, card.id, 1, -1);
    sess.ok++; sess.ko--;
    levels.set(card.id, 2);
    store.setLevel(id, card.id, 2);
    firstTry.set(card.id, true);
    const lastIdx = queue.lastIndexOf(card);
    if (lastIdx > pos) queue.splice(lastIdx, 1);
    requeued.delete(card.id);
    renderTop();
    next();
  }

  function next() { clearTimeout(autoNext); if (!answered) return; pos++; ask(); }

  function roundEnd() {
    current = null;
    const doneAll = pool().every((c) => levels.get(c.id) >= 2);
    if (doneAll) { allDone(); return; }
    const okFirst = roundCards.filter((c) => firstTry.get(c.id)).length;
    const tag = (c) => { const l = levels.get(c.id); return l >= 2 ? h('span', { class: 'tag m2' }, 'Maîtrisée') : l === 1 ? h('span', { class: 'tag m1' }, 'En cours') : h('span', { class: 'tag m0' }, 'À revoir'); };
    const cont = h('button', { class: 'btn btn-primary btn-lg btn-block', onclick: () => newRound() }, 'Manche suivante');
    setChildren(body, h('div', { class: 'round-end' },
      h('div', { class: 'big' }, `Manche ${roundNo} terminée`),
      h('p', { class: 'muted' }, `${okFirst} sur ${roundCards.length} du premier coup.`),
      h('ul', { class: 'round-list' }, roundCards.map((c) => h('li', null, h('span', { class: 't' }, current?.side === 'term' ? c.definition : c.term), tag(c)))),
      h('div', { style: { maxWidth: '360px', margin: '0 auto' } }, cont)));
    requestAnimationFrame(() => focusSoft(cont));
  }

  function allDone() {
    record();
    renderTop();
    const p = pool();
    setChildren(body, h('div', { class: 'round-end' },
      h('div', { class: 'big' }, 'Tout est maîtrisé'),
      h('p', { class: 'muted' }, `Les ${plural(p.length, 'carte')}${opts.starred && p.length !== all.length ? ' étoilées' : ''} sont maîtrisées.`),
      h('div', { class: 'stack', style: { maxWidth: '340px', margin: '24px auto 0' } },
        h('a', { class: 'btn btn-primary btn-lg', href: `#/set/${id}/test` }, icon('test', 20), 'Faire un test'),
        h('button', { class: 'btn', onclick: () => { store.resetLearn(id); all.forEach((c) => levels.set(c.id, 0)); recorded = false; sess.ok = 0; sess.ko = 0; roundNo = 0; newRound(); } }, icon('restart', 20), 'Recommencer l’apprentissage'),
        h('a', { class: 'btn btn-ghost', href: `#/set/${id}` }, 'Retour à la série'))));
  }

  function record() {
    if (recorded || sess.ok + sess.ko === 0) return;
    recorded = true;
    store.addSession(id, { mode: 'learn', ok: sess.ok, ko: sess.ko, mastered: masteredCount(), total: pool().length, dur: Math.round(timer.ms) });
  }

  const onKey = (e) => {
    if (!current) { if (e.key === 'Enter' && !e.target.closest('button, a')) { const b = body.querySelector('.btn-primary'); b && b.click(); } return; }
    if (e.target.closest('input, textarea, select')) return;
    if (current.type === 'mcq' && !answered && /^[1-4]$/.test(e.key)) { const b = current.buttons[Number(e.key) - 1]; b && b.click(); }
    else if (e.key === 'Enter' && answered && !e.target.closest('button')) { e.preventDefault(); next(); }
  };
  document.addEventListener('keydown', onKey);
  ctx.onCleanup(() => { clearTimeout(autoNext); document.removeEventListener('keydown', onKey); record(); timer.stop(); });
  root.remove();
  start();
}
