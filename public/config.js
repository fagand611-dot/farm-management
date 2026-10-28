// Firebase web config for this farm's project.
// Copy the values from Firebase console > Project settings > General > Your apps > Web app.
// These values are not secret: access is controlled by the sign-in and the Firestore security rules.
//
// IMPORTANT: set authDomain to your Hosting address (e.g. "loughree-farm.web.app"),
// not the default "...firebaseapp.com". Google sign-in on iPhones depends on it. See README step 5.

export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "YOUR-PROJECT-ID.web.app",
  projectId: "YOUR-PROJECT-ID",
  storageBucket: "YOUR-PROJECT-ID.firebasestorage.app",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME",
};
