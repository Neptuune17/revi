// Réglages : compte et synchronisation, thème, installation, sauvegarde, diagnostic.
import { h, setChildren, add, icon, toast, confirmDialog, segmented } from '../ui.js';
import { store, LS_DATA } from '../store.js';
import { ls, downloadFile, copyText, plural } from '../util.js';
import { APP_VERSION } from '../version.js';
import { applyTheme, getCloud, getErrors, clearErrors } from '../main.js';

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function settingsView(ctx) {
  ctx.setHeader({ back: '/', title: 'Réglages' });
  const account = h('div', { class: 'panel' });
  const install = h('div', { class: 'panel' });
  const diag = h('pre', { class: 'diag' });

  add(ctx.main, 
    h('div', { class: 'page-head' }, h('h1', null, 'Réglages')),
    block('Compte et synchronisation', account),
    block('Apparence', h('div', { class: 'panel' },
      h('div', { class: 'opt' }, h('span', { class: 'small muted', style: { display: 'block', marginBottom: '6px' } }, 'Thème'),
        segmented([['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']], ls.get('revi.theme', 'auto'), (v) => applyTheme(v), 'Thème')))),
    block('Installer l’appli', install),
    block('Sauvegarde', backupPanel()),
    block('Diagnostic', h('div', { class: 'panel' },
      h('p', { class: 'small muted' }, 'En cas de problème, copiez ce rapport et collez-le dans une conversation avec Claude, avec le fichier DOCUMENTATION.md.'),
      diag,
      h('div', { class: 'row' },
        h('button', { class: 'btn', onclick: async () => toast((await copyText(report())) ? 'Rapport copié.' : 'Copie impossible : sélectionnez le texte à la main.') }, icon('copy', 20), 'Copier le rapport'),
        h('button', { class: 'btn btn-ghost', onclick: () => { clearErrors(); renderDiag(); toast('Journal effacé.'); } }, 'Effacer le journal')))),
    h('p', { class: 'small muted', style: { marginTop: '28px' } },
      `Révi ${APP_VERSION}. Vos données sont enregistrées sur cet appareil et, si vous êtes connecté, dans votre propre projet Firebase.`));

  let sig = '';
  const render = () => {
    const s = store.state;
    const next = [s.cloudConfigured, s.user?.uid, s.online, s.pending, s.cloudError, !!window.__reviInstall].join('|');
    if (next !== sig) { sig = next; renderAccount(account); renderInstall(install); }
    renderDiag();
  };
  const renderDiag = () => { diag.textContent = report(); };
  ctx.watch(render);
}

const block = (title, content) => h('section', { class: 'settings-block' }, h('h2', null, title), content);

function statusLine(kind, text) { return h('div', { class: 'status-line' }, h('span', { class: 'dot ' + kind }), text); }

function renderAccount(el) {
  const s = store.state;
  const cloud = getCloud();
  if (!s.cloudConfigured) {
    setChildren(el, 
      statusLine('warn', 'Synchronisation non configurée'),
      h('p', { class: 'muted' }, 'Vos séries sont enregistrées sur cet appareil uniquement. Pour synchroniser votre téléphone et votre ordinateur, ajoutez la configuration de votre projet Firebase dans le fichier config.js (étapes dans DOCUMENTATION.md).'),
      dangerLocal());
    return;
  }
  if (s.cloudError && !cloud) { setChildren(el, statusLine('ko', s.cloudError)); return; }
  if (!s.user) { setChildren(el, ...loginForm()); return; }

  const state = !s.online ? ['ko', 'Hors ligne : les modifications seront envoyées au retour du réseau.']
    : s.pending ? ['warn', 'Envoi des modifications en cours…'] : ['ok', 'Tout est synchronisé.'];
  setChildren(el, 
    statusLine('ok', 'Connecté' + (s.user.email ? ' : ' + s.user.email : '')),
    statusLine(state[0], state[1]),
    s.cloudError ? h('p', { class: 'small', style: { color: 'var(--red)' } }, s.cloudError) : null,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => {
      if (s.pending && !(await confirmDialog({ title: 'Se déconnecter maintenant ?', body: 'Des modifications ne sont pas encore envoyées. Elles partiront à votre prochaine connexion sur cet appareil.', confirm: 'Se déconnecter' }))) return;
      await cloud.logout(); toast('Déconnecté.');
    } }, 'Se déconnecter')));
}

function loginForm() {
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'email', placeholder: 'vous@exemple.fr', 'aria-label': 'Email' });
  const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Mot de passe (6 caractères minimum)', 'aria-label': 'Mot de passe' });
  const msg = h('p', { class: 'small', style: { color: 'var(--red)' }, 'aria-live': 'polite' });
  const busy = async (fn) => {
    msg.textContent = '';
    const cloud = getCloud();
    if (!cloud) { msg.textContent = 'La connexion se prépare, réessayez dans un instant.'; return; }
    try { await fn(cloud); }
    catch (e) { msg.textContent = cloud.authMessage(e); }
  };
  const valid = () => { if (!email.value.trim()) { msg.textContent = 'Entrez votre email.'; email.focus(); return false; } return true; };
  return [
    statusLine('warn', 'Non connecté'),
    h('p', { class: 'muted' }, 'Connectez-vous avec le même compte sur votre téléphone et votre ordinateur : vos séries et vos résultats seront synchronisés.'),
    h('button', { class: 'btn btn-lg', onclick: () => busy((c) => c.signInGoogle()) }, 'Continuer avec Google'),
    isIOS() && isStandalone() ? h('p', { class: 'small muted' }, 'Sur iPhone, si la fenêtre Google ne s’ouvre pas depuis l’appli installée, utilisez la connexion par email.') : null,
    h('div', { class: 'divider' }, 'ou avec un email'),
    h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); if (valid()) busy((c) => c.signInEmail(email.value.trim(), pw.value)); } },
      email, pw, msg,
      h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'submit' }, 'Se connecter'),
        h('button', { class: 'btn', type: 'button', onclick: () => { if (valid()) busy((c) => c.signUpEmail(email.value.trim(), pw.value)); } }, 'Créer un compte'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { if (valid()) busy(async (c) => { await c.resetPassword(email.value.trim()); toast('Email de réinitialisation envoyé.'); }); } }, 'Mot de passe oublié'))),
  ];
}

function dangerLocal() {
  return h('div', null, h('button', { class: 'btn btn-danger wrap', onclick: async () => {
    const n = Object.keys(store.state.sets).length;
    if (!n) { toast('Aucune donnée à effacer.'); return; }
    if (!(await confirmDialog({ title: 'Effacer les données de cet appareil ?', body: `${plural(n, 'série')} et toute la progression seront supprimées. Exportez une sauvegarde avant si besoin.`, confirm: 'Tout effacer', danger: true }))) return;
    Object.keys(store.state.sets).forEach((id) => store.deleteSet(id));
    Object.keys(store.state.progress).forEach((id) => store.backend.remove('progress', id));
    toast('Données effacées.');
  } }, icon('trash', 20), 'Effacer les données de cet appareil'));
}

function renderInstall(el) {
  if (isStandalone()) { setChildren(el, statusLine('ok', 'Révi est installée sur cet appareil.')); return; }
  const prompt = window.__reviInstall;
  if (prompt) {
    setChildren(el, 
      h('p', { class: 'muted' }, 'Ajoutez Révi à votre écran d’accueil : elle s’ouvrira comme une appli et fonctionnera hors ligne.'),
      h('div', null, h('button', { class: 'btn btn-primary', onclick: async () => { prompt.prompt(); await prompt.userChoice.catch(() => null); window.__reviInstall = null; store.emit(); } }, icon('install', 20), 'Installer Révi')));
    return;
  }
  setChildren(el, h('p', { class: 'muted' }, isIOS()
    ? 'Sur iPhone ou iPad : ouvrez Révi dans Safari, touchez le bouton Partager, puis « Sur l’écran d’accueil ».'
    : 'Dans le menu du navigateur, choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».'));
}

function backupPanel() {
  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden', onchange: async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const n = store.importAll(data);
      toast(`${plural(n, 'série importée', 'séries importées')}.`);
    } catch (err) { toast(err.message.startsWith('Fichier') ? err.message : 'Fichier illisible : ce n’est pas une sauvegarde Révi.', { kind: 'error' }); }
    e.target.value = '';
  } });
  return h('div', { class: 'panel' },
    h('p', { class: 'muted' }, 'La sauvegarde contient toutes vos séries, votre progression et vos records. Importer une sauvegarde ajoute ses séries à celles déjà présentes.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => downloadFile(`revi-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportAll(), null, 2)) }, icon('download', 20), 'Exporter une sauvegarde'),
      h('button', { class: 'btn', onclick: () => file.click() }, icon('upload', 20), 'Importer une sauvegarde'), file));
}

export function report() {
  const s = store.state;
  const sets = Object.values(s.sets);
  const cards = sets.reduce((a, x) => a + Object.keys(x.cards || {}).length, 0);
  const errs = getErrors();
  const sw = 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? 'actif' : 'inactif') : 'non pris en charge';
  return [
    'Révi : rapport de diagnostic',
    `Version : ${APP_VERSION}`,
    `Date : ${new Date().toISOString()}`,
    `Mode des données : ${s.mode === 'cloud' ? 'compte Firebase' : 'local (cet appareil)'}`,
    `Firebase configuré : ${s.cloudConfigured ? 'oui' : 'non'}${s.cloudConfigured ? `, projet ${window.REVI_CONFIG?.firebase?.projectId || '?'}` : ''}`,
    `Connecté : ${s.user ? 'oui (' + s.user.uid.slice(0, 6) + '…)' : 'non'}`,
    `En ligne : ${s.online ? 'oui' : 'non'}, envoi en attente : ${s.pending ? 'oui' : 'non'}`,
    `Séries : ${sets.length}, cartes : ${cards}`,
    `Service worker : ${sw}, installée : ${isStandalone() ? 'oui' : 'non'}`,
    `Stockage local : ${(() => { try { return Math.round((localStorage.getItem(LS_DATA) || '').length / 1024) + ' Ko'; } catch { return 'indisponible'; } })()}`,
    `Navigateur : ${navigator.userAgent}`,
    `Écran : ${window.innerWidth}x${window.innerHeight}`,
    s.cloudError ? `Erreur de synchro : ${s.cloudError}` : null,
    `Dernières erreurs (${errs.length}) :`,
    ...(errs.length ? errs.map((e) => `- ${e.at} [${e.where}] ${e.msg}${e.code ? ' (' + e.code + ')' : ''}${e.stack ? '\n    ' + e.stack : ''}`) : ['- aucune']),
  ].filter(Boolean).join('\n');
}
