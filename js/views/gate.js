// Écrans d'accès : connexion obligatoire (config.js > requireLogin) et compte refusé par les règles Firestore.
import { h, add, toast } from '../ui.js';
import { store } from '../store.js';
import { getCloud } from '../main.js';
import { loginForm } from './settings.js';

export function gateView(ctx) {
  ctx.setHeader({ gate: true });
  const s = store.state;
  const cloud = getCloud();
  add(ctx.main, h('div', { class: 'gate' },
    h('div', { class: 'bristol gate-card', 'aria-hidden': 'true' }, h('span', null, 'Révi')),
    h('h1', null, 'Connectez-vous'),
    h('p', { class: 'muted' }, 'Connectez-vous pour retrouver vos séries et vos résultats, synchronisés entre vos appareils.'),
    !s.online ? h('p', { class: 'small', style: { color: 'var(--red)' } }, 'Vous êtes hors ligne. Une connexion internet est nécessaire pour se connecter la première fois sur cet appareil.') : null,
    s.cloudError && !cloud ? h('p', { class: 'small', style: { color: 'var(--red)' } }, s.cloudError) : null,
    h('div', { class: 'panel stack' }, loginForm({ intro: false }))));
}

export function deniedView(ctx) {
  ctx.setHeader({ gate: true });
  const s = store.state;
  add(ctx.main, h('div', { class: 'gate' },
    h('h1', null, 'Ce compte n’a pas accès à Révi'),
    h('p', { class: 'muted' }, `Vous êtes connecté${s.user?.email ? ' avec ' + s.user.email : ''}, mais la base de données refuse ce compte. Déconnectez-vous puis connectez-vous avec le compte autorisé.`),
    h('div', { class: 'stack', style: { marginTop: '18px' } },
      h('button', { class: 'btn btn-primary btn-lg', onclick: async () => { await getCloud()?.logout(); toast('Déconnecté.'); } }, 'Se déconnecter'),
      h('button', { class: 'btn', onclick: () => location.reload() }, 'Réessayer')),
    h('p', { class: 'small muted', style: { marginTop: '18px' } }, 'Si c’est bien votre compte, vérifiez les règles Firestore et votre UID (DOCUMENTATION.md, section 5.2).')));
}
