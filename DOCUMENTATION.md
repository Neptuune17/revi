# Révi : documentation technique

Révi est une appli de fiches de révision (cartes, Apprendre, Test, Associer) qui fonctionne sur téléphone et ordinateur, hors ligne, avec synchronisation optionnelle via Firebase.

Ce fichier sert à reprendre le projet plus tard, seul ou avec Claude : il décrit l'architecture, les données, les règles de chaque mode, la mise en ligne et le débogage.

Version documentée : **1.1.0** (17 octobre 2026).

---

## 0. Reprendre le projet avec Claude

Dans une nouvelle conversation, joignez :

1. **ce fichier** (`DOCUMENTATION.md`) ;
2. **le dossier du projet en .zip**, ou au minimum les fichiers concernés par votre demande (voir l'arborescence, section 2) ;
3. si c'est un bug : **le rapport de diagnostic** (dans l'appli : Réglages > Diagnostic > Copier le rapport), collé dans le message.

Modèle de message :

> Voici la documentation et le code de mon appli Révi. [Décrivez le problème ou la nouveauté.]
> Sur quel appareil : [iPhone / Android / PC, navigateur]. Ce que je fais : [étapes]. Ce qui se passe : [résultat]. Ce que j'attends : [résultat voulu].
> Rapport de diagnostic : [coller ici]

Après une modification du code, avant de remettre l'appli en ligne : **changer la version** (section 9), sinon les appareils garderont l'ancienne version en cache.

---

## 1. Vue d'ensemble

- **Type** : application web progressive (PWA). Elle s'installe sur l'écran d'accueil, s'ouvre en plein écran et marche hors ligne grâce à un service worker.
- **Sans étape de compilation** : HTML, CSS et JavaScript (modules ES natifs) servis tels quels. N'importe quel hébergeur de fichiers statiques convient (GitHub Pages, Netlify, Firebase Hosting…).
- **Aucune dépendance externe au chargement** : polices, icônes et SDK Firebase sont dans le dossier. Aucun appel à un CDN.
- **Données « local d'abord »** :
  - sans compte : tout est dans le `localStorage` de l'appareil ;
  - avec compte : Cloud Firestore, avec cache hors ligne (IndexedDB). Les modifications faites hors ligne partent au retour du réseau.
- **Synchronisation optionnelle** : tant que `config.js` contient `firebase: null`, l'appli fonctionne sans compte.
- **Connexion obligatoire (option)** : avec `requireLogin: true` dans `config.js`, l'appli n'affiche que l'écran de connexion tant qu'on n'est pas connecté (voir 7.1).
- **Langue de l'interface** : français. Thème clair / sombre / automatique.

---

## 2. Arborescence

| Fichier | Rôle |
|---|---|
| `index.html` | Page unique : charge `config.js`, la feuille de style et `js/main.js`. |
| `config.js` | Configuration Firebase (`window.REVI_CONFIG.firebase`). `null` = pas de synchro. |
| `manifest.webmanifest` | Nom, icônes, couleurs et mode plein écran de l'appli installée. |
| `sw.js` | Service worker : mise en cache de tous les fichiers, fonctionnement hors ligne, mises à jour. Contient `CACHE_VERSION` et la liste `FILES`. |
| `css/app.css` | Toute la mise en forme. Couleurs en variables en haut du fichier (thème clair, puis sombre). |
| `js/main.js` | Démarrage, routeur, barre du haut, connexion Firebase, migration local vers compte, service worker, journal d'erreurs. |
| `js/store.js` | Magasin de données central (`store`) et `LocalBackend` (localStorage). Toutes les lectures et écritures passent par lui. |
| `js/cloud.js` | `CloudBackend` (Firestore) et fonctions de connexion (Google, email). Chargé seulement si Firebase est configuré. |
| `js/util.js` | Outils : sentinelles `DELETE`/`inc`, fusion profonde, correction des réponses, import de texte, formats français, minuteur, voix, stockage sûr. |
| `js/ui.js` | Création d'éléments `h()`, `setChildren()`, `add()`, icônes SVG, toasts, dialogues, menus, contrôles segmentés. |
| `js/version.js` | `APP_VERSION`. |
| `js/sample.js` | Série d'exemple (connecteurs logiques en anglais). |
| `js/views/home.js` | Accueil : séries par matière, recherche, écran vide. |
| `js/views/set.js` | Page d'une série : modes, progression, résultats (graphiques), liste des cartes, menu (copier, télécharger, réinitialiser, supprimer). |
| `js/views/editor.js` | Création / modification d'une série et import de texte. |
| `js/views/cards.js` | Mode Cartes. |
| `js/views/learn.js` | Mode Apprendre. |
| `js/views/test.js` | Mode Test. |
| `js/views/match.js` | Mode Associer. |
| `js/views/settings.js` | Réglages : compte, thème, installation, sauvegarde, diagnostic. Exporte aussi `loginForm()`. |
| `js/views/gate.js` | Écran de connexion obligatoire (`gateView`) et écran « compte refusé » (`deniedView`). |
| `vendor/firebase.js` | SDK Firebase 13.0.0 (app, auth, firestore) regroupé en un seul fichier. |
| `fonts/` | Atkinson Hyperlegible Next (texte) et Kalam (annotations « stylo »). Licence SIL OFL. |
| `icons/` | Icônes de l'appli (générées par `tools/make_icons.py`). |
| `firestore.rules` | Règles de sécurité Firestore à coller dans la console Firebase. |
| `tools/firebase-entry.js` | Liste des fonctions Firebase incluses dans `vendor/firebase.js` (pour le reconstruire). |
| `tools/make_icons.py` | Régénère les icônes PNG (Python + Pillow). |
| `tests/` | Tests automatisés dans un vrai navigateur (Playwright), voir section 10. |

---

## 3. Architecture

### 3.1 Démarrage (`main.js > boot()`)

1. Applique le thème enregistré.
2. Lit `window.REVI_CONFIG.firebase` :
   - pas de config, ou dernier mode utilisé = local : démarre tout de suite avec `LocalBackend` ;
   - sinon : attend la session Firebase.
3. Si Firebase est configuré :
   - charge `js/cloud.js` (qui importe `vendor/firebase.js`) et initialise Firebase ;
   - écoute l'état de connexion :
     - utilisateur connecté : `CloudBackend`, puis proposition d'envoyer les séries locales dans le compte (une fois par compte et par appareil) ;
     - déconnecté : `LocalBackend`.
   - filet de sécurité : si aucune source de données n'est choisie au bout de 6 s, le mode local est utilisé.
4. Enregistre le service worker.

Deux écrans passent avant toutes les routes (`route()` dans `main.js`) :
- **compte refusé** (`deniedView`) : un compte est connecté mais Firestore refuse ses lectures (`permission-denied`, `state.accessDenied`). L'écran propose de se déconnecter ;
- **connexion obligatoire** (`gateView`) : `requireLogin` est activé et personne n'est connecté.

Le routeur se relance de lui-même quand l'un de ces deux états change (connexion, déconnexion, refus).

### 3.2 Routeur

Navigation par le hash de l'adresse (`#/...`), donc aucune configuration serveur n'est nécessaire.

| Route | Vue |
|---|---|
| `#/` | Accueil |
| `#/new` | Nouvelle série |
| `#/import` | Nouvelle série avec le panneau d'import ouvert |
| `#/set/<id>` | Page de la série |
| `#/set/<id>/edit` | Modifier la série |
| `#/set/<id>/cards`, `/learn`, `/test`, `/match` | Modes d'étude |
| `#/settings` | Réglages |

Chaque vue est une fonction `xxxView(ctx)` qui reçoit :

- `ctx.main` : élément où dessiner ;
- `ctx.params.id` : identifiant de la série dans l'adresse ;
- `ctx.setHeader({ title, back, study, gate })` : barre du haut. `study: true` affiche une croix et masque les réglages ; `gate: true` n'affiche que le logo ;
- `ctx.watch(render)` : appelle `render` maintenant et à chaque changement de données ;
- `ctx.onCleanup(fn)` : appelée en quittant la vue (enregistrer la session, retirer les écouteurs clavier…) ;
- `ctx.go(path)` : changer de page.

Les modes d'étude ne se redessinent pas à chaque changement de données (pour ne pas interrompre une révision) : ils lisent la série au démarrage.

### 3.3 Règle d'interface importante

Les méthodes natives `append()` et `replaceChildren()` affichent le texte « null » si on leur passe `null`. Dans les vues, utiliser **`add(el, ...)`** et **`setChildren(el, ...)`** de `ui.js`, qui ignorent `null`/`false` et aplatissent les tableaux. `h(tag, props, ...enfants)` le fait déjà.

---

## 4. Données

### 4.1 Modèle

Deux collections, avec la même clé (l'identifiant de la série) :

**`sets/<setId>`** : la série et ses cartes.

```json
{
  "title": "Connecteurs logiques",
  "folder": "Anglais",
  "termLang": "fr-FR",
  "defLang": "en-GB",
  "createdAt": 1760710000000,
  "updatedAt": 1760710000000,
  "cards": {
    "cmgv1x2abc123": { "term": "ainsi (t)", "definition": "thus", "order": 0, "starred": false }
  }
}
```

Les cartes sont un **dictionnaire** indexé par identifiant, et non une liste : deux appareils qui modifient des cartes différentes ne s'écrasent pas. L'ordre d'affichage vient de `order`.

**`progress/<setId>`** : la progression.

```json
{
  "cards": { "cmgv1x2abc123": { "lvl": 2, "ok": 5, "ko": 1, "last": 1760710000000 } },
  "sessions": { "xmgv1y9def456": { "mode": "test", "ok": 9, "total": 12, "score": 75, "dur": 64000, "at": 1760710000000 } },
  "best": { "match": 21400 },
  "updatedAt": 1760710000000
}
```

Niveaux d'une carte (`lvl`) :

| `lvl` | Signification |
|---|---|
| 0 | pas vue ou ratée |
| 1 | en cours (QCM réussi) |
| 2 | maîtrisée (réponse écrite réussie) |

`statusOf()` affiche « en cours » dès qu'une carte a reçu au moins une réponse.

Champs des sessions selon le mode :

| Mode | Champs |
|---|---|
| `cards` | `sorted`, `ok` (sues), `ko` (à revoir), `total` (vues), `dur` |
| `learn` | `ok`, `ko`, `mastered`, `total`, `dur` |
| `test` | `ok`, `total`, `score` (%), `dur` |
| `match` | `ms` (temps avec pénalités), `errors`, `pairs`, `dur` |

Toutes les durées sont en millisecondes. Seules les 60 dernières sessions sont gardées par série.

### 4.2 Écritures par « patch »

Toute écriture est un objet imbriqué, fusionné en profondeur dans le document : `backend.apply(collection, id, patch)`. Deux valeurs spéciales (`util.js`) :

- `DELETE` : supprime la clé (devient `deleteField()` dans Firestore) ;
- `inc(n)` : ajoute `n` à un nombre (devient `increment(n)`). Les compteurs s'additionnent même si deux appareils écrivent hors ligne en même temps.

`deepMerge()` reproduit exactement `setDoc(ref, patch, { merge: true })` de Firestore. Les deux modes se comportent donc de la même façon. Il faut éviter les tableaux dans les documents : une fusion remplace un tableau entier.

### 4.3 API du magasin (`store`)

- **Lecture** :
  - `state.sets`, `state.progress` ;
  - `getSet(id)`, `cardsOf(set)` (liste triée), `progressOf(id)`, `cardProgress(id, cardId)`, `statusOf(id, cardId)`, `sessionsOf(id)` (plus récente d'abord), `lastStudied(id)`, `folders()`.
- **Séries** : `createSet({...})` (renvoie l'id), `updateSet(id, {title, folder, termLang, defLang, cards})` (calcule la différence avec l'existant), `toggleStar`, `deleteSet`.
- **Progression** : `recordAnswer(id, cardId, ok, lvl?)`, `adjustCounts`, `setLevel`, `resetLearn`, `addSession(id, session, existingId?)`, `setBestMatch(id, ms)`.
- **Sauvegarde** : `exportAll()`, `importAll(data)` (fusion), `copyInto(data)`.
- **État** : `mode` (`local`/`cloud`), `user`, `pending` (envois en attente), `fromCache`, `online`, `cloudConfigured`, `cloudError`, `ready`, `requireLogin`, `allowSignup`, `accessDenied`.

### 4.4 Clés `localStorage`

| Clé | Contenu |
|---|---|
| `revi.data.v1` | Données du mode local `{ sets, progress }`. |
| `revi.data.v1.backup` | Copie des données locales faite au moment de leur envoi dans le compte. |
| `revi.theme` | `auto` / `light` / `dark`. |
| `revi.lastMode` | `local` / `cloud` (pour savoir s'il faut attendre Firebase au démarrage). |
| `revi.migrated.<uid>` | Séries locales déjà envoyées dans ce compte. |
| `revi.errors` | 15 dernières erreurs (affichées dans Diagnostic). |
| `revi.opts.cards` / `.learn` / `.test` | Options choisies dans chaque mode (propres à l'appareil). |

### 4.5 Firestore

- Chemins : `users/{uid}/sets/{setId}` et `users/{uid}/progress/{setId}`.
- Règles (`firestore.rules`) : chaque utilisateur ne lit et n'écrit que sous `users/{son uid}`.
- Cache hors ligne : `persistentLocalCache` avec gestion multi-onglets. Si IndexedDB est indisponible, l'appli bascule sur un cache en mémoire.
- `ignoreUndefinedProperties: true` : une valeur `undefined` oubliée ne fait pas échouer l'écriture.

---

## 5. Synchronisation et sécurité

### 5.1 Comportement de la synchronisation

- **Hors ligne** : les écritures sont gardées par Firestore et envoyées au retour du réseau. La pastille en haut indique l'état :
  - « Synchronisé » (vert) ;
  - « Envoi… » (jaune) ;
  - « Hors ligne » (rouge) ;
  - « Sur cet appareil » / « Non connecté » (gris).
- **Conflits** : la fusion se fait champ par champ. Sur une même carte modifiée sur deux appareils, la dernière écriture gagne. Les compteurs (`ok`, `ko`) s'additionnent.
- **Première connexion sur un appareil qui a des séries locales** : l'appli propose de les ajouter au compte. Les données locales sont alors copiées dans le compte, puis sauvegardées dans `revi.data.v1.backup` et retirées du mode local.
- **Déconnexion** : retour au mode local (vide si les séries ont été envoyées dans le compte). Le cache Firestore reste sur l'appareil.

### 5.2 Sécurité

**Ce qui est public** (dépôt GitHub et site en ligne) : le code, la configuration Firebase de `config.js` et la série d'exemple. La configuration Firebase n'est pas secrète : elle identifie le projet, sans donner accès aux données. Aucune donnée d'utilisateur n'est dans le code. Les commits GitHub sont signés avec l'adresse anonyme `@users.noreply.github.com`.

**Ce qui protège les données** : les règles Firestore. Chaque utilisateur ne lit et n'écrit que sous `users/{son uid}`, et tout le reste est refusé.

**Règles actuellement en place** (dans la console Firebase, pas dans le dépôt) : la base est réservée au compte du propriétaire grâce à la liste d'UID.

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null
                         && request.auth.uid == uid
                         && uid in ['UID_DU_PROPRIETAIRE'];
    }
  }
}
```

- L'UID se trouve dans Firebase > Authentication > Utilisateurs.
- Pour ouvrir l'appli à d'autres personnes, ajouter leurs UID à la liste et mettre `allowSignup: true` dans `config.js`.
- Un compte connecté mais absent de la liste voit l'écran « Ce compte n'a pas accès à Révi ».

**Audit du 17 octobre 2026**, requêtes envoyées sans compte avec la configuration publique. Toutes ont été refusées (HTTP 403 `PERMISSION_DENIED`) :
- lister les utilisateurs ;
- lire les séries ou un document d'un compte ;
- requêtes groupées sur toutes les séries et progressions ;
- écrire dans un compte ou ailleurs dans la base.

**Autres points** :
- le contenu des cartes est toujours affiché comme du texte (pas d'injection de HTML ou de script possible) ;
- aucun service tiers en dehors de Firebase, aucun pisteur ;
- la connexion par Google bénéficie de la validation en deux étapes du compte Google ;
- un inconnu qui se crée un compte ne peut ni lire ni écrire, grâce à la liste d'UID.

---

## 6. Règles des modes

### Cartes

- Clic, espace ou toucher pour retourner la carte.
- Options : face visible (terme ou définition), mélanger, cartes étoilées seulement, tri.
- Avec le tri (par défaut) :
  - glisser à droite ou → : « Je sais » ;
  - glisser à gauche ou ← : « À revoir » ;
  - Z : annuler la dernière carte.
  - En fin de paquet : bouton « Revoir les N cartes ».
- Sans tri : ← → pour naviguer, glisser à gauche pour la carte suivante.
- S : mettre ou retirer l'étoile.
- Le haut-parleur lit la carte si une langue est choisie dans la série (synthèse vocale du navigateur).
- Ce mode ne change pas le niveau des cartes.

### Apprendre

- Manches de N cartes (5, 7, 10 ou 15 ; 7 par défaut). Priorité aux cartes « en cours », puis aux nouvelles.
- Niveau 0 : QCM (4 choix pris parmi les réponses des autres cartes). Niveau 1 : réponse écrite. Réussir la réponse écrite fait passer la carte au niveau 2 (maîtrisée).
- Options :
  - « QCM seulement » : deux QCM réussis suffisent ;
  - « Écrit seulement » : une réponse écrite juste suffit.
- Erreur ou « Je ne sais pas » : retour au niveau 0. La carte revient une fois en fin de manche.
- « En fait, j'avais juste » (réponse écrite) : corrige le comptage et passe la carte en maîtrisée.
- Une bonne réponse passe seule à la question suivante (0,9 s pour un QCM, 1,1 s pour une réponse écrite), sauf s’il y a une remarque à lire.
- Clavier : 1 à 4 pour les QCM, Entrée pour valider ou continuer.
- La session est enregistrée en quittant le mode ou quand tout est maîtrisé.
- « Recommencer l'apprentissage » remet tous les niveaux à 0 (l'historique est conservé).

### Test

- Paramètres : nombre de questions, types (vrai/faux, QCM, écrit), réponse attendue (définition, terme, les deux), cartes étoilées.
- Les types sont répartis à tour de rôle sur les questions.
- Les questions sans réponse comptent comme fausses.
- Correction détaillée. « En fait, j'avais juste » met à jour la note et la session.
- « Retravailler les erreurs » lance un test avec les cartes ratées.
- Ce mode met à jour les compteurs `ok`/`ko`, mais pas les niveaux.

### Associer

- Jusqu'à 6 paires (12 tuiles) tirées au hasard. Toucher un terme puis sa définition.
- Une erreur ajoute 1 s de pénalité (`PENALTY` dans `match.js`). Toucher deux tuiles du même côté change simplement la sélection, sans pénalité.
- Si deux cartes ont le même terme ou la même définition, les deux associations sont acceptées.
- Le record (`best.match`) et les 5 derniers temps sont affichés.

### Correction des réponses écrites (`util.js > grade`)

1. Normalisation :
   - minuscules ;
   - apostrophes supprimées ;
   - ponctuation et points de suspension ignorés ;
   - tirets et barres remplacés par des espaces ;
   - espaces regroupés.
2. Formes acceptées :
   - la réponse complète ;
   - la réponse sans ce qui est entre parenthèses ;
   - si la réponse contient `,` `;` ou `/` : chacune des variantes (ex. « besides, moreover » accepte « besides »). La réponse complète est alors rappelée.
3. Si les accents sont faux : accepté, avec « Attention aux accents ».
4. Petites fautes de frappe (distance de Levenshtein, sans les accents) : accepté, avec « Petite faute ». Tolérance selon la longueur de la réponse :

   | Longueur de la réponse | Erreurs tolérées |
   |---|---|
   | 3 caractères ou moins | 0 |
   | 4 à 7 | 1 |
   | 8 à 14 | 2 |
   | plus de 14 | 3 |

### Import de texte (`util.js > detectSeparators / parseImport`)

- Détection automatique, dans cet ordre :
  1. une seule ligne contenant des `;` : les cartes sont séparées par `;` ;
  2. présence de tabulations (export Quizlet par défaut, copier-coller depuis un tableur) ;
  3. toutes les lignes contiennent « - » ;
  4. toutes les lignes contiennent « : » ;
  5. toutes les lignes contiennent « ; » ;
  6. toutes les lignes contiennent « , ».
- Les séparateurs peuvent être choisis à la main (y compris un séparateur personnalisé).
- Une ligne sans séparateur donne une carte sans définition, signalée dans l'aperçu.

---

## 7. Activer la synchronisation (Firebase), pas à pas

Gratuit (offre Spark, sans carte bancaire). Les libellés de la console peuvent légèrement varier.

1. **Créer le projet** : sur https://console.firebase.google.com, choisir « Créer un projet » et lui donner un nom (ex. `revi`). Google Analytics n'est pas nécessaire.
2. **Ajouter une application Web** : sur la page du projet, cliquer sur l'icône Web `</>`, donner un nom et ne pas cocher Firebase Hosting. Firebase affiche un bloc `const firebaseConfig = { apiKey: …, authDomain: …, projectId: …, … }`.
3. **Coller la configuration** : dans `config.js`, remplacer `firebase: null` par `firebase: { apiKey: "…", authDomain: "…", projectId: "…", storageBucket: "…", messagingSenderId: "…", appId: "…" }`. Ces valeurs ne sont pas secrètes : la sécurité vient des règles.
4. **Activer la connexion** : menu Authentication (Build / Créer), puis « Commencer ». Dans l'onglet « Méthode de connexion » :
   - activer **Adresse e-mail/Mot de passe** ;
   - activer **Google** (choisir un email d'assistance).
5. **Autoriser le site** : Authentication > Paramètres > **Domaines autorisés**, puis ajouter l'adresse du site en ligne (ex. `votrepseudo.github.io`), sans `https://` ni chemin. Nécessaire pour la connexion Google. `localhost` est déjà autorisé.
6. **Créer la base** : menu Firestore Database, puis « Créer une base de données ». Choisir l'édition standard si on vous le demande, un emplacement en Europe (ex. `eur3` ou `europe-west9` Paris) et le **mode production**.
7. **Coller les règles** : Firestore Database > onglet Règles. Remplacer tout par le contenu de `firestore.rules`, puis « Publier ».
8. Remettre l'appli en ligne (section 8). Dans Réglages, se connecter avec le **même compte** sur chaque appareil.
9. Recommandé : réserver la base à votre compte avec la liste d'UID (section 5.2).

### 7.1 Options de `config.js`

| Option | Valeur | Effet |
|---|---|---|
| `firebase` | `null` ou l'objet `firebaseConfig` | `null` : mode local uniquement, sans synchronisation. |
| `requireLogin` | `true` / `false` (défaut `false`) | `true` : seul l'écran de connexion s'affiche tant qu'on n'est pas connecté. Ignoré si `firebase` vaut `null`. |
| `allowSignup` | `true` / `false` | Affiche « Créer un compte » (par email). Par défaut : `false` si `requireLogin` est activé, `true` sinon. La connexion Google crée toujours un compte au premier passage : c'est la liste d'UID des règles qui bloque les inconnus. |

Avec `requireLogin`, il faut une connexion internet pour se connecter la première fois sur un appareil. Ensuite, la session est gardée et l'appli fonctionne hors ligne.

---

## 8. Mise en ligne

### GitHub Pages (recommandé : gratuit, adresse stable)

1. Créer un compte sur https://github.com, puis un dépôt **public** (ex. `revi`).
2. Dans le dépôt : « Add file » > « Upload files ». Glisser **le contenu** du dossier `revi` (les fichiers et sous-dossiers, pas le dossier lui-même), puis « Commit changes ».
3. Settings > Pages > Source : « Deploy from a branch ». Choisir la branche `main` et le dossier `/ (root)`, puis enregistrer.
4. Après une minute ou deux, l'appli est en ligne à `https://votrepseudo.github.io/revi/`.

Pour mettre à jour : changer la version (section 9), puis « Upload files » à nouveau avec les fichiers modifiés (ils remplacent les anciens).

### Netlify (alternative par glisser-déposer)

- Se connecter sur https://app.netlify.com, puis glisser le dossier sur https://app.netlify.com/drop.
- Sans compte, le site est protégé par un mot de passe temporaire tant qu'il n'est pas réclamé. Selon l'offre, il peut rester privé jusqu'à ce qu'on le rende public.
- Pour mettre à jour : glisser le nouveau dossier dans « Production deploys » du projet.

### Installer sur les appareils

- **iPhone / iPad** : ouvrir l'adresse dans **Safari**, bouton Partager, puis « Sur l'écran d'accueil ».
- **Android / Chrome / Edge** : menu du navigateur, puis « Installer l'application » (ou bouton dans Réglages > Installer l'appli).

---

## 9. Publier une nouvelle version

1. Modifier le code.
2. Changer la version aux **deux** endroits (ex. `1.0.0` devient `1.0.1`) :
   - `js/version.js` : `APP_VERSION` ;
   - `sw.js` : `CACHE_VERSION`.
3. Si un fichier a été ajouté, l'ajouter à la liste `FILES` de `sw.js`. Le test `tests/e2e.py` vérifie que l'appli marche hors ligne.
4. Mettre en ligne. Sur chaque appareil, un message « Une nouvelle version de Révi est prête » propose « Mettre à jour ».

`config.js` est lu en priorité sur le réseau : un changement de configuration Firebase est pris en compte au rechargement suivant, même sans changer la version.

Pour reconstruire `vendor/firebase.js` (nouvelle version de Firebase, ou besoin d'une fonction de plus) :

```bash
npm i firebase esbuild
npx esbuild tools/firebase-entry.js --bundle --format=esm --minify --target=es2020 --outfile=vendor/firebase.js
```

---

## 10. Débogage

### Outils intégrés

- **Réglages > Diagnostic** : version, mode des données, état de connexion, synchro, service worker, navigateur, taille d'écran et 15 dernières erreurs. « Copier le rapport » pour le coller à Claude.
- **Console du navigateur** (ordinateur) :
  - `revi.store.state` : toutes les données en mémoire ;
  - `revi.errors` : journal d'erreurs ;
  - `revi.export()` : sauvegarde complète ;
  - `revi.go('/settings')` : changer de page.
- Sur iPhone, la console est accessible via un Mac (Safari > Développement). Le rapport de diagnostic est plus simple.

### Problèmes fréquents

| Symptôme | Cause probable | Solution |
|---|---|---|
| Les changements mis en ligne n'apparaissent pas | Ancienne version en cache | Changer `CACHE_VERSION` et `APP_VERSION`, remettre en ligne, puis accepter « Mettre à jour » (ou fermer et rouvrir l'appli). |
| « Firebase refuse l'accès » | Règles Firestore absentes ou mal collées | Section 7, étape 7. |
| « Ce site n'est pas autorisé dans Firebase » | Domaine non autorisé | Section 7, étape 5. |
| « Cette méthode de connexion n'est pas activée » | Fournisseur non activé | Section 7, étape 4. |
| La fenêtre Google ne s'ouvre pas sur iPhone (appli installée) | Limite des fenêtres dans les PWA iOS | Utiliser la connexion par email, ou se connecter une fois depuis Safari. |
| Les séries d'un appareil n'apparaissent pas sur l'autre | Pas le même compte, ou appareil hors ligne | Vérifier l'email dans Réglages et la pastille d'état sur les deux appareils. |
| « Impossible d'enregistrer sur cet appareil » | Stockage local plein ou bloqué (navigation privée) | Quitter la navigation privée, exporter une sauvegarde, se connecter pour utiliser Firestore. |
| Une page affiche « Cette page n'a pas pu s'afficher » | Erreur JavaScript dans la vue | Copier le rapport de diagnostic (la pile d'appel y est). |
| « Ce compte n'a pas accès à Révi » | Compte connecté absent de la liste d'UID, ou règles Firestore incorrectes | Se reconnecter avec le bon compte, ou corriger l'UID dans les règles (section 5.2). |

### Tests automatisés

Le dossier `tests/` contient des scripts Playwright (Python) :

- `e2e.py` : joue chaque mode sur mobile, ordinateur et en thème sombre, et vérifie :
  - les notes et la progression ;
  - l'import ;
  - la persistance ;
  - le service worker ;
  - le fonctionnement hors ligne.
- `cloud_local.py` : vérifie avec le vrai SDK Firestore (sans serveur) la fusion des patchs, `increment`, `deleteField` et le cache après rechargement.
- `cloud_smoke.py` : démarre l'appli avec une fausse configuration Firebase et vérifie le formulaire de connexion et les messages d'erreur.
- `gate_smoke.py` : vérifie la connexion obligatoire (toutes les pages bloquées, pas de « Créer un compte »), l'écran « compte refusé » et le message hors ligne.
- `_site.py` : utilitaire commun. Chaque test sert lui-même une copie de l'appli avec son propre `config.js`, sans jamais toucher au vrai projet Firebase.

Pour les lancer, depuis le dossier du projet :

```bash
pip install playwright && python3 -m playwright install chromium
python3 tests/e2e.py
python3 tests/gate_smoke.py
```

---

## 11. Limites connues et idées

- **Pas de répétition espacée datée**. Les niveaux 0/1/2 servent au mode Apprendre. Idée : ajouter `due` (date de prochaine révision) dans `progress.cards` et une vue « À réviser aujourd'hui ».
- **Pas d'images ni d'audio enregistré dans les cartes** : texte seulement, plus la synthèse vocale du navigateur.
- **Pas de partage de séries** entre comptes. Idée : collection publique `shared/{id}` avec des règles en lecture seule.
- **Pas de création automatique de cartes depuis un cours** (nécessiterait un service d'IA externe).
- **Mode Associer** : pas de version à glisser-déposer (toucher-toucher uniquement), et une seule taille de grille.
- **Conflits** : sur une même carte modifiée simultanément hors ligne sur deux appareils, la dernière modification gagne.
- La déconnexion ne vide pas le cache Firestore de l'appareil (pensé pour des appareils personnels).

---

## 12. Historique des versions

- **1.1.0** (17 octobre 2026) :
  - option `requireLogin` : écran de connexion obligatoire ;
  - option `allowSignup` ;
  - écran « compte refusé » au lieu d'un chargement sans fin quand Firestore refuse un compte ;
  - section Sécurité dans la documentation ;
  - tests autonomes (`tests/_site.py`, `tests/gate_smoke.py`).
- **1.0.0** (17 octobre 2026) : première version.
  - Modes Cartes, Apprendre, Test, Associer.
  - Statistiques et historique.
  - Import de texte.
  - Synchronisation Firebase avec cache hors ligne.
  - PWA installable, thème sombre, diagnostic intégré.
