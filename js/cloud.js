// Synchronisation via Firebase (Authentication + Cloud Firestore). Chargé uniquement si config.js contient une config.
// Données : users/{uid}/sets/{setId}, users/{uid}/progress/{setId} et users/{uid}/folders/{folderId}.
// Firestore garde un cache local (IndexedDB) : l'appli marche hors ligne, les écritures partent au retour du réseau.

import * as fb from '../vendor/firebase.js';
import { isDelete, isInc, isPlainObject } from './util.js';

let app, auth, db;

export function initCloud(config) {
  app = fb.initializeApp(config);
  auth = fb.getAuth(app);
  auth.languageCode = 'fr';
  try {
    db = fb.initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
  } catch (e) {
    console.warn('Cache hors ligne indisponible, Firestore en mémoire', e);
    db = fb.initializeFirestore(app, { ignoreUndefinedProperties: true });
  }
  return { auth };
}

export const onAuth = (cb) => fb.onAuthStateChanged(auth, cb);
export const currentUser = () => auth?.currentUser || null;

export async function signInGoogle() {
  const provider = new fb.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    return await fb.signInWithPopup(auth, provider);
  } catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) {
      return fb.signInWithRedirect(auth, provider);
    }
    throw e;
  }
}
export const handleRedirect = () => fb.getRedirectResult(auth).catch((e) => { throw e; });
export const signInEmail = (email, pw) => fb.signInWithEmailAndPassword(auth, email, pw);
export const signUpEmail = (email, pw) => fb.createUserWithEmailAndPassword(auth, email, pw);
export const resetPassword = (email) => fb.sendPasswordResetEmail(auth, email);
export const logout = () => fb.signOut(auth);

/** Convertit un patch Révi (DELETE / inc) en valeurs Firestore (deleteField / increment). */
function toFirestore(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (isDelete(v)) out[k] = fb.deleteField();
    else if (isInc(v)) out[k] = fb.increment(v.n);
    else if (isPlainObject(v)) out[k] = toFirestore(v);
    else out[k] = v;
  }
  return out;
}

export class CloudBackend {
  constructor(user, onError) {
    this.kind = 'cloud';
    this.uid = user.uid;
    this.onError = onError || console.error;
    this.data = { sets: {}, progress: {}, folders: {} };
    this.meta = { sets: {}, progress: {}, folders: {} };
    this.loaded = { sets: false, progress: false, folders: false };
  }
  start(onData) {
    const listen = (coll) => fb.onSnapshot(
      fb.collection(db, 'users', this.uid, coll),
      { includeMetadataChanges: true },
      (snap) => {
        const m = {};
        snap.forEach((d) => { m[d.id] = d.data(); });
        this.data = { ...this.data, [coll]: m };
        this.meta[coll] = { pending: snap.metadata.hasPendingWrites, fromCache: snap.metadata.fromCache };
        this.loaded[coll] = true;
        if (this.loaded.sets && this.loaded.progress && this.loaded.folders) {
          onData(this.data, {
            pending: this.meta.sets.pending || this.meta.progress.pending || this.meta.folders.pending,
            fromCache: this.meta.sets.fromCache || this.meta.progress.fromCache || this.meta.folders.fromCache,
          });
        }
      },
      (err) => this.onError(err),
    );
    this.unsubs = [listen('sets'), listen('progress'), listen('folders')];
  }
  stop() { (this.unsubs || []).forEach((u) => u()); this.unsubs = []; }
  apply(coll, id, patch) {
    fb.setDoc(fb.doc(db, 'users', this.uid, coll, id), toFirestore(patch), { merge: true }).catch((e) => this.onError(e));
  }
  remove(coll, id) {
    fb.deleteDoc(fb.doc(db, 'users', this.uid, coll, id)).catch((e) => this.onError(e));
  }
}

/** Messages d'erreur Firebase en français clair. */
export function authMessage(e) {
  const map = {
    'auth/invalid-email': 'Adresse email invalide.',
    'auth/missing-password': 'Entrez un mot de passe.',
    'auth/weak-password': 'Mot de passe trop court : 6 caractères minimum.',
    'auth/email-already-in-use': 'Un compte existe déjà avec cet email. Utilisez « Se connecter ».',
    'auth/invalid-credential': 'Email ou mot de passe incorrect.',
    'auth/wrong-password': 'Email ou mot de passe incorrect.',
    'auth/user-not-found': 'Aucun compte avec cet email. Utilisez « Créer un compte ».',
    'auth/too-many-requests': 'Trop de tentatives. Réessayez dans quelques minutes.',
    'auth/network-request-failed': 'Pas de connexion internet. Réessayez une fois en ligne.',
    'auth/popup-closed-by-user': 'Connexion annulée.',
    'auth/cancelled-popup-request': 'Connexion annulée.',
    'auth/unauthorized-domain': 'Ce site n’est pas autorisé dans Firebase. Ajoutez son adresse dans Authentication > Paramètres > Domaines autorisés.',
    'auth/operation-not-allowed': 'Cette méthode de connexion n’est pas activée dans Firebase (Authentication > Méthodes de connexion).',
    'auth/configuration-not-found': 'Firebase Authentication n’est pas activé dans votre projet.',
    'permission-denied': 'Firebase refuse l’accès : vérifiez les règles Firestore (voir DOCUMENTATION.md).',
    unavailable: 'Serveur injoignable : vos modifications seront envoyées au retour du réseau.',
  };
  return map[e?.code] || (e?.message ? 'Erreur : ' + e.message : 'Erreur inconnue.');
}
