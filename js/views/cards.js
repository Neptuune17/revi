// Mode Cartes : retourner (clic, espace), glisser, trier « je sais / à revoir », étoiles, lecture à voix haute
// (bouton haut-parleur, et lecture automatique de la face qui apparaît).
import { h, setChildren, add, icon, toast, segmented, hlbar } from '../ui.js';
import { store } from '../store.js';
import { shuffle, ls, ActiveTimer, plural, speak, canSpeak, unlockSpeech } from '../util.js';

const FLIP_FALLBACK_MS = 600; // secours si la fin de l'animation du retournement n'est pas signalée
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function cardsView(ctx) {
  const id = ctx.params.id;
  const set = store.getSet(id);
  if (!set) { ctx.go('/', { replace: true }); return; }
  ctx.setHeader({ study: true, back: `/set/${id}`, title: 'Cartes' });

  const opts = { front: 'term', shuffle: false, starred: false, sort: true, autoplay: true, ...ls.get('revi.opts.cards', {}) };
  const saveOpts = () => ls.set('revi.opts.cards', opts);
  const all = store.cardsOf(set);
  const hasLang = !!(set.termLang || set.defLang);
  let timer = new ActiveTimer();
  let deck = [], index = 0, flipped = false, known = [], again = [], history = [], recorded = false, seen = 0;

  const root = h('div');
  add(ctx.main, root);

  if (!all.length) {
    add(root, h('div', { class: 'empty' }, h('h2', null, 'Cette série est vide'), h('div', { class: 'actions' }, h('a', { class: 'btn btn-primary', href: `#/set/${id}/edit` }, 'Ajouter des cartes'))));
    return;
  }

  function start(subset) {
    let base = subset || all;
    if (!subset && opts.starred) {
      const st = base.filter((c) => c.starred);
      if (st.length) base = st; else toast('Aucune carte étoilée : toutes les cartes sont affichées.');
    }
    deck = opts.shuffle ? shuffle(base) : base.slice();
    index = 0; flipped = false; known = []; again = []; history = []; seen = 0; recorded = false;
    timer.stop(); timer = new ActiveTimer();
    renderAll();
    sayVisible();
  }

  // ---------- Lecture automatique ----------
  // Lit la face visible : à l'arrivée d'une carte, et à la fin de chaque retournement.
  // Une nouvelle lecture coupe la précédente (retournements rapides). Rien n'est lu pour une face sans langue.
  let speakTimer = null, speakEnd = null;
  function stopSpeech() {
    clearTimeout(speakTimer); speakTimer = null;
    if (speakEnd) { flipEl?.removeEventListener('transitionend', speakEnd); speakEnd = null; }
    if (canSpeak()) { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } }
  }
  function sayVisible(afterFlip = false) {
    if (!opts.autoplay || !hasLang || !canSpeak()) return;
    stopSpeech();
    if (index >= deck.length) return;
    const c = deck[index];
    const showsTerm = (opts.front === 'term') !== flipped;
    const text = showsTerm ? c.term : c.definition;
    const lang = showsTerm ? set.termLang : set.defLang;
    if (!lang || !text.trim()) return;
    const el = flipEl;
    const go = () => {
      clearTimeout(speakTimer); speakTimer = null;
      if (speakEnd) { el?.removeEventListener('transitionend', speakEnd); speakEnd = null; }
      speak(text, lang);
    };
    if (!afterFlip || !el || reducedMotion()) { speakTimer = setTimeout(go, afterFlip ? 0 : 60); return; }
    speakEnd = (e) => { if (e.target === el && e.propertyName === 'transform') go(); };
    el.addEventListener('transitionend', speakEnd);
    speakTimer = setTimeout(go, FLIP_FALLBACK_MS);
  }

  // ---------- Options ----------
  const options = h('details', { class: 'options panel' },
    h('summary', { style: { cursor: 'pointer', fontWeight: 700 } }, 'Options'),
    h('div', { class: 'options-grid', style: { marginTop: '14px' } },
      h('div', { class: 'opt' }, h('span', null, 'Face visible'), segmented([['term', 'Terme'], ['def', 'Définition']], opts.front, (v) => { opts.front = v; saveOpts(); start(); }, 'Face visible')),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.sort, onchange: (e) => { opts.sort = e.target.checked; saveOpts(); start(); } }), 'Trier les cartes (je sais / à revoir)'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.shuffle, onchange: (e) => { opts.shuffle = e.target.checked; saveOpts(); start(); } }), 'Mélanger'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.starred, onchange: (e) => { opts.starred = e.target.checked; saveOpts(); start(); } }), 'Cartes étoilées seulement'),
      canSpeak() ? h('label', { class: 'check' + (hasLang ? '' : ' disabled') },
        h('input', { type: 'checkbox', checked: opts.autoplay && hasLang, disabled: !hasLang, onchange: (e) => {
          opts.autoplay = e.target.checked; saveOpts();
          if (opts.autoplay) sayVisible(); else stopSpeech();
        } }),
        h('span', null, 'Lecture automatique',
          h('span', { class: 'small muted', style: { display: 'block' } }, hasLang
            ? 'Lit la face qui apparaît, sans le contenu entre parenthèses.'
            : 'Choisissez la langue des cartes dans la série (Modifier) pour l’activer.'))) : null));

  const top = h('div');
  const stageHost = h('div');
  add(root, options, h('div', { style: { height: '16px' } }), top, stageHost);

  function renderAll() {
    if (index >= deck.length) { renderEnd(); return; }
    renderTop();
    renderStage();
  }
  function renderTop() {
    setChildren(top, 
      opts.sort ? h('div', { class: 'tally' }, h('span', { class: 'again' }, `À revoir ${again.length}`), h('span', { class: 'muted' }, `${index + 1} / ${deck.length}`), h('span', { class: 'know' }, `Sues ${known.length}`))
        : h('div', { class: 'tally', style: { justifyContent: 'center' } }, h('span', { class: 'muted' }, `${index + 1} / ${deck.length}`)),
      h('div', { style: { maxWidth: '680px', margin: '0 auto 16px' } }, hlbar(index / deck.length, 'thin')));
  }

  let flipEl, dragEl;
  function renderStage() {
    const c = deck[index];
    const frontText = opts.front === 'term' ? c.term : c.definition;
    const backText = opts.front === 'term' ? c.definition : c.term;
    const frontLang = opts.front === 'term' ? set.termLang : set.defLang;
    const backLang = opts.front === 'term' ? set.defLang : set.termLang;
    const tools = (text, lang) => h('div', { class: 'face-tools' },
      canSpeak() && lang ? h('button', { class: 'icon-btn', 'aria-label': 'Écouter', onclick: (e) => { e.stopPropagation(); stopSpeech(); speak(text, lang); } }, icon('speaker', 20)) : null,
      h('button', { class: 'icon-btn' + (c.starred ? ' on' : ''), 'aria-label': c.starred ? 'Retirer l’étoile' : 'Ajouter une étoile', onclick: (e) => { e.stopPropagation(); star(); } }, icon(c.starred ? 'starFill' : 'star', 20)));
    const face = (cls, label, text, lang) => h('div', { class: `face bristol ${cls}${text.length > 110 ? ' long' : ''}` },
      h('span', { class: 'side' }, label), tools(text, lang), h('div', null, text));
    flipEl = h('div', { class: 'flip' + (flipped ? ' flipped' : ''), role: 'button', tabindex: 0, 'aria-label': 'Carte : appuyez pour retourner' },
      face('front', opts.front === 'term' ? 'Terme' : 'Définition', frontText, frontLang),
      face('back', opts.front === 'term' ? 'Définition' : 'Terme', backText, backLang));
    const hintKnow = h('div', { class: 'swipe-hint know' }, 'Je sais');
    const hintAgain = h('div', { class: 'swipe-hint again' }, 'À revoir');
    dragEl = h('div', { class: 'drag' }, flipEl);
    const stage = h('div', { class: 'stage' }, opts.sort ? [hintKnow, hintAgain] : null, dragEl);
    attachSwipe(stage, hintKnow, hintAgain);

    const controls = opts.sort
      ? h('div', { class: 'stage-controls' },
        h('button', { class: 'round-btn', 'aria-label': 'Annuler la dernière carte', disabled: !history.length, onclick: undo }, icon('undo')),
        h('button', { class: 'round-btn again', 'aria-label': 'À revoir', onclick: () => act('left') }, icon('x', 26)),
        h('button', { class: 'btn', onclick: flip }, icon('flip', 20), 'Retourner'),
        h('button', { class: 'round-btn know', 'aria-label': 'Je sais', onclick: () => act('right') }, icon('check', 26)))
      : h('div', { class: 'stage-controls' },
        h('button', { class: 'round-btn', 'aria-label': 'Carte précédente', disabled: index === 0, onclick: () => act('right') }, icon('arrowLeft')),
        h('button', { class: 'btn', onclick: flip }, icon('flip', 20), 'Retourner'),
        h('button', { class: 'round-btn', 'aria-label': 'Carte suivante', onclick: () => act('left') }, icon('arrowRight')));
    setChildren(stageHost, stage, controls,
      h('p', { class: 'hint-keys' }, opts.sort ? 'Espace : retourner, → je sais, ← à revoir, Z : annuler, S : étoile' : 'Espace : retourner, ← → : naviguer, S : étoile'));
  }

  function flip() { flipped = !flipped; flipEl?.classList.toggle('flipped', flipped); sayVisible(true); }
  function star() {
    const c = deck[index];
    c.starred = !c.starred;
    store.toggleStar(id, c.id);
    renderStage();
  }

  /** dir 'right' = je sais (tri) ou précédente ; 'left' = à revoir (tri) ou suivante */
  /** Affiche la carte qui arrive et lit sa face visible. */
  const showNext = () => { renderAll(); sayVisible(); };
  function act(dir) {
    if (index >= deck.length) return;
    if (!opts.sort) {
      if (dir === 'right') { if (index === 0) return; index--; }
      else { index++; seen = Math.max(seen, index); }
      flipped = false;
      if (opts.autoplay) stopSpeech();
      animateOut(dir === 'left' ? -1 : 1, showNext);
      return;
    }
    const c = deck[index];
    (dir === 'right' ? known : again).push(c);
    history.push(dir);
    index++; seen = Math.max(seen, index); flipped = false;
    if (opts.autoplay) stopSpeech();
    animateOut(dir === 'right' ? 1 : -1, showNext);
  }
  function undo() {
    if (!history.length) return;
    const dir = history.pop();
    (dir === 'right' ? known : again).pop();
    index--; flipped = false; showNext();
  }
  function animateOut(sign, then) {
    if (!dragEl || matchMedia('(prefers-reduced-motion: reduce)').matches) { then(); return; }
    dragEl.style.transition = 'transform .18s ease, opacity .18s ease';
    dragEl.style.transform = `translateX(${sign * 60}%) rotate(${sign * 6}deg)`;
    dragEl.style.opacity = '0';
    setTimeout(then, 170);
  }

  function attachSwipe(stage, hintKnow, hintAgain) {
    let x0 = 0, y0 = 0, dx = 0, dragging = false, down = false, pid = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      down = true; dragging = false; x0 = e.clientX; y0 = e.clientY; dx = 0; pid = e.pointerId;
    });
    stage.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== pid) return;
      dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { dragging = true; stage.setPointerCapture?.(pid); }
      if (dragging) {
        dragEl.style.transition = 'none';
        dragEl.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
        if (opts.sort) { hintKnow.style.opacity = Math.max(0, Math.min(1, dx / 90)); hintAgain.style.opacity = Math.max(0, Math.min(1, -dx / 90)); }
      }
    });
    const end = (e) => {
      if (!down || (e && e.pointerId !== pid)) return;
      down = false;
      if (!dragging) { if (e && e.type === 'pointerup') flip(); return; }
      dragging = false;
      hintKnow.style.opacity = 0; hintAgain.style.opacity = 0;
      if (Math.abs(dx) > 90) act(dx > 0 ? 'right' : 'left');
      else { dragEl.style.transition = 'transform .2s ease'; dragEl.style.transform = ''; }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  function renderEnd() {
    record();
    setChildren(top, );
    const restartAll = h('button', { class: 'btn', onclick: () => start() }, icon('restart', 20), 'Recommencer');
    if (opts.sort) {
      setChildren(stageHost, h('div', { class: 'round-end' },
        h('div', { class: 'big' }, again.length ? 'Paquet terminé' : 'Tout est su !'),
        h('p', { class: 'muted' }, `${plural(known.length, 'carte sue', 'cartes sues')}, ${again.length} à revoir.`),
        h('div', { style: { maxWidth: '420px', margin: '18px auto' } }, hlbar(deck.length ? known.length / deck.length : 0)),
        h('div', { class: 'stack', style: { maxWidth: '340px', margin: '22px auto 0' } },
          again.length ? h('button', { class: 'btn btn-primary btn-lg', onclick: () => start(again.slice()) }, `Revoir les ${plural(again.length, 'carte')}`) : null,
          restartAll,
          h('a', { class: 'btn btn-ghost', href: `#/set/${id}/learn` }, 'Passer au mode Apprendre'))));
    } else {
      setChildren(stageHost, h('div', { class: 'round-end' },
        h('div', { class: 'big' }, 'Paquet parcouru'),
        h('p', { class: 'muted' }, `Vous avez vu les ${plural(deck.length, 'carte')}.`),
        h('div', { class: 'stack', style: { maxWidth: '340px', margin: '22px auto 0' } },
          h('button', { class: 'btn btn-primary btn-lg', onclick: () => { opts.shuffle = true; start(); opts.shuffle = ls.get('revi.opts.cards', {}).shuffle || false; } }, icon('shuffle', 20), 'Mélanger et recommencer'),
          restartAll,
          h('a', { class: 'btn btn-ghost', href: `#/set/${id}/learn` }, 'Passer au mode Apprendre'))));
    }
  }

  function record() {
    if (recorded || seen < 1) return;
    recorded = true;
    store.addSession(id, { mode: 'cards', sorted: opts.sort, ok: known.length, ko: again.length, total: seen, dur: Math.round(timer.ms) });
  }

  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, summary')) return;
    if (e.key === ' ' || e.key === 'Enter') { if (e.target.closest('button, a')) return; e.preventDefault(); if (index < deck.length) flip(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); act(opts.sort ? 'right' : 'left'); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); act(opts.sort ? 'left' : 'right'); }
    else if (e.key.toLowerCase() === 's' && index < deck.length) star();
    else if (e.key.toLowerCase() === 'z' && opts.sort) undo();
  };
  document.addEventListener('keydown', onKey);
  // iPhone : débloque la voix au premier toucher (ou à la première touche) de la séance.
  const unlock = () => unlockSpeech();
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
  ctx.onCleanup(() => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
    record(); timer.stop(); stopSpeech();
  });
  start();
}
