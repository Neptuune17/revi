// Configuration de la synchronisation entre appareils.
// - firebase: null  -> Révi fonctionne sans compte, les données restent sur l'appareil.
// - Pour synchroniser : remplacez null par l'objet firebaseConfig de votre projet Firebase
//   (console Firebase > Paramètres du projet > Vos applications > Configuration). Voir DOCUMENTATION.md.
// Ces valeurs ne sont pas secrètes : la sécurité vient des règles Firestore (fichier firestore.rules).
window.REVI_CONFIG = {
  firebase: {
    apiKey: "AIzaSyAezXAbzGk4MeEa7UpCMdN6hPVHAi2J3As",
    authDomain: "revi-18757.firebaseapp.com",
    projectId: "revi-18757",
    storageBucket: "revi-18757.firebasestorage.app",
    messagingSenderId: "1029115666673",
    appId: "1:1029115666673:web:c3ded4e9196db1f8fa4950",
  },
};
