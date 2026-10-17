export { initializeApp } from 'firebase/app';
export {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut
} from 'firebase/auth';
export {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection,
  setDoc, deleteDoc, onSnapshot, deleteField, increment
} from 'firebase/firestore';
