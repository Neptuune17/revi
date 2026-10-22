// Mode Test : paramétrage, examen (vrai/faux, QCM, réponse écrite), correction au « stylo rouge », reprise des erreurs.
import { h, setChildren, add, icon, segmented, confirmDialog, diffText } from '../ui.js';
import { store } from '../store.js';
import { shuffle, sample, ls, grade, normalize, ActiveTimer, plural, pct, fmtDuration, clamp } from '../util.js';

const TYPE_LABEL = { tf: 'Vrai ou faux', mcq: 'QCM', written: 'Réponse écrite' };

export function testView(ctx) {
  const id = ctx.params.id;
  const set = store.getSet(id);
  if (!set) { ctx.go('/', { replace: true }); return; }
  ctx.setHeader({ study: true, back: `/set/${id}`, title: 'Test' });
  const all = store.cardsOf(set);
  const saved = ls.get('revi.opts.test', {});
  const opts = { count: 20, tf: true, mcq: true, written: true, answer: 'def', starred: false, ...saved };
  const saveOpts = () => ls.set('revi.opts.test', opts);
  let questions = [], timer = null, cleanupKeys = null;

  if (all.length === 0) {
    add(ctx.main, h('div', { class: 'empty' }, h('h2', null, 'Cette série est vide'), h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: `#/set/${id}/edit` }, 'Ajouter des cartes'))));
    return;
  }

  const pool = () => { if (opts.starred) { const s = all.filter((c) => c.starred); if (s.length) return s; } return all; };

  // ---------- Paramétrage ----------
  function configure() {
    setChildren(ctx.main, );
    window.scrollTo(0, 0);
    const max = pool().length;
    const count = h('input', { class: 'input tnum', type: 'number', min: 1, max, value: clamp(opts.count, 1, max), style: { maxWidth: '110px' },
      oninput: () => { range.value = count.value; } });
    const range = h('input', { type: 'range', min: 1, max, value: clamp(opts.count, 1, max), style: { flex: '1', accentColor: 'var(--pen)' }, oninput: () => { count.value = range.value; } });
    const typeBox = (key) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts[key], onchange: (e) => { opts[key] = e.target.checked; } }), TYPE_LABEL[key]);
    const err = h('p', { class: 'small', style: { color: 'var(--red)' }, 'aria-live': 'polite' });
    add(ctx.main, 
      h('div', { class: 'page-head' }, h('h1', null, 'Préparer le test')),
      h('div', { class: 'panel options-grid' },
        h('div', { class: 'opt' }, h('span', null, `Nombre de questions (${max} max)`), h('div', { class: 'row' }, count, range)),
        h('div', { class: 'opt' }, h('span', null, 'Types de questions'), typeBox('tf'), typeBox('mcq'), typeBox('written')),
        h('div', { class: 'opt' }, h('span', null, 'Répondre avec'), segmented([['def', 'La définition'], ['term', 'Le terme'], ['both', 'Les deux']], opts.answer, (v) => { opts.answer = v; })),
        all.some((c) => c.starred) ? h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.starred, onchange: (e) => { opts.starred = e.target.checked; configure(); } }), 'Cartes étoilées seulement') : null,
        err,
        h('button', { class: 'btn btn-primary btn-lg', onclick: () => {
          if (!opts.tf && !opts.mcq && !opts.written) { err.textContent = 'Choisissez au moins un type de question.'; return; }
          opts.count = clamp(Number(count.value) || 1, 1, max); saveOpts();
          begin(sample(pool(), opts.count));
        } }, 'Commencer le test')));
  }

  // ---------- Génération ----------
  function build(cards) {
    let types = ['tf', 'mcq', 'written'].filter((t) => opts[t]);
    const answers = (side) => [...new Map(all.map((c) => { const t = side === 'def' ? c.definition : c.term; return [normalize(t), t]; })).values()];
    return shuffle(cards).map((card, i) => {
      const side = opts.answer === 'both' ? (Math.random() < 0.5 ? 'def' : 'term') : opts.answer;
      const answer = side === 'def' ? card.definition : card.term;
      const others = answers(side).filter((t) => normalize(t) !== normalize(answer));
      let type = types[i % types.length];
      if (type !== 'written' && others.length === 0) type = 'written';
      const q = { card, side, type, prompt: side === 'def' ? card.term : card.definition, answer, user: null, ok: null, override: false };
      if (type === 'mcq') q.options = shuffle([answer, ...sample(others, 3)]);
      if (type === 'tf') { q.claimTrue = Math.random() < 0.5; q.claim = q.claimTrue ? answer : sample(others, 1)[0]; }
      return q;
    });
  }

  // ---------- Examen ----------
  function begin(cards) {
    questions = build(cards);
    timer = new ActiveTimer();
    setChildren(ctx.main, );
    window.scrollTo(0, 0);
    const counter = h('span', { class: 'muted small tnum' });
    const updateCounter = () => { counter.textContent = `${questions.filter(answeredQ).length} / ${questions.length} réponses`; };
    const blocks = questions.map((q, i) => questionBlock(q, i, () => { updateCounter(); }, (i2) => {
      const nextEl = blocks[i2 + 1];
      if (nextEl && !answeredQ(questions[i2 + 1])) setTimeout(() => nextEl.scrollIntoView({ behavior: 'smooth', block: 'center' }), 220);
    }));
    updateCounter();
    add(ctx.main, 
      h('div', { class: 'page-head' }, h('h1', null, set.title), h('span', { class: 'muted' }, plural(questions.length, 'question'))),
      ...blocks,
      h('div', { class: 'submitbar' }, counter, h('div', { class: 'spacer' }), h('button', { class: 'btn btn-primary btn-lg', onclick: submit }, 'Valider le test')));
  }
  const answeredQ = (q) => q.user != null && String(q.user).trim() !== '';

  function questionBlock(q, i, onAnswer, onPicked) {
    const el = h('div', { class: 'tq panel' });
    const head = h('div', { class: 'num' }, h('span', null, `Question ${i + 1} sur ${questions.length}`), h('span', null, TYPE_LABEL[q.type]));
    const promptEl = h('div', null,
      h('div', { class: 'small muted' }, q.side === 'def' ? 'Terme' : 'Définition'),
      h('div', { style: { fontSize: '1.2rem', fontWeight: 650, marginTop: '4px', overflowWrap: 'anywhere' } }, q.prompt));
    add(el, head, promptEl);
    if (q.type === 'tf') {
      add(el, h('div', { class: 'tf-claim' }, h('span', { class: 'small muted', style: { display: 'block' } }, q.side === 'def' ? 'Définition proposée' : 'Terme proposé'), q.claim));
      const btns = [[true, 'Vrai'], [false, 'Faux']].map(([v, l]) => h('button', { class: 'choice', 'aria-pressed': 'false', onclick: () => {
        q.user = v; btns.forEach((b, j) => { const on = (j === 0) === v; b.classList.toggle('picked', on); b.setAttribute('aria-pressed', String(on)); }); onAnswer(); onPicked(i);
      } }, h('span', { class: 'txt', style: { textAlign: 'center' } }, l)));
      add(el, h('p', { class: 'ask' }, 'Cette association est-elle juste ?'), h('div', { class: 'tf' }, btns));
    } else if (q.type === 'mcq') {
      const btns = q.options.map((opt, j) => h('button', { class: 'choice', 'aria-pressed': 'false', onclick: () => {
        q.user = opt; btns.forEach((b, k) => { b.classList.toggle('picked', k === j); b.setAttribute('aria-pressed', String(k === j)); }); onAnswer(); onPicked(i);
      } }, h('span', { class: 'kbd' }, String.fromCharCode(65 + j)), h('span', { class: 'txt' }, opt)));
      add(el, h('p', { class: 'ask' }, 'Choisissez la bonne réponse'), h('div', { class: 'choices' + (q.options.every((o) => o.length < 40) ? ' grid2' : '') }, btns));
    } else {
      const input = h('input', { class: 'input', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', placeholder: 'Votre réponse', 'aria-label': `Réponse à la question ${i + 1}`,
        lang: (q.side === 'def' ? set.defLang : set.termLang) || null,
        oninput: (e) => { q.user = e.target.value; onAnswer(); },
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); const inputs = [...ctx.main.querySelectorAll('.tq input')]; const k = inputs.indexOf(e.target); (inputs[k + 1] || e.target).focus(); } } });
      add(el, h('p', { class: 'ask' }, 'Écrivez ' + (q.side === 'def' ? 'la définition' : 'le terme')), input);
    }
    return el;
  }

  async function submit() {
    const missing = questions.filter((q) => !answeredQ(q)).length;
    if (missing && !(await confirmDialog({ title: `${plural(missing, 'question')} sans réponse`, body: 'Les questions sans réponse comptent comme fausses.', confirm: 'Valider quand même', cancel: 'Continuer le test' }))) return;
    const dur = timer ? Math.round(timer.stop()) : 0;
    for (const q of questions) {
      if (q.type === 'tf') q.ok = q.user === q.claimTrue;
      else if (q.type === 'mcq') q.ok = q.user != null && normalize(q.user) === normalize(q.answer);
      else { const g = grade(q.user || '', q.answer); q.ok = g.ok; q.note = g.note; q.diff = g.diff || null; }
      store.recordAnswer(id, q.card.id, q.ok);
    }
    const ok = questions.filter((q) => q.ok).length;
    const sid = store.addSession(id, { mode: 'test', ok, total: questions.length, score: pct(ok, questions.length), dur });
    results(sid, dur);
  }

  // ---------- Résultats ----------
  function results(sid, dur, keepScroll = false) {
    const y = window.scrollY;
    const ok = questions.filter((q) => q.ok).length;
    const n = questions.length;
    const p = pct(ok, n);
    const msg = p >= 90 ? 'Excellent travail.' : p >= 70 ? 'Bon résultat. Reprenez les erreurs pour viser le sans-faute.' : p >= 50 ? 'Vous y êtes presque : retravaillez les cartes ratées.' : 'Passez par le mode Apprendre pour consolider ces cartes.';
    const wrongCards = questions.filter((q) => !q.ok).map((q) => q.card);
    const score = h('div', { class: 'score', role: 'img', 'aria-label': `Note : ${ok} sur ${n}` },
      h('svg', { viewBox: '0 0 170 120', 'aria-hidden': 'true' }, h('path', { d: 'M28 70 C 14 30, 120 6, 154 44 C 178 74, 120 112, 64 106 C 22 101, 10 70, 40 42 C 58 26, 96 20, 118 24' })),
      h('span', null, `${ok}/${n}`));
    setChildren(ctx.main, 
      h('div', { class: 'round-end' }, score,
        h('p', { style: { fontSize: '1.3rem', fontWeight: 750 } }, `${p} %`),
        h('p', { class: 'muted' }, `${msg} Durée : ${fmtDuration(dur)}.`),
        h('div', { class: 'stack', style: { maxWidth: '360px', margin: '20px auto 0' } },
          wrongCards.length ? h('button', { class: 'btn btn-primary btn-lg', onclick: () => begin(wrongCards) }, `Retravailler les erreurs (${wrongCards.length})`) : null,
          h('button', { class: 'btn', onclick: configure }, icon('restart', 20), 'Nouveau test'),
          h('a', { class: 'btn btn-ghost', href: `#/set/${id}` }, 'Retour à la série'))),
      h('h2', { style: { marginTop: '28px' } }, 'Correction'),
      ...questions.map((q, i) => correction(q, i, sid, dur)));
    window.scrollTo(0, keepScroll ? y : 0);
  }

  function correction(q, i, sid, dur) {
    const el = h('div', { class: 'tq panel' });
    const userText = q.type === 'tf' ? (q.user == null ? '' : q.user ? 'Vrai' : 'Faux') : (q.user || '');
    const expectedText = q.type === 'tf' ? (q.claimTrue ? 'Vrai' : 'Faux') : q.answer;
    add(el, 
      h('div', { class: 'num' }, h('span', null, `Question ${i + 1} : ${TYPE_LABEL[q.type]}`), h('span', { class: 'result-mark ' + (q.ok ? 'ok' : 'ko') }, q.ok ? 'Juste' : 'Faux')),
      h('div', { style: { fontWeight: 650, overflowWrap: 'anywhere' } }, q.prompt),
      q.type === 'tf' ? h('div', { class: 'tf-claim' }, q.claim) : null,
      h('div', { class: 'corr' },
        q.ok && q.type !== 'tf' ? h('div', null, 'Votre réponse : ', h('b', null, userText)) : null,
        !q.ok ? h('div', null, 'Votre réponse : ', !userText ? h('span', { class: 'muted' }, 'aucune')
          : q.diff ? diffText(q.diff.yours, 'yours diffed')
            : h('span', { class: 'yours', style: { textDecoration: 'line-through', textDecorationColor: 'var(--red)', textDecorationThickness: '2px' } }, userText)) : null,
        !q.ok || q.type === 'tf' ? h('div', null, q.type === 'tf' ? 'Bonne réponse : ' : 'Réponse attendue : ',
          h('b', { style: { color: 'var(--green)' } }, !q.ok && q.diff ? diffText(q.diff.expected) : expectedText)) : null,
        q.type === 'tf' && !q.claimTrue ? h('div', { class: 'small muted' }, 'La bonne association était : ', h('b', null, q.answer)) : null,
        q.ok && q.note ? h('div', { class: 'small muted' }, q.note) : null,
        !q.ok && q.type === 'written' && userText ? h('div', null, h('button', { class: 'btn btn-ghost', style: { paddingLeft: 0 }, onclick: () => {
          q.ok = true; q.override = true;
          store.adjustCounts(id, q.card.id, 1, -1);
          const ok = questions.filter((x) => x.ok).length;
          store.addSession(id, { mode: 'test', ok, total: questions.length, score: pct(ok, questions.length), dur }, sid);
          results(sid, dur, true);
        } }, 'En fait, j’avais juste')) : null));
    return el;
  }

  ctx.onCleanup(() => { timer && timer.stop(); cleanupKeys && cleanupKeys(); });
  configure();
}
