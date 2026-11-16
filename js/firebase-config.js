/* ==========================================================================
   Firebase web app configuration (Project: gen-lang-client-0965379779).

   Required in the Firebase console:
   • Authentication → Sign-in method → Google: enabled
   • Firestore Database: created (default database)
   • Authentication → Settings → Authorized domains: your deployed domain
     (localhost is allowed by default)
   • Firestore rules from this repo deployed (owner-only sync document)

   The web API key below is a public client identifier, not a secret.
   ========================================================================== */

export const firebaseConfig = {
  apiKey: 'AIzaSyBvKOKObBwCM8nijyV8LRhP1FROwq3oV7U',
  authDomain: 'gen-lang-client-0965379779.firebaseapp.com',
  projectId: 'gen-lang-client-0965379779',
  storageBucket: 'gen-lang-client-0965379779.firebasestorage.app',
  messagingSenderId: '108217230951',
  appId: '1:108217230951:web:15843aa6255cf74fb1d6c2',
};

export const configured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId,
);
