// Firebase web config for the loughree-farm project.
// From Firebase console > Project settings > General > Your apps > Web app (Config).
// These values are not secret: access is controlled by the sign-in and the Firestore security rules.
//
// authDomain is deliberately the Hosting address (loughree-farm.web.app), not the default
// "loughree-farm.firebaseapp.com". Google sign-in on iPhones depends on it. See README step 5.

export const firebaseConfig = {
  apiKey: "AIzaSyDrZkD5vEMdvnb3hbsr8VLfoNNDKLJwxYI",
  authDomain: "loughree-farm.web.app",
  projectId: "loughree-farm",
  storageBucket: "loughree-farm.firebasestorage.app",
  messagingSenderId: "405198054540",
  appId: "1:405198054540:web:55fcac3629b7032a5107a9",
  measurementId: "G-ZSPXSD78NS",
};
