// All Firebase imports live in this one file.
// To upgrade the SDK, change the version number in the three URLs below (and in sw.js, FIREBASE_VERSION).
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut,
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

export const configured = !Object.values(firebaseConfig).some(v => String(v).includes("REPLACE_ME") || String(v).includes("YOUR-PROJECT-ID"));

export const app = configured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
// Offline cache: reads come from the phone when there's no signal, and writes queue until it's back.
export const db = app ? initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
}) : null;

export {
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut,
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
};
